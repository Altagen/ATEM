/**
 * The set-code scanner.
 *
 * Markup and classes taken from ATEM-old
 * (`design/styles/components/scanner.css` and the `.scan-*` classes of
 * `collection.css`). So is the recognition engine, without a line changed: its
 * settings are the product of repeated measurements, documented in
 * `ocr/README.md`.
 *
 * **The aiming band is no longer positioned here.** It is positioned by
 * `.scan-zoom-band`, and `scripts/check-scan-band.mjs` checks that its
 * percentages are those of `SCAN_ZOOM_BAND`. Having written them in both places
 * with nothing linking them is what produced, in ATEM-old, a viewfinder showing
 * an area the OCR did not read.
 *
 * **The field never takes focus on its own.** On a phone, focus raises the
 * keyboard, which covers half the screen — including the shutter bar. One then
 * had to tap beside it to dismiss it before taking another photo, for every
 * card. The field stays there, within thumb's reach of anyone who wants to
 * correct it; it no longer summons the keyboard by itself.
 *
 * **The contract stays non-negotiable: the OCR is never authoritative.** It
 * proposes, the user confirms with “+1” or corrects the field. Nothing enters
 * the collection without an explicit gesture — recognition that is 95% sure
 * leaves one wrong card in twenty, and nobody rereads an eight-hundred-line
 * inventory.
 */
import { t } from "../../platform/i18n/index.js";
import { lockScroll, unlockScroll } from "../../platform/scroll-lock.js";
import { el, toast } from "../../platform/ui.js";
import {
  captureScanPhoto,
  ensureSetDictLoaded,
  filterLogicalScanChoices,
  isStrongSetCode,
  ocrSetCodeFromImage,
  type OcrProgressStatus,
} from "./ocr/engine.js";

/**
 * What a “+1” or a “−1” returns, whatever is being inventoried.
 *
 * The scanner knows neither the collection nor batches: it reads a code and
 * reports the gesture to whoever asked. That is what lets the scanlist reuse it
 * without a line of change — and above all, it is what makes its “−1” unable to
 * touch the collection. There is no path.
 */
export type ScanOutcome = {
  setCode: string;
  quantity: number;
  /** The card's name, when known — otherwise the code speaks. */
  label: string | null;
  /** A clarification, when the outcome deserves one: “identification under way”. */
  hint?: string;
};

export type ScannerOptions = {
  onConfirm: (setCode: string, delta: number) => Promise<ScanOutcome>;
  onClose: () => void;
  /** What the announced total counts: “in collection”, “in the batch”. */
  tallyLabel: string;
};

/**
 * The reading stages — translated at display time, not at declaration.
 *
 * This table is evaluated at import, before the account's language is known.
 */
const STATUS_LABELS: Record<string, string> = {
  crop: "Framing",
  loading: "Loading the engine",
  recognizing: "Reading",
  done: "Done",
};

export async function openScanner(options: ScannerOptions): Promise<void> {
  const video = el("video", { class: "scan-zoom-video", playsinline: "" });
  video.muted = true;

  const lockedCode = el("span", { class: "scan-zoom-locked-code" });
  const band = el("div", { class: "scan-zoom-band" }, [lockedCode]);
  const placeholder = el("div", { class: "scan-zoom-placeholder", hidden: "" }, [
    t("No camera — type the set code below."),
  ]);
  const viewport = el("div", { class: "scan-zoom-viewport" }, [video, band, placeholder]);

  const status = el("p", { class: "scan-status", role: "status" }, [
    t("Line the set code up inside the band."),
  ]);
  const errorLine = el("p", { class: "scan-err", role: "alert" });

  const codeInput = el("input", {
    type: "text",
    class: "scan-code-input",
    autocapitalize: "characters",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "LTGY-FR008",
    "aria-label": t("Recognised set code, editable"),
  });
  const codeRow = el("div", { class: "scan-code-row" }, [
    el("span", { class: "scan-code-row-label" }, [t("Code")]),
    codeInput,
  ]);

  const candidates = el("div", { class: "scan-cand-row" });

  const shutter = el(
    "button",
    { type: "button", class: "btn-scan-shutter", "aria-label": t("Read the card") },
    [
      el("span", { class: "btn-scan-shutter-ring", "aria-hidden": "true" }),
      el("span", { class: "btn-scan-shutter-core", "aria-hidden": "true" }),
    ],
  );
  /**
   * Starting over: we erase the reading, not the card.
   *
   * After a doubtful reading, the field keeps a wrong code and the band stays
   * locked onto it. Taking another photo on top is not always enough — one has
   * to start from nothing first. This button touches neither the camera nor the
   * collection: it puts the screen back in the state it opened in.
   */
  const restart = el(
    "button",
    { type: "button", class: "btn-scan-shutter-side", "aria-label": t("Start over") },
    [el("span", { class: "i-restart", "aria-hidden": "true" }, ["↺"])],
  );
  const minus = el(
    "button",
    { type: "button", class: "btn-scan-shutter-side", "aria-label": t("Remove a copy") },
    ["−1"],
  );
  const plus = el(
    "button",
    { type: "button", class: "btn-scan-add-lg", "aria-label": t("Add a copy") },
    ["+1"],
  );
  // The shutter stays in the centre: that is every camera's convention, and
  // the thumb finds it without looking. The two secondary buttons group to its
  // left, the “+1” keeps its place and its size on the right.
  const shutterBar = el("div", { class: "scan-shutter-bar" }, [
    el("div", { class: "scan-shutter-side-group" }, [restart, minus]),
    shutter,
    plus,
  ]);

  const close = el("button", { type: "button", class: "icon-btn", "aria-label": t("Close") }, ["✕"]);

  const modal = el("div", { class: "scan-modal scan-modal-zoom", role: "dialog", "aria-modal": "true" }, [
    el("div", { class: "scan-modal-head" }, [el("h2", {}, [t("Scan a card")]), close]),
    el("div", { class: "scan-modal-body" }, [
      viewport,
      status,
      errorLine,
      codeRow,
      candidates,
      shutterBar,
    ]),
  ]);
  const backdrop = el("div", { class: "scan-backdrop" });

  document.body.append(backdrop, modal);
  lockScroll();

  // The prefix dictionary loads while the user frames the shot: it conditions
  // the confidence score, and waiting for it at the click would add a pause
  // exactly where people are least patient.
  void ensureSetDictLoaded();

  let stream: MediaStream | null = null;
  let busy = false;

  /**
   * Closing, once, and leaving nothing behind.
   *
   * The guard is not a stylistic precaution: `dismiss` is wired to four
   * sources, and a normal close consumes only one. Without it, a scanner opened
   * then closed with the button left its navigation listeners in place — and
   * the next navigation called `onClose()` as many times as the scanner had
   * been opened, each one firing three requests. Same family of defect as the
   * listener that piled up on the grid.
   */
  let dismissed = false;
  function dismiss(): void {
    if (dismissed) return;
    dismissed = true;

    unlockScroll();
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;

    document.removeEventListener("keydown", onKey);
    window.removeEventListener("popstate", dismiss);
    document.removeEventListener("atem:navigated", dismiss);

    modal.remove();
    backdrop.remove();
    options.onClose();
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") dismiss();
  }
  document.addEventListener("keydown", onKey);
  close.addEventListener("click", dismiss);
  backdrop.addEventListener("click", dismiss);

  /**
   * A route change closes the scanner.
   *
   * The modal is attached to `document.body`, while the router only replaces
   * `#app`: clicking a navigation link left the scanner on top of the next
   * screen, with no way to close it by finger — and **the camera on**,
   * indicator light included.
   */
  window.addEventListener("popstate", dismiss);
  document.addEventListener("atem:navigated", dismiss);

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // `environment`: the rear camera. Without that constraint a phone opens
      // the front one, which will never see the card lying in front of it.
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    placeholder.hidden = false;
    video.hidden = true;
    errorLine.textContent =
      err instanceof DOMException && err.name === "NotAllowedError"
        ? t("Camera access was denied. You can type the set code by hand.")
        : t("No camera available. You can type the set code by hand.");
    shutter.disabled = true;
  }

  function setLocked(code: string | null, strong: boolean): void {
    lockedCode.textContent = code ?? "";
    band.classList.toggle("is-locked", Boolean(code) && strong);
  }

  function setCandidates(codes: string[]): void {
    candidates.replaceChildren();
    for (const code of codes.slice(0, 4)) {
      const chip = el("button", { type: "button", class: "scan-cand" }, [code]);
      chip.addEventListener("click", () => {
        codeInput.value = code;
        setLocked(code, false);
      });
      candidates.append(chip);
    }
  }

  async function capture(): Promise<void> {
    if (busy || !stream) return;
    busy = true;
    shutter.disabled = true;
    /**
     * The shutter's core pulses while reading.
     *
     * The styling existed — `.btn-scan-shutter.is-busy` — but nothing set the
     * class: the button merely greyed out, which reads as a failure rather than
     * as work under way. Reading takes one to three seconds, and the percentage
     * displayed next to it is invisible when holding the device above a card.
     */
    shutter.classList.add("is-busy");
    errorLine.textContent = "";
    setCandidates([]);

    try {
      const { source } = await captureScanPhoto(video);
      const result = await ocrSetCodeFromImage(
        source,
        (stage: OcrProgressStatus, progress: number) => {
          status.textContent = t("{step} — {percent}%", {
            step: t(STATUS_LABELS[stage] ?? stage),
            percent: Math.round(progress * 100),
          });
        },
        "zoom-band",
        /**
         * The viewfinder's **displayed** size, without which the crop is wrong.
         *
         * `captureScanPhoto` returns a detached canvas; the engine can then no
         * longer read `clientWidth` on the video element, and its
         * `object-fit: cover` computation falls back to zero. It then cuts its
         * band out of the whole image — 16:9 — while the viewfinder shows a
         * central 3:4 slice. One aimed at a place, the OCR read elsewhere.
         *
         * It is the same failure `check-scan-band.mjs` prevents between the CSS
         * and the constant, by another path: that gate compares percentages,
         * not the source's framing.
         */
        { viewW: video.clientWidth, viewH: video.clientHeight },
        // The dedicated scan screen takes the wide budget: the user
        // deliberately opened the camera for that card, and one more second
        // beats a failed reading.
        { thorough: "full" },
      );

      if (result.code) {
        const strong = isStrongSetCode(result.code);
        codeInput.value = result.code;
        setLocked(result.code, strong);
        status.textContent = strong
          ? t("Code recognised — check it, then confirm.")
          : t("Uncertain reading — correct it if needed.");
        /**
         * Suggestions go through the engine's filter.
         *
         * `candidates` holds raw fragments extracted from the text read:
         * `OCR.md` states that only near-duplicates backed by the catalogue
         * should be proposed. Offering them all put a truncated code, or one
         * with an unknown prefix, one tap away from the collection.
         */
        setCandidates(
          filterLogicalScanChoices(result.candidates, { prefer: result.code }).filter(
            (code) => code !== result.code,
          ),
        );
      } else {
        setLocked(null, false);
        status.textContent = t("Nothing readable. Move the card closer, or type the code.");
      }
    } catch (err) {
      errorLine.textContent =
        err instanceof Error && err.message === "camera_not_ready"
          ? t("The camera is not ready.")
          : t("Reading failed.");
    } finally {
      busy = false;
      shutter.disabled = !stream;
      shutter.classList.remove("is-busy");
    }
  }

  async function apply(delta: number): Promise<void> {
    const setCode = codeInput.value.trim().toUpperCase();
    if (!setCode) {
      errorLine.textContent = t("No set code to record.");
      return;
    }
    minus.disabled = true;
    plus.disabled = true;
    errorLine.textContent = "";
    try {
      const outcome = await options.onConfirm(setCode, delta);
      const name = outcome.label ?? outcome.setCode;
      toast(
        outcome.hint
          ? t("{name} — ×{n} · {hint}", { name, n: outcome.quantity, hint: outcome.hint })
          : t("{name} — ×{n}", { name, n: outcome.quantity }),
        "success",
      );
      status.textContent = t("{code}: {n} {where}.", { code: outcome.setCode, n: outcome.quantity, where: options.tallyLabel });
      // We carry on: it is a pile being counted, not a card. The camera stays
      // open and the field clears, ready for the next one.
      codeInput.value = "";
      setLocked(null, false);
      setCandidates([]);
    } catch (err) {
      errorLine.textContent =
        err instanceof Error ? err.message : t("Saving failed.");
    } finally {
      minus.disabled = false;
      plus.disabled = false;
    }
  }

  shutter.addEventListener("click", () => void capture());
  plus.addEventListener("click", () => void apply(1));
  minus.addEventListener("click", () => void apply(-1));
  restart.addEventListener("click", () => {
    codeInput.value = "";
    setLocked(null, false);
    setCandidates([]);
    errorLine.textContent = "";
    status.textContent = t("Line the set code up inside the band.");
  });
  codeInput.addEventListener("input", () => setLocked(codeInput.value.trim(), false));
}
