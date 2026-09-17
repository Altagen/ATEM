/**
 * The profile screen — wiring.
 *
 * `/profile` is your own; `/profile?user=<id>` is anyone's, which is the address
 * “Share profile” copies. The server says whether it is yours (`isSelf`), so the
 * edit button never depends on the screen guessing.
 *
 * Saving sends name, bio and avatar in **one** `PATCH /auth/me`: ATEM-old sent two
 * requests and announced success when the second had failed.
 */
import { LIMITS, textLengthStatus, type Avatar } from "@atem/shared";
import { api, ApiError, type PublicUser } from "../../platform/api.js";
import { t } from "../../platform/i18n/index.js";
import { renderNavigation } from "../../platform/navigation.js";
import { knownUser, setUser } from "../../platform/session.js";
import { toast } from "../../platform/ui.js";
import { profileState, type PlayerProfile } from "./state.js";
import { draftReady, overMessage, profileHtml } from "./view.js";

export async function profileScreen(
  root: HTMLElement,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<void> {
  const state = profileState();
  const ownerId = params.get("user") ?? knownUser()?.id ?? "";

  function paint(): void {
    root.innerHTML = profileHtml(state).toString();
    bind();
  }

  async function load(): Promise<void> {
    try {
      state.player = await api<PlayerProfile>(`/players/${encodeURIComponent(ownerId)}`);
      state.failure = null;
    } catch (err) {
      state.failure = err instanceof ApiError && err.status === 404
        ? t("No duellist answers to this address.")
        : err instanceof ApiError ? err.message : t("The profile could not be loaded.");
    }
  }

  function closeEdit(): void {
    state.draft = null;
    paint();
    root.querySelector<HTMLButtonElement>("#btn-edit-profile")?.focus();
  }

  /**
   * The counter, the red frame and the save button, without repainting.
   *
   * A repaint at every keystroke would rebuild the textarea and lose the caret.
   */
  function paintBio(): void {
    if (!state.draft) return;
    const status = textLengthStatus(state.draft.bio, LIMITS.bio.max);
    const field = root.querySelector<HTMLElement>("#edit-bio-field");
    if (field) {
      field.classList.remove("is-ok", "is-warn", "is-full", "is-over");
      field.classList.add(`is-${status.state}`);
      field.querySelector(".counted-count")!.textContent = `${status.length}/${status.limit}`;
      field.querySelector(".counted-over")!.textContent = overMessage(status);
      field.querySelector("textarea")?.setAttribute("aria-invalid", String(status.state === "over"));
    }
    paintSave();
  }

  function paintSave(): void {
    const save = root.querySelector<HTMLButtonElement>("#profile-modal-save");
    if (save) save.disabled = !draftReady(state);
  }

  async function save(): Promise<void> {
    const player = state.player;
    const draft = state.draft;
    if (!player || !draft || !draftReady(state)) return;

    // Only what changed: an unchanged name is not sent, so it cannot move the tag.
    const body: { displayName?: string; bio?: string; avatar?: Avatar } = {};
    if (draft.displayName.trim() !== player.profile.displayName) body.displayName = draft.displayName.trim();
    if (draft.bio !== player.profile.bio) body.bio = draft.bio;
    if (draft.avatar !== player.profile.avatar) body.avatar = draft.avatar;
    if (Object.keys(body).length === 0) {
      closeEdit();
      return;
    }

    state.saving = true;
    paintSave();
    try {
      const { user } = await api<{ user: PublicUser }>("/auth/me", { method: "PATCH", body });
      setUser(user);
      renderNavigation();
      await load();
      if (signal.aborted) return;
      state.saving = false;
      closeEdit();
      toast(t("Profile saved."), "success");
    } catch (err) {
      state.saving = false;
      paintSave();
      toast(err instanceof ApiError ? err.message : t("The profile could not be saved."), "error");
    }
  }

  async function share(): Promise<void> {
    if (!state.player) return;
    const link = `${window.location.origin}/profile?user=${state.player.profile.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast(t("Profile link copied."), "success");
    } catch {
      // Refused or unavailable: the link is still given, to copy by hand.
      toast(t("The link could not be copied: {link}", { link }), "error");
    }
  }

  function bind(): void {
    root.querySelector("#btn-share-profile")?.addEventListener("click", () => void share());

    root.querySelector("#btn-edit-profile")?.addEventListener("click", () => {
      if (!state.player) return;
      const { displayName, bio, avatar } = state.player.profile;
      state.draft = { displayName, bio, avatar };
      paint();
      root.querySelector<HTMLInputElement>("#edit-display-name")?.focus();
    });

    root.querySelector("#profile-modal-cancel")?.addEventListener("click", closeEdit);
    root.querySelector("#profile-modal-backdrop")?.addEventListener("click", closeEdit);

    root.querySelector<HTMLInputElement>("#edit-display-name")?.addEventListener("input", (event) => {
      if (!state.draft) return;
      state.draft.displayName = (event.target as HTMLInputElement).value;
      paintSave();
    });
    root.querySelector<HTMLTextAreaElement>("#edit-bio")?.addEventListener("input", (event) => {
      if (!state.draft) return;
      state.draft.bio = (event.target as HTMLTextAreaElement).value;
      paintBio();
    });

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-avatar]")) {
      button.addEventListener("click", () => {
        if (!state.draft) return;
        state.draft.avatar = button.dataset.avatar as Avatar;
        for (const other of root.querySelectorAll<HTMLButtonElement>("[data-avatar]")) {
          const chosen = other === button;
          other.classList.toggle("is-selected", chosen);
          other.setAttribute("aria-pressed", String(chosen));
        }
      });
    }

    root.querySelector("#form-profile-edit")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void save();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.draft && !state.saving) closeEdit();
  }, { signal });

  paint();
  await load();
  if (signal.aborted) return;
  paint();
}
