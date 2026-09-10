# Étape 2 — Tri d'ATEM-old, module par module

Verdicts : **REPRENDRE** (tel quel, au détail d'imports près) · **ADAPTER** (le fond est
bon, la forme change) · **REFAIRE** · **IGNORER** (hors périmètre prioritaire).

Règle : aucun fichier n'est repris sans justification écrite ici.

---

## Module `referential` (ex-`catalogue` + `media`)

**Verdict d'ensemble : c'est la zone la mieux tenue d'ATEM-old.** Commentaires qui
expliquent des bugs vécus, tests qui rejouent l'incident plutôt que la fonction,
séparation pur/IO propre. Le module ne viole aucune frontière — ce sont les autres qui
écrivent chez lui.

| Fichier | L. | Verdict | Motif |
|---|---|---|---|
| `catalogue/set-code.ts` (+test) | 58 | **REPRENDRE** | Fonctions pures testées. La bascule FR→EN, socle de D4. |
| `catalogue/debit-sortant.ts` (+test) | 151 | **REPRENDRE** | Seau à jetons. Voir « leçons » ci-dessous — non négociable. |
| `catalogue/ygoprodeck.ts` | 202 | **REPRENDRE** | Client Zod strict, gère le `400 + {error}` de l'API. Essaie le code EN en premier pour éviter un aller-retour perdu. |
| `catalogue/card-mapper.ts` | 44 | **REPRENDRE** | Mapping DB→DTO, trois replis d'image documentés. |
| `media/cache.ts` | 193 | **REPRENDRE** | Liste blanche anti-SSRF, écriture atomique, contrôle de place disque. |
| `media/espace.ts` | 80 | **REPRENDRE** | Distingue « mesure impossible » de « disque plein ». |
| `media/paths.ts` | 36 | **REPRENDRE** | Construction de chemins pure. |
| `media/*.test.ts` | 204 | **REPRENDRE** | Provoquent de vraies pannes au lieu de les simuler. |
| `routes/catalogue.ts`, `routes/media.ts` | 109 | **REPRENDRE** | Routes minimales, regex ancrées, traversée de chemin testée. |
| `collection/resolve-queue.ts` (+test) | 522 | **REPRENDRE** | File de résolution différée, dédoublonnage par *(utilisateur, code)*. Déménage dans `referential`. |
| `catalogue/resolve.ts` | 150 | **ADAPTER** | Cœur métier à préserver quasi mot pour mot. Retirer sa connaissance des stubs (concept qui ne lui appartient pas). |
| `catalogue/upsert.ts` | 184 | **ADAPTER** | `upsertPrint` fait `.limit(20)` puis filtre en mémoire, alors qu'un index unique `(set_code, rarity, language)` existe. Remplacer par un `WHERE` exact. |
| `catalogue/queries.ts` | 86 | **ADAPTER** | Télécharge une image **dans le chemin de requête**, ce que le reste du code s'interdit explicitement. À rendre asynchrone. |
| `catalogue/sync.ts` | 54 | **ADAPTER** | Import de dump en boucle `await` séquentielle sur des dizaines de milliers de lignes. À passer en insertion par lots. |
| `collection/seed-playset.ts` | 226 | **REFAIRE** | Script de développement. Réinvente la regex de langue et son propre `setTimeout(120ms)` au lieu du seau à jetons partagé. |

### Leçons à ne pas redécouvrir

**Le débit sortant compte l'API *et* les images ensemble.** Un limiteur par type d'appel
avait laissé les téléchargements d'images hors comptage → liste noire YGOPRODeck. Un
seul seau à jetons pour tout ce qui sort.

**Zod retire silencieusement les champs absents du schéma.** `linkval` et `linkmarkers`
manquaient : toutes les cartes Lien affichaient « Lien — ». Pire, le premier test écrit
pour couvrir le bug fabriquait l'objet à la main et ne testait donc rien.
→ **Règle** : tout schéma sur une réponse d'API externe se teste avec la charge utile
réelle, jamais avec un objet reconstruit.

**Le nom affiché suit la langue de l'impression possédée, pas celle de l'interface.**
Un anglophone voyait des noms français parce que le code faisait `nameFr ?? nameEn`.
C'est une règle produit, indépendante de son implémentation.

**La liste blanche d'hôtes d'images est une défense anti-SSRF, pas un détail.** L'URL
vient d'un tiers. Filtrer les IP privées ne suffit pas — un nom peut résoudre vers une
IP privée *après* le contrôle. Liste blanche stricte de noms d'hôtes + HTTPS obligatoire.

**La réserve d'espace disque protège PostgreSQL, pas l'affichage.** Le scénario redouté
est la base qui cesse d'écrire ses journaux de transaction sur le même disque.

**Le minuteur du limiteur n'est délibérément pas `unref()`.** Ça paraît sale, ça ne
l'est pas : sans ça, le script de synchronisation se termine avant la fin de la
limitation. À ne pas « corriger » par réflexe.

### Le piège n°1 : les stubs à passcode négatif

**Le besoin est légitime.** `POST /collection` doit répondre immédiatement : on ne peut
pas attendre YGOPRODeck dans le chemin de requête. Une carte inconnue est donc créée
tout de suite en ligne provisoire, et résolue en tâche de fond.

**L'encodage est fragile.** Le provisoire est signalé par un `passcode` **négatif**,
dérivé d'un hash du set code. Cette convention implicite est réécrite à la main dans
**quatre modules** (`if (cardId > 0)`), sans garde-fou de type : rien ne distingue un
vrai passcode d'un stub dans la signature `cardId: number`. Et une collision de hash
entre deux set codes donnerait le même stub à deux cartes différentes — non prouvé
impossible, non testé.

**Pire : il existe trois implémentations différentes du même concept.**
`collection/service.ts` (`createStubPrint`), `decks/service.ts` (insertion directe dans
`cards` avec un nom différent, `Card ${pc}`), et le contrôle `> 0` disséminé côté
catalogue. Aucune ne connaît les deux autres.

→ **Décision pour ATEM** : garder le principe (réponse immédiate, résolution différée),
remplacer le passcode négatif par un **état explicite porté par la ligne**
(`resolve_status`), et n'avoir **qu'une seule fonction propriétaire** de la création
d'une ligne provisoire, exposée par le module `referential`.

### La violation de frontière à corriger

`collection/service.ts` et `decks/service.ts` **écrivent directement** dans les tables
`cards` et `card_prints`, en contournant le module catalogue. C'est la cause racine des
trois logiques de stub.

→ Le module `referential` doit exposer une **API d'écriture** (`upsertCard`,
`upsertPrint`, `ensurePlaceholderPrint`) que `collection` et `decks` appellent. Aucun
accès direct aux tables du référentiel depuis un autre module. C'est le seul changement
structurel à faire sur cette zone.

### Dette de test à combler avant de porter

`resolve.ts`, `upsert.ts` et `queries.ts` — les fichiers qui portent la logique la plus
subtile — **n'ont aucun test unitaire dédié**. Ils ne sont couverts qu'indirectement.
→ Écrire ces tests **avant** de porter le code, en particulier le cas « code FR déjà
connu en EN localement → matérialise le code FR sans appel réseau ».

---

## Infrastructure et outillage

### La stack réelle d'ATEM-old (mesurée, pas déclarée)

| Couche | Choix | Verdict |
|---|---|---|
| Runtime | Node ≥ 22, pnpm 9.15.0 (corepack), workspaces `apps/*` + `packages/*` | **REPRENDRE** |
| Langage | TypeScript 5.7, `strict` + `noUncheckedIndexedAccess` + `noUnused*` | **REPRENDRE** — configuration saine |
| Serveur | Hono 4 + `@hono/node-server` | **REPRENDRE** |
| Base | PostgreSQL 16, Drizzle ORM 0.45 + drizzle-kit 0.31, driver `postgres` 3.4 | **REPRENDRE** |
| Contrats | Zod, partagés via `packages/shared` | **REPRENDRE** |
| Front | TypeScript vanilla + Vite 6, **aucun framework UI** (choix délibéré et documenté) | **REPRENDRE** |
| OCR | tesseract.js 5.1.1 — *pas une dépendance npm*, vendorisé depuis jsDelivr avec vérification SHA-256 | **REPRENDRE** |

Dépendances de production, exhaustives : `hono`, `@hono/node-server`, `drizzle-orm`,
`postgres`, `zod` côté API ; **zéro dépendance tierce** côté web. C'est remarquablement
sobre — aucun surdimensionnement à purger.

À corriger en reprenant : zod est en `^3.24` côté API et `^3.25` côté shared
(désaccord de version à unifier), et **aucun linter ni formateur n'est configuré** —
lacune, pas choix documenté.

### L'écart majeur : `docker compose up` n'existe pas

`compose.yaml` porte son propre avertissement : *« Dev-only infrastructure. Not the
application ship stack. »* Un seul service, `db`. Aucune image applicative.
`Containerfile.build` est une image de **build** CI, pas d'exécution.

Le déploiement réellement pratiqué est **bare-metal, systemd + nginx**, en **neuf
étapes manuelles** documentées dans `deploy/README.md`.

→ **Conséquence pour M0 : rien à adapter, tout à écrire.** C'est l'objectif du jalon et
il est plus lourd que je ne l'avais estimé. Le `deploy/README.md` reste la meilleure
spécification disponible : il énumère exactement ce que le compose devra automatiser.

| Élément | Verdict |
|---|---|
| `compose.yaml` | **REFAIRE** — dev-only, ne livre pas l'application |
| `Containerfile.build` | **ADAPTER** — bon squelette, à décliner en images d'exécution |
| `deploy/nginx/*.conf` | **REPRENDRE** — CSP justifiée directive par directive, tampon SSE, cache des médias |
| `deploy/systemd/*` | **ADAPTER** — arrêt propre et sauvegarde vérifiée, à traduire en entrypoint et healthcheck |
| `.env.example` | **REPRENDRE** — chaque variable justifiée en une phrase, modèle à copier |
| `packages/shared` | **REPRENDRE** — contrats Zod purs, découpés par domaine, testés |
| `apps/web/vite.config.ts` | **REPRENDRE** — proxy `/api` et `/media`, HTTPS auto-signé en dev (nécessaire à `getUserMedia`, donc au scan) |
| `scripts/epreuves-api.sh` | **REPRENDRE** — base Postgres jetable horodatée + dossier média jetable, nettoyage garanti, détection des bases orphelines |
| `scripts/vendor-tesseract.sh` + `.sha256` | **REPRENDRE** — vendorisation vérifiée par empreinte, motivée par un vrai incident CSP |
| `scripts/check-*.sh` (~35 barrières) | **REPRENDRE le mécanisme**, trier le contenu — beaucoup sont spécifiques à des écrans différés |
| `scripts/lib/navigateur.mjs`, `banc-*.mjs` | **REFAIRE en Playwright** — voir ci-dessous |
| `scripts/ocr-lab/`, `__pycache__/*.pyc`, `avant-communaute.txt` | **IGNORER / ne pas reprendre** — artefacts commités par accident |

### Tests : bon socle, pas d'end-to-end réel

Lanceur natif `node --test` avec `tsx`, 87 fichiers de test co-localisés. La base de
test jetable de `epreuves-api.sh` est un pattern solide, à reprendre tel quel.

**Il n'y a pas de Playwright.** Les bancs d'essai pilotent Chromium en CDP écrit à la
main, en réutilisant opportunément un binaire téléchargé par un plugin tiers — cassé
une fois par une mise à jour de ce plugin, impossible à faire tourner en CI.

→ La mise en place de Playwright prévue à M1 part donc d'une page blanche. En revanche
le **scénario** de ces bancs mérite d'être repris : instance jetable complète montée
avant chaque campagne, mesure de la couverture réelle des routes atteintes par un
navigateur, et test à plusieurs navigateurs simultanés pour les flux sociaux — qu'on ne
peut pas valider en testant une route isolée.

**Aucune CI n'existe** (`.github/` absent). Les quatre barrières listées dans
`AGENTS.md` sont lancées à la main.

### Connaissance opérationnelle à transférer

`docs/CHANTIER-HEBERGEMENT.md` est le document le plus dense du dépôt : chaque point de
durcissement y est décrit avec **la cause réelle trouvée en production** — limitation de
débit contournable via un `X-Forwarded-For` non filtré, flux SSE jamais fermés côté
serveur, écoute sur toutes les interfaces malgré un message annonçant le contraire,
absence d'arrêt propre, absence de CSP, sauvegardes jamais vérifiées par restauration.
→ À transposer en **check-list de durcissement** pour ATEM, indépendamment du mode de
déploiement.

`antipatterns.md` (dans le backbone `all/ATEM/`) recense des défauts génériques
constatés : données fabriquées en repli (`d.winrate || "65%"`), contenu de démonstration
affiché en repli inconditionnel, migration écrite à la main désynchronisant le snapshot
Drizzle, table déclarée sans migration → 500 en production. → À porter tel quel dans le
contrat du nouveau projet.

**À ne pas reprendre comme feuille de route** : `BACKLOG.md` est périmé — plusieurs
items qu'il liste comme ouverts sont déjà faits. Le backbone `all/ATEM/` l'est aussi
partiellement (il affirme « Deployment: none yet » alors qu'un déploiement systemd
fonctionne depuis le 8 septembre 2026).

### Deux réflexes de rigueur à conserver

`MEMORY.md` d'ATEM-old a été **délibérément vidé**, avec la raison écrite : les
auto-évaluations d'agent s'étaient révélées fausses sur des points vérifiables.
`AGENTS.md` en tire deux règles cardinales — **ne jamais fabriquer de donnée**, et
**ne jamais écrire de fichier de statut de projet en prose**. Un état de projet se
mesure par une barrière exécutable, pas par un bulletin rédigé par celui qu'on évalue.

Ces deux règles s'appliquent à moi. Je les reprends dans le contrat d'ATEM.

---

## Module `identity` (auth)

**Verdict d'ensemble : REPRENDRE presque intégralement.** C'est une implémentation mûre,
sans reproche notable.

| Fichier | Verdict | Motif |
|---|---|---|
| `auth/crypto.ts` | **REPRENDRE** | scrypt asynchrone, paramètres **versionnés dans le hash** (on peut relever le coût sans invalider l'existant), `needsRehash` + rehachage opportuniste à la connexion, comparaison à temps constant. |
| `auth/secret.ts` | **REPRENDRE** | Refuse de démarrer sans `JWT_SECRET` valide, et rejette explicitement par égalité de chaîne l'ancien secret par défaut codé en dur. |
| `auth/token.ts` + `revocation.ts` | **REPRENDRE** | Le jeton porte une **version** relue en base à chaque requête → déconnexion, changement de mot de passe et suspension invalident réellement les jetons émis. |
| `auth/cookie.ts` | **REPRENDRE** | `httpOnly` + `Secure` conditionnel + `SameSite=Strict`, avec un cookie témoin non sensible pour que le front connaisse l'état de connexion sans lire le jeton. |
| `auth/csrf.ts` | **REPRENDRE** | Contrôle d'origine en complément de `SameSite`, appliqué aux seules écritures et à la seule authentification par cookie. |
| `auth/rate-limit.ts` + `magasin-debit.ts` | **REPRENDRE** | Double compteur IP **et** compte visé, fenêtre glissante, stocké en base donc survit au redémarrage. |
| `auth/middleware.ts` | **REPRENDRE** | Relit rôle, suspension et version de jeton en base à chaque requête — aucune confiance aveugle au contenu du JWT. |
| `auth/adresse-appelante.ts` | **ADAPTER** | Dépend de `X-Forwarded-For`. À revalider contre le reverse-proxy réel du nouveau déploiement — c'est exactement le vecteur de contournement du rate-limit décrit dans le chantier d'hébergement. |
| `db/verifier-migrations.ts` | **REPRENDRE** | Refuse de démarrer si la base n'a pas toutes les migrations attendues, en distinguant « manquantes » et « inconnues ». |
| `db/client.ts`, `user-tag.ts`, `bootstrap-admin.ts` | **REPRENDRE** | Pool borné, `prepare:false` justifié pour PgBouncer, échec net sans `DATABASE_URL`. |
| `db/delete-account.ts` | **ADAPTER** | Bonne politique, mais une seule fonction connaît `users` **et** les tables de guilde. À découper : chaque module nettoie ses propres données. |
| `db/seed.ts` | **REFAIRE** | 483 lignes de données de démonstration mêlant tous les domaines. |

## Module `decks`

| Fichier | Verdict | Motif |
|---|---|---|
| `decks/folders.ts` | **REPRENDRE** | Profondeur max, détection de cycle, calcul de profondeur du sous-arbre avant déplacement, et **ré-attachement** des enfants à la suppression plutôt qu'une cascade destructrice. |
| `shared/engine/banlist.ts`, `card-math.ts` | **REPRENDRE** | Logique pure : statut banlist, classification extra deck. Briques utiles. |
| `decks/service.ts` | **ADAPTER** | CRUD sain, mais voir les deux lacunes ci-dessous. |
| `routes/decks.ts` | **ADAPTER** | Bon découpage, mais gestion d'erreurs par **égalité de chaînes** (`msg === "folder_max_depth"`) — fragile. |
| `shared/deck.ts` | **ADAPTER** | Contrats Zod propres ; purger `category`. |
| `decks/engine-mirror.test.ts` | **NE PAS PORTER** | Vérifie la parité avec une copie manuelle du moteur dans la maquette. Sans objet une fois la maquette partie. |

### Lacune 1 — la règle des 3 exemplaires n'est pas garantie

`quantity` est borné à 3 **par ligne**, en Zod et dans le service. Mais l'unicité en base
est `(deck_id, zone, passcode, set_code)` : la même carte peut donc exister sur
**plusieurs lignes** — zones différentes, ou impression épinglée différente — et
totaliser plus de 3 exemplaires. Aucune contrainte n'agrège.

Un moteur de légalité agrégé existe pourtant (`engine/banlist.ts`, `checkDeckAdd`), mais
il reçoit le total déjà calculé et **n'est jamais appelé côté serveur** pour valider une
écriture. C'est un utilitaire d'affichage, pas une garde.

→ La validation agrégée est **à écrire**, côté serveur, au M2.

### Lacune 2 — le calcul « possédé / manquant » n'existe pas

Il n'a jamais été implémenté pour les decks. Le générateur qui portait ce type de calcul
a été retiré. Le seul « possédé/manquant » restant concerne l'identification des cartes
scannées, ce qui est un tout autre sujet.

→ **À concevoir depuis zéro** au M2. `card-math.ts` et `banlist.ts` fournissent des
briques, pas le calcul.

### Lacune 3 — aucun test sur les decks

Ni le service, ni les dossiers, ni les routes n'ont de test. C'est la zone la moins
couverte du projet, et celle où je viens de trouver deux lacunes fonctionnelles.

## Le point de contrôle d'accès manquant

`app.ts` empile les middlewares dans un ordre correct et documenté, et l'autorisation
« admin » est bien centralisée. L'autorisation « propriétaire de la ressource » est un
`eq(x.userId, userId)` répété mais homogène — acceptable.

**En revanche, la consultation des données d'autrui n'a aucun point de contrôle unique.**
Deux endroits recalculent indépendamment l'amitié et le blocage :
`routes/users.ts` (profil public) et `routes/community/duellistes.ts`. Aucune fonction
commune. Le jour où les decks et la collection d'autrui doivent aussi respecter le
blocage, ce serait une troisième copie.

→ Confirme la règle déjà posée en `02-architecture.md` : **une seule fonction
`canView(viewerId, targetId)`**, propriété du module `social`, appelée par `decks` et
`collection` avant de servir la moindre donnée d'un tiers. À écrire au M4, mais la
frontière est posée dès M0.

## Décisions de reprise annexes

- `decks.category` est marqué `@deprecated` mais reste **activement recalculé à chaque
  écriture**. Dette vivante : la colonne ne sera pas reconduite.
- `instanceSettings` est un clé-valeur `text` sans schéma, relu par des `find()`
  dispersés. À typer et à centraliser.
- **Nommage mixte français/anglais** (`erreurs.ts` à côté de `service.ts`). À trancher
  pour ATEM : identifiants et noms de fichiers en anglais, commentaires en français.
- Aucune dérive entre `schema.ts` et les migrations — rien à éponger de ce côté.
- **Pratique à conserver** : les commentaires d'ATEM-old expliquent presque toujours le
  *pourquoi* et l'incident qui a motivé le choix, pas seulement le *quoi*. C'est la
  meilleure chose du dépôt et ça se garde indépendamment du code.

---

## Module `collection` (+ scanlistes, import/export)

**Verdict d'ensemble : la zone la plus dense en logique métier acquise.** Le problème
n'est presque jamais la logique — c'est son emplacement.

| Fichier | Verdict | Motif |
|---|---|---|
| `scanlists/service.ts` | **REPRENDRE** | **Module exemplaire.** Ne touche aucune table étrangère : il appelle `addToCollection`, la fonction exposée. C'est le patron à généraliser partout. |
| `routes/collection.ts` | **REPRENDRE** | Taille d'upload vérifiée **deux fois** — sur `Content-Length` puis sur le texte réellement lu, contre un en-tête mensonger ou du `chunked`. |
| `routes/scanlists.ts` (+ test) | **REPRENDRE** | Isolation par compte renvoyant **404 et non 403** — ne révèle pas l'existence de la ressource d'autrui. |
| `shared/scanlist.ts`, `limits.ts` (+test) | **REPRENDRE** | Source unique des bornes. Le test vérifie que le compteur d'interface et le schéma serveur décident **exactement pareil**, emoji multi-unités UTF-16 compris. |
| `collection/service.test.ts` | **REPRENDRE** | Test pur de `nomImprime`, tous les replis couverts. |
| `collection/consolidation.test.ts` | **REPRENDRE** | Injecte une vraie panne par `Proxy` sur la transaction pour prouver qu'aucun exemplaire n'est perdu. Rare et précieux. |
| `collection/csv.ts` | **ADAPTER** | Parsing solide. Mais `ALIAS_MAP` et la normalisation de langue sont **dupliqués** en JS dans la maquette. Doit vivre une seule fois, dans `packages/shared`. |
| `collection/service.ts` | **ADAPTER** | Voir les violations ci-dessous. |
| `shared/collection.ts` | **ADAPTER** | Schémas à reprendre, mais il **manque une borne haute de quantité** (voir lacunes). |
| `shared/card.ts` | **ADAPTER** | Mélange le schéma de carte (référentiel) et celui d'impression (identité). À scinder. |
| `*-mirror.test.ts`, `scanlist-roundtrip.test.ts` | **REFAIRE, garder les jeux d'essai** | Chargent du JS de maquette dans un faux `window`. Le mécanisme disparaît avec le monorepo ; les vecteurs de test sont excellents et se rapatrient tels quels. |
| `collection/seed-playset.ts` | **REFAIRE** | Contourne l'API du catalogue par un `fetch` direct vers YGOPRODeck. |

### Violations de frontière à corriger

`collection/service.ts` importe et joint directement `cardPrints`, `cards`, `deckCards`,
`instanceSettings` et `users`. Trois corrections :

- `createStubPrint` **écrit** dans `cards` et `card_prints` → doit devenir une fonction
  exposée par `referential`.
- `cleanUnusedCatalogueCache` **lit `deck_cards`** pour savoir si une carte sert encore
  → doit appeler `isCardUsedInAnyDeck()` exposé par `decks`.
- `normalizeSetCode` / `languageFromSetCode` définissent l'identité `(set_code, rarity,
  language)` que `collection` stocke — ce n'est pas une donnée de carte. Elles
  descendent dans `packages/shared`.

### Logique à préserver mot pour mot

**La consolidation provisoire → réelle doit tenir en une seule transaction.** Sans ça,
une interruption entre la suppression des lignes provisoires et l'écriture de la ligne
consolidée perd des exemplaires — « sur un import de huit cents cartes, la fenêtre
s'ouvre huit cents fois ».

**`addToCollection` n'appelle jamais un service distant dans le chemin de requête.** La
ligne est écrite immédiatement en `pending`, et la résolution ne part qu'**après** la
validation de la transaction — sinon la résolution course une écriture non encore
committée.

**Le versement d'une scanliste est une addition pure, jamais une réconciliation**, et
emprunte exactement le même chemin que l'ajout manuel.

**À la création d'une scanliste, les doublons sont fusionnés** en conservant le premier
nom identifié : « une seconde lecture qui n'a rien reconnu ne doit pas effacer ce que la
première avait identifié ».

### Lacunes réelles à combler

1. **Aucune borne haute de quantité côté collection.** `quantity_delta` et `quantity`
   n'ont pas de plafond, là où les scanlistes plafonnent à 1000. Un CSV avec
   `quantity=999999999` passe.
2. **Nettoyage de cache incohérent.** `updateOwnedLine` purge le cache catalogue quand
   la quantité tombe à zéro ; `addToCollection` avec un delta négatif (le bouton « −1 »)
   ne le fait pas. Des impressions orphelines s'accumulent.
3. **Doublons de `set_code` dans un même CSV** : comportement « dernière ligne gagne »,
   non spécifié et non testé, incohérent avec la fusion pratiquée par les scanlistes.
   → On tranche : **fusionner**, comme les scanlistes.
4. **Le BOM UTF-8 est ajouté côté client**, pas côté serveur. Un lien direct vers
   `/export.csv` produirait donc un fichier qu'Excel en locale française abîme.
   → On tranche : **BOM côté serveur**.
5. **Cardmarket ne traduit que `fr` et `en`** en toutes lettres ; les autres langues
   sortent en code ISO.

---

## Front web

### Le système de design : REPRENDRE, c'est la meilleure partie du dépôt

`tokens.css` (174 l.) et `base.css` (1323 l.) sont sains : **zéro `!important`**, aucun
sélecteur mort, et chaque règle commentée avec le problème réel qu'elle a résolu. Les
jetons ont été extraits *après* mesure (`#f5c542` apparaissait 104 fois en TS et 85 fois
en CSS avant de devenir `--gold`). Une échelle de `z-index` nommée existe, ajoutée après
un bug où un `--z-modal` non défini retombait à `auto`.

**Point à décider : il n'y a pas de thème clair.** `color-scheme: dark` en dur, aucun
`prefers-color-scheme` nulle part. C'est un parti pris assumé.

| Fichier | Verdict |
|---|---|
| `styles/tokens.css`, `styles/base.css` | **REPRENDRE** |
| `styles/settings.css` | **ADAPTER** — dans le périmètre, propre |
| `styles/shared-nav.css` | **ADAPTER** — retirer les entrées guilde et admin |
| `styles/collection.css` (2254 l.) | **ADAPTER** — moitié structurelle propre ; convertir 19 sélecteurs d'ID en classes |
| `styles/decks.css` | **ADAPTER** — deux `!important` sur des couleurs littérales à repasser au jeton |
| `styles/community.css` (1548 l.) | **REFAIRE en triant** — mélange annuaire (dans le périmètre) et guildes (différées), et porte deux générations de style visibles |
| `style.css` (agrégateur) | **REFAIRE** — contient le seul vrai foyer de dette : 8 `!important` bruts non commentés |
| `styles/admin.css` | **IGNORER** |

**Piège majeur de périmètre** : `style.css` importe **hors de `apps/web`**. Les feuilles
de `profile` (255 l.) et `scanlist` (107 l.), et surtout `components/scanner.css`
(348 l.), vivent dans `design/styles/pages/`. Porter uniquement `apps/web/src/` ferait
perdre silencieusement le CSS du profil **et celui du scanner**.

**Dette mesurée** : 330 attributs `style="..."` en ligne subsistent dans le TS, dont
46 dans `settings/vue.ts` et 25 dans `profile/vue.ts` — deux écrans du périmètre
prioritaire. Le nettoyage était en cours et inachevé ; ne pas présumer une qualité
uniforme d'un fichier à l'autre.

### Composants : REPRENDRE la plupart

`toast.ts`, `confirm-modal.ts` (avec l'option « recopier le mot » pour les actions
destructrices), `pager.ts`, `avatar.ts`, `counted-textarea.ts` (borne sans `maxlength`,
donc le texte tapé n'est jamais tronqué en silence), `selecteur-langue.ts`,
`service-banner.ts`. Chacun a fusionné plusieurs implémentations redondantes.
`header-nav.ts` et les composants de boîte de réception sont à **adapter fortement** ou
à écarter (hors périmètre).

### Routeur : REPRENDRE le principe, pas le dispatch

`router.ts` fait 35 lignes ; tout le dispatch réel est un grand `if/else` de 250 lignes
dans `main.ts`. Lisible pour dix routes, ne passera pas l'échelle. → Table de routes.

Deux mécanismes à garder absolument : **`racineNeuve()` remplace le nœud racine** à
chaque navigation au lieu de le vider — sans ça un écran quitté continue d'écrire dans
le DOM au retour d'une requête tardive (bug réel) ; et `retirerEcoutes()` désabonne les
écouteurs globaux à chaque changement de route.

### Internationalisation : REPRENDRE intégralement

Deux couches. La clé de traduction **est le français**, résolue vers l'anglais par un
dictionnaire généré, avec repli sur la clé et un avertissement émis une seule fois.
Et surtout `ygo-i18n.ts`, qui traduit les **énumérations que l'API ne localise pas** :
7 attributs, 25 races de monstres, 7 propriétés Magie/Piège, 23 familles de cartes — avec
une désambiguïsation monstre / magie-piège, le champ `race` de l'API servant aux deux.

C'est exactement la dette annoncée en ADR-005, déjà payée. On la reprend telle quelle.

### La suite de barrières `check-*`

Une quarantaine de scripts maison (`check-design-dead-css.js`, `check-web-colors.sh`,
`check-styles-en-ligne.mjs`, `check-i18n.sh`…) sont **ce qui a maintenu le CSS honnête**.
Certains portent un plafond chiffré qui ne peut que descendre.

→ Reprendre le mécanisme et trier le contenu. Porter le CSS sans porter ses garde-fous
ferait revenir la dette qu'ils empêchaient.

---

## Ce qui a effectivement été repris — bilan au 2026-09-09

| Élément | Décision | Ce qui a été fait |
|---|---|---|
| `catalogue/set-code.ts` | REPRENDRE → **réécrit** | Le découpage d'ATEM-old ne couvrait que 88,2 % des set codes réels. Le nouveau en couvre 100 %, et sépare la clé de jointure du code d'interrogation (ADR-007). |
| `auth/*` | **REPRIS** | scrypt à format versionné, version de session en base, cookie témoin, garde CSRF, double compteur de débit. Traduit en anglais pour les identifiants, raisonnement conservé. |
| `catalogue/ygoprodeck.ts` | **REPRIS**, durci | Schéma Zod passé en `nullish` après qu'une carte sur 14 524 se soit révélée porter `attribute: null`. |
| `debit-sortant.ts` | **REPRIS** | Un seul seau à jetons pour l'API et les images. |
| `collection/resolve-queue.ts` | **REPRIS** | Dédoublonnage par *(utilisateur, code)*, attente croissante avec part d'aléa. |
| Consolidation transactionnelle | **REPRISE** | Avec son test de non-perte d'exemplaires. |
| Règle du nom imprimé | **REPRISE** | Avec son test. |
| `collection/ocr.ts` (2 319 l.) | **REPRIS TEL QUEL** | Aucun import, donc aucune adaptation. Ses 46 tests aussi. |
| `scripts/vendor-tesseract.sh` | **REPRIS** | Vendorisation vérifiée par empreinte. |
| `styles/tokens.css` | **REPRIS, consolidé** | 103 lignes au lieu de 174 : une seule palette, la seconde étant une dette qu'ATEM-old ne pouvait plus résorber. |
| `styles/base.css` (1 323 l.) | **RÉÉCRIT** | 250 lignes au strict nécessaire. Trois règles reprises avec leur justification. |
| `ygo-i18n.ts` | **REPRIS** | Les quatre tables d'énumération, avec la désambiguïsation monstre / magie-piège. |
| `router.ts` + dispatch | **RÉÉCRIT** | Table de routes au lieu d'un `if/else` de 250 lignes. Les deux mécanismes qui comptaient — racine renouvelée, désabonnement — sont conservés. |
| `scanner.ts` (UI) | **RÉÉCRIT** | Couplé à l'ancienne application. Le contrat, lui, est repris mot pour mot : l'OCR propose, l'utilisateur confirme. |
| `db/schema.ts` (780 l.) | **ÉCLATÉ** | Un fichier de tables par module, un agrégateur de six lignes. |
| Passcodes négatifs | **REMPLACÉS** | `card_passcode` nullable et `resolve_status`, avec deux contraintes en base (ADR-008). |
| `compose.yaml` | **REFAIT** | Celui d'ATEM-old ne livrait que PostgreSQL. |
| `set-prefixes.json` | **RÉGÉNÉRÉ** | Depuis le catalogue local, pas recopié : le fichier d'ATEM-old datait d'août. |
| Guildes, boîte de réception, admin, landing | **NON REPRIS** | Hors périmètre prioritaire. |
| `banc-*.mjs` (CDP maison) | **NON REPRIS** | Playwright partira d'une page blanche. |

---

## Reprise du front — 2026-09-09

Première tentative écartée : j'avais écrit un front « inspiré de » plutôt que
repris. Le front d'ATEM-old avait été validé ; le réécrire perdait ce travail et
recréait ses défauts autrement.

### Qui fait autorité, et où

| Zone | Source retenue | Pourquoi |
|---|---|---|
| Collection | `apps/web/src/collection/vue.ts` | La maquette `design/pages/collection.html` est une version antérieure, autre jeu de classes. |
| Authentification | `design/scripts/pages/*.js` (maquette) | Elle est une **transcription corrigée** du front porté : `h1` au lieu de `h2`, vrai lien au lieu d'un `div` cliquable, zéro style en ligne là où le porté en comptait dix-huit. |
| Scanner | `design/styles/components/scanner.css` | `apps/web` l'importait sans en avoir de copie. |
| Force du mot de passe | `packages/shared/src/auth.ts` | Voir ci-dessous. |

### Ce qui a été chargé, et ce qui attend

Reprises et livrées : `tokens.css`, `base.css`, `collection.css`,
`pages/auth.css`, `components/scanner.css`, `utilities.css`, et les onze règles
`.pwd-*` extraites de `components.css`.

Mises en attente dans `design/staged/`, **non chargées donc sans poids** :
`decks.css` (M2), `settings.css` (M3), `pages/profile.css` (M4),
`pages/scanlist.css` (M1 P1), `shared-nav.css` (boîte de réception et panneau de
compte, M3–M4), et `components.css` (bibliothèque de la maquette, dont on n'a
tiré que la jauge).

### Le CSS mort, mesuré et retiré

Le contrôle d'ATEM-old est repris (`scripts/check-dead-css.mjs`). Il avait trouvé
chez lui 362 classes mortes, 2 763 lignes — un tiers des feuilles.

| Étape | Règles mortes |
|---|---|
| Import brut des 10 564 lignes | **1 207** (~6 500 lignes) |
| Après mise en attente des feuilles sans écran | 851 |
| Après reprise du balisage validé | 582 |
| Après extraction de la jauge hors de `components.css` | 211 |
| Après purge | **0** |

Livré aujourd'hui : **3 001 lignes de CSS**, 41 ko (9,4 ko compressés). Les
règles retirées sont conservées dans `design/staged/pruned/`, avec leur feuille
d'origine — non livrées, non perdues.

### Une règle qui mentait

La maquette affichait sa propre appréciation de la force d'un mot de passe, et
ATEM-old en avait **quatre implémentations divergentes** — une au serveur, deux
dans le front, une dans la maquette — tenues ensemble par des tests « miroir ».
Elles ne racontaient pas la même chose : une phrase de vingt-huit lettres sans
chiffre s'affichait « Solide » et se faisait refuser à l'envoi.

`checkPasswordStrength` vit désormais dans `@atem/shared`, **une seule fois**.
Le serveur l'applique, la jauge la dessine. Les tests miroir n'ont plus d'objet.

Au passage, notre règle serveur était trop faible : elle ne vérifiait que la
longueur, là où ATEM-old exigeait seize caractères **et** les quatre familles.

### Nos écarts assumés

Dans `design/adjustments.css`, à part et commentés un par un — pour qu'on
sache plus tard ce qui vient d'ATEM-old et ce qui vient de nous :

- **Obturateur du scanner collant** : la modale d'origine défile, et sur
  téléphone le déclencheur passait sous la ligne de flottaison. C'est le geste
  répété à chaque carte.
- **Boutons de quantité à 44 px au doigt** : ils font 32 px dans la feuille
  d'origine, alors que `base.css` note lui-même que le seuil est à 44. Seulement
  sur pointeur grossier — à la souris, la densité vaut mieux.
- **En-tête sur deux rangées en dessous de 46 rem**, avec `--app-bar-height`
  qui suit : `collection.css` fixait `top: 3.25rem` « under app-bar », juste
  tant que l'en-tête tient sur une rangée.
- **Titre de page lu mais non vu** : l'écran d'origine n'a aucun titre de
  niveau 1. La maquette avait corrigé exactement ce défaut côté authentification.

### Une barrière de plus

`scripts/check-scan-band.mjs` compare les pourcentages de `SCAN_ZOOM_BAND` à
ceux de `.scan-zoom-band`. Chez ATEM-old, les avoir écrits aux deux endroits
sans rien qui les relie avait produit un viseur qui montrait une zone que l'OCR
ne lisait pas — « quand je scanne en OCR j'ai *rien de fiable* ».

---

## Mise d'équerre de M1 — 2026-09-09

Avant d'ouvrir M2, la collection a été reprise jusqu'à ce que plus rien n'y
traîne. Quatre barrières nouvelles, et ce qu'elles ont trouvé.

### Les barrières

| Barrière | Ce qu'elle interdit |
|---|---|
| `check-dead-css.mjs` | Une règle qui habille une classe que rien ne pose |
| `check-dead-exports.mjs` | Un export que rien n'appelle, nulle part |
| `check-routes.mjs` | Une route que ni le front ni un test n'atteint |
| `check-module-boundaries.mjs` | Un module qui entre chez un autre autrement que par son `index.ts` |
| `check-scan-band.mjs` | Une bande de visée dessinée ailleurs que là où l'OCR lit |

Toutes tournent dans `pnpm check`.

### Ce qu'elles ont trouvé — dans notre propre code

**Trois franchissements de frontière.** `collection/service.ts` joignait
directement `cards` et `card_prints` : exactement le défaut que je reprochais à
ATEM-old, reproduit sans m'en apercevoir.

Le remède n'est pas de renoncer aux jointures — filtrer, trier et paginer sur le
nom d'une carte l'exige. `referential` expose désormais **`printIndex`**, une
sous-requête nommée aux colonnes stables. Les autres modules la joignent comme
une table, sans jamais savoir comment `cards` et `card_prints` sont faites, ni
pouvoir y écrire.

Deux franchissements subsistent et sont autorisés nommément : un *schéma* peut
référencer le schéma d'un autre module, parce qu'une clé étrangère est une
relation déclarée que la base fait respecter. Un *service* qui lit le schéma d'un
autre dit « je sais comment ses tables sont faites » — c'est ça qui produit des
logiques concurrentes.

**Six exports morts.** Quatre venaient du moteur OCR repris tel quel : un
indicateur de disponibilité, un libellé de chargement, un aperçu de recadrage et
sa fonction de découpe, qui servaient l'interface d'ATEM-old et pas la nôtre. Le
retrait du troisième a rendu le quatrième mort à son tour, puis une variable —
la cascade a été suivie jusqu'au bout.

Les deux autres étaient des **crochets de test sans test**. Le défaut n'était pas
la fonction mais le test manquant : `secret.test.ts` et `outbound-rate.test.ts`
couvrent maintenant le refus de démarrer sans clé valide et l'étalement du débit
sortant.

**Trois routes que rien n'atteignait :**
- `GET /health` — utilisée par le healthcheck du compose, donc invisible au
  contrôle. Un test la couvre : preuve qu'elle marche, pas seulement qu'elle
  existe.
- `PATCH /auth/me/locale` — **retirée**. Aucun écran ne l'appelait : elle
  appartient aux paramètres du compte (M3) et arrivait en avance. Elle reviendra
  avec son écran.
- `GET /catalogue/cards/:passcode` — **utilisée**, en complétant la fiche avec
  le bloc « Autres éditions » d'ATEM-old. « Est-ce que je l'ai déjà, et dans
  quelle édition ? » se pose devant chaque carte qu'on trie.

### Ce que la collection avait de moins qu'ATEM-old, et qui est comblé

Les icônes d'attribut, de type de monstre, de propriété Magie/Piège et de niveau
n'avaient pas été copiées : les puces étaient en texte là où les leurs portaient
une image. 504 ko de ressources, et deux blocs de filtre ajoutés — **type
d'invocation** et **propriété magie/piège**.

Cette seconde distinction demandait une correction côté serveur : l'API met le
type d'un monstre et la propriété d'une Magie dans **le même champ** `race`. Un
Piège « Normal » n'est pas un monstre Normal ; les facettes les séparent
désormais, comme ATEM-old le faisait dans son interface.

### Ce qui reste signalé sans bloquer

31 exports sont utilisés seulement à l'intérieur de leur fichier. Ce n'est pas du
code mort : c'est une frontière percée pour rien. La plupart sont dans le moteur
OCR repris tel quel, où les réduire ferait diverger un fichier qu'on veut garder
comparable à sa source. Le contrôle les signale sans faire échouer.

---

## Coquille de navigation — 2026-09-10

Structurant avant tout : c'est la surface sur laquelle Decks, Paramètres, Profil
et Duellistes viendront s'accrocher. La faire maintenant évite que chaque écran
réinvente sa navigation — et que la barre finisse par mentir sur la page
courante.

### Le routeur est la source unique des destinations

Une route et sa place dans la navigation se déclarent **d'un seul geste** :

```ts
register("/collection", collectionScreen, {
  requiresSession: true,
  nav: { label: "Collection", icon: "🗃️", group: "main" },
});
```

Aucune liste n'est tenue à part. Un onglet qui mène nulle part devient
impossible à écrire — le défaut classique d'une barre entretenue séparément, où
l'on ajoute l'entrée avant l'écran et où l'on oublie de la retirer après.

### Trois surfaces, un seul état

| Surface | Quand |
|---|---|
| Barre du haut | au-dessus de 46 rem |
| Barre du bas | en dessous — elle **remplace** la première |
| Feuille de compte | ouverte par la barre du bas |

Remplacer plutôt qu'adapter est le choix d'ATEM-old, et il tient : sur
téléphone, la barre du haut ne gardait que la marque, l'état du service et
l'avatar — cinq cibles dans une bande de 62 px, pour des réglages qu'on ne
visite pas en boucle. Le pouce, lui, est en bas de l'écran.

Garder les deux aurait voulu dire deux navigations à tenir d'accord, dont l'une
finit par mentir. Une épreuve le vérifie : **une seule barre visible à la fois**.

### L'état du service, visible en permanence

Une pastille relève `/health` au démarrage puis chaque minute. Quand le serveur
ne répond plus, chaque geste échoue avec un message différent et l'on cherche la
panne dans l'application ; la pastille répond avant qu'on pose la question.

### Le CSS

Les règles de la pastille et de la feuille de compte viennent de
`shared-nav.css`. Celles de la barre du bas vivaient dans une balise `<style>`
injectée par le composant, **chaque déclaration marquée `!important`** — non par
choix, mais parce qu'une feuille injectée doit l'emporter sur celles déjà
chargées. Écrites dans une feuille ordinaire, elles n'en ont plus besoin.

### Le mode tiroir est supprimé

Décision d'Ange, et elle est juste : deux façons d'ouvrir la même fiche, dont
l'une n'apportait rien. Retiré du livré **et** de ce qui était mis de côté —
36 règles, un jeton d'empilement, et la classe que la fiche lui empruntait
encore. Il ne reviendra pas par mégarde.

### Deux défauts trouvés en regardant, encore

**Cent pixels de vide en tête d'écran mobile.** `--app-bar-height` réservait
encore 6,25 rem — la hauteur de la barre du haut sur deux rangées, du temps où
elle survivait sur téléphone. Elle vaut zéro là où la barre n'existe plus.

**Deux règles qui se contredisaient.** L'ajustement de la veille remettait la
barre du haut en grille sous 46 rem, pendant que la nouvelle feuille la cachait.
Chargée après, la première l'emportait : la barre restait visible. Le
raccommodage est parti avec sa raison d'être.

Et une fausse piste écartée par la mesure : la barre du bas paraissait dessinée
deux fois sur les captures. Le DOM n'en contient qu'une, et couper le
`backdrop-filter` fait disparaître la seconde — c'est le flou qui se compose mal
sans affichage réel.

---

## Parité avec la collection d'ATEM-old — 2026-09-10

Ange a signalé que j'avais mal étudié sa collection et sa barre de recherche.
Vérification faite, il avait raison sur trois points que je n'avais pas vus.

### Ce que j'avais manqué

**ATEM-old n'a pas d'écran Catalogue.** Dix écrans, aucun catalogue. Celui que
j'avais construit était un artefact du jalon M0 — la preuve que la recherche
fonctionnait — que j'avais ensuite promu au premier rang de la navigation. Il
doublait une fonction que la collection assure déjà, sans permettre d'agir sur
ce qu'on y trouvait : on cherchait une carte, on la trouvait, et puis rien.

**La barre de recherche cherche dans la collection**, et compare **trois**
champs : le nom, le set code **et le passcode**. La mienne en comparait deux.

**Le chemin d'ajout sans set code existait déjà, et je l'avais supprimé.** La
barre avancée porte un champ `passcode`, et `POST /collection` accepte
`passcode` et `name` en plus du code. Je l'avais écarté en écrivant « notre API
d'ajout ne le prend pas » — vrai, et raison à l'envers : c'est l'API qu'il
fallait compléter.

C'est le recours quand le set code est illisible : carte abîmée, pochette,
mauvaise lumière. Les huit chiffres en bas à gauche, eux, restent lisibles.

### L'inventaire complet, puis comblé

Sept écarts, pas trois — l'inventaire ligne à ligne de l'état d'ATEM-old l'a
montré :

| | |
|---|---|
| Passcode à l'ajout et à la recherche | ajouté |
| Sens du tri | ajouté |
| Densité confortable / compacte | ajoutée |
| Regroupement des monstres par type | ajouté |
| Filtre de rang Xyz | ajouté |
| Filtre de valeur de Lien | ajouté |
| Note d'exemplaire | ajoutée, avec sa route |

Niveau, rang et Lien sont désormais **trois listes exactes** et non un
intervalle : l'API range les trois dans le même champ, mais un Xyz de rang 4
n'est pas un monstre de niveau 4, et les mélanger produit un filtre qui ne veut
rien dire.

Les règles de densité avaient été purgées faute d'usage, comme les icônes avant
elles : elles sont revenues avec la fonction qu'elles habillent.

### Une divergence que j'avais introduite sans le dire

ATEM-old ne pagine pas : `GET /collection` rend tout, et le front filtre, trie
et regroupe en mémoire. J'ai construit une pagination serveur avec défilement
infini.

**Les deux défauts que la revue a trouvés là-dessus** — pagination
inatteignable, filtre « Monstre » appliqué après la pagination — étaient des
conséquences de cette divergence, pas des problèmes hérités. Je les avais
présentés comme des corrections ; c'était réparer ce que j'avais cassé.

La pagination est conservée, et c'est un choix : au-delà de quelques milliers de
lignes, tout charger devient coûteux pour un téléphone. Mais elle est désormais
notée comme un écart assumé, avec sa raison — pas comme un état de fait.

### Ce qui reste hors périmètre

Le lien vers les scanlistes attend son écran (M1, P1). Le mode tiroir est
supprimé à la demande d'Ange.

---

## Retours du premier essai réel — 2026-09-10

Quatre observations d'Ange après avoir saisi des cartes par set code. Trois
défauts, une explication.

### Quatre valeurs par défaut fausses

J'avais choisi les miennes sans le dire. ATEM-old ouvre :

| | ATEM-old | ce que j'avais mis |
|---|---|---|
| Vue | **liste** | galerie |
| Tri | **nom** | ajout récent |
| Sens | **croissant** | décroissant |
| Regroupement par type | **coupé** | activé |

Et surtout : **regroupement coupé veut dire aucun en-tête**, pas un en-tête
« Monstre » unique. La liste sort d'un bloc, dans l'ordre du tri et rien
d'autre. Découper par famille impose une seconde clé d'ordre par-dessus celle
qu'on a choisie, et l'on ne retrouve plus ce qu'on cherche.

### Le compteur d'attente restait figé

Retirer la dernière carte d'une ligne non identifiée laissait « 1 en attente
d'identification » jusqu'au rechargement complet. `applyDelta` ne relevait pas
le compteur ; il le fait désormais, et une épreuve le vérifie.

### Le texte anglais n'était pas un défaut, son silence si

Vérification faite sur les cartes réelles d'Ange : `ALIN-FR010`, `BLZD-FR021` et
`BLZD-FR022` **n'ont aucune version française chez YGOPRODeck**. Elles font
partie des 2 863 sans traduction, et l'anglais est le repli correct.

Mais rien ne le disait. Un texte anglais sur une carte française est
incompréhensible tant qu'on ne l'explique pas — on cherche le défaut dans
l'application. Le référentiel expose maintenant `descFrMissing`, et la fiche
l'annonce : « Cette carte n'a pas de version française chez YGOPRODeck ».

C'est le référentiel qui porte ce drapeau, pas l'écran : lui seul sait si la
traduction manque ou si personne ne l'a demandée.

### Ce qui va bien

L'ajout par set code dans la barre est jugé « très fluide ». C'est le geste
central de l'écran — celui qu'on répète des centaines de fois.

---

## Verrou de défilement — 2026-09-10

Deux barres de défilement cohabitaient dès qu'une carte était ouverte en grand :
celle de la fiche, et celle de la collection derrière elle. On croyait descendre
dans la carte et c'est la page qui bougeait — et en refermant, on ne se
retrouvait plus où l'on était.

### La méthode compte

Poser `overflow: hidden` sur `<body>` suffit sur un bureau et **ne fait rien sur
iOS Safari**, qui continue de faire défiler la page. On fixe donc le corps à sa
position courante et on restaure le défilement à la fermeture. C'est la seule
technique qui tient sur les deux, et le scan se fera au téléphone.

La largeur de la barre est rendue en rembourrage : sans quoi la page gagne cette
largeur au moment où la barre disparaît, et tout sursaute vers la droite.

### Le compteur aussi

Le panneau de filtres et la fiche peuvent être ouverts l'un par-dessus l'autre.
Un simple drapeau libérerait la page en fermant le second alors que le premier
est encore là — d'où un compteur, et deux garde-fous :

- `setFilterPanel(true)` est rappelé **à chaque puce cliquée** ; le verrou suit
  l'état réel, pas l'appel, sans quoi le compte grimperait sans jamais
  redescendre ;
- un changement de route emporte les modales sans passer par leur fermeture ;
  `releaseScroll()` remet le compte à zéro, faute de quoi la page suivante ne
  défilerait plus du tout.

Quatre surfaces l'utilisent : la fiche, le panneau de filtres, le scanner et la
feuille de compte.

### Une épreuve qui mesurait son propre effet de bord

La première version vérifiait `window.scrollY` pendant le verrou. Il vaut **zéro
par construction** : le corps est fixé, il n'est plus défilé. Ce qu'on voit est
visuel, et c'est la position à l'écran d'une ligne qu'il faut mesurer.

Puis l'épreuve échouait quand même, d'exactement la valeur du défilement.
`click()` de Playwright fait défiler l'élément dans la vue **avant** de cliquer,
et remettait la page à zéro juste avant le verrou : l'épreuve mesurait son
propre effet de bord. `dispatchEvent("click")` déclenche l'événement sans
toucher au défilement.

Deux fausses pistes, écartées par la mesure plutôt que par le raisonnement — le
défaut n'a jamais été dans le verrou.

---

## Le français manquant est un retard, pas une lacune — 2026-09-10

Ange a mis en doute ma conclusion de la veille : « tu es certain que les cartes
sans version française n'ont pas les noms non plus ? Aspischool, c'est *Banc
d'aspis*. » Il avait raison, et sur le point qui compte.

### Ce que la mesure dit

`Aspischool` (passcode 12888461) n'existe pas dans le jeu de données français de
YGOPRODeck — ni par identifiant, ni par nom. Le dump français est un
**sous-ensemble strict** de l'anglais : 2 863 cartes absentes, zéro identifiant
alternatif.

Mais la couverture par extension est sans ambiguïté :

| Extensions anciennes | | Extensions récentes | |
|---|---|---|---|
| LOB, MRD, PSV, LON, LTGY, SDK | **100 %** | RA05 | 60 % |
| | | MP25 | 17 % |
| | | MAMO | 22 % |
| | | ALIN, CORI, SUDA | **0 %** |

**La source accuse un retard, elle ne renonce pas.** Et `ALIN` — *Alliance
Insight* — est précisément l'extension de la carte qu'Ange avait saisie.

### Ce que ça change

Mon message disait « Cette carte n'a pas de version française chez
YGOPRODeck ». Techniquement vrai sur la source, et **faux** pour qui le lit :
la carte a bel et bien un nom français officiel.

Il dit désormais qu'elle n'est **pas encore** traduite dans le catalogue, et
qu'une prochaine synchronisation la remplira — ce qui est exact, puisque
`upsertCard` fusionne les champs localisés au lieu de les écraser.

Le drapeau porte aussi sur le **nom**, pas seulement sur le texte : c'est ce
qu'on lit en premier, et aucune carte n'a l'un sans l'autre — vérifié sur les
11 661 traduites.

### La leçon

J'avais conclu « ces cartes n'ont pas de version française » à partir de trois
requêtes qui répondaient « absente ». La question n'était pas *si* la donnée
manque, mais *pourquoi* — et la réponse changeait ce qu'il fallait écrire à
l'écran. Une absence n'est pas une négation.

---

## Fiche de carte : note et éditions — 2026-09-10

### Le message de traduction, raccourci

« Pas encore traduite dans le catalogue : YGOPRODeck accuse un retard sur les
extensions récentes. Le nom et le texte ci-dessous sont les originaux anglais,
et une prochaine synchronisation les remplacera. »

devient

« Traduction pas encore disponible — nom et texte en anglais. »

« Pas encore » porte tout le sens ; le reste tenait de l'explication de texte, et
sa place est dans ce document, pas dans une fiche qu'on parcourt.

### L'étiquette de la note

`.inspect-notes` est un rang souple dont les enfants s'étirent par défaut :
l'étiquette occupait toute la hauteur et son texte se posait en haut, à côté
d'un champ et d'un bouton centrés. Trois éléments sur une ligne, trois
alignements. `align-items: center` suffisait.

### « Autres éditions » se détache

Le bloc arrivait juste sous la note, sans marge ni trait. Il a désormais son
espacement et son filet, et une épreuve vérifie l'écart.

### Ce que la mesure a révélé au passage

Le bloc fait **2 246 pixels de haut** pour un Dragon Blanc : soixante-dix-huit
éditions. C'est davantage que tout le reste de la fiche réuni, et l'espacement
n'y change rien.

On n'y met **pas** de défilement propre : une troisième barre dans une fiche qui
en a déjà une serait exactement ce que le verrou vient de corriger. Le titre
annonce donc le compte et le nombre d'éditions possédées — « 78 · 1 possédée » —
pour que la longueur ne surprenne pas.

Le vrai remède demande un design : trier les éditions possédées en tête, replier
le reste, permettre d'en cocher une. Ange l'a explicitement remis à plus tard —
« pour l'instant on fait juste propre l'UX importante en priorité ». La mesure
est notée ici pour que la conversation reparte de là.
