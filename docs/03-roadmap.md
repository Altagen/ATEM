# ATEM — Feuille de route

Chaque jalon est une tranche **verticale** livrable et démontrable. On ne passe au
suivant que lorsque le précédent tourne réellement en `docker compose up`.

À chaque jalon, une étape « archéologie ATEM-old » ciblée : on n'inspecte que ce qui
concerne le jalon en cours, et on classe chaque élément **Reprendre / Adapter /
Refaire**. Pas de cartographie exhaustive de l'ancien projet.

---

## M0 — Squelette qui marche  ✅ *terminé le 2026-09-09*

**Objectif.** `docker compose up` sur une machine vierge donne une application où l'on
s'inscrit, se connecte, et cherche une carte dans le référentiel complet.

- Monorepo, compose, base de données, migrations, CI minimale
- Job d'amorçage du référentiel : 2 dumps → tables → index de set codes normalisés
- Téléchargement des images en tâche de fond, reprenable
- Inscription / connexion / déconnexion (scrypt)
- Une page : recherche de carte par nom, avec image

**Archéologie ciblée.** Configuration du monorepo, compose, client API YGOPRODeck,
socle d'authentification.

**Terminé quand.** Machine vierge → application utilisable en une commande, sans étape
manuelle. Le référentiel contient les 14 524 cartes et 44 517 impressions.

### Ce qui a été vérifié, et non supposé

| Mesure | Résultat |
|---|---|
| Import du catalogue complet | **12,4 s** — 14 524 cartes, 44 496 impressions, 12 codes malformés écartés |
| Résolution d'un set code français déjà en base | **39 ms**, zéro appel réseau |
| Découpage des set codes réels | **100 %** (44 505 / 44 517), contre 88,2 % pour ATEM-old |
| Tests | 11 dans `shared`, 7 dans `api`, tous au vert |
| Poids du front construit | 7,9 ko de JS, 4,5 ko de CSS |

Parcours validé de bout en bout à travers le proxy du front : inscription →
session par cookie → recherche par nom → résolution d'un set code français.

**Deux défauts trouvés en exécutant, pas en relisant** — voir ADR-007 (les deux
formes de set code) et le durcissement du schéma Zod : une carte sur 14 524 a
`attribute: null`, et un champ absent n'est pas un champ nul.

---

## M1 — Collection *(le cœur)*  ◐ *mis d'équerre ; reste l'essai sur cartes réelles*

- Recherche par set code, via la forme normalisée (ADR-004) — **P0**
- Ajout à la collection depuis le résultat — **P0**
- Grille de collection : `+1` / `-1` par impression, favori — **P0**
- Fiche carte plein écran, toutes informations — **P0**
- Recherche par nom et **filtres complets** (type, race, attribut, niveau, atk/def,
  archétype, set, rareté, favoris) — **P0**
- Scan OCR `tesseract.js` : capture → set code reconnu → correction manuelle →
  `+1`/`-1` → nouvelle capture — **P0**
- Scanliste : lot de scans indépendant, exportable en JSON, versable dans la
  collection à la demande — **P1**

**Archéologie ciblée.** Composants de grille et de fiche carte, réglages OCR
(prétraitement image, restriction de charset, zone de capture), interface de filtres.

**Terminé quand.** Une pile de cartes physiques est inventoriée par scan, de bout en
bout, sans passer par la base à la main.

### État au 2026-09-09

**Fait et vérifié** — recherche et ajout par set code, grille avec `+1` / `−1`,
favoris, fiche plein écran, filtres alimentés par ce que la collection contient
réellement, écran de scan complet. Le moteur OCR d'ATEM-old est repris **tel
quel** : 2 319 lignes sans aucun import, avec ses 46 tests, tous au vert.

| Mesure | Résultat |
|---|---|
| Tests | 11 partagés · 22 API · 46 OCR — 79 au total, tous au vert |
| Fragment principal du front | 19,4 ko (7,3 ko compressés) |
| Fragment du scanner | 24,4 ko, chargé seulement à l'ouverture de la caméra |
| Dictionnaire de préfixes OCR | 650 préfixes, 34 746 numéros, dérivés du catalogue local |
| Moteur Tesseract | vendorisé, 4 Mo, vérifié par empreinte SHA-256 |

**Deux défauts d'ATEM-old corrigés au passage.** Le premier : une impression déjà
identifiée l'emportait sur une provisoire seulement par hasard, si bien que la
consolidation ne se déclenchait jamais quand les raretés différaient — trouvé en
écrivant le test, pas en relisant le code. Le second : aucune borne haute
n'existait sur les quantités.

**Playwright est en place**, avec deux profils — bureau 1440×900 et Pixel 5 —
et **chaque épreuve tourne sur les deux**. 28 épreuves au vert, en 18 secondes.

Trois défauts ont été trouvés en *regardant* l'écran, qu'aucun test serveur
n'aurait révélés :

1. **Les noms s'affichaient en anglais sur des cartes françaises.** Après un
   import complet, le catalogue ne contient que les codes anglais ;
   `ensurePlaceholderPrint` retournait l'impression anglaise trouvée par la clé
   canonique au lieu de matérialiser le code du joueur. Corrigé, avec deux tests
   de régression.
2. **La barre de navigation restait en retard d'une action.** Elle se mettait à
   jour sur les clics, or le clic précède la réponse du serveur : juste après la
   connexion, elle affichait encore « Connexion ». Elle suit désormais le rendu
   de route.
3. **La mise en page mobile.** En-tête dont les trois blocs se chevauchaient,
   zone de capture du scanner si haute qu'elle repoussait `+1` et `−1` sous la
   ligne de flottaison, pastille de carte non identifiée flottant dans un coin.

Les épreuves qui les verrouillent mesurent aussi le débordement horizontal et la
taille des cibles tactiles — 44 px minimum, parce que cet écran sert à
inventorier des centaines de cartes au pouce.

**Parité avec ATEM-old atteinte le 2026-09-10** — passcode à l'ajout et à la
recherche, sens du tri, densité, regroupement par type, filtres de rang Xyz et
de valeur de Lien, note d'exemplaire. L'écran Catalogue, qui n'existait pas dans
ATEM-old et doublait la collection sans permettre d'agir, est supprimé.

**Reste à faire** — la scanliste (P1), et **l'essai du scan sur des cartes
physiques**. Les réglages OCR sont mesurés, l'ergonomie du geste ne l'est pas :
aucun navigateur d'épreuve n'a de caméra.

> Le prétraitement de l'image avant OCR est le vrai point dur de ce jalon, pas
> `tesseract.js` lui-même. Ce que fait ATEM-old ici est probablement l'actif le plus
> précieux de l'ancien projet.

---

## Coquille de navigation  ✅ *2026-09-10*

Hors jalon, faite avant M2 parce qu'elle le porte : barre du haut, barre du bas
sur téléphone, feuille de compte, état du service. Les destinations viennent du
routeur, si bien qu'un écran déclare sa route et sa place d'un seul geste.

Le mode tiroir de la fiche de carte est supprimé — deux façons d'ouvrir la même
chose, dont l'une n'apportait rien.

---

## M2 — Decks

- Arborescence de dossiers — **P1**
- Liste des decks, recherche par nom, vue liste / galerie — **P1**
- Atelier : collection à gauche, deck à droite (Main / Extra / Side), vue liste /
  galerie, paramètres du deck, enregistrement — **P1**
- Indicateur « possédé / manquant » calculé selon D3 (somme sur toutes les impressions)
- Contrôle des limites : 3 exemplaires max, 40–60 en Main, 15 en Extra et Side

**Archéologie ciblée.** Interface de l'atelier, glisser-déposer, rendu des sections.

**Terminé quand.** Un deck se construit depuis sa collection et signale ce qui manque.

---

## M3 — Paramètres & souveraineté des données

- Compte : email, UUID, date de création, statut
- Changement de mot de passe
- Langue FR/EN et mode d'inspection des cartes
- Export CSV : formats ATEM, ScanFlip, Cardmarket
- Import CSV : mêmes formats, modes fusion / remplacement
- Historique d'importation avec rapport des lignes en échec
- Zone de danger : réinitialisation de la collection, effacement total du compte

**Archéologie ciblée.** Spécifications exactes des colonnes ScanFlip et Cardmarket —
c'est de la connaissance de format, pas du code : à récupérer tel quel.

**Terminé quand.** Un utilisateur exporte, efface tout, réimporte, et retrouve sa
collection à l'identique.

---

## M4 — Duellistes

- Annuaire des joueurs, recherche par pseudo, filtres amis / en ligne
- Carte d'aperçu : pseudo, icône, badges, lien vers le profil
- Demande d'ami (envoi, attente, acceptation, suppression), blocage
- Profil public consultable
- **Consultation de la collection et des decks d'un autre joueur**, via le point de contrôle
  d'accès unique décrit dans « Frontières de modules » (02-architecture.md)

Le bouton « lancer un duel » est présent mais inactif jusqu'au cadrage de la mécanique.

**Terminé quand.** Deux comptes se voient, deviennent amis, et consultent mutuellement
leurs collections en respectant leurs réglages de visibilité.

---

## Après M4 — à cadrer, dans cet ordre

1. **Mécanique de duel.** Décision préalable : écran partagé ou deux appareils
   synchronisés. Détermine s'il faut du temps réel (ADR-006).
2. **Guildes.** Rôles, candidatures, invitations, journal d'activité.
3. **Boîte de réception.** Prend son sens une fois les guildes en place.
4. **Tournois.** Dépend des duels ET des guildes.
5. **Administration.** À réduire avant d'être reprise — la zone d'ATEM-old est jugée
   trop complexe ; on repartira des besoins réels d'un hébergeur.

---

## Ce qui reste à trancher

| Question | Nécessaire pour |
|---|---|
| Framework front / serveur / ORM / base (par défaut : ceux d'ATEM-old) | M0 |
| Favori au niveau de la carte ou de l'impression ? | M1 |
| Mode d'usage de l'assistant de duel | Après M4 |
