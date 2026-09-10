# Référence — reconnaissance du set code (OCR)

**L'actif le plus précieux d'ATEM-old.** Ces réglages sont le produit de mesures
répétées, pas d'un choix théorique. Les reproduire de mémoire coûterait des jours.

## Moteur

**tesseract.js 5.1.1**, variante LSTM **non-SIMD** — la variante SIMD plante sur
certains processeurs mobiles. Langue `eng`, pack `@tesseract.js-data/eng` en
`4.0.0_best_int` (~2,9 Mo compressé).

**Ce n'est pas une dépendance npm.** Le moteur est vendorisé : téléchargé une fois depuis
jsDelivr, **vérifié par empreinte SHA-256**, puis servi depuis le domaine propre sous
`/tesseract/*`.

Raison, et elle n'est pas cosmétique : le cookie de session est `httpOnly`, mais un
script tiers chargé dans la page pourrait appeler l'API au nom de l'utilisateur.
Épingler une version ne protège de rien — seule l'empreinte du contenu compte.

```
tessedit_pageseg_mode  = "7"        // ligne unique
tessedit_char_whitelist = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"
load_system_dawg       = "0"        // pas de dictionnaire anglais
load_freq_dawg         = "0"        // un set code n'est pas un mot
```

Délais : 20 s pour le chargement du script, 45 s pour la création du worker et de la
langue.

## Zone de capture

Bande horizontale fixe, en fraction du cadre caméra :

```
SCAN_ZOOM_BAND = { x: 0.05, y: 0.34, w: 0.90, h: 0.30 }
```

**Ces coordonnées sont synchronisées avec la règle CSS `.scan-zoom-band`.** Un
désalignement entre les deux **casse le scan en silence** : la caméra montre au joueur
une zone que l'OCR ne lit pas. → Doit être couvert par un test, ce qui n'était pas le cas.

## Prétraitement — six variantes, essayées dans l'ordre

Chaque bande est mise à l'échelle vers une hauteur cible de **88 px**, plafonnée à 140 px
de haut et 1100 px de large — au-delà, le traitement passe à 10-15 s sur mobile.

1. **`gray`** — niveaux de gris + étirement de contraste par percentile, **sans
   seuillage**. Mesuré : le noir et blanc pur fait confondre `8`↔`S` et `0`↔`U`. Le LSTM
   lit mieux le gris.
2. **`soft`** — seuillage partiel (biais −12, zone morte ±18/22), conserve les demi-tons.
3. **`hard`** — Otsu, amincissement des traits par dilatation 3×3, dépoussiérage.
4. **`ink`** — seuil au 22ᵉ percentile : ne garde que l'encre la plus sombre, ce qui
   **préserve les trous des `0` et des `8`**.
5. **Inversion du gris** — cas de polarité inversée (texte clair sur fond sombre).
6. **Redressement à ±6° et ±12°.** Mesuré le 3 septembre 2026 : à 5° d'inclinaison la
   lecture échoue totalement, à 3° elle passe encore. D'où ces deux paliers.

## Boucle de reconnaissance

Modes de segmentation essayés : `7` (ligne simple), `8` (mot simple), `13` (ligne brute).
En capture standard, seuls `7` et `8` sont tentés sur les deux premières variantes —
budget rapide. En mode approfondi (l'écran de scan dédié), toutes les variantes × tous
les modes.

**Sortie anticipée dès que deux lectures indépendantes s'accordent** sur un même code
fort. Empêche de verrouiller un faux positif sur une seule image bruitée.

## Correction des erreurs de lecture

**Normalisation** : `|` → `I`, filtrage sur la liste blanche de caractères.

**Confusions lettre → chiffre, appliquées uniquement au numéro d'impression, jamais au
préfixe de set** :

```
O U D Q → 0     I L → 1     Z → 2     S → 5     G → 6     B → 8
```

Correspondance stricte 1 pour 1 : pas de `S → 5 ou 8`, qui rouvrirait l'ambiguïté.

**Catalogue de préfixes** chargé depuis `/ocr/set-prefixes.json`, généré depuis
YGOPRODeck, avec un repli d'environ 120 sets si l'application est hors ligne.

**Pas de distance de Levenshtein libre sur les préfixes** — refusé explicitement, ça
produisait des verrouillages sur un mauvais set. Levenshtein ≤ 1 est autorisé uniquement
sur le **numéro d'impression**, et seulement contre un ensemble fermé de numéros connus.

## Score de confiance

| Critère | Points |
|---|---|
| Préfixe de set connu | **+100** |
| Préfixe inconnu | **−80** |
| Numéro d'impression présent au catalogue | **+80** |
| Numéro connu mais faux | **−50** |
| Région `FR` | +20 |
| Région `EN` | +8 |
| Région `IT` | −12 |
| Numéro à 3 chiffres | +15 |
| Numéro à 4 chiffres | −8 |
| Numéro à 2 chiffres | −15 |
| Bégaiement de caractères (`LTGGY`) | pénalité — mais `DOOD` est épargné, il est au catalogue |

**Seuil de verrouillage automatique : 140.**

**Suggestions proposées au joueur** : uniquement des quasi-doublons soutenus par le
catalogue (`SDS1` ↔ `5DS1`). **Jamais** une alternative FR ↔ EN inventée.

## Contrat d'usage — non négociable

**L'OCR n'est jamais autoritaire.** Il propose, l'utilisateur confirme par « +1 » ou
corrige le champ. Aucun ajout automatique silencieux à la collection.

## À porter ensemble, sous peine de casse silencieuse

- `collection/ocr.ts` (logique) et `collection/OCR.md` (sa documentation)
- `collection/scanner.ts` — **un seul scanner** sert la Collection et la Scanliste
- `scripts/vendor-tesseract.sh` + `scripts/tesseract.sha256`
- `public/ocr/set-prefixes.json` et le script qui le génère
- `design/styles/components/scanner.css` — **la géométrie du recadrage en dépend**
