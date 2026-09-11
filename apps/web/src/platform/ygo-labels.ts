/**
 * Les libellés français des énumérations Yu-Gi-Oh!
 *
 * L'API ne les localise pas : même en `language=fr`, `type`, `race` et
 * `attribute` reviennent en anglais (`Spellcaster`, `DARK`, `Equip`). Seuls le
 * nom et le texte de la carte sont traduits. Ces tables sont donc à notre
 * charge — c'est la dette annoncée en ADR-005, et elle se paie une fois.
 *
 * **La valeur anglaise reste la clé.** Elle est ce qui est stocké, filtré et
 * comparé ; le français n'est qu'un affichage. Un filtre posé en français reste
 * donc valide quand l'interface passe à l'anglais.
 *
 * Et c'est ce qui rend la bascule de langue triviale ici : en anglais, il n'y a
 * rien à traduire — la valeur brute de l'API **est** l'anglais. Ces tables ne
 * s'appliquent qu'en français. Ce vocabulaire n'a donc rien à faire dans le
 * dictionnaire général : « Poisson » n'est pas une phrase d'interface, c'est le
 * nom français d'une valeur du catalogue.
 *
 * Table reprise d'ATEM-old, où elle avait été établie à partir des noms usuels
 * du TCG français.
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

/** Le type d'un monstre — champ `race` de l'API quand la carte est un monstre. */
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
 * La propriété d'une Magie ou d'un Piège — **le même champ `race`**.
 *
 * D'où l'ambiguïté à lever : un Piège « Normal » n'est pas un monstre Normal.
 * C'est le type de la carte qui dit dans quelle table chercher.
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
  "Spell Card": "Magie",
  "Trap Card": "Piège",
  "Skill Card": "Compétence",
};

/**
 * Un libellé inconnu revient tel quel.
 *
 * Konami sort de nouveaux types régulièrement, et un tableau vide en face d'un
 * type non répertorié serait pire que son nom anglais — l'utilisateur, lui,
 * saurait le lire.
 */
const label = (table: Labels, value: string | null | undefined): string => {
  if (!value) return "";
  // En anglais, la valeur de l'API est déjà celle qu'on affiche.
  if (locale() === "en") return value;
  return table[value] ?? value;
};

export const translateAttribute = (value: string | null | undefined): string =>
  label(ATTRIBUTES, value);

export const translateType = (value: string | null | undefined): string =>
  label(CARD_TYPES, value);

/**
 * Traduit le champ `race`, en levant l'ambiguïté par le type de la carte.
 *
 * Sans le type, `Normal` est indécidable : « Monstre Normal » ou « Piège
 * Normal » selon la carte.
 */
export function translateRace(
  value: string | null | undefined,
  cardType?: string | null,
): string {
  if (!value) return "";
  const isSpellOrTrap = cardType === "Spell Card" || cardType === "Trap Card";
  return isSpellOrTrap ? label(SPELL_TRAP_PROPERTIES, value) : label(MONSTER_RACES, value);
}

/** Les huit directions d'un monstre Lien, telles que l'API les nomme. */
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
 * Le cadre d'une carte — `frameType` de l'API, en minuscules et sans espaces.
 *
 * Il vivait dans la vue de la collection, où il faisait tache : c'est le même
 * vocabulaire que le reste de ce fichier, et il se traduit par la même règle —
 * en anglais, la valeur de l'API suffit, à ceci près qu'elle n'est pas écrite
 * pour être lue (`normal_pendulum`). Elle est donc reformatée.
 */
const FRAME_TYPES: Labels = {
  normal: "Normal",
  effect: "À effet",
  ritual: "Rituel",
  fusion: "Fusion",
  synchro: "Synchro",
  xyz: "Xyz",
  link: "Lien",
  spell: "Magie",
  trap: "Piège",
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
