import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestApp, freshSession } from "../../test-support.js";
import { configureImageFetcher, isDownloadableImage, publicImageUrls } from "./media.js";
import { upsertCard } from "./service.js";

/**
 * Card images, downloaded once and served by ATEM.
 *
 * No test here goes out on the network: the download is substituted, and the
 * substitute counts its calls — “fetched once” is the property YGOPRODeck's
 * guide asks for, so it is the one measured.
 */
const mediaDir = mkdtempSync(path.join(tmpdir(), "atem-media-"));
process.env.ATEM_MEDIA_DIR = mediaDir;

const { app, db } = createTestApp();

const JPEG = Buffer.alloc(2048, 0xff);
let calls: string[] = [];

function serveImages(status = 200, type = "image/jpeg", body: Buffer = JPEG, delayMs = 0) {
  calls = [];
  configureImageFetcher(async (url) => {
    calls.push(url);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return new Response(body, { status, headers: { "content-type": type } });
  });
}

beforeEach(() => {
  delete process.env.ATEM_DISK_RESERVE_BYTES;
  serveImages();
});

async function seedCard(passcode: number, imageUrl: string | null) {
  await upsertCard(db, {
    passcode, nameEn: `Card ${passcode}`, nameFr: null, descEn: null, descFr: null,
    type: "Effect Monster", frameType: "effect", race: "Fish", attribute: "WATER",
    atk: 0, def: 0, level: 1, scale: null, linkValue: null, linkMarkers: null,
    archetype: null, banlistTcg: null,
    imageUrl, imageUrlSmall: imageUrl?.replace("/cards/", "/cards_small/") ?? null,
  });
}

test("only YGOPRODeck's image host, over HTTPS, is ever downloaded from", () => {
  assert.equal(isDownloadableImage("https://images.ygoprodeck.com/images/cards/89631139.jpg"), true);
  for (const url of [
    "https://images.ygoprodeck.com.attacker.example/x.jpg",
    "https://attacker.example/x.jpg",
    "http://images.ygoprodeck.com/x.jpg",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:3000/auth/me",
    "http://[::1]/",
    "file:///etc/passwd",
    "not a url",
    null,
  ]) {
    assert.equal(isDownloadableImage(url), false, String(url));
  }
});

test("a screen is given ATEM's address, never YGOPRODeck's", () => {
  const urls = publicImageUrls(73000001, {
    imageUrl: "https://images.ygoprodeck.com/images/cards/73000001.jpg",
    imageUrlSmall: "https://images.ygoprodeck.com/images/cards_small/73000001.jpg",
  });
  assert.deepEqual(urls, {
    imageUrl: "/media/cards/73000001.jpg",
    imageUrlSmall: "/media/cards/73000001-small.jpg",
  });

  // A URL we would refuse to download gives no image rather than a broken one.
  assert.deepEqual(
    publicImageUrls(73000002, { imageUrl: "https://attacker.example/x.jpg", imageUrlSmall: null }),
    { imageUrl: null, imageUrlSmall: null },
  );
});

test("an image is downloaded the first time, then served from disk", async () => {
  await seedCard(73000010, "https://images.ygoprodeck.com/images/cards/73000010.jpg");
  const { cookie } = await freshSession(app, "media-once");

  const first = await app.request("/media/cards/73000010-small.jpg", { headers: { cookie } });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "image/jpeg");
  assert.match(first.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(Buffer.from(await first.arrayBuffer()).length, JPEG.length);
  assert.deepEqual(calls, ["https://images.ygoprodeck.com/images/cards_small/73000010.jpg"]);

  const again = await app.request("/media/cards/73000010-small.jpg", { headers: { cookie } });
  assert.equal(again.status, 200);
  assert.equal(calls.length, 1, "the second request must not go out on the network");
});

test("simultaneous requests for the same image download it once", async () => {
  /**
   * A slow download, so the requests really overlap. With an instant one, the
   * first request has written the file before the others look at the disk, and
   * the test passes without the de-duplication it claims to measure — checked
   * by removing it.
   */
  serveImages(200, "image/jpeg", JPEG, 200);
  await seedCard(73000020, "https://images.ygoprodeck.com/images/cards/73000020.jpg");
  const { cookie } = await freshSession(app, "media-burst");

  const responses = await Promise.all(
    Array.from({ length: 5 }, () => app.request("/media/cards/73000020.jpg", { headers: { cookie } })),
  );
  assert.deepEqual(responses.map((r) => r.status), [200, 200, 200, 200, 200]);
  assert.equal(calls.length, 1);
});

test("the route needs a session", async () => {
  // Open to anyone, it would let a stranger make the instance pull every
  // artwork in the catalogue.
  await seedCard(73000030, "https://images.ygoprodeck.com/images/cards/73000030.jpg");
  const response = await app.request("/media/cards/73000030.jpg");
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("nothing but a passcode-named JPEG reaches the disk", async () => {
  const { cookie } = await freshSession(app, "media-names");
  for (const name of ["..%2F..%2Fetc%2Fpasswd", "73000040.png", "abc.jpg", "73000040-large.jpg", "-1.jpg"]) {
    const response = await app.request(`/media/cards/${name}`, { headers: { cookie } });
    assert.equal(response.status, 400, name);
  }
  assert.equal(calls.length, 0);
});

test("a card without a downloadable image answers 404, without going out", async () => {
  await seedCard(73000050, null);
  await seedCard(73000051, "https://attacker.example/73000051.jpg");
  const { cookie } = await freshSession(app, "media-none");

  for (const name of ["73000050.jpg", "73000051.jpg", "73999999.jpg"]) {
    const response = await app.request(`/media/cards/${name}`, { headers: { cookie } });
    assert.equal(response.status, 404, name);
  }
  assert.equal(calls.length, 0);
});

test("a failed download is not retried at every view", async () => {
  serveImages(404, "text/html");
  await seedCard(73000060, "https://images.ygoprodeck.com/images/cards/73000060.jpg");
  const { cookie } = await freshSession(app, "media-failed");

  for (let view = 0; view < 3; view += 1) {
    const response = await app.request("/media/cards/73000060.jpg", { headers: { cookie } });
    assert.equal(response.status, 404);
  }
  assert.equal(calls.length, 1, "a missing remote image is asked for once per hour, not per view");
});

test("what is not an image is not written", async () => {
  serveImages(200, "text/html", Buffer.from("<html>not an image</html>".repeat(10)));
  await seedCard(73000070, "https://images.ygoprodeck.com/images/cards/73000070.jpg");
  const { cookie } = await freshSession(app, "media-type");

  const response = await app.request("/media/cards/73000070.jpg", { headers: { cookie } });
  assert.equal(response.status, 404);
  const stored = await readdir(path.join(mediaDir, "cards")).catch(() => []);
  assert.equal(stored.some((name) => name.startsWith("73000070")), false);
});

test("below the disk reserve, nothing is downloaded", async () => {
  // Fetching an image only to throw it away would spend outbound rate for
  // nothing, and a full disk is what stops PostgreSQL writing its log.
  process.env.ATEM_DISK_RESERVE_BYTES = String(Number.MAX_SAFE_INTEGER);
  await seedCard(73000080, "https://images.ygoprodeck.com/images/cards/73000080.jpg");
  const { cookie } = await freshSession(app, "media-disk");

  const response = await app.request("/media/cards/73000080.jpg", { headers: { cookie } });
  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
});
