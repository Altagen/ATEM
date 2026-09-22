/**
 * The French labels of the Yu-Gi-Oh! enumerations.
 *
 * The API does not localise them: even with `language=fr`, `type`, `race` and
 * `attribute` come back in English (`Spellcaster`, `DARK`, `Equip`). Only the
 * card's name and text are translated. These tables are therefore on us — that
 * is the debt announced in ADR-005, and it is paid once.
 *
 * **The English value stays the key.** It is what is stored, filtered and
 * compared; French is only a display. A filter set in French therefore stays
 * valid when the interface switches to English.
 *
 * And that is what makes the language switch trivial here: in English there is
 * nothing to translate — the API's raw value **is** the English. These tables
 * only apply in French. This vocabulary therefore has no business in the
 * general dictionary: « Poisson » is not an interface sentence, it is the
 * French name of a catalogue value.
 *
 * Table taken from the earlier prototype, where it was established from the usual names of
 * the French TCG.
 */

import { locale } from "./i18n/index.js";

type Labels = Record<string, string>;

const ATTRIBUTES: Labels = {
  LIGHT: "Lumière",
  DARK: "Ténèbres",
  WATER: "Eau",
  FIRE: "Feu",
  EARTH: "Terre",
  WIND: "Vent",
  DIVINE: "Divin",
};

/** A monster's type — the API's `race` field when the card is a monster. */
const MONSTER_RACES: Labels = {
  Aqua: "Aqua",
  Beast: "Bête",
  "Beast-Warrior": "Bête-Guerrier",
  "Creator-God": "Dieu Créateur",
  Cyberse: "Cyberse",
  Dinosaur: "Dinosaure",
  "Divine-Beast": "Bête Divine",
  Dragon: "Dragon",
  Fairy: "Elfe",
  Fiend: "Démon",
  Fish: "Poisson",
  Illusion: "Illusion",
  Insect: "Insecte",
  Machine: "Machine",
  Plant: "Plante",
  Psychic: "Psychique",
  Pyro: "Pyro",
  Reptile: "Reptile",
  Rock: "Rocher",
  "Sea Serpent": "Serpent de Mer",
  Spellcaster: "Magicien",
  Thunder: "Tonnerre",
  Warrior: "Guerrier",
  "Winged Beast": "Bête Ailée",
  Wyrm: "Wyrm",
  Zombie: "Zombie",
};

/**
 * A Spell's or Trap's property — **the same `race` field**.
 *
 * Hence the ambiguity to resolve: a “Normal” Trap is not a Normal monster. It
 * is the card's type that says which table to look in.
 */
const SPELL_TRAP_PROPERTIES: Labels = {
  Normal: "Normale",
  Continuous: "Continue",
  Field: "Terrain",
  Equip: "Équipement",
  "Quick-Play": "Jeu-Rapide",
  Ritual: "Rituelle",
  Counter: "Contre",
};

const CARD_TYPES: Labels = {
  "Normal Monster": "Monstre Normal",
  "Effect Monster": "Monstre à Effet",
  "Ritual Monster": "Monstre Rituel",
  "Fusion Monster": "Monstre Fusion",
  "Synchro Monster": "Monstre Synchro",
  "XYZ Monster": "Monstre Xyz",
  "Link Monster": "Monstre Lien",
  "Pendulum Effect Monster": "Monstre Pendule à Effet",
  "Pendulum Normal Monster": "Monstre Pendule Normal",
  "Pendulum Effect Fusion Monster": "Monstre Fusion Pendule",
  "Synchro Pendulum Effect Monster": "Monstre Synchro Pendule",
  "XYZ Pendulum Effect Monster": "Monstre Xyz Pendule",
  "Pendulum Tuner Effect Monster": "Monstre Syntoniseur Pendule",
  "Tuner Monster": "Monstre Syntoniseur",
  "Synchro Tuner Monster": "Monstre Synchro Syntoniseur",
  "Flip Effect Monster": "Monstre à Effet Flip",
  "Gemini Monster": "Monstre Gémeau",
  "Union Effect Monster": "Monstre Union",
  "Spirit Monster": "Monstre Spirit",
  "Toon Monster": "Monstre Toon",
  Token: "Jeton",
  "Spell Card": "Spell",
  "Trap Card": "Trap",
  "Skill Card": "Compétence",
};

/**
 * An unknown label comes back as is.
 *
 * Konami releases new types regularly, and a blank in front of an unlisted type
 * would be worse than its English name — the user, at least, could read that.
 */
const label = (table: Labels, value: string | null | undefined): string => {
  if (!value) return "";
  // In English, the API's value is already the one we display.
  if (locale() === "en") return value;
  return table[value] ?? value;
};

export const translateAttribute = (value: string | null | undefined): string =>
  label(ATTRIBUTES, value);

export const translateType = (value: string | null | undefined): string =>
  label(CARD_TYPES, value);

/**
 * Translates the `race` field, resolving the ambiguity with the card's type.
 *
 * Without the type, `Normal` is undecidable: “Normal Monster” or “Normal Trap”
 * depending on the card.
 */
export function translateRace(
  value: string | null | undefined,
  cardType?: string | null,
): string {
  if (!value) return "";
  const isSpellOrTrap = cardType === CATALOGUE.spellCard || cardType === CATALOGUE.trapCard;
  return isSpellOrTrap ? label(SPELL_TRAP_PROPERTIES, value) : label(MONSTER_RACES, value);
}

/** The eight directions of a Link monster, as the API names them. */
const LINK_MARKERS: Labels = {
  Top: "Haut",
  "Top-Left": "Haut-Gauche",
  "Top-Right": "Haut-Droite",
  Left: "Gauche",
  Right: "Droite",
  Bottom: "Bas",
  "Bottom-Left": "Bas-Gauche",
  "Bottom-Right": "Bas-Droite",
};

export const translateLinkMarker = (value: string): string => label(LINK_MARKERS, value);

/**
 * A card's frame — the API's `frameType`, lowercase and without spaces.
 *
 * It used to live in the collection's view, where it stood out: it is the same
 * vocabulary as the rest of this file, and it translates by the same rule — in
 * English the API's value is enough, except that it is not written to be read
 * (`normal_pendulum`). So it gets reformatted.
 */
const FRAME_TYPES: Labels = {
  normal: "Normal",
  effect: "À effet",
  ritual: "Rituel",
  fusion: "Fusion",
  synchro: "Synchro",
  xyz: "Xyz",
  link: "Link",
  spell: "Spell",
  trap: "Trap",
  token: "Jeton",
  normal_pendulum: "Pendule Normal",
  effect_pendulum: "Pendule à effet",
  fusion_pendulum: "Pendule Fusion",
  synchro_pendulum: "Pendule Synchro",
  xyz_pendulum: "Pendule Xyz",
  skill: "Compétence",
};

const FRAME_TYPES_EN: Labels = {
  normal: "Normal",
  effect: "Effect",
  ritual: "Ritual",
  fusion: "Fusion",
  synchro: "Synchro",
  xyz: "Xyz",
  link: "Link",
  spell: "Spell",
  trap: "Trap",
  token: "Token",
  normal_pendulum: "Normal Pendulum",
  effect_pendulum: "Effect Pendulum",
  fusion_pendulum: "Fusion Pendulum",
  synchro_pendulum: "Synchro Pendulum",
  xyz_pendulum: "Xyz Pendulum",
  skill: "Skill",
};

export function translateFrameType(value: string | null | undefined): string {
  if (!value) return "";
  const table = locale() === "en" ? FRAME_TYPES_EN : FRAME_TYPES;
  return table[value] ?? value;
}

/**
 * The catalogue's vocabulary, as YGOPRODeck writes it.
 *
 * These are **data**, not labels: we compare them, we do not display them.
 * Written in the clear in three screens, they looked like displayed text
 * forgotten by the translation — and a typo would have gone unnoticed there.
 */
export const CATALOGUE = {
  spellCard: "Spell Card",
  trapCard: "Trap Card",
} as const;
