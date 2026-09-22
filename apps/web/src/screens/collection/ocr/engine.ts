/**
 * Set-code recognition in the browser.
 *
 * Taken from the earlier prototype with no change of logic. Three exported functions were
 * removed — a worker-availability flag, a loading-state label and a crop
 * preview — which served its interface and that ours does not call. Nothing
 * else moved.
 *
 * Browser OCR for Yu-Gi-Oh! set codes (~9 chars, e.g. LTGY-FR008).
 * Tesseract.js from CDN — no local LLM. Prefer zoom-band mode: user frames
 * only the set-code line in a thin horizontal strip.
 */

export type OcrSetCodeResult = {
  text: string;
  code: string | null;
  candidates: string[];
  confidence: number;
  /** What Tesseract actually received (debug / UI preview). */
  cropDataUrl?: string;
};

export type OcrProgressStatus =
  | "crop"
  | "loading"
  | "recognizing"
  | "done"
  | string;

type TessWorker = {
  recognize: (
    image: HTMLCanvasElement | string,
  ) => Promise<{ data: { text: string; confidence: number } }>;
  setParameters: (p: Record<string, string>) => Promise<void>;
  terminate: () => Promise<void>;
};

type TessCreateWorker = (
  langs?: string,
  oem?: number,
  options?: Record<string, unknown>,
) => Promise<TessWorker>;

declare global {
  interface Window {
    Tesseract?: {
      recognize: (
        image: HTMLCanvasElement | HTMLImageElement | File | Blob | string,
        langs?: string,
        options?: Record<string, unknown>,
      ) => Promise<{ data: { text: string; confidence: number } }>;
      createWorker: TessCreateWorker;
    };
  }
}

/*
 * The engine is served from our own domain, not from a CDN.
 *
 * It came from `cdn.jsdelivr.net`: third-party code running in our origin, at
 * every opening of the scan screen. The session cookie is `httpOnly`, so that
 * code could not read it — but it could call the API on behalf of the signed-in
 * person. And pinning by version protected nothing: it is the CDN that decides
 * what it serves under that name.
 *
 * `scripts/vendor-tesseract.sh` downloads them once and **checks their
 * fingerprint**. A pinned version trusts a name; a fingerprint trusts only the
 * content.
 *
 * It removed the only outside *script* host, which is what let the page be closed
 * to outside hosts entirely (ADR-010, 2026-09-16): `script-src 'self'`, with
 * `'wasm-unsafe-eval'` and `blob:` for the WebAssembly core and its worker — and
 * nothing else. So the engine only starts as long as it is served from here, and
 * `e2e/security.spec.ts` starts it under the real policy to prove it.
 */
const TESSERACT_CDN = "/tesseract/tesseract.min.js";
const TESSERACT_BASE = "/tesseract";
/**
 * Non-SIMD LSTM core — SIMD can hang/fail on some mobile CPUs.
 * (~slightly slower, much more reliable on phones)
 */
const TESSERACT_CORE = "/tesseract/tesseract-core-lstm.wasm.js";
/** ~2.9 MB compressed — the `best_int` variant, lighter than the full 4.0.0. */
const TESSERACT_LANG = "/tesseract/lang";

/** Script tag load timeout (ms). */
const SCRIPT_LOAD_MS = 20_000;
/** Worker create + lang download timeout (ms). Mobile CDN can be slow. */
const WORKER_CREATE_MS = 45_000;

let loadPromise: Promise<NonNullable<Window["Tesseract"]>> | null = null;
let workerPromise: Promise<TessWorker> | null = null;

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label}_timeout_${Math.round(ms / 1000)}s`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function loadTesseract(): Promise<NonNullable<Window["Tesseract"]>> {
  if (typeof window !== "undefined" && window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-atem-tesseract]",
    );
    if (existing && window.Tesseract) {
      resolve(window.Tesseract);
      return;
    }
    const s = document.createElement("script");
    s.src = TESSERACT_CDN;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.dataset.atemTesseract = "1";
    const timer = setTimeout(() => {
      s.onload = null;
      s.onerror = null;
      loadPromise = null;
      reject(new Error("tesseract_script_timeout"));
    }, SCRIPT_LOAD_MS);
    s.onload = () => {
      clearTimeout(timer);
      if (window.Tesseract) resolve(window.Tesseract);
      else {
        loadPromise = null;
        reject(new Error("tesseract_global_missing"));
      }
    };
    s.onerror = () => {
      clearTimeout(timer);
      loadPromise = null;
      reject(new Error("tesseract_cdn_failed"));
    };
    document.head.appendChild(s);
  });
  return loadPromise;
}

/**
 * Singleton worker so whitelist / PSM stick (recognize() options are flaky).
 * onProgress receives tesseract logger status during first init.
 */
async function getOcrWorker(
  onProgress?: (status: string, progress: number) => void,
): Promise<TessWorker> {
  if (workerPromise) {
    try {
      return await workerPromise;
    } catch (e) {
      workerPromise = null;
      throw e;
    }
  }
  workerPromise = (async () => {
    onProgress?.("loading_script", 0.05);
    const T = await loadTesseract();
    if (typeof T.createWorker !== "function") {
      throw new Error("tesseract_createWorker_missing");
    }
    onProgress?.("loading_core", 0.15);
    const worker = await withTimeout(
      T.createWorker("eng", 1, {
        workerPath: `${TESSERACT_BASE}/worker.min.js`,
        corePath: TESSERACT_CORE,
        langPath: TESSERACT_LANG,
        logger: (m: { status?: string; progress?: number }) => {
          const st = m.status || "loading";
          const pr =
            typeof m.progress === "number" ? Math.max(0, Math.min(1, m.progress)) : 0;
          // Map tesseract statuses into 0.15–0.9
          const base = 0.15 + pr * 0.75;
          onProgress?.(st, base);
        },
      }),
      WORKER_CREATE_MS,
      "tesseract_worker",
    );
    onProgress?.("configuring", 0.92);
    await worker.setParameters({
      // Single text line — set codes are one line
      tessedit_pageseg_mode: "7",
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
      // Prefer dictionary-free (set codes are not English words)
      load_system_dawg: "0",
      load_freq_dawg: "0",
    });
    onProgress?.("ready", 1);
    return worker;
  })();
  try {
    return await workerPromise;
  } catch (e) {
    workerPromise = null;
    throw e;
  }
}

/** Normalize a set-code token for compare / UI (upper, no spaces, single hyphens). */
function normalizeSetCodeToken(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "").replace(/-+/g, "-");
}

/** OCR noise fixes common on set codes. */
export function fixOcrNoise(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\|/g, "I")
    .replace(/[^A-Z0-9\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Letter → digit in the *print number* only (never apply to set prefixes).
 * One letter → one nearest digit (S→5, B→8, …). Shared by early token fix + variants.
 */
const PRINT_LETTER_TO_DIGIT: Readonly<Record<string, string>> = {
  O: "0",
  U: "0",
  D: "0",
  Q: "0",
  I: "1",
  L: "1",
  Z: "2",
  S: "5",
  G: "6",
  B: "8",
};

function mapPrintLettersToDigits(num: string): string {
  return num
    .toUpperCase()
    .replace(/[OUDQILZSGB]/g, (ch) => PRINT_LETTER_TO_DIGIT[ch] ?? ch);
}

/** Known YGO language tags (after set prefix). */
const LANG_TAGS = new Set([
  "FR",
  "EN",
  "DE",
  "IT",
  "ES",
  "PT",
  "JP",
  "KR",
  "AE",
  "TC",
  "SC",
]);

function isLangTag(lang: string): boolean {
  return LANG_TAGS.has(lang) || lang === "OC";
}

/**
 * Apply print-letter→digit map only on real set-code tokens
 * (lang must be a known tag — avoids YUGI-OH-LOB nonsense).
 */
function applyDigitLetterFixes(s: string): string {
  return s.replace(
    /\b([A-Z0-9]{2,6})\s*[-–—]?\s*([A-Z]{2})\s*[-–—]?\s*([A-Z0-9]{2,5})\b/g,
    (full, pref: string, lang: string, num: string) => {
      if (!isLangTag(lang)) return full;
      return `${pref}-${lang}${mapPrintLettersToDigits(num)}`;
    },
  );
}

/**
 * Print-number variants after FR/EN/… — 1:1 letter→digit (+ optional 2→3 pad).
 * FR03S → 035 · FR00S → 005 · FR03B → 038 · O8 → 08 → 008
 */
function digitishVariants(num: string): string[] {
  const base = num.toUpperCase();
  const out = new Set<string>();
  out.add(base);
  out.add(mapPrintLettersToDigits(base));

  // Pure digits only (do NOT strip letters then re-pad: invents FR003).
  // Zero-pad 2→3 only when source still had a letter (O8 → 08 → 008).
  for (const v of [...out]) {
    if (/^\d{2,4}$/.test(v) && !/^0+$/.test(v)) {
      out.add(v);
      if (v.length === 2 && /[A-Z]/.test(base)) out.add("0" + v);
    }
  }
  return [...out];
}

/** Modern PREFIX-LANG### (pure digits). Used by strong / chips / score. */
type ModernSetParts = { prefix: string; lang: string; num: string };

function parseModernSetCode(
  code: string,
  opts?: { pureDigitsOnly?: boolean },
): ModernSetParts | null {
  const c = normalizeSetCodeToken(code);
  const pure = opts?.pureDigitsOnly !== false;
  const m = pure
    ? c.match(/^([A-Z0-9]{2,5})-([A-Z]{2})(\d{3,4})$/)
    : c.match(/^([A-Z0-9]{2,5})-([A-Z]{2})(\d{2,4})([A-Z]?)$/);
  if (!m) return null;
  const prefix = m[1]!;
  const lang = m[2]!;
  const num = m[3]!;
  if (!isLangTag(lang)) return null;
  if (!isValidPrefixShape(prefix)) return null;
  return { prefix, lang, num };
}

/**
 * Minimal offline fallback — used by unit tests and before the static JSON loads.
 * Full catalogue = apps/web/public/ocr/set-prefixes.json
 * (generated by scripts/ocr-lab/build-set-dict.py).
 */
const FALLBACK_SET_PREFIXES = new Set([
  "LOB",
  "MRD",
  "SRL",
  "PSV",
  "MRL",
  "LON",
  "LOD",
  "PGD",
  "MFC",
  "DCR",
  "IOC",
  "AST",
  "SOD",
  "RDS",
  "FET",
  "TLM",
  "CRV",
  "EEN",
  "SOI",
  "EOJ",
  "POT",
  "CDIP",
  "STON",
  "FOTB",
  "TAEV",
  "GLAS",
  "PTDN",
  "LODT",
  "TDGS",
  "CSOC",
  "CRMS",
  "RGBT",
  "ANPR",
  "SOVR",
  "ABPF",
  "TSHD",
  "DREV",
  "STBL",
  "STOR",
  "EXVC",
  "GENF",
  "PHSW",
  "ORCS",
  "GAOV",
  "REDU",
  "ABYR",
  "CBLZ",
  "LTGY",
  "NUMH",
  "JOTL",
  "LVAL",
  "PRIO",
  "DUEA",
  "NECH",
  "SECE",
  "CROS",
  "CORE",
  "DOCS",
  "BOSH",
  "SHVI",
  "TDIL",
  "INOV",
  "RATE",
  "MACR",
  "COTD",
  "CIBR",
  "EXFO",
  "FLOD",
  "CYHO",
  "SOFU",
  "SAST",
  "DANE",
  "RIRA",
  "CHIM",
  "IGAS",
  "ETCO",
  "ROTD",
  "PHRA",
  "BLVO",
  "LIOV",
  "DAMA",
  "BODE",
  "BACH",
  "DIFO",
  "POTE",
  "DABL",
  "PHHY",
  "CYAC",
  "DUNE",
  "AGOV",
  "PHNI",
  "LEDE",
  "SUDA",
  "INFO",
  "ALIN",
  "DUAD",
  "SDS1",
  "SDRE",
  "SDBE",
  "SDSE",
  "SDCS",
  "MP14",
  "MP15",
  "MP16",
  "MP17",
  "MP18",
  "MP19",
  "MP20",
  "MP21",
  "MP22",
  "MP23",
  "MP24",
  "RA01",
  "RA02",
  "RA03",
  "RA04",
  "MAGO",
  "GFP2",
  "BLCR",
  "BLMR",
  "DUDE",
  "YGLD",
  "SGX1",
  "SGX2",
  "SGX3",
  // Digit-leading prefixes (Starter Deck 5D's, …)
  "5DS1",
  "5DS2",
  "5DS3",
]);

/** Valid set prefix shape: 2–5 alnum, ≥1 letter (may start with digit). */
function isValidPrefixShape(p: string): boolean {
  return /^(?=.*[A-Z])[A-Z0-9]{2,5}$/.test(p);
}

/** Live catalogue from /ocr/set-prefixes.json (null = use fallback). */
let livePrefixes: Set<string> | null = null;
/** prefix → set of print numbers ("008", "010", …) when JSON has prints. */
let livePrints: Map<string, Set<string>> | null = null;
let setDictLoadPromise: Promise<boolean> | null = null;

export type OcrSetDict = {
  prefixes: string[];
  prints?: Record<string, string[]>;
  generated_at?: string;
  source?: string;
};

function knownPrefixes(): Set<string> {
  return livePrefixes ?? FALLBACK_SET_PREFIXES;
}

/** Cached 3-letter prefixes from current known set (invalidated on dict apply). */
let classicThreeCache: Set<string> | null = null;

function classicThreeLetter(): Set<string> {
  if (classicThreeCache) return classicThreeCache;
  const out = new Set<string>();
  for (const p of knownPrefixes()) {
    if (p.length === 3) out.add(p);
  }
  classicThreeCache = out;
  return out;
}

/** Apply a dict object (tests or after fetch). */
export function applySetDict(dict: OcrSetDict): void {
  classicThreeCache = null;
  const prefs = new Set<string>();
  for (const p of dict.prefixes ?? []) {
    const u = String(p).toUpperCase().trim();
    if (isValidPrefixShape(u)) prefs.add(u);
  }
  // Always keep fallback as floor so tests/offline never lose critical sets
  for (const p of FALLBACK_SET_PREFIXES) prefs.add(p);
  livePrefixes = prefs;

  if (dict.prints && typeof dict.prints === "object") {
    const m = new Map<string, Set<string>>();
    for (const [k, nums] of Object.entries(dict.prints)) {
      const pref = k.toUpperCase();
      if (!prefs.has(pref) || !Array.isArray(nums)) continue;
      const set = new Set<string>();
      for (const n of nums) {
        const d = String(n).replace(/\D/g, "");
        if (d.length >= 2 && d.length <= 4) set.add(d);
      }
      if (set.size) m.set(pref, set);
    }
    livePrints = m.size ? m : null;
  } else {
    livePrints = null;
  }
}

/** Reset to fallback only (unit tests). */
export function resetSetDictForTests(): void {
  livePrefixes = null;
  livePrints = null;
  setDictLoadPromise = null;
  classicThreeCache = null;
}

/**
 * Load static asset once. Safe to call multiple times.
 * Default path served by Vite from public/ocr/set-prefixes.json.
 */
export async function ensureSetDictLoaded(
  url = "/ocr/set-prefixes.json",
): Promise<boolean> {
  if (livePrefixes && livePrefixes.size > FALLBACK_SET_PREFIXES.size) {
    return true;
  }
  if (setDictLoadPromise) return setDictLoadPromise;
  setDictLoadPromise = (async () => {
    try {
      if (typeof fetch !== "function") return false;
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) {
        setDictLoadPromise = null;
        return false;
      }
      const json = (await res.json()) as OcrSetDict;
      if (!json?.prefixes?.length) {
        setDictLoadPromise = null;
        return false;
      }
      applySetDict(json);
      return true;
    } catch {
      setDictLoadPromise = null;
      return false;
    }
  })();
  return setDictLoadPromise;
}

/** Levenshtein — used only for print-number snap (small digit strings), not prefixes. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array<number>(n + 1);
  const cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j]!;
  }
  return prev[n]!;
}

/**
 * Snap a digit tail to a known print number for this prefix (Gemini dict step).
 * Only when distance ≤1 and a unique best match — avoids inventing wrong cards.
 */
function snapPrintNumber(prefix: string, num: string): string[] {
  const prints = livePrints?.get(prefix.toUpperCase());
  if (!prints || !prints.size) return [];
  const digits = num.replace(/\D/g, "");
  if (!digits) return [];
  if (prints.has(digits)) return [digits];

  const out = new Set<string>();
  // Same length, Levenshtein ≤1 (e.g. 038→035, 082→084)
  for (const p of prints) {
    if (p.length !== digits.length) continue;
    if (levenshtein(digits, p) <= 1) out.add(p);
  }
  // Do NOT zero-pad 2→3 into the catalogue (03 → 003).
  // Full RGBT prints include 001…100: sliding-window truncation RGBTFR035 → FR03
  // then pad-to-003 invents a real but wrong card that ties FR035 on score.
  return [...out];
}

/**
 * OCR glyph confusions inside set *prefixes* (not free Levenshtein).
 * Digit/letter: 5DSI↔5DS1, SDSI↔SDS1, RAO4↔RA04.
 * Letter/letter: I↔L (ITGY→LTGY), I↔T (RGBI→RGBT, LIGY→LTGY), T↔L (ATIN→ALIN),
 * O↔G (LIOY→LIGY→LTGY). ~0 real catalogue collisions for these letter pairs.
 * Do NOT add R↔B (SDBE↔SDRE etc.).
 */
const PREFIX_GLYPH_PAIRS: readonly [string, string][] = [
  ["I", "1"],
  ["1", "I"],
  ["O", "0"],
  ["0", "O"],
  ["S", "5"],
  ["5", "S"],
  ["B", "8"],
  ["8", "B"],
  ["Z", "2"],
  ["2", "Z"],
  ["G", "6"],
  ["6", "G"],
  ["O", "G"],
  ["G", "O"],
  ["I", "L"],
  ["L", "I"],
  ["I", "T"],
  ["T", "I"],
  ["T", "L"],
  ["L", "T"],
];

/** One-substitution glyph forms (always includes the original). */
function prefixGlyphForms1(prefix: string): string[] {
  const p = prefix.toUpperCase();
  const out = new Set<string>([p]);
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]!;
    for (const [a, b] of PREFIX_GLYPH_PAIRS) {
      if (ch === a) out.add(p.slice(0, i) + b + p.slice(i + 1));
    }
  }
  return [...out].filter(isValidPrefixShape);
}

/**
 * Glyph forms with up to `maxSubs` substitutions (default 2).
 * 2-sub needed for e.g. LIOY → LIGY → LTGY (O→G then I→T).
 */
function prefixGlyphForms(prefix: string, maxSubs = 2): string[] {
  let frontier = new Set<string>([prefix.toUpperCase()]);
  const all = new Set<string>(frontier);
  for (let step = 0; step < maxSubs; step++) {
    const next = new Set<string>();
    for (const form of frontier) {
      for (const g of prefixGlyphForms1(form)) {
        if (!all.has(g)) {
          all.add(g);
          next.add(g);
        }
      }
    }
    frontier = next;
    if (!frontier.size) break;
  }
  return [...all].filter(isValidPrefixShape);
}

/**
 * Map OCR prefix → known catalogue prefixes via glyph confusions only.
 * No free Levenshtein (that snapped TALN→ALIN, AP01→OP01, etc.).
 *
 * If the OCR prefix is already a known set, keep it only — do not fan out to
 * glyph twins (SDS1 must not become 5DS1 via S↔5).
 *
 * Prefer same *leading class* (digit vs letter) so 5DSI → 5DS1 not SDS1.
 */
function fuzzyKnownPrefixes(prefix: string): string[] {
  const known = knownPrefixes();
  const orig = prefix.toUpperCase();
  if (known.has(orig)) return [orig];

  const origDigitLead = /^\d/.test(orig);
  const hits = new Set<string>();
  for (const form of prefixGlyphForms(orig, 2)) {
    if (known.has(form)) hits.add(form);
  }
  if (!hits.size) return [];
  const sameLead = [...hits].filter((k) => /^\d/.test(k) === origDigitLead);
  return sameLead.length ? sameLead : [...hits];
}

/** True if `full` is `short` with exactly one character inserted. */
function isOneCharInsert(full: string, short: string): boolean {
  if (full.length !== short.length + 1) return false;
  let i = 0;
  let j = 0;
  let skipped = 0;
  while (i < full.length && j < short.length) {
    if (full[i] === short[j]) {
      i++;
      j++;
    } else {
      skipped++;
      i++;
      if (skipped > 1) return false;
    }
  }
  if (j !== short.length) return false;
  skipped += full.length - i;
  return skipped === 1;
}

/**
 * Known prefixes obtained by inserting exactly one character into `p`.
 * LGY→LTGY, TGY→LTGY, LTG→LTGY — only catalogue hits, no free invent.
 */
function knownOneInsertCompletions(prefix: string): string[] {
  const p = prefix.toUpperCase();
  const known = knownPrefixes();
  const out: string[] = [];
  for (const k of known) {
    if (isOneCharInsert(k, p)) out.push(k);
  }
  return out;
}

/**
 * Known prefixes that are `p` + one trailing char (RGB→RGBT when unique-ish).
 * Also `p` + digit when OCR drops a trailing digit (SDS→SDS1).
 */
function knownLengthPlusOne(prefix: string): string[] {
  const p = prefix.toUpperCase();
  const known = knownPrefixes();
  const out: string[] = [];
  for (const k of known) {
    if (k.length === p.length + 1 && k.startsWith(p)) out.push(k);
  }
  return out;
}

/**
 * Language tag variants — FR cards often OCR as IT (F→I, R→T).
 * Expand toward FR only (inventory is FR-first); never invent IT from FR.
 */
function langVariants(lang: string): string[] {
  const L = lang.toUpperCase();
  const out = new Set<string>([L]);
  if (L === "IT" || L === "IR" || L === "TR" || L === "FT" || L === "ER") {
    out.add("FR");
  }
  if (L === "FN" || L === "EN") {
    // EN is real; still offer FR for FR-market phones (rank prefers FR)
    out.add("FR");
  }
  if (L === "F8" || L === "F0") out.add("FR");
  return [...out].filter(isLangTag);
}

/**
 * Prefix repairs — evidence-based only:
 *  - collapse OCR stutter (LTGGY → LTGY)
 *  - strip one leading junk letter (TLTGY → LTGY), never a leading digit (5DS1)
 *  - glyph confusions (≤2 subs) that land on a known catalogue prefix
 *  - one-char insert/completion that lands on a known prefix (LGY→LTGY, RGB→RGBT)
 *  - SDS/SDST → SDS1 when SDS1 is known (trailing digit lost; not 5DS1)
 *
 * No free Levenshtein across the catalogue (false locks: TALN→ALIN, LIN→LTIN).
 */
function prefixVariants(prefix: string): string[] {
  const p = prefix.toUpperCase();
  const out = new Set<string>([p]);
  const known = knownPrefixes();

  const add = (x: string) => {
    if (x.length >= 2 && x.length <= 5 && isValidPrefixShape(x)) out.add(x);
  };

  // Collapse OCR stutter (LTGGY → LTGY) ONLY when the raw prefix is unknown.
  // Real sets with double letters (DOOD, BLLR, …) must not become DOD / BLR.
  const collapsed = p.replace(/(.)\1+/g, "$1");
  if (
    collapsed !== p &&
    collapsed.length >= 2 &&
    collapsed.length <= 5 &&
    !known.has(p) &&
    known.has(collapsed)
  ) {
    add(collapsed);
  }

  // Leading junk before a 4-letter prefix (TLTGY / TLIGY / ILTGY)
  // Do NOT strip a leading digit from 5DS1.
  if (p.length === 5 && /^[A-Z]/.test(p)) {
    const tail = p.slice(1);
    add(tail);
    const ct = tail.replace(/(.)\1+/g, "$1");
    if (ct.length >= 3 && ct.length <= 4) add(ct);
  }
  // Digit/punct junk lead: 7LTGY → LTGY
  if (p.length === 5 && /^\d/.test(p)) {
    add(p.slice(1));
  }

  // SDST: trailing T often misread digit slot → SDS1 (not 5DS1)
  if (p === "SDS" || p === "SDST") {
    if (known.has("SDS1")) add("SDS1");
  }

  // Expand seeds with catalogue-grounded completions + glyph snaps
  for (const seed of [...out]) {
    // One-char insert only when unique (LGY→LTGY; SDS has many inserts → skip)
    const inserts = knownOneInsertCompletions(seed);
    if (inserts.length === 1) add(inserts[0]!);
    const plus1 = knownLengthPlusOne(seed);
    // Only when unique (RGB→RGBT) — avoid SD→SD1/SD2/… explosion
    if (plus1.length === 1) add(plus1[0]!);
    // Trailing digit often dropped (SDS→SDS1) even if other letter extensions exist
    if (known.has(seed + "1")) add(seed + "1");
    for (const k of fuzzyKnownPrefixes(seed)) add(k);
  }

  return [...out].filter(isValidPrefixShape);
}

/**
 * Repair a near-set-code into plausible forms (folder 4 confusions).
 * Exported for unit tests.
 */
export function repairSetCodeCandidate(code: string): string[] {
  const raw = code.toUpperCase().replace(/\s+/g, "");
  const m = raw.match(/^([A-Z0-9]{2,6})-([A-Z]{2})([A-Z0-9]{2,5})$/);
  if (!m) return [raw];
  const [, prefix, lang, num] = m;
  if (!isLangTag(lang!)) return [raw];

  const found = new Set<string>();
  found.add(raw);
  for (const p of prefixVariants(prefix!)) {
    for (const lg of langVariants(lang!)) {
      const digitVars = new Set(digitishVariants(num!));
      // Catalogue snap: FR038 → FR035 when only 035 is a real print (Gemini dict)
      for (const n of [...digitVars]) {
        if (/^\d{2,4}$/.test(n)) {
          for (const snapped of snapPrintNumber(p, n)) digitVars.add(snapped);
        }
      }
      for (const n of digitVars) {
        // Prefer pure 3–4 digit numbers after language tag
        if (/^\d{3,4}$/.test(n)) found.add(`${p}-${lg}${n}`);
        if (/^\d{2,4}[A-Z]?$/.test(n)) found.add(`${p}-${lg}${n}`);
      }
    }
  }
  return [...found];
}

function isPlausibleSetCode(code: string): boolean {
  if (/^\d{8}$/.test(code)) return false;
  if (!/[A-Z]/.test(code)) return false;
  // Prefix (set abbreviation) must contain a letter — reject "12-3456"
  const prefix = code.split("-")[0] ?? "";
  if (!/[A-Z]/.test(prefix)) return false;
  // SET-LANGNUM e.g. LTGY-FR008, RA02-FR001
  if (/^[A-Z0-9]{2,5}-[A-Z]{2}\d{2,4}[A-Z]?$/.test(code)) {
    const lang = code.match(/-([A-Z]{2})/)?.[1];
    return !!lang && (LANG_TAGS.has(lang) || lang === "OC");
  }
  // SET-NUM e.g. MRD-098 — older prints without language tag
  if (/^[A-Z]{2,5}-\d{3,4}$/.test(code)) return true;
  return false;
}

/**
 * Evidence score for a set-code candidate. Higher = more trustworthy.
 * Used for ranking (pickBest) and auto-lock threshold (isStrongSetCode).
 *
 * Evidence ladder:
 *  - known catalogue prefix (required for positive scores)
 *  - print number in dict when prints are loaded
 *  - clean shape / FR language
 *  - penalties: unknown print, IT, 4-digit junk, doubled letters
 */
export function scoreSetCode(code: string): number {
  // Allow optional trailing letter on num for scoring intermediate forms
  const loose = parseModernSetCode(code, { pureDigitsOnly: false });
  if (!loose) {
    if (/^[A-Z]{2,5}-\d{3,4}$/.test(normalizeSetCodeToken(code))) return 10;
    return -1000;
  }
  const { prefix: p, lang, num } = loose;
  const known = knownPrefixes();

  if (!isLangTag(lang)) return -500;
  // Double letters: penalize only unknown stutter (LTGGY), not real sets (DOOD)
  if (/(.)\1/.test(p) && !known.has(p)) return -200;

  let s = 0;

  if (!known.has(p)) {
    s -= 80;
  } else {
    s += 100;
    const prints = livePrints?.get(p);
    if (prints && prints.size > 0) {
      if (prints.has(num)) s += 80;
      else s -= 50;
    } else {
      s += 25;
    }
  }

  if (lang === "FR") s += 20;
  else if (lang === "EN") s += 8;
  else if (lang === "IT") s -= 12;
  else s += 2;

  if (num.length === 3) s += 15;
  else if (num.length === 4) s -= 8;
  else if (num.length === 2) s -= 15;

  if (/^0+$/.test(num)) s -= 40;
  if (/[1-9]/.test(num)) s += 5;
  if (num.length === 3 && num.startsWith("00") && num[2] !== "0") s -= 6;
  else if (num.length === 3 && num[1] !== "0") s += 4;

  if (p.length === 4) s += 8;
  if (p.length === 3 && classicThreeLetter().has(p)) s += 6;
  if (p.length === 5) s -= 15;

  if (p.length === 4 && p.startsWith("L") && p.endsWith("GY") && p[1] !== "T") {
    s -= 30;
  }

  return s;
}

/**
 * Minimum score for auto-lock (camera lock + skip manual confirm).
 * Requires roughly: known prefix + (print match OR fallback bonus) + FR/shape.
 * Unknown prefixes and wrong prints stay below this.
 */
export const STRONG_SCORE_THRESHOLD = 140;

/**
 * Strong modern set code (auto-lock safe): high evidence score only.
 * Shape gate + scoreSetCode ≥ threshold (prefix in catalogue; print if loaded).
 */
export function isStrongSetCode(code: string): boolean {
  const parts = parseModernSetCode(code, { pureDigitsOnly: true });
  if (!parts) return false;
  // Strong path keeps classic 2–4 letter prefixes (same as before)
  if (parts.prefix.length < 2 || parts.prefix.length > 4) return false;
  const known = knownPrefixes();
  if (/(.)\1/.test(parts.prefix) && !known.has(parts.prefix)) return false;
  if (!known.has(parts.prefix)) return false;
  return scoreSetCode(code) >= STRONG_SCORE_THRESHOLD;
}

/**
 * True if PREFIX-LANG### is a clean catalogue-backed set code for UI chips.
 */
function isLogicalChoiceForm(code: string): boolean {
  const parts = parseModernSetCode(code, { pureDigitsOnly: true });
  if (!parts) return false;
  const known = knownPrefixes();
  if (!known.has(parts.prefix)) return false;
  const prints = livePrints?.get(parts.prefix);
  if (prints && prints.size > 0 && !prints.has(parts.num)) return false;
  return true;
}

/**
 * Near-miss set codes for one-tap recovery (e.g. SDS1-FR007 ↔ 5DS1-FR007).
 * Same language + print number; only prefix glyph confusions (S↔5, I↔1, …).
 * No FR↔EN swap — that is not an OCR misread of the physical print line.
 */
function expandNearSetAlternatives(code: string): string[] {
  const parts = parseModernSetCode(code, { pureDigitsOnly: true });
  if (!parts) return [];
  const { prefix: pref, lang, num } = parts;
  const known = knownPrefixes();
  const out: string[] = [];
  for (const g of prefixGlyphForms(pref, 1)) {
    if (!known.has(g)) continue;
    const alt = `${g}-${lang}${num}`;
    if (isLogicalChoiceForm(alt)) out.push(alt);
  }
  return out;
}

/**
 * Logical one-tap scan choices for the UI.
 * - Filters junk (SDSI-FR0075R, unknown prefixes, bad prints)
 * - Dedupes
 * - Adds near catalogue alternatives (SDS1 ↔ 5DS1 same number) for OCR recovery
 */
export function filterLogicalScanChoices(
  codes: string[],
  opts?: { max?: number; prefer?: string | null },
): string[] {
  const max = opts?.max ?? 5;
  const prefer = opts?.prefer?.trim().toUpperCase() ?? "";
  const pool: string[] = [];
  for (const raw of codes) {
    const c = normalizeSetCodeToken(raw);
    if (c) pool.push(c);
    pool.push(...expandNearSetAlternatives(c));
  }

  const seen = new Set<string>();
  const logical: string[] = [];
  for (const c of pool) {
    if (seen.has(c)) continue;
    if (!isLogicalChoiceForm(c)) continue;
    seen.add(c);
    logical.push(c);
  }

  logical.sort((a, b) => {
    if (a === prefer) return -1;
    if (b === prefer) return 1;
    // Prefer same leading class as prefer (digit vs letter) when ranking ties
    if (prefer) {
      const prefDigit = /^\d/.test(prefer.split("-")[0] ?? "");
      const aDigit = /^\d/.test(a.split("-")[0] ?? "");
      const bDigit = /^\d/.test(b.split("-")[0] ?? "");
      if (aDigit === prefDigit && bDigit !== prefDigit) return -1;
      if (bDigit === prefDigit && aDigit !== prefDigit) return 1;
    }
    return scoreSetCode(b) - scoreSetCode(a) || a.localeCompare(b);
  });
  return logical.slice(0, max);
}

/**
 * Drop candidates that are strict truncations / dominated fragments.
 * - ALIN-FR01 when ALIN-FR010 exists (2-digit truncated modern print #)
 * - RGBT-FR003 when RGBT-FR035 exists (0-pad of truncated FR03 from FR035)
 * - LIN-FR010 when ALIN-FR010 exists (prefix fragment of a real 4-letter set)
 * - TLTGY / 1LTGY when LTGY exists (leading junk on a 4-letter set)
 * Do NOT drop LTGY when only TLTGY exists as dominator (5-letter stutter).
 */
function filterDominatedCandidates(codes: string[]): string[] {
  return codes.filter((c) => {
    const m = c.match(/^([A-Z0-9]+)-([A-Z]{2})(\d+)([A-Z]?)$/);
    if (!m) return true;
    const [, pref, lang, num, suf = ""] = m;
    for (const o of codes) {
      if (o === c) continue;
      const om = o.match(/^([A-Z0-9]+)-([A-Z]{2})(\d+)([A-Z]?)$/);
      if (!om) continue;
      const [, op, ol, on, os = ""] = om;
      if (ol !== lang || os !== suf) continue;

      // 2-digit print # truncated of a 3–4 digit sibling (FR01 ⊂ FR010)
      if (
        op === pref &&
        num!.length === 2 &&
        on!.startsWith(num!) &&
        on!.length >= 3
      ) {
        return false;
      }

      // Zero-padded truncation: FR003 dominated by FR035 / FR038
      // (sliding window dropped last digit 5/8 → FR03 → pad 003)
      if (
        op === pref &&
        num!.length === 3 &&
        on!.length === 3 &&
        num === `0${on!.slice(0, 2)}` &&
        on![2] !== "0"
      ) {
        return false;
      }

      // LIN ⊂ ALIN: drop shorter only if longer looks like a real 3–4 letter set
      if (
        on === num &&
        op!.length > pref!.length &&
        op!.endsWith(pref!) &&
        !classicThreeLetter().has(pref!) &&
        op!.length <= 4 &&
        /^[A-Z]/.test(op!) &&
        !/^\d/.test(op!)
      ) {
        return false;
      }

      // TLTGY / 1LTGY / 7LTGY: drop longer junk if a clean 4-letter suffix exists
      if (
        on === num &&
        pref!.length >= 5 &&
        op!.length === 4 &&
        pref!.endsWith(op!) &&
        /^[A-Z]/.test(op!)
      ) {
        return false;
      }
      if (
        on === num &&
        pref!.length === 5 &&
        op!.length === 4 &&
        pref!.slice(1) === op!
      ) {
        return false;
      }
    }
    return true;
  });
}

/** Expand compact strings into hyphenated set codes (LTGYFR008 → LTGY-FR008). */
function expandCompactToSetCodes(compact: string): string[] {
  const out: string[] = [];
  const s = compact.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length < 6 || s.length > 14) return out;

  // Full-string patterns — modern LANG prints are 3–4 digits (not 2).
  // Allowing \d{2} made RGBTFR035 windows emit FR03 → snap/pad → FR003.
  let m = s.match(/^([A-Z0-9]{2,5})([A-Z]{2})(\d{3,4}[A-Z]?)$/);
  if (m && LANG_TAGS.has(m[2]!)) out.push(`${m[1]}-${m[2]}${m[3]}`);
  m = s.match(/^([A-Z0-9]{2,5})(\d{3,4})$/);
  if (m) out.push(`${m[1]}-${m[2]}`);

  // Sliding windows — OCR often adds junk *around* the code (digits/punct).
  // Never start after a letter: dropping T from TALNFR001 → ALN → ALIN false lock.
  // Min len 8 = 2pref+2lang+3num (e.g. LOBFR001); avoid len that ends mid-number.
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && /[A-Z]/.test(s[i - 1]!)) continue;
    for (let len = 8; len <= 12 && i + len <= s.length; len++) {
      const sub = s.slice(i, i + len);
      let mm = sub.match(/^([A-Z0-9]{2,5})([A-Z]{2})(\d{3,4})$/);
      if (mm && LANG_TAGS.has(mm[2]!)) out.push(`${mm[1]}-${mm[2]}${mm[3]}`);
      mm = sub.match(/^([A-Z0-9]{2,5})(\d{3,4})$/);
      if (mm) out.push(`${mm[1]}-${mm[2]}`);
    }
  }
  return out;
}

/**
 * Extract YGO set-code candidates from OCR text.
 * Patterns: LTGY-FR008, LOB-FR001, MRD-098, RA02-FR001, etc.
 * Also recovers from spaced / compact / slightly noisy OCR.
 */
export function extractSetCodeCandidates(ocrText: string): string[] {
  let cleaned = fixOcrNoise(ocrText);
  cleaned = applyDigitLetterFixes(cleaned);

  const compactAll = cleaned.replace(/\s+/g, "");
  const alnumOnly = cleaned.replace(/[^A-Z0-9]/g, "");

  const found = new Set<string>();
  let m: RegExpExecArray | null;

  const tryText = (text: string) => {
    const withLang =
      /\b([A-Z0-9]{2,6})\s*[-–—]?\s*([A-Z]{2})\s*[-–—]?\s*([A-Z0-9]{2,5})\b/g;
    while ((m = withLang.exec(text))) {
      const lang = m[2]!;
      if (!LANG_TAGS.has(lang) && lang !== "OC") continue;
      const num = m[3]!.replace(/[^A-Z0-9]/g, "");
      if (num.length >= 2) found.add(`${m[1]}-${lang}${num}`.toUpperCase());
    }
    // Allow missing hyphen entirely: LTGY FR 008 / LTGYFR008 handled below
    const withLangLoose =
      /([A-Z0-9]{2,6})\s*[-–—]?\s*(FR|EN|DE|IT|ES|PT|JP|KR|AE|TC|SC)\s*[-–—]?\s*([A-Z0-9]{2,5})/g;
    while ((m = withLangLoose.exec(text))) {
      found.add(`${m[1]}-${m[2]}${m[3]}`.toUpperCase());
    }
    const noLang = /\b([A-Z0-9]{2,5})\s*[-–—]\s*(\d{3,4})\b/g;
    while ((m = noLang.exec(text))) {
      found.add(`${m[1]}-${m[2]}`.toUpperCase());
    }
    const compact = /\b([A-Z0-9]{2,5})([A-Z]{2})(\d{3,4})\b/g;
    while ((m = compact.exec(text))) {
      found.add(`${m[1]}-${m[2]}${m[3]}`.toUpperCase());
    }
  };

  tryText(cleaned);
  tryText(compactAll);
  for (const c of expandCompactToSetCodes(alnumOnly)) found.add(c);
  for (const c of expandCompactToSetCodes(applyDigitLetterFixes(alnumOnly))) {
    found.add(c);
  }

  // Second pass: only confusions that are not “letter in print number”
  // (those are handled 1:1 in digitishVariants: S→5, B→8, …).
  if (/[A-Z]/.test(alnumOnly)) {
    const confusions: [RegExp, string][] = [
      [/0/g, "O"],
      [/O/g, "0"],
      [/1/g, "I"],
      [/I/g, "1"],
      [/U/g, "0"],
    ];
    for (const [re, rep] of confusions) {
      const alt = alnumOnly.replace(re, rep);
      if (alt !== alnumOnly) {
        for (const c of expandCompactToSetCodes(alt)) found.add(c);
      }
    }
  }

  // Repair pass: FR00S / FROU8 / LTGGY / ITGY → strong LTGY-FR008 forms
  const repaired = new Set<string>();
  for (const c of found) {
    repaired.add(c);
    for (const r of repairSetCodeCandidate(c)) repaired.add(r);
  }

  return filterDominatedCandidates([...repaired].filter(isPlausibleSetCode));
}

/**
 * Pick the highest-evidence candidate.
 * Prefer the strong pool when any auto-lock-safe code exists; otherwise rank all.
 * Ties break lexicographically for stability.
 */
export function pickBestSetCode(candidates: string[]): string | null {
  if (!candidates.length) return null;
  const filtered = filterDominatedCandidates(candidates);
  if (!filtered.length) return null;

  const strong = filtered.filter(isStrongSetCode);
  const pool = strong.length ? strong : filtered;
  const withLang = pool.filter((c) =>
    /^[A-Z0-9]{2,5}-[A-Z]{2}\d{2,4}[A-Z]?$/.test(c),
  );
  const rankPool = withLang.length ? withLang : pool;

  return (
    rankPool.slice().sort((a, b) => {
      const d = scoreSetCode(b) - scoreSetCode(a);
      if (d !== 0) return d;
      return a.localeCompare(b);
    })[0] ?? null
  );
}

export const YGO_CARD_RATIO = 59 / 86;
const SCAN_CARD_HEIGHT_FRAC = 0.84;

const SCAN_SETCODE = {
  x: 0.52,
  y: 0.67,
  w: 0.44,
  h: 0.07,
} as const;

export type CardGuideRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  codeX: number;
  codeY: number;
  codeW: number;
  codeH: number;
};

export type CoverCrop = { sx: number; sy: number; sw: number; sh: number };

function getObjectFitCoverCrop(
  mediaW: number,
  mediaH: number,
  elW: number,
  elH: number,
): CoverCrop {
  if (mediaW <= 0 || mediaH <= 0 || elW <= 0 || elH <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(1, mediaW), sh: Math.max(1, mediaH) };
  }
  const scale = Math.max(elW / mediaW, elH / mediaH);
  const sw = elW / scale;
  const sh = elH / scale;
  return {
    sx: Math.max(0, (mediaW - sw) / 2),
    sy: Math.max(0, (mediaH - sh) / 2),
    sw,
    sh,
  };
}

export function getCardGuideRect(
  frameW: number,
  frameH: number,
  opts?: { cardHeightFrac?: number; originX?: number; originY?: number },
): CardGuideRect {
  const cardHeightFrac = opts?.cardHeightFrac ?? SCAN_CARD_HEIGHT_FRAC;
  const ox = opts?.originX ?? 0;
  const oy = opts?.originY ?? 0;
  let h = frameH * cardHeightFrac;
  let w = h * YGO_CARD_RATIO;
  if (w > frameW * 0.92) {
    w = frameW * 0.92;
    h = w / YGO_CARD_RATIO;
  }
  const x = ox + (frameW - w) / 2;
  const y = oy + (frameH - h) / 2;
  const codeW = Math.max(24, w * SCAN_SETCODE.w);
  const codeH = Math.max(14, h * SCAN_SETCODE.h);
  const codeX = x + w * SCAN_SETCODE.x;
  const codeY = y + h * SCAN_SETCODE.y;
  return { x, y, w, h, codeX, codeY, codeW, codeH };
}

function sourcePixelSize(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): { w: number; h: number } {
  if (source instanceof HTMLVideoElement) {
    return {
      w: source.videoWidth || source.clientWidth,
      h: source.videoHeight || source.clientHeight,
    };
  }
  if (source instanceof HTMLImageElement) {
    return {
      w: source.naturalWidth || source.width,
      h: source.naturalHeight || source.height,
    };
  }
  return { w: source.width, h: source.height };
}

type EnhanceOpts = {
  /**
   * gray = contrast-stretched grayscale (best for LSTM / phone photos).
   * soft = partial threshold (keeps mid-tones).
   * hard = pure B/W Otsu (can blotch thin strokes → 8↔S, 0↔U).
   * ink = only darkest ~22% of pixels black (preserves hollows in 0/8).
   */
  mode?: "gray" | "soft" | "hard" | "ink";
  /** Flip black/white after processing. */
  invert?: boolean;
  /**
   * Bias Otsu threshold. Negative = only darker pixels become ink
   * (thinner strokes, keeps holes in 0/8). Used by soft/hard.
   */
  threshBias?: number;
};

function otsuThreshold(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let thresh = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      thresh = t;
    }
  }
  return thresh;
}

/** Percentile threshold: darkest `pct`% of pixels → black. */
function percentileThreshold(hist: number[], total: number, pct: number): number {
  const target = (Math.max(1, Math.min(99, pct)) / 100) * total;
  let cum = 0;
  for (let i = 0; i < 256; i++) {
    cum += hist[i]!;
    if (cum >= target) return i;
  }
  return 128;
}

/**
 * Preprocess set-code band for Tesseract LSTM.
 * Phone photos: hard Otsu often blots 8→S / 0→U. Prefer gray first.
 */
function enhanceForOcr(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts?: EnhanceOpts,
) {
  const mode = opts?.mode ?? "gray";
  const invert = opts?.invert ?? false;
  const threshBias = opts?.threshBias ?? 0;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const gray = new Float32Array(w * h);
  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    gray[p] = g;
    min = Math.min(min, g);
    max = Math.max(max, g);
  }
  // Mild percentile clip so a bright highlight doesn't flatten contrast
  const span = Math.max(1, max - min);
  const hist = new Array(256).fill(0) as number[];
  const stretched = new Uint8Array(w * h);
  for (let p = 0; p < gray.length; p++) {
    const v = Math.round(((gray[p]! - min) / span) * 255);
    stretched[p] = v;
    hist[v]!++;
  }
  const otsu = otsuThreshold(hist, gray.length);
  const thresh = Math.max(1, Math.min(254, otsu + threshBias));

  if (mode === "gray") {
    // Let Tesseract LSTM binarize — preserves stroke interiors of 0/8
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      let out = stretched[p]!;
      if (invert) out = 255 - out;
      d[i] = d[i + 1] = d[i + 2] = out;
      d[i + 3] = 255;
    }
  } else if (mode === "soft") {
    const lo = Math.max(0, thresh - 18);
    const hi = Math.min(255, thresh + 22);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const v = stretched[p]!;
      let out: number;
      if (v <= lo) out = 0;
      else if (v >= hi) out = 255;
      else out = Math.round(((v - lo) / (hi - lo)) * 255);
      if (invert) out = 255 - out;
      d[i] = d[i + 1] = d[i + 2] = out;
      d[i + 3] = 255;
    }
  } else if (mode === "ink") {
    // Only darkest ink — keeps hollows in 0/8 open
    const inkThr = percentileThreshold(hist, gray.length, 22);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      let out = stretched[p]! <= inkThr ? 0 : 255;
      if (invert) out = 255 - out;
      d[i] = d[i + 1] = d[i + 2] = out;
      d[i + 3] = 255;
    }
  } else {
    // Hard B/W Otsu
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      let out = stretched[p]! <= thresh ? 0 : 255;
      if (invert) out = 255 - out;
      d[i] = d[i + 1] = d[i + 2] = out;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Thin black strokes by dilating white (MaxFilter 3×3 once).
 * After hard Otsu, thick blotchy ink confuses 8/B/0 — thinning helps.
 */
function thinBlackStrokes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < src.length; p++, i += 4) {
    src[p] = d[i]! < 128 ? 0 : 255;
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      // White if any neighbor is white (dilate white = erode black)
      let white = src[y * w + x] === 255;
      if (!white) {
        for (let dy = -1; dy <= 1 && !white; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (src[(y + dy) * w + (x + dx)] === 255) {
              white = true;
              break;
            }
          }
        }
      }
      const i = (y * w + x) * 4;
      const v = white ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Wipe near-full-width black rows (card border / shadow lines). */
function removeHorizontalRules(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const limit = w * 0.72;
  for (let y = 0; y < h; y++) {
    let black = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (d[(row + x) * 4]! < 128) black++;
    }
    if (black >= limit) {
      for (let x = 0; x < w; x++) {
        const i = (row + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
      }
    }
  }
  // Also wipe near-full-height black columns (side frame edges)
  const colLimit = h * 0.72;
  for (let x = 0; x < w; x++) {
    let black = 0;
    for (let y = 0; y < h; y++) {
      if (d[(y * w + x) * 4]! < 128) black++;
    }
    if (black >= colLimit) {
      for (let y = 0; y < h; y++) {
        const i = (y * w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Remove isolated speckles (3×3: center black, few black neighbors → white). */
function despeckle(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < src.length; p++, i += 4) {
    src[p] = d[i]! < 128 ? 0 : 255;
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (src[p] !== 0) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (src[(y + dy) * w + (x + dx)] === 0) n++;
        }
      }
      if (n <= 1) {
        const i = p * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Tight crop around dark ink + white padding.
 * Falls back to original if no meaningful ink mass.
 */
function trimInkBlob(
  canvas: HTMLCanvasElement,
  pad = 12,
): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 8 || h < 8) return canvas;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // Ignore a thin outer margin (often frame edges)
  const mx = Math.floor(w * 0.04);
  const my = Math.floor(h * 0.08);
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let ink = 0;
  for (let y = my; y < h - my; y++) {
    for (let x = mx; x < w - mx; x++) {
      if (d[(y * w + x) * 4]! < 128) {
        ink++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const area = Math.max(1, (w - 2 * mx) * (h - 2 * my));
  const inkRatio = ink / area;
  // Too little ink or almost all black → don't trim (bad frame)
  if (ink < 40 || inkRatio < 0.004 || inkRatio > 0.55) return canvas;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (bw < 12 || bh < 6) return canvas;
  // Trim only if it meaningfully shrinks width (wide empty band problem)
  if (bw > w * 0.92 && bh > h * 0.7) return canvas;

  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;

  const out = document.createElement("canvas");
  // Extra white margin helps Tesseract PSM single-line
  const margin = 16;
  out.width = tw + margin * 2;
  out.height = Math.max(th + margin * 2, 48);
  const octx = out.getContext("2d")!;
  // A literal white, and it stays one: a canvas context ignores custom
  // properties without saying so. This background is not part of the theme, it
  // is what Tesseract expects under the text.
  octx.fillStyle = "#fff";
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(
    canvas,
    minX,
    minY,
    tw,
    th,
    margin,
    Math.floor((out.height - th) / 2),
    tw,
    th,
  );
  return out;
}

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
}

function invertCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = cloneCanvas(src);
  const ctx = c.getContext("2d")!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i]!;
    d[i + 1] = 255 - d[i + 1]!;
    d[i + 2] = 255 - d[i + 2]!;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

type CropBuildOpts = EnhanceOpts & {
  trim?: boolean;
  cleanRules?: boolean;
  despeckle?: boolean;
  /** Thin black strokes after hard B/W (helps 8/0 holes). */
  thinStrokes?: boolean;
  /**
   * Target strip height in px after scale (character line ~48–96).
   * When set, overrides width-only scaling so capitals stay LSTM-friendly.
   */
  targetH?: number;
  /**
   * Straightening, in degrees, applied to the sampling.
   *
   * A card held in the hand is never quite straight, and Tesseract collapses
   * fast: measured on 3 September 2026, five degrees are enough to recognise
   * nothing at all, while the same image straightened reads without trouble. We
   * rotate at the source rather than the already-cropped thumbnail: pivoting a
   * 720×88 band around its centre would throw away its ends, where the start of
   * the code often sits.
   */
  angleDeg?: number;
};

function cropRegion(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  targetMinW = 480,
  opts?: CropBuildOpts,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  // Cap size: huge canvases make Tesseract crawl on phones (10–15s).
  // Prefer a stable text-line height (~64–96px) over pure width scale —
  // lab (debugocr/4): gray@h96 beat hard-Otsu on the same strips.
  let scale: number;
  if (opts?.targetH && sh > 0) {
    scale = opts.targetH / sh;
    scale = Math.max(1.5, Math.min(6, scale));
  } else {
    scale = Math.max(2, Math.min(4, targetMinW / Math.max(1, sw)));
  }
  out.width = Math.min(1100, Math.max(1, Math.floor(sw * scale)));
  out.height = Math.max(
    1,
    Math.floor(sh * (out.width / Math.max(1, sw))),
  );
  // Clamp height so we don't ship 200px-tall strips to the phone WASM
  if (out.height > 140) {
    const r = 140 / out.height;
    out.width = Math.max(1, Math.floor(out.width * r));
    out.height = 140;
  }
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Same reason as above: literal, and outside the theme.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  if (opts?.angleDeg) {
    /*
     * We compose the transform instead of cropping then rotating.
     *
     * The output point (u, v) must sample the source point obtained by rotating
     * around the band's centre. By laying the matrix down in that order —
     * output centre, scaling, rotation, source centre — the browser does the
     * interpolation itself, and nothing is lost at the edges since it draws
     * from the whole image.
     */
    const k = out.width / Math.max(1, sw);
    ctx.save();
    ctx.translate(out.width / 2, out.height / 2);
    ctx.scale(k, k);
    ctx.rotate((-opts.angleDeg * Math.PI) / 180);
    ctx.translate(-(sx + sw / 2), -(sy + sh / 2));
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  } else {
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
  }
  enhanceForOcr(ctx, out.width, out.height, {
    mode: opts?.mode ?? "gray",
    invert: opts?.invert,
    threshBias: opts?.threshBias,
  });
  // cleanRules / despeckle only make sense on binary (or near-binary) images
  const binary =
    opts?.mode === "hard" || opts?.mode === "ink" || opts?.mode === "soft";
  if (binary && opts?.cleanRules !== false) {
    removeHorizontalRules(ctx, out.width, out.height);
  }
  if (binary && opts?.thinStrokes) {
    thinBlackStrokes(ctx, out.width, out.height);
  }
  if (binary && opts?.despeckle !== false) {
    despeckle(ctx, out.width, out.height);
  }
  if (opts?.trim !== false && binary) {
    return trimInkBlob(out);
  }
  // Gray: still pad with white margin via a light trim only if ink is tight
  if (opts?.trim === true) {
    return trimInkBlob(out);
  }
  return out;
}

function prepareSetCodeRegions(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  opts?: { viewW?: number; viewH?: number },
): HTMLCanvasElement[] {
  const { w, h } = sourcePixelSize(source);
  if (!w || !h) {
    const empty = document.createElement("canvas");
    empty.width = 1;
    empty.height = 1;
    return [empty];
  }

  let ox = 0;
  let oy = 0;
  let fw = w;
  let fh = h;
  const viewW =
    opts?.viewW ?? (source instanceof HTMLElement ? source.clientWidth : 0);
  const viewH =
    opts?.viewH ?? (source instanceof HTMLElement ? source.clientHeight : 0);
  if (viewW > 0 && viewH > 0) {
    const cover = getObjectFitCoverCrop(w, h, viewW, viewH);
    ox = cover.sx;
    oy = cover.sy;
    fw = cover.sw;
    fh = cover.sh;
  }

  const guide = getCardGuideRect(fw, fh, { originX: ox, originY: oy });
  const primary = cropRegion(
    source,
    guide.codeX,
    guide.codeY,
    guide.codeW,
    guide.codeH,
    640,
  );
  const bandH = Math.max(18, guide.h * SCAN_SETCODE.h * 1.4);
  const bandY = guide.y + guide.h * SCAN_SETCODE.y;
  const fallback = cropRegion(
    source,
    guide.x + guide.w * 0.4,
    bandY,
    guide.w * 0.56,
    bandH,
    800,
  );
  return [primary, fallback];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = url;
  });
}

/**
 * Horizontal set-code band — user zooms so the code line fills it.
 * Must match CSS .scan-zoom-band percentages.
 * Height 30% for framing margin without enlarging the camera viewport.
 */
const SCAN_ZOOM_BAND = {
  x: 0.05,
  y: 0.34,
  w: 0.9,
  h: 0.3,
} as const;

function zoomBandSourceRect(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  opts?: { viewW?: number; viewH?: number },
): { sx: number; sy: number; sw: number; sh: number } | null {
  const { w, h } = sourcePixelSize(source);
  if (!w || !h) return null;

  let ox = 0;
  let oy = 0;
  let fw = w;
  let fh = h;
  const viewW =
    opts?.viewW ?? (source instanceof HTMLElement ? source.clientWidth : 0);
  const viewH =
    opts?.viewH ?? (source instanceof HTMLElement ? source.clientHeight : 0);
  if (viewW > 0 && viewH > 0) {
    const cover = getObjectFitCoverCrop(w, h, viewW, viewH);
    ox = cover.sx;
    oy = cover.sy;
    fw = cover.sw;
    fh = cover.sh;
  }

  return {
    sx: ox + fw * SCAN_ZOOM_BAND.x,
    sy: oy + fh * SCAN_ZOOM_BAND.y,
    sw: Math.max(1, fw * SCAN_ZOOM_BAND.w),
    sh: Math.max(1, fh * SCAN_ZOOM_BAND.h),
  };
}

/**
 * Preprocess variants for the same band — tried until a strong set code hits.
 *
 * Order from debugocr/4 lab (phone screenshots → native tesseract 5):
 * 1. gray@~88px  — best exact/near hits (LSTM-friendly)
 * 2. soft        — mid-tones kept
 * 3. hard+thin   — Otsu then thin strokes (helps blotchy 8/0)
 * 4. ink%        — darkest 22% only
 * 5. invert gray — rare polarity
 */
function prepareZoomBandVariants(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  opts?: { viewW?: number; viewH?: number },
): HTMLCanvasElement[] {
  const rect = zoomBandSourceRect(source, opts);
  if (!rect) {
    const empty = document.createElement("canvas");
    empty.width = 1;
    empty.height = 1;
    return [empty];
  }
  const { sx, sy, sw, sh } = rect;
  const base = { targetH: 88 as const };

  // #0 Primary = UI preview (grayscale)
  const primary = cropRegion(source, sx, sy, sw, sh, 720, {
    ...base,
    mode: "gray",
    trim: false,
    cleanRules: false,
    despeckle: false,
  });
  const variants: HTMLCanvasElement[] = [primary];

  // #1 Soft threshold
  variants.push(
    cropRegion(source, sx, sy, sw, sh, 720, {
      ...base,
      mode: "soft",
      threshBias: -12,
      trim: false,
      cleanRules: true,
      despeckle: false,
    }),
  );

  // #2 Hard Otsu + stroke thin + despeckle + trim
  variants.push(
    cropRegion(source, sx, sy, sw, sh, 720, {
      ...base,
      mode: "hard",
      threshBias: -10,
      trim: true,
      cleanRules: true,
      despeckle: true,
      thinStrokes: true,
    }),
  );

  // #3 Ink percentile (preserve hollows)
  variants.push(
    cropRegion(source, sx, sy, sw, sh, 720, {
      ...base,
      mode: "ink",
      trim: true,
      cleanRules: true,
      despeckle: true,
    }),
  );

  // #4 Inverted gray (dark sleeve / backlight edge cases)
  variants.push(invertCanvas(primary));

  /*
   * #5 to #8 — the same band, straightened.
   *
   * Measured on 3 September 2026 on manufactured images whose code we know: at
   * three degrees of tilt the reading still goes through, at five it returns
   * nothing at all, and at eight or twelve it returns anything. The same images
   * straightened read without trouble. A card held in the hand is never within
   * three degrees of straight: that is the most likely cause of the scans that
   * “do not even see there is any text” while the card next to it goes through
   * on the first try.
   *
   * Six and twelve degrees cover the useful range on either side. They come
   * last because the loop stops as soon as two independent readings agree: a
   * straight card never pays for them.
   */
  for (const angle of [-6, 6, -12, 12]) {
    variants.push(
      cropRegion(source, sx, sy, sw, sh, 720, {
        ...base,
        mode: "gray",
        angleDeg: angle,
        trim: false,
        cleanRules: false,
        despeckle: false,
      }),
    );
  }

  return variants;
}

export type OcrMode = "zoom-band" | "card-guide";

async function resolveSourceElement(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | File | Blob,
): Promise<{
  el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
  revoke?: () => void;
}> {
  if (source instanceof File || source instanceof Blob) {
    const url = URL.createObjectURL(source);
    const img = await loadImage(url);
    return {
      el: img,
      revoke: () => URL.revokeObjectURL(url),
    };
  }
  return { el: source };
}

async function buildCrops(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | File | Blob,
  mode: OcrMode,
  viewSize?: { viewW: number; viewH: number },
): Promise<HTMLCanvasElement[]> {
  const { el, revoke } = await resolveSourceElement(source);
  try {
    if (mode === "zoom-band") {
      const v =
        el instanceof HTMLVideoElement
          ? (viewSize ?? {
              viewW: el.clientWidth,
              viewH: el.clientHeight,
            })
          : viewSize;
      return prepareZoomBandVariants(el, v);
    }
    return prepareSetCodeRegions(el, viewSize);
  } finally {
    revoke?.();
  }
}

/** PSM modes to try: 7 single line, 8 single word, 13 raw line. */
const PSM_ATTEMPTS = ["7", "8", "13"] as const;

/**
 * OCR a frame. Crop is built FIRST so the UI can show the preview even while
 * the Tesseract worker is still downloading (first load).
 *
 * Tries multiple preprocess variants × PSM modes; stops early on a set code.
 *
 * onProgress statuses: crop | loading_* | recognizing | done | (tesseract logger)
 * Third arg of onProgress is optional cropDataUrl when status === "crop".
 */
export type OcrFromImageOpts = {
  /**
   * Photo mode: fast budget (2 variants × PSM 7→8).
   * "full" only if first pass fails (optional second wave).
   */
  thorough?: boolean | "full";
};

export async function ocrSetCodeFromImage(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | File | Blob,
  onProgress?: (
    status: OcrProgressStatus,
    progress: number,
    cropDataUrl?: string,
  ) => void,
  mode: OcrMode = "zoom-band",
  viewSize?: { viewW: number; viewH: number },
  opts?: OcrFromImageOpts,
): Promise<OcrSetCodeResult> {
  // 0) Catalogue dict for prefix gate + print snap (static JSON asset)
  await ensureSetDictLoaded();

  // 1) Crops first — independent of worker
  const crops = await buildCrops(source, mode, viewSize);
  let cropDataUrl: string | undefined;
  try {
    cropDataUrl = crops[0]?.toDataURL("image/png");
  } catch {
    /* ignore */
  }
  // Freeze UI on primary crop only — never swap mid-OCR (avoids “2nd frame” flicker)
  onProgress?.("crop", 0.02, cropDataUrl);

  // 2) Worker (may download WASM + lang on first call)
  onProgress?.("loading", 0.05);
  const worker = await getOcrWorker((status, p) => {
    onProgress?.(status, p, cropDataUrl);
  });
  onProgress?.("recognizing", 0.1, cropDataUrl);

  const texts: string[] = [];
  let bestConf = 0;
  const allCandidates = new Set<string>();
  /** How many independent raw OCR strings support each strong code (consensus). */
  const strongVotes = new Map<string, number>();
  let foundCode: string | null = null;

  // Photo default: gray+soft × PSM 7/8. thorough: +hard-thin. full: all variants+PSM13.
  const thorough = opts?.thorough;
  /*
   * `thorough` tries everything, and that is new.
   *
   * It stopped at four variants out of the nine prepared. The scan screen
   * always calls with `thorough: true`: inversion — the variant that catches a
   * light code on a dark background — was therefore never attempted in the
   * application, and the straightenings would not have been either.
   *
   * The cost is bounded by the early exit: as soon as two independent readings
   * give the same strong code, the loop stops. A straight, sharp card comes out
   * after two or three passes, as before.
   */
  const maxVariants =
    thorough === "full" || thorough
      ? crops.length
      : mode === "zoom-band"
        ? Math.min(crops.length, 3)
        : crops.length;
  const psmList: readonly string[] =
    thorough === "full"
      ? PSM_ATTEMPTS
      : (["7", "8"] as const);

  let step = 0;
  const totalSteps = maxVariants * psmList.length;

  outer: for (let vi = 0; vi < maxVariants; vi++) {
    const crop = crops[vi]!;

    for (const psm of psmList) {
      step++;
      onProgress?.(
        "recognizing",
        0.1 + (0.85 * step) / totalSteps,
        cropDataUrl,
      );
      try {
        await worker.setParameters({
          tessedit_pageseg_mode: psm,
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
        });
      } catch {
        /* some builds ignore mid-flight setParameters */
      }
      const result = await worker.recognize(crop);
      const raw = result.data.text?.trim() ?? "";
      if (raw) texts.push(raw);
      bestConf = Math.max(bestConf, result.data.confidence ?? 0);

      const cands = extractSetCodeCandidates(raw);
      for (const c of cands) allCandidates.add(c);
      for (const c of extractSetCodeCandidates(texts.join("\n"))) {
        allCandidates.add(c);
      }

      // Vote: best strong code from THIS raw alone
      const solo = pickBestSetCode(cands.filter(isStrongSetCode));
      if (solo && isStrongSetCode(solo)) {
        strongVotes.set(solo, (strongVotes.get(solo) ?? 0) + 1);
      }

      const strong = [...allCandidates].filter(isStrongSetCode);
      foundCode = pickBestSetCode(strong.length ? strong : [...allCandidates]);

      // Early exit only with consensus (2+ independent votes) — avoids
      // locking TALN-FR001 from a single noisy frame (debugocr/5).
      if (
        foundCode &&
        isStrongSetCode(foundCode) &&
        (strongVotes.get(foundCode) ?? 0) >= 2
      ) {
        break outer;
      }
    }
  }

  // Prefer consensus winner when available
  let topVote: string | null = null;
  let topN = 0;
  for (const [code, n] of strongVotes) {
    if (n > topN) {
      topN = n;
      topVote = code;
    }
  }
  if (topVote && topN >= 2 && isStrongSetCode(topVote)) {
    foundCode = topVote;
  }

  // Restore default PSM for next call
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: "7",
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
    });
  } catch {
    /* ignore */
  }

  const text = texts.join("\n");
  const candidates = [...allCandidates];
  if (!candidates.length) {
    for (const c of extractSetCodeCandidates(text)) candidates.push(c);
  }
  const strong = candidates.filter(isStrongSetCode);
  const code =
    foundCode && isStrongSetCode(foundCode)
      ? foundCode
      : pickBestSetCode(strong.length ? strong : candidates);
  onProgress?.("done", 1, cropDataUrl);
  return {
    text,
    code,
    candidates: candidates.length ? candidates : extractSetCodeCandidates(text),
    confidence: bestConf,
    cropDataUrl,
  };
}

function captureVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = video.videoWidth || video.clientWidth || 640;
  c.height = video.videoHeight || video.clientHeight || 480;
  c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
  return c;
}

export type CaptureScanPhotoResult = {
  /** Frozen video frame — same FOV as the preview band (never takePhoto). */
  source: HTMLCanvasElement;
  highRes: boolean;
};

/**
 * Freeze the current preview frame for OCR.
 *
 * We intentionally do NOT use ImageCapture.takePhoto(): full stills have a
 * different FOV/aspect than the video element, so the zoom-band crop maps to
 * the wrong region (blank white strips / shifted angle). The video frame
 * matches object-fit:cover + the blue guide exactly.
 */
export async function captureScanPhoto(
  video: HTMLVideoElement,
  _stream?: MediaStream | null,
): Promise<CaptureScanPhotoResult> {
  if (video.videoWidth < 32) {
    throw new Error("camera_not_ready");
  }
  return { source: captureVideoFrame(video), highRes: false };
}
