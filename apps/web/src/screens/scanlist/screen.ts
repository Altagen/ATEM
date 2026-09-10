/**
 * L'écran des scanlistes.
 *
 * **Il réutilise le scanner sans le modifier.** Celui-ci ne connaît ni la
 * collection ni les lots : il lit un code et rapporte le geste à qui le lui a
 * demandé. Ici, ce geste écrit dans un compteur qui vit en mémoire — c'est ce
 * qui rend le « −1 » de cet écran structurellement incapable de toucher la
 * collection. Il n'existe pas de chemin, pas même par erreur.
 */
import { api, ApiError, type CardDetail } from "../../platform/api.js";
import { toast } from "../../platform/ui.js";
import type { ScanlistDetail, ScanlistSummary } from "@atem/shared";
import { keptForSaving, SCANLIST_EXPORT_VERSION } from "@atem/shared";
import { scanlistHtml } from "./view.js";
import {
  applyToDraft, discardDraft, draftCopies, nameDraftLine, resetView, scanlistState, startDraft,
} from "./state.js";

/**
 * Le temps qu'on accorde au catalogue pour nommer une carte.
 *
 * L'ajout ne l'attend jamais : la ligne entre tout de suite avec son set code,
 * que le navigateur tient déjà. Si le nom arrive avant la fin de ce délai, il
 * se pose sur la ligne ; sinon le code reste, et c'est très bien — refuser
 * d'inventorier une carte parce qu'on ne sait pas encore la nommer serait
 * absurde. Un code inconnu de YGOPRODeck ne sera d'ailleurs jamais nommé.
 */
const DELAI_NOM_MS = 2_500;

export async function scanlistScreen(root: HTMLElement, params: URLSearchParams): Promise<void> {
  const state = scanlistState();
  resetView();
  root.className = "scanlist-page-root";

  /**
   * Repeint l'écran **sans effacer ce qu'on est en train d'écrire**.
   *
   * Le nom d'une carte arrive après coup et déclenche une repeinture. Si elle
   * tombe pendant qu'on saisit le code suivant, le champ est reconstruit vide
   * et la frappe est perdue — sans rien qui l'explique, et au pire moment :
   * quand on enchaîne les cartes d'une pile.
   *
   * On rend donc au champ sa valeur, son focus et la position du curseur. Le
   * nom du lot, lui, vit dans l'état et se réécrit tout seul.
   */
  function paint(): void {
    const champ = root.querySelector<HTMLInputElement>("#draft-code");
    const saisie = champ
      ? { value: champ.value, focus: document.activeElement === champ, caret: champ.selectionStart }
      : null;

    root.innerHTML = scanlistHtml(state).toString();
    bind();

    if (!saisie?.value && !saisie?.focus) return;
    const frais = root.querySelector<HTMLInputElement>("#draft-code");
    if (!frais) return;
    frais.value = saisie.value;
    if (saisie.focus) {
      frais.focus();
      const position = saisie.caret ?? saisie.value.length;
      frais.setSelectionRange(position, position);
    }
  }

  async function loadList(): Promise<void> {
    try {
      const { items } = await api<{ items: ScanlistSummary[] }>("/scanlistes");
      state.items = items;
    } catch (err) {
      state.error = err instanceof ApiError ? err.message : "Serveur injoignable.";
    } finally {
      state.loading = false;
      paint();
    }
  }

  async function loadOne(id: string): Promise<void> {
    try {
      state.opened = await api<ScanlistDetail>(`/scanlistes/${encodeURIComponent(id)}`);
    } catch (err) {
      state.error = err instanceof ApiError ? err.message : "Lot introuvable.";
    } finally {
      state.loading = false;
      paint();
    }
  }

  /**
   * Va chercher le nom, sans jamais retenir l'ajout.
   *
   * L'appel continue côté serveur même si l'on cesse de l'attendre — le
   * référentiel s'enrichit quand même, au bénéfice de la prochaine carte du
   * même lot.
   */
  function resolveName(setCode: string): void {
    void api<{ card: CardDetail | null }>(
      `/catalogue/impressions/${encodeURIComponent(setCode)}`,
      { signal: AbortSignal.timeout(DELAI_NOM_MS) },
    )
      .then(({ card }) => {
        if (card && nameDraftLine(setCode, card.name, card.passcode)) paint();
      })
      .catch(() => {
        // Délai dépassé, code inconnu, réseau absent : le set code reste
        // affiché, et il dit déjà l'essentiel.
      });
  }

  function addToDraft(rawCode: string, delta: number): { setCode: string; quantity: number; label: string | null } {
    const setCode = rawCode.trim().toUpperCase();
    if (!setCode) throw new Error("Aucun set code à enregistrer.");

    const connuAvant = state.draft?.lines.some((line) => line.setCode === setCode) ?? false;
    const line = applyToDraft(setCode, delta);
    if (!connuAvant) resolveName(setCode);
    paint();
    return { setCode: line.setCode, quantity: line.quantity, label: line.name };
  }

  async function save(): Promise<void> {
    const draft = state.draft;
    if (!draft) return;

    const nom = draft.name.trim();
    if (!nom) {
      state.error = "Donnez un nom au lot.";
      paint();
      return;
    }
    const lines = keptForSaving(draft.lines);
    if (lines.length === 0) {
      state.error = "Aucune carte à enregistrer — toutes les lignes sont à zéro.";
      paint();
      return;
    }

    try {
      const lot = await api<ScanlistDetail>("/scanlistes", { method: "POST", body: { name: nom, lines } });
      discardDraft();
      state.error = "";
      toast(`« ${lot.name} » enregistré — ${lot.copyCount} ex.`, "success");
      await loadList();
    } catch (err) {
      state.error = err instanceof ApiError ? err.message : "L'enregistrement a échoué.";
      paint();
    }
  }

  /**
   * Le fichier passe par un lien construit à la volée.
   *
   * On ne demande pas au serveur de nous rendre ce qu'on a déjà : le lot est
   * en mémoire, et le navigateur sait fabriquer un fichier.
   */
  function exportOpened(): void {
    const lot = state.opened;
    if (!lot) return;

    const contenu = JSON.stringify(
      {
        version: SCANLIST_EXPORT_VERSION,
        name: lot.name,
        createdAt: lot.createdAt,
        pouredAt: lot.pouredAt,
        lines: lot.lines,
      },
      null,
      2,
    );

    const url = URL.createObjectURL(new Blob([contenu], { type: "application/json" }));
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = `${lot.name.replace(/[^\w\-]+/g, "-").toLowerCase()}.json`;
    lien.click();
    URL.revokeObjectURL(url);
  }

  async function pourOpened(): Promise<void> {
    const lot = state.opened;
    if (!lot || lot.pouredAt) return;

    const bouton = root.querySelector<HTMLButtonElement>("#lot-pour");
    if (bouton) bouton.disabled = true;
    try {
      const bilan = await api<{ poured: number; failed: number }>(
        `/scanlistes/${encodeURIComponent(lot.id)}/verser`,
        { method: "POST" },
      );
      // Un versement à moitié réussi se lit comme tel, pas comme un succès.
      toast(
        bilan.failed > 0
          ? `${bilan.poured} ex. versés · ${bilan.failed} ligne(s) en échec`
          : `${bilan.poured} ex. versés dans votre collection.`,
        bilan.failed > 0 ? "error" : "success",
      );
      await loadOne(lot.id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Le versement a échoué.", "error");
      if (bouton) bouton.disabled = false;
    }
  }

  async function deleteOpened(): Promise<void> {
    const lot = state.opened;
    if (!lot) return;
    if (!window.confirm(`Jeter « ${lot.name} » ? Cette liste sera perdue.`)) return;

    try {
      await api(`/scanlistes/${encodeURIComponent(lot.id)}`, { method: "DELETE" });
      toast(`« ${lot.name} » jeté.`, "success");
      window.history.pushState({}, "", "/scanlistes");
      state.opened = null;
      await loadList();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "La suppression a échoué.", "error");
    }
  }

  function bind(): void {
    root.querySelector("#draft-start")?.addEventListener("click", () => {
      startDraft();
      paint();
    });
    root.querySelector("#draft-discard")?.addEventListener("click", () => {
      const draft = state.draft;
      if (draft && draftCopies(draft) > 0 && !window.confirm("Abandonner ce lot ? Il sera perdu.")) {
        return;
      }
      discardDraft();
      state.error = "";
      paint();
    });

    const nameInput = root.querySelector<HTMLInputElement>("#draft-name");
    nameInput?.addEventListener("input", () => {
      if (state.draft) state.draft.name = nameInput.value;
    });

    const codeInput = root.querySelector<HTMLInputElement>("#draft-code");
    const ajouterSaisie = (): void => {
      const saisi = codeInput?.value.trim();
      if (!saisi) return;
      // Vidé **avant** la repeinture : celle-ci restaure ce qu'elle trouve
      // dans le champ, et y laisser le code le ferait réapparaître.
      if (codeInput) codeInput.value = "";
      try {
        addToDraft(saisi, 1);
        // La saisie au clavier garde le focus : ici l'utilisateur tape, il n'a
        // pas le doigt sur l'écran, et le champ suivant est celui-ci.
        root.querySelector<HTMLInputElement>("#draft-code")?.focus();
      } catch (err) {
        state.error = err instanceof Error ? err.message : "Ajout impossible.";
        paint();
      }
    };
    root.querySelector("#draft-add")?.addEventListener("click", ajouterSaisie);
    codeInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        ajouterSaisie();
      }
    });

    root.querySelector("#draft-save")?.addEventListener("click", () => void save());

    root.querySelector("#draft-scan")?.addEventListener("click", async () => {
      // Même chargement à la demande que la collection : le moteur pèse quatre
      // mégaoctets, et la plupart des visites n'ouvrent jamais la caméra.
      const { openScanner } = await import("../collection/scanner.js");
      await openScanner({
        tallyLabel: "dans le lot",
        onConfirm: async (setCode, delta) => addToDraft(setCode, delta),
        onClose: () => paint(),
      });
    });

    root.querySelector("#lot-pour")?.addEventListener("click", () => void pourOpened());
    root.querySelector("#lot-export")?.addEventListener("click", exportOpened);
    root.querySelector("#lot-delete")?.addEventListener("click", () => void deleteOpened());
  }

  /**
   * Les « + » et « − » de chaque ligne, délégués **une seule fois**.
   *
   * Posé au montage et non dans `bind()`, qui est rappelé à chaque repeinture :
   * l'écouteur s'y serait accumulé, et un « −1 » aurait décrémenté de trois
   * après trois repeintures. C'est le défaut qu'on a déjà corrigé sur la grille
   * de collection, et il ne coûte rien de ne pas le refaire.
   */
  root.addEventListener("click", (event) => {
    const cible = (event.target as HTMLElement | null)?.closest<HTMLElement>(".js-draft");
    if (!cible?.dataset.code) return;
    applyToDraft(cible.dataset.code, Number(cible.dataset.d ?? "1"));
    paint();
  });

  paint();

  const id = params.get("lot");
  await (id ? loadOne(id) : loadList());
}
