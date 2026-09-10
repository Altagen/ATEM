/**
 * Le scanner de set codes.
 *
 * Balisage et classes repris d'ATEM-old (`design/styles/components/scanner.css`
 * et les classes `.scan-*` de `collection.css`). Le moteur de reconnaissance
 * l'est aussi, sans une ligne changée : ses réglages sont le produit de mesures
 * répétées, documentées dans `ocr/README.md`.
 *
 * **La bande de visée n'est plus positionnée ici.** Elle l'est par
 * `.scan-zoom-band`, et `scripts/check-scan-band.mjs` vérifie que ses
 * pourcentages sont ceux de `SCAN_ZOOM_BAND`. Les avoir écrits aux deux
 * endroits sans rien qui les relie est ce qui avait produit, chez ATEM-old, un
 * viseur qui montrait une zone que l'OCR ne lisait pas.
 *
 * **Le contrat reste non négociable : l'OCR n'est jamais autoritaire.** Il
 * propose, l'utilisateur confirme par « +1 » ou corrige le champ. Rien n'entre
 * en collection sans un geste explicite — une reconnaissance sûre à 95 % laisse
 * une carte fausse sur vingt, et personne ne relit un inventaire de huit cents
 * lignes.
 */
import { lockScroll, unlockScroll } from "../../platform/scroll-lock.js";
import { el, toast } from "../../platform/ui.js";
import type { CollectionItem } from "./state.js";
import {
  captureScanPhoto,
  ensureSetDictLoaded,
  filterLogicalScanChoices,
  isStrongSetCode,
  ocrSetCodeFromImage,
  type OcrProgressStatus,
} from "./ocr/engine.js";

export type ScannerOptions = {
  onConfirm: (setCode: string, delta: number) => Promise<CollectionItem>;
  onClose: () => void;
};

const STATUS_LABELS: Record<string, string> = {
  crop: "Cadrage",
  loading: "Chargement du moteur",
  recognizing: "Lecture",
  done: "Terminé",
};

export async function openScanner(options: ScannerOptions): Promise<void> {
  const video = el("video", { class: "scan-zoom-video", playsinline: "" });
  video.muted = true;

  const lockedCode = el("span", { class: "scan-zoom-locked-code" });
  const band = el("div", { class: "scan-zoom-band" }, [lockedCode]);
  const placeholder = el("div", { class: "scan-zoom-placeholder", hidden: "" }, [
    "Aucune caméra — saisissez le set code ci-dessous.",
  ]);
  const viewport = el("div", { class: "scan-zoom-viewport" }, [video, band, placeholder]);

  const status = el("p", { class: "scan-status", role: "status" }, [
    "Alignez le set code dans la bande.",
  ]);
  const errorLine = el("p", { class: "scan-err", role: "alert" });

  const codeInput = el("input", {
    type: "text",
    class: "scan-code-input",
    autocapitalize: "characters",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "LTGY-FR008",
    "aria-label": "Set code reconnu, corrigeable",
  });
  const codeRow = el("div", { class: "scan-code-row" }, [
    el("span", { class: "scan-code-row-label" }, ["Code"]),
    codeInput,
  ]);

  const candidates = el("div", { class: "scan-cand-row" });

  const shutter = el(
    "button",
    { type: "button", class: "btn-scan-shutter", "aria-label": "Lire la carte" },
    [
      el("span", { class: "btn-scan-shutter-ring", "aria-hidden": "true" }),
      el("span", { class: "btn-scan-shutter-core", "aria-hidden": "true" }),
    ],
  );
  const minus = el(
    "button",
    { type: "button", class: "btn-scan-shutter-side", "aria-label": "Retirer un exemplaire" },
    ["−1"],
  );
  const plus = el(
    "button",
    { type: "button", class: "btn-scan-add-lg", "aria-label": "Ajouter un exemplaire" },
    ["+1"],
  );
  const shutterBar = el("div", { class: "scan-shutter-bar" }, [minus, shutter, plus]);

  const close = el("button", { type: "button", class: "icon-btn", "aria-label": "Fermer" }, ["✕"]);

  const modal = el("div", { class: "scan-modal", role: "dialog", "aria-modal": "true" }, [
    el("div", { class: "scan-modal-head" }, [el("h2", {}, ["Scanner une carte"]), close]),
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

  // Le dictionnaire de préfixes se charge pendant que l'utilisateur cadre : il
  // conditionne le score de confiance, et l'attendre au déclic ajouterait une
  // pause là où l'on est le moins patient.
  void ensureSetDictLoaded();

  let stream: MediaStream | null = null;
  let busy = false;

  function dismiss(): void {
    unlockScroll();
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    document.removeEventListener("keydown", onKey);
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
   * Un changement de route ferme le scanner.
   *
   * La modale est posée sur `document.body`, alors que le routeur ne remplace
   * que `#app` : cliquer un lien de navigation laissait le scanner par-dessus
   * l'écran suivant, sans moyen de le fermer au doigt — et **la caméra
   * allumée**, témoin compris.
   */
  window.addEventListener("popstate", dismiss, { once: true });
  document.addEventListener("atem:navigated", dismiss, { once: true });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // `environment` : la caméra arrière. Sans cette contrainte, un téléphone
      // ouvre la frontale, qui ne verra jamais la carte posée devant.
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
        ? "L'accès à la caméra a été refusé. Vous pouvez saisir le set code à la main."
        : "Aucune caméra disponible. Vous pouvez saisir le set code à la main.";
    shutter.disabled = true;
    codeInput.focus();
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
        codeInput.focus();
      });
      candidates.append(chip);
    }
  }

  async function capture(): Promise<void> {
    if (busy || !stream) return;
    busy = true;
    shutter.disabled = true;
    errorLine.textContent = "";
    setCandidates([]);

    try {
      const { source } = await captureScanPhoto(video);
      const result = await ocrSetCodeFromImage(
        source,
        (stage: OcrProgressStatus, progress: number) => {
          status.textContent = `${STATUS_LABELS[stage] ?? stage} — ${Math.round(progress * 100)} %`;
        },
        "zoom-band",
        /**
         * La taille **affichée** du viseur, sans quoi le recadrage est faux.
         *
         * `captureScanPhoto` rend une toile détachée ; le moteur ne peut donc
         * plus lire `clientWidth` sur l'élément vidéo, et son calcul de
         * `object-fit: cover` retombe sur zéro. Il découpe alors sa bande sur
         * l'image entière — du 16/9 — quand le viseur, lui, montre une tranche
         * centrale en 3/4. On visait un endroit, l'OCR lisait ailleurs.
         *
         * C'est la même panne que `check-scan-band.mjs` prévient entre le CSS
         * et la constante, par un autre chemin : cette barrière compare les
         * pourcentages, pas le cadrage de la source.
         */
        { viewW: video.clientWidth, viewH: video.clientHeight },
        // L'écran de scan dédié prend le budget large : l'utilisateur a
        // délibérément ouvert la caméra pour cette carte-là, et une seconde de
        // plus vaut mieux qu'une lecture ratée.
        { thorough: "full" },
      );

      if (result.code) {
        const strong = isStrongSetCode(result.code);
        codeInput.value = result.code;
        setLocked(result.code, strong);
        status.textContent = strong
          ? "Code reconnu — vérifiez puis validez."
          : "Lecture incertaine — corrigez si besoin.";
        /**
         * Les suggestions passent par le filtre du moteur.
         *
         * `candidates` contient des fragments bruts extraits du texte lu :
         * `OCR.md` précise que seuls les quasi-doublons soutenus par le
         * catalogue doivent être proposés. Les offrir tous mettait un code
         * tronqué ou de préfixe inconnu à une tape de la collection.
         */
        setCandidates(
          filterLogicalScanChoices(result.candidates, { prefer: result.code }).filter(
            (code) => code !== result.code,
          ),
        );
      } else {
        setLocked(null, false);
        status.textContent = "Rien de lisible. Rapprochez la carte, ou saisissez le code.";
        codeInput.focus();
      }
    } catch (err) {
      errorLine.textContent =
        err instanceof Error && err.message === "camera_not_ready"
          ? "La caméra n'est pas prête."
          : "La lecture a échoué.";
    } finally {
      busy = false;
      shutter.disabled = !stream;
    }
  }

  async function apply(delta: number): Promise<void> {
    const setCode = codeInput.value.trim().toUpperCase();
    if (!setCode) {
      errorLine.textContent = "Aucun set code à enregistrer.";
      codeInput.focus();
      return;
    }
    minus.disabled = true;
    plus.disabled = true;
    errorLine.textContent = "";
    try {
      const item = await options.onConfirm(setCode, delta);
      toast(
        item.card
          ? `${item.card.name} — ${item.quantity} ex.`
          : `${item.setCode} enregistré, identification en cours.`,
        "success",
      );
      status.textContent = `${item.setCode} : ${item.quantity} en collection.`;
      // On enchaîne : c'est une pile qu'on inventorie, pas une carte. La caméra
      // reste ouverte et le champ se vide, prêt pour la suivante.
      codeInput.value = "";
      setLocked(null, false);
      setCandidates([]);
    } catch (err) {
      errorLine.textContent =
        err instanceof Error ? err.message : "L'enregistrement a échoué.";
    } finally {
      minus.disabled = false;
      plus.disabled = false;
    }
  }

  shutter.addEventListener("click", () => void capture());
  plus.addEventListener("click", () => void apply(1));
  minus.addEventListener("click", () => void apply(-1));
  codeInput.addEventListener("input", () => setLocked(codeInput.value.trim(), false));
}
