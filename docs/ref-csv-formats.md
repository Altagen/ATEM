# Référence — formats d'import / export de collection

Connaissance extraite d'ATEM-old, où elle était fonctionnelle. Ce document fait
autorité : **il survit à la réécriture même si tout le code est jeté.**

## Règles communes

**Encodage** UTF-8. **BOM** : à l'export, ATEM-old l'ajoutait *côté client* — un lien
direct vers `/export.csv` produisait donc un fichier qu'Excel en locale française lit en
latin-1 et dont il abîme les accents.
→ **Décision ATEM : le BOM est écrit côté serveur.** À l'import, un BOM de tête est
retiré s'il est présent ; le fichier est accepté avec ou sans.

**Fins de ligne** : `\r?\n` accepté en lecture (CRLF et LF). En écriture, `\n` final
après la dernière ligne. Les lignes vides sont filtrées.

**Séparateur** : détecté **une seule fois**, sur la ligne d'en-tête, en comptant les
virgules et les points-virgules **hors guillemets**. S'il y a plus de `;` que de `,`, tout
le fichier est lu en `;`. Un seul séparateur pour tout le fichier.

**Échappement en écriture** : une cellule est entourée de guillemets doubles dès qu'elle
contient une virgule, **un point-virgule**, un guillemet, `\n` ou `\r`. Le point-virgule
est protégé même dans un fichier séparé par virgules, parce qu'un tableur français le
lit comme séparateur. Un guillemet interne est doublé (`"` → `""`). `null` → chaîne vide.

**Lecture** : parseur à état gérant les guillemets doublés et ignorant le séparateur à
l'intérieur d'un champ cité.

## Reconnaissance des colonnes

L'en-tête est normalisé (`trim`, minuscules, puis suppression de tout sauf
`[a-z0-9_ ]`) avant comparaison. Table d'alias :

| Colonne cible | Variantes acceptées en en-tête |
|---|---|
| `set_code` | `set_code`, `set code`, `card number`, `card_number`, `number`, `code`, `set_id`, `setid`, `cardnumber`, `expansion_code`, `expansion code`, `set_number`, `expansion/set` |
| `name` | `name`, `card_name`, `card name`, `title`, `cardname`, `card` |
| `quantity` | `quantity`, `qty`, `count`, `amount`, `quantite`, `quantité` |
| `rarity` | `rarity`, `print_rarity`, `print rarity`, `rarité`, `rarite` |
| `language` | `language`, `lang`, `langue` |
| `passcode` | `passcode`, `pass_code`, `pass code`, `card_id`, `card id`, `id`, `ygoprodeck_id` |
| `notes` | `notes`, `note`, `comment`, `comments`, `remark`, `remarks`, `condition` |

**Seule `set_code` est obligatoire.** Son absence rejette le fichier entier
(`missing_column_set_code`).

## Normalisation des valeurs

**`set_code`** : `trim`, suppression d'un `#` de tête, puis passage en majuscules et
espaces → tiret.

**`language`** : code ISO à deux lettres, nom complet FR/EN, ou **code numérique Konami**
hérité — `1`=en, `2`=fr, `3`=de, `4`=es, `5`=it, `6`=pt, `7`=ja, `8`=ko. Colonne absente
ou vide → langue **déduite du set code** (`LTGY-FR008` → `fr`). Valeur non reconnue →
deux premiers caractères en minuscules.

**`quantity`** : `1` par défaut si la colonne est absente, non numérique, nulle ou
négative — silencieusement, sans erreur de ligne.
→ **Décision ATEM** : ajouter une **borne haute** (ATEM-old n'en avait aucune, un CSV
avec `quantity=999999999` passait). On aligne sur la borne des scanlistes : **1000**.

## Les trois formats

### ATEM (natif)

```
set_code,name,quantity,rarity,language,passcode,notes
```
Séparateur `,` · fichier `collection.csv` · seul format où `set_code` est en tête, parce
que c'est l'identité de la ligne au réimport.

### ScanFlip (en-têtes TCGplayer)

```
Card Name,Set Code,Quantity,Rarity,Language,Passcode,Notes
```
Séparateur `,` · fichier `scanflip_collection.csv` · langue écrite telle quelle.

### Cardmarket

```
Card Name;Card Number;Quantity;Rarity;Language;Comments
```
Séparateur **`;`** (les exports Cardmarket réels l'utilisent) · fichier
`cardmarket_collection.csv`.

- **Pas de colonne passcode** — Cardmarket identifie par le numéro d'extension.
- `set_code` → colonne `Card Number` ; `notes` → colonne `Comments`.
- **Langue en toutes lettres** : `fr` → `French`, `en` → `English`. ATEM-old ne traduisait
  que ces deux-là et laissait les autres en code ISO. → **À compléter** : de, es, it, pt,
  ja, ko.

## Format JSON (scanliste)

```json
{
  "version": 1,
  "scanliste": "<nom du lot>",
  "date": "<date de création>",
  "lignes": [
    { "set_code": "SDRE-FR005", "name": "…", "quantity": 3, "passcode": 26976414 },
    { "set_code": "ZZZ-FR999", "name": "…", "quantity": 1 }
  ]
}
```

**`passcode` est omis, jamais `null`, quand la carte n'est pas identifiée — et c'est un
entier, jamais une chaîne.** Bug vécu : la première version l'émettait en chaîne, et
chaque ligne était rejetée par le schéma serveur, en silence.

L'import détecte le JSON tout seul (premier caractère non blanc `[` ou `{`), sans
paramètre de format. Formes acceptées : tableau nu, ou enveloppe `{lignes:[…]}` ou
`{rows:[…]}` — les autres clés sont ignorées sans erreur. Toute autre forme →
`expected_array_or_lignes`. JSON invalide → `invalid_json`.

## Modes d'import

**`merge` n'additionne pas.** C'est le point le moins intuitif du format.

- **`merge`** (défaut) : la quantité de la ligne existante est **alignée** sur celle du
  fichier (`delta = fichier − existant`), pas ajoutée. Les lignes possédées mais absentes
  du fichier sont conservées intactes. Si seule la note change, seule la note est écrite.
- **`replace`** : même traitement, puis **suppression** de toute ligne possédée dont le
  `set_code` n'apparaît pas dans le fichier. Une ligne du fichier **en échec compte quand
  même comme présente** et épargne la ligne correspondante — comportement délibéré, à
  conserver : un fichier partiellement illisible ne doit pas provoquer de suppression.

**Échecs par ligne** : chaque ligne est traitée indépendamment. Un échec ajoute une entrée
au rapport (`{line, set_code, error}`) sans interrompre les suivantes. Bilan retourné :
`mode`, `imported`, `removed`, `failed`, `errors[]`.

**Doublons de `set_code` dans un même fichier** : ATEM-old faisait « dernière ligne
gagne », sans test ni spécification, alors que la création de scanliste fusionne.
→ **Décision ATEM : fusionner**, en additionnant les quantités et en conservant le
premier nom identifié.

**Taille maximale** : 5 Mo, vérifiée **deux fois** — d'abord sur `Content-Length` pour
rejeter tôt, puis sur la taille réelle du texte lu, parce que l'en-tête peut mentir ou
être absent en `chunked`.
