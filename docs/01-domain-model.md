# ATEM — Modèle de domaine (noyau invariant)

> **Statut : validé le 2026-09-09.** Ce document est figé. Les écrans, filtres et formats d'export restent ouverts ;
> les entités et relations ci-dessous ne changent que par décision explicite et tracée.
> C'est la garantie qu'on ne reproduira pas la dérive d'ATEM-old.

---

## Faits mesurés sur l'API YGOPRODeck (2026-09-09)

Ces chiffres viennent d'appels réels, pas d'estimations. Ils justifient les décisions.

| Mesure | Valeur |
|---|---|
| Cartes (dump EN complet, 1 requête, 22 s) | **14 524** — 21 Mo JSON |
| Cartes (dump FR complet) | **11 661** — 18 Mo JSON |
| Cartes sans version FR (→ fallback EN obligatoire) | **2 863** |
| Impressions (`set_code`) au total | **44 517** |
| Artworks (variantes d'illustration) | **14 688** |
| Raretés distinctes | 48 |
| Limite API | 20 req/s — dépassement = blocage IP 1 h |

### Deux contraintes réelles

**C1 — La recherche par set code se fait via `cardsetsinfo.php`.**
`cardsetsinfo.php?setcode=LOB-EN001` renvoie directement `{id, name, set_name,
set_code, set_rarity, set_price}`. C'est l'endpoint de résolution d'un code imprimé.
(`cardinfo.php` n'a pas de paramètre de set code — il ne sert qu'à récupérer la fiche
complète ensuite, par `id`.)

**C2 — Les set codes non anglais ne sont pas indexés.**
Mesuré : `LOB-EN001` et `PSV-E088` répondent ; `LOB-FR001` et `SDK-FR001` renvoient
« No card matching your query ». Le dump `language=fr` ne corrige rien — vérifié sur
« Magicien Sombre » : `name` et `desc` sont traduits, mais `card_sets` contient
`CT13-EN003`, `DB1-EN102`… jamais `-FR`.

→ Un code français se résout en **basculant la région vers EN** pour l'interrogation
(`LTGY-FR008` → `LTGY-EN008`), puis en **conservant le code français** comme identité
de l'impression côté utilisateur. C'est exactement ce que fait ATEM-old
(`toEnglishLookupSetCode`), et c'est validé par l'usage.

**C3 — La traduction FR est partielle.**
Seuls `name` et `desc` sont localisés. `type`, `race`, `attribute`, `frameType`
restent en anglais (`Spellcaster`, `DARK`, `Equip`). Et **2 863 cartes sur 14 524**
n'ont aucune version française.
→ Les libellés d'énumération et le repli EN sont **notre** responsabilité.

## Décisions structurantes

### D1 — `Card` et `CardPrint` sont deux entités distinctes

C'est **la** décision qui conditionne tout le reste.

- **`Card`** = la carte au sens des règles, identifiée par son **passcode** (8 chiffres).
  Immuable, vient du référentiel. « Magicien Sombre » est UNE carte.
- **`CardPrint`** = une **impression** de cette carte dans un set donné, identifiée par
  son **set code** (`LOB-FR001`) + sa rareté. Le Magicien Sombre a **59 impressions**.

Confondre les deux rend impossibles à la fois la valorisation d'une collection
(rareté et édition changent tout) et la règle des 3 exemplaires (qui s'applique à la
carte, pas à l'impression). C'est l'erreur classique à ne pas refaire.

### D2 — Une collection contient des `CardPrint`, pas des `Card`

L'utilisateur scanne un set code : il déclare posséder **une impression précise**.
Le « +1 / -1 à côté d'une carte » opère sur `CollectionItem`, donc sur l'impression.

### D3 — Un deck référence des `Card`, pas des `CardPrint`

La limite de 3 exemplaires s'applique par carte, toutes impressions confondues. Un
deck est une liste de cartes ; l'exemplaire physique utilisé est indifférent aux règles.

La question « est-ce que je possède les cartes de ce deck ? » se calcule en sommant
les quantités de **toutes** les impressions de cette carte dans la collection.

> Évolution prévue sans casse : si un jour on veut épingler une impression précise à
> une entrée de deck (pour l'esthétique du deck physique), on ajoute une table
> d'allocation optionnelle. Le schéma actuel ne l'interdit pas.

### D4 — Résolution d'un set code : bascule EN pour l'interrogation, code imprimé pour l'identité

**Contexte.** C2 : seuls les codes anglais sont indexés côté YGOPRODeck.

**Procédure** (reprise d'ATEM-old, éprouvée) :

```
1. Normaliser        "ltgy fr008"  → "LTGY-FR008"   (majuscules, espaces → tiret)
2. Déduire la langue "LTGY-FR008"  → fr             (segment du milieu ; défaut en)
3. Chercher en local par le code imprimé, puis par son équivalent EN
4. Si absent : interroger cardsetsinfo.php avec "LTGY-EN008"
5. Persister DEUX impressions : celle du joueur (LTGY-FR008, fr)
                                et sa contrepartie EN (LTGY-EN008, en)
```

L'étape 5 est ce qui fait que la collection garde **le code réellement imprimé sur la
carte** — celui que le joueur voit, scanne et retrouve à l'export — tout en restant
raccordée au référentiel anglais.

**Identité d'une impression** : `(set_code, rarity, language)`. La rareté en fait
partie parce qu'un même set code existe en plusieurs raretés.

La rareté **n'est pas saisie à l'ajout** : elle vient du catalogue. Un menu à cinq
valeurs ne tranchait rien — 10,1 % des impressions portent plusieurs raretés pour
un même code, et 91 % d'entre elles en ont au moins une hors de ces cinq. Le choix
se posera quand on saura enregistrer ses éditions, avec les raretés réelles du code.

### Limite connue — les codes suffixés du wiki français ne résolvent pas

Le wiki français distingue les raretés d'une même édition par un **suffixe de
lettres** : `RA03-FR004` (Secret Rare), `RA03-FR004u` (Ultra), `RA03-FR004q`
(Quarter Century Secret), `RA03-FR004ul`, `RA03-FR004c`…

**Ce suffixe n'est pas imprimé sur la carte.** Le carton porte `RA03-FR004`, et
c'est ce que le joueur scanne ou saisit. La convention appartient au wiki.

Un code suffixé saisi tel quel **ne plante pas, mais ne se résout jamais** : sa
forme canonique (`RA03-004UL`) ne correspond à aucune impression connue,
`cardsetsinfo.php` ne le connaît pas non plus, et la file de résolution
abandonne — une absence n'est pas une erreur, elle n'est pas réessayée. La ligne
entre dans la collection avec la bonne quantité et y reste **« en attente
d'identification » indéfiniment**, sans nom ni illustration.

Un rattrapage serait sans risque, et c'est mesuré : sur **38 435 codes
distincts**, un seul se termine par des lettres après ses chiffres —
`BLAR-EN10K`, dont la base `BLAR-EN10` n'existe pas. Réessayer sans le suffixe
uniquement après l'échec du code exact ne toucherait donc jamais un code
légitime.

**Décision d'Ange le 2026-09-10 : on ne le fait pas.** Le cas ne se présente que
si l'on recopie un code depuis le wiki au lieu de le lire sur la carte, ce qui
n'est pas le geste que l'application sert. La limite est notée ici pour qu'elle
soit reconnue si elle se présente, plutôt que rediagnostiquée.

### D5 — Le référentiel est en lecture seule et versionné

Les tables du référentiel (`Card`, `CardPrint`, `CardSet`, `CardImage`,
`CardLocalization`) ne sont **jamais** écrites par une action utilisateur. Elles sont
remplies par un job d'import identifié (`ReferentialImport`), ce qui rend un
rafraîchissement rejouable et diagnosticable.

---

## Entités

### Référentiel (immuable, source : YGOPRODeck)

```
Card
  passcode          PK, 8 chiffres          -- identité au sens des règles
  konami_id         nullable
  name_en           -- toujours présent, sert de fallback
  desc_en
  type, frame_type, race, attribute   -- valeurs brutes EN, traduites côté UI (C3)
  atk, def, level, scale, link_value, link_markers   -- nullable selon le type
  archetype         nullable
  banlist_tcg, banlist_ocg           nullable

CardLocalization                       -- 11 661 lignes en FR (C3)
  (card_passcode, lang)  PK
  name, desc

CardSet
  set_prefix        PK      -- "LOB"
  set_name                  -- "Legend of Blue Eyes White Dragon"
  release_date, num_of_cards

CardPrint                              -- 44 517 lignes
  id                PK
  card_passcode     FK -> Card
  set_code                  -- "LOB-EN001", tel qu'imprimé
  set_code_normalized       -- "LOB-001", INDEX UNIQUE-ISH, voir D4
  set_prefix        FK -> CardSet
  rarity, rarity_code
  price_indicative  nullable

CardImage                              -- 14 688 lignes
  image_id          PK      -- != passcode pour les artworks alternatifs
  card_passcode     FK -> Card
  variant                   -- full | small | cropped
  local_path                -- fichier servi par ATEM, jamais une URL distante
```

### Utilisateur

```
User
  id                PK, uuid
  email             UNIQUE
  password_hash             -- scrypt
  locale                    -- fr | en
  status, created_at

UserProfile
  user_id           PK, FK -> User
  display_name, tag         -- pseudo + discriminant
  avatar, banner, bio
  visibility_profile        -- public | friends | private
  visibility_collection     -- idem
  visibility_decks          -- idem
```

> La visibilité est dans le noyau **dès maintenant**, alors que le social est en P0
> mais léger. Rajouter des règles de confidentialité après coup sur des endpoints déjà
> écrits est une source classique de fuite de données.

### Collection

```
CollectionItem
  (user_id, card_print_id)  PK          -- D2 : l'unité est l'impression
  quantity                  > 0
  is_favorite
  added_at, updated_at

ScanList                                -- P1, lot de scans hors collection
  id, user_id, name, created_at
ScanListEntry
  scan_list_id, raw_set_code
  card_print_id             nullable    -- null = non résolu, à corriger à la main
  quantity
```

### Decks

```
DeckFolder
  id, user_id, parent_id  nullable      -- arborescence
  name

Deck
  id, user_id, folder_id  nullable
  name, description
  cover_card_passcode     nullable
  visibility                            -- public | friends | private
  created_at, updated_at

DeckEntry
  (deck_id, section, card_passcode)  PK -- D3 : référence la carte
  section                               -- MAIN | EXTRA | SIDE
  quantity                  1..3
  position                              -- ordre d'affichage
```

### Social (P0 léger)

```
Friendship
  (requester_id, addressee_id)  PK
  status                                -- pending | accepted
  created_at, responded_at

Block
  (blocker_id, blocked_id)  PK
```

### Données & conformité

```
ImportJob
  id, user_id, source                   -- atem | scanflip | cardmarket
  mode                                  -- merge | replace
  status, rows_total, rows_ok, rows_failed
  report            -- lignes en échec, consultable (« Historique d'Importation »)
  created_at
```

---

## Différé — à ne PAS implémenter, mais à ne pas rendre impossible

`Guild`, `GuildMember`, `GuildApplication`, `GuildActivityLog`, `Message`,
`Duel`, `DuelTurn`, `DamageEvent`, `Tournament`, `Trophy`.

**Contraintes de compatibilité à respecter dès maintenant :**

- `UserProfile` prévoit un rattachement futur à une guilde → ne pas dénormaliser le
  pseudo ou l'appartenance dans d'autres tables.
- Un duel référencera **deux `Deck`** → un deck ne doit jamais être supprimé
  physiquement une fois utilisé ; prévoir une suppression logique.
- Les trophées seront attachés au profil → `UserProfile` reste extensible.
