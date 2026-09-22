/**
 * What an avatar looks like: its picture and its name.
 *
 * Shared by the navigation, which opens the account menu on it, and the profile,
 * which shows it and offers the choice. A function, so the names follow the
 * language of the moment — and literal `t()` calls the translation gate can see.
 */
import type { Avatar } from "@atem/shared";
import { t } from "./i18n/index.js";

export const avatarLooks = (): Record<Avatar, { icon: string; label: string }> => ({
  dragon: { icon: "🐉", label: t("Dragon") },
  spellcaster: { icon: "🧙", label: t("Spellcaster") },
  warrior: { icon: "⚔️", label: t("Warrior") },
  harpie: { icon: "🦅", label: t("Harpie") },
  occult: { icon: "🔮", label: t("Occult") },
});
