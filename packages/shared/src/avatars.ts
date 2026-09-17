/**
 * The avatars a duellist can pick.
 *
 * ATEM-old's five presets — the picture is the product's, never an upload: its
 * image upload was removed on 2026-09-08 for want of a screen (ADR-0005 there).
 * Its route also accepted any `preset:` prefix and a dozen legacy aliases; only
 * these five names are kept, and the database refuses anything else.
 */
export const AVATARS = ["dragon", "spellcaster", "warrior", "harpie", "occult"] as const;

export type Avatar = (typeof AVATARS)[number];
