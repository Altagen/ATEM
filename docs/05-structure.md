# Étape 3 — Structure du monorepo et frontières

## Le mal à soigner

ATEM-old déclarait ses 21 tables dans **un seul fichier de 780 lignes**, mêlant
utilisateurs, invitations, limitation de débit, réglages, guildes, notifications, cartes,
decks et scanlistes. Chaque table prise isolément est saine ; c'est leur cohabitation qui
empoisonne. Conséquence directe : trois modules écrivaient dans les tables du catalogue,
chacun avec sa propre logique de carte provisoire, sans connaître les deux autres.

**La frontière n'est pas un principe esthétique : c'est ce qui empêche cette dérive.**

## Arborescence

```
ATEM/
├─ apps/
│  ├─ api/
│  │  └─ src/
│  │     ├─ modules/
│  │     │  ├─ referential/     cartes, impressions, sets, images, résolution
│  │     │  ├─ identity/        comptes, sessions, mots de passe, débit
│  │     │  ├─ collection/      exemplaires possédés, scanlistes
│  │     │  ├─ decks/           dossiers, decks, entrées
│  │     │  ├─ social/          amitiés, blocages, contrôle d'accès
│  │     │  └─ data/            import, export, effacement de compte
│  │     ├─ platform/           erreurs, en-têtes, arrêt propre, corps de requête
│  │     ├─ db/                 client, migrations, agrégateur de schéma
│  │     └─ app.ts
│  └─ web/
│     └─ src/
│        ├─ design/             tokens.css, base.css — la fondation
│        ├─ components/         toast, modale, pagineur, avatar…
│        ├─ screens/            collection/, decks/, settings/, players/
│        ├─ platform/           routeur, client d'API, i18n, préférences
│        └─ main.ts
└─ packages/
   └─ shared/                   contrats Zod, bornes, identité de set code
```

### Anatomie d'un module serveur

```
modules/<nom>/
  schema.ts     ses tables Drizzle, et elles seules
  service.ts    sa logique métier — la seule porte d'entrée
  routes.ts     ses routes HTTP, qui n'appellent que son service
  <nom>.test.ts
  index.ts      son API publique : ce que les autres modules ont le droit d'appeler
```

`db/schema.ts` **n'existe plus comme fichier de déclaration**. Il devient un agrégateur
de six lignes qui réexporte les schémas des modules pour drizzle-kit. Il ne peut plus
grossir : il n'y a rien à y écrire.

## Les quatre règles de frontière

**R1 — Un module ne lit ni n'écrit jamais les tables d'un autre.** Il appelle une
fonction exportée par son `index.ts`. ATEM-old avait un modèle de cette règle bien
appliquée : `scanlists/service.ts` ne touchait aucune table étrangère et passait par
`addToCollection`. On généralise ce patron.

**R2 — Le référentiel expose une API d'écriture.** `upsertCard`, `upsertPrint`,
`ensurePlaceholderPrint`. C'est le seul remède aux trois implémentations concurrentes de
la carte provisoire. `collection` et `decks` cessent d'écrire dans `cards` et
`card_prints`.

**R3 — Un seul point de contrôle d'accès.** `social` expose `canView(viewerId, targetId,
resource)`. Aucune vérification d'amitié ou de blocage n'est recopiée ailleurs.
ATEM-old en avait déjà deux copies indépendantes, avant même que les decks et la
collection d'autrui soient consultables — la troisième était garantie.

**R4 — Une seule direction de dépendance.**

```
data ──▶ collection ──▶ referential
  │           │              ▲
  │           └──▶ decks ────┘
  └──▶ social ──▶ identity ◀─┘
```

`referential` et `identity` ne dépendent de rien. Aucun cycle. Une dépendance qui
remonterait cette flèche est un défaut de conception, pas un cas particulier.

## La carte provisoire — décision

Le besoin est réel : `POST /collection` doit répondre immédiatement, sans attendre
YGOPRODeck. ATEM-old marquait le provisoire par un **passcode négatif** issu d'un hachage
du set code — convention implicite recopiée à la main dans quatre modules, sans garde-fou
de type, avec un risque de collision non testé.

**ATEM remplace ça par un état explicite** porté par la ligne :

```
resolve_status : 'resolved' | 'pending' | 'unidentified'
```

Une seule fonction, `ensurePlaceholderPrint`, propriété de `referential`, crée une ligne
provisoire. Le signe d'un entier ne porte plus de sens métier.

## Conventions

**Nommage** — identifiants, noms de fichiers et de tables en **anglais** ; commentaires
et documentation en **français**. ATEM-old mélangeait les deux dans les identifiants
(`erreurs.ts` à côté de `service.ts`), sans règle.

**Commentaires** — on garde la meilleure pratique d'ATEM-old : un commentaire explique
le *pourquoi* et l'incident qui a motivé le choix, pas le *quoi*. Un commentaire qui
paraphrase le code ne sert à rien ; un commentaire qui dit « le noir et blanc pur faisait
confondre 8 et S » évite de refaire l'erreur.

**Tests** — co-localisés, lanceur natif `node --test`. Intégration sur base PostgreSQL
jetable horodatée, détruite en sortie (le mécanisme d'ATEM-old est repris tel quel).

**Deux règles héritées, et elles s'appliquent à moi :**
- **Ne jamais fabriquer de donnée.** Pas de repli inventé, pas de contenu de
  démonstration affiché en cas d'erreur.
- **Ne jamais écrire de fichier de statut de projet en prose.** Un état se mesure par une
  barrière exécutable. ATEM-old avait vidé son `MEMORY.md` précisément parce que les
  auto-évaluations d'agent s'étaient révélées fausses sur des points vérifiables.
