/**
 * Card images, downloaded once and served by ATEM.
 *
 * The screens used to load artworks straight from `images.ygoprodeck.com`.
 * YGOPRODeck's API guide forbids it: “You must download and store these images
 * yourself!” — and continued hot-linking “will result in an IP blacklist”. It
 * also sent every viewer's browser to a third party, and kept any content
 * security policy from closing the page to outside hosts.
 *
 * So an image is fetched **the first time someone asks for it**, through the
 * outbound token bucket, written to disk, and served from there forever: a
 * passcode identifies a card, and a card's artwork does not change. Nothing is
 * downloaded ahead of need — the catalogue holds 14,524 cards, and pulling
 * artworks nobody looks at is exactly the volume the guide warns against.
 *
 * Taken from the earlier prototype's media cache, with two of its defects left behind: a download no longer runs in a
 * request that did not ask for an image, and there is **no fallback to the
 * remote URL** — a missing image is a missing image, not a hot-link.
 */
import { randomBytes } from "node:crypto";
import { mkdir, rename, stat, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { loggableError } from "../../platform/errors.js";
import { retryAfterMs, throttleOutbound, withOutboundSlot } from "./outbound-rate.js";

export type ImageVariant = "full" | "small";

/** Where images live on disk. `ATEM_MEDIA_DIR` in production, a volume. */
function mediaRoot(): string {
  return process.env.ATEM_MEDIA_DIR ?? path.resolve(import.meta.dirname, "../../../../../data/media");
}

const fileName = (passcode: number, variant: ImageVariant) =>
  variant === "small" ? `${passcode}-small.jpg` : `${passcode}.jpg`;

const imagePath = (passcode: number, variant: ImageVariant) =>
  path.join(mediaRoot(), "cards", fileName(passcode, variant));

/**
 * The hosts an image may be downloaded from — an allowlist, and HTTPS only.
 *
 * The URL is not built by us: it is copied from YGOPRODeck's response. Without
 * this check the server fetches whatever a third party designates — a cloud
 * provider's metadata address, a service listening only on the loopback. That
 * is server-side request forgery, and it only takes a tampered upstream
 * response. Filtering private addresses is not enough: a name can resolve to
 * one after the check. Plain HTTP is refused too: anyone on the path would
 * choose what the server writes to its disk.
 */
const ALLOWED_HOSTS = new Set(["images.ygoprodeck.com"]);

export function isDownloadableImage(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * The address a screen uses for a card's image, or `null` when there is none.
 *
 * `null` when the catalogue has no image, and also when its URL is not one we
 * would download: pointing the screen at a route that is bound to answer 404
 * would only draw a broken image.
 */
export function publicImageUrls(
  passcode: number,
  source: { imageUrl: string | null; imageUrlSmall: string | null },
): { imageUrl: string | null; imageUrlSmall: string | null } {
  return {
    imageUrl: isDownloadableImage(source.imageUrl) ? `/media/cards/${fileName(passcode, "full")}` : null,
    imageUrlSmall: isDownloadableImage(source.imageUrlSmall)
      ? `/media/cards/${fileName(passcode, "small")}`
      : null,
  };
}

/**
 * What is always left free on the media disk.
 *
 * A full disk does not fail loudly: the write fails, the card shows without its
 * artwork, and one suspects the catalogue — while PostgreSQL, often on the same
 * disk, stops writing its transaction log. So we stop writing images **before**
 * that, while there is room left to diagnose, back up and clean. Two hundred
 * megabytes by default (an artwork weighs about 155 kB); `ATEM_DISK_RESERVE_BYTES`
 * adjusts it, which is also what makes the full-disk case testable.
 */
const DEFAULT_RESERVE_BYTES = 200 * 1024 * 1024;

function reserveBytes(): number {
  const raw = (process.env.ATEM_DISK_RESERVE_BYTES ?? "").trim();
  const value = Number(raw);
  return raw !== "" && Number.isFinite(value) && value >= 0 ? value : DEFAULT_RESERVE_BYTES;
}

/**
 * Room is checked before downloading, not after: fetching an image only to
 * throw it away spends outbound rate for nothing. When the free space cannot be
 * measured, writing goes ahead — refusing everything because a system call
 * failed would be worse than a write that may fail.
 */
async function hasRoomToWrite(): Promise<boolean> {
  try {
    const fs = await statfs(mediaRoot());
    return Number(fs.bsize) * Number(fs.bavail) >= reserveBytes();
  } catch {
    return true;
  }
}

/** An artwork is about 155 kB; anything this far off is not a card image. */
const MIN_BYTES = 100;
const MAX_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

/**
 * How the bytes are fetched — replaced by tests, which never go out on the
 * network.
 *
 * `redirect: "error"`: a redirect would take the download to a host the
 * allowlist never saw.
 */
type ImageFetcher = (url: string) => Promise<Response>;

const networkFetcher: ImageFetcher = (url) =>
  withOutboundSlot(() =>
    fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { Accept: "image/jpeg", "User-Agent": "ATEM (self-hosted; image cache)" },
    }),
  );

let fetchImage: ImageFetcher = networkFetcher;

/** Test hook: substitutes the download. `null` restores the network. */
export function configureImageFetcher(fetcher: ImageFetcher | null): void {
  fetchImage = fetcher ?? networkFetcher;
  inFlight.clear();
  failedAt.clear();
}

/**
 * One download per file, however many requests ask at once.
 *
 * A gallery of sixty new cards fires sixty image requests; without this, two
 * requests for the same artwork would each spend a token and race to write it.
 */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * A download that failed is not retried for an hour.
 *
 * Otherwise every view of a card whose image YGOPRODeck no longer serves would
 * go out on the network again — repeated pulls of the same missing file.
 */
const failedAt = new Map<string, number>();
const RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * The image's path on disk, downloading it first if needed — or `null` when it
 * cannot be had.
 */
export async function ensureCardImage(
  passcode: number,
  variant: ImageVariant,
  remoteUrl: string | null,
): Promise<string | null> {
  const target = imagePath(passcode, variant);
  if (await isStored(target)) return target;
  if (!isDownloadableImage(remoteUrl)) return null;

  const failed = failedAt.get(target);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return null;

  let pending = inFlight.get(target);
  if (!pending) {
    pending = download(remoteUrl!, target).finally(() => inFlight.delete(target));
    inFlight.set(target, pending);
  }
  return pending;
}

async function isStored(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function download(url: string, target: string): Promise<string | null> {
  await mkdir(path.dirname(target), { recursive: true });
  if (!(await hasRoomToWrite())) {
    console.warn(`[atem] media: not enough disk space, ${path.basename(target)} not downloaded`);
    return null;
  }

  // A unique temporary name: two processes sharing the volume must not write
  // into each other's half-written file. `rename` then makes the file appear
  // whole or not at all.
  const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const response = await fetchImage(url);
    if (response.status === 429) {
      // The image server is YGOPRODeck too: its refusal slows down the whole
      // bucket, API calls included, exactly as a 429 from the API does.
      throttleOutbound(retryAfterMs(response.headers.get("retry-after")) ?? 60_000);
    }
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) {
      console.warn(`[atem] media: ${url} answered ${response.status} ${type}`);
      failedAt.set(target, Date.now());
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) {
      console.warn(`[atem] media: ${url} weighs ${bytes.length} bytes, refused`);
      failedAt.set(target, Date.now());
      return null;
    }
    await writeFile(temporary, bytes);
    await rename(temporary, target);
    return target;
  } catch (error) {
    console.warn(`[atem] media: download of ${url} failed:`, loggableError(error));
    failedAt.set(target, Date.now());
    await unlink(temporary).catch(() => {});
    return null;
  }
}
