# ATEM

Un service web auto-hébergeable qui donne aux joueurs de Yu-Gi-Oh! papier un
inventaire numérique de leur collection, un atelier de construction de decks, et
à terme un assistant de duel en présentiel.

**Il ne simule jamais les règles du jeu.** Des reproductions fidèles existent
déjà ; ATEM accompagne une partie jouée avec de vraies cartes, sur une vraie
table. Le périmètre exact, et surtout ce qui en est exclu, sont dans
[`docs/00-vision.md`](docs/00-vision.md).

## Démarrer

```sh
cp .env.example .env
# JWT_SECRET n'a aucune valeur de repli : sans elle, le serveur refuse de démarrer.
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env

docker compose up          # ou podman compose up
```

L'application écoute sur http://localhost:8080.

Le catalogue de cartes se remplit ensuite en une commande — deux requêtes vers
YGOPRODeck, une douzaine de secondes pour 14 524 cartes et 44 496 impressions :

```sh
pnpm --filter @atem/api catalogue:sync
pnpm --filter @atem/api ocr:build-dict   # le dictionnaire de préfixes du scanner
```

## Développer

```sh
./scripts/dev-db.sh up                   # PostgreSQL sur le port 55432
pnpm install
pnpm --filter @atem/api db:migrate
pnpm dev                                 # API sur :3000, front sur :5173
```

`ATEM_API_ORIGIN` change la cible du proxy du front, si une autre instance
occupe déjà le port de l'API.

```sh
pnpm typecheck
pnpm test
```

Les tests d'API montent une base PostgreSQL jetable, y rejouent les migrations,
et la détruisent en sortie — y compris en cas d'échec.

### Épreuves de bout en bout

```sh
pnpm e2e          # bureau ET mobile, sur les deux profils systématiquement
pnpm e2e:ui       # l'explorateur pas à pas
pnpm e2e:shots    # captures de revue dans e2e/shots/
```

**Chaque écran se valide sur les deux profils au moment où on l'écrit**, jamais
à l'intégration. Une grille qui déborde, une cible tactile trop petite ou une
modale qui sort de l'écran ne se voient pas à 1440 px de large, et coûtent bien
plus cher une fois l'écran considéré comme terminé.

`pnpm e2e:shots` ne teste rien : il photographie les écrans principaux sur les
deux profils, pour les regarder — et pour voir ce qui a bougé après un
changement.

## Structure

```
apps/api      modules referential · identity · collection (decks, social, data à venir)
apps/web      TypeScript sans framework, Vite, CSS pur
packages/shared   contrats et bornes partagés
docs/         vision, modèle de domaine, décisions d'architecture, feuille de route
```

Chaque module possède ses tables et n'accède jamais à celles d'un autre. Les
frontières et leur raison d'être sont dans
[`docs/05-structure.md`](docs/05-structure.md).

## Documentation

| Document | Contenu |
|---|---|
| [`00-vision.md`](docs/00-vision.md) | Périmètre, personas, et surtout les non-goals |
| [`01-domain-model.md`](docs/01-domain-model.md) | Le noyau invariant — le seul document figé |
| [`02-architecture.md`](docs/02-architecture.md) | Les décisions, avec leurs alternatives et leurs conséquences |
| [`03-roadmap.md`](docs/03-roadmap.md) | Les jalons, et ce qui a été mesuré à chacun |
| [`04-triage-atem-old.md`](docs/04-triage-atem-old.md) | Ce qui a été repris du projet précédent, et pourquoi |
| [`05-structure.md`](docs/05-structure.md) | Frontières de modules et conventions |
| [`ref-csv-formats.md`](docs/ref-csv-formats.md) | Formats d'import/export, colonne par colonne |
| [`ref-ocr.md`](docs/ref-ocr.md) | Les réglages du scanner, et les mesures qui les justifient |

## Deux règles

Héritées du projet précédent, qui les avait apprises à ses dépens :

**Ne jamais fabriquer de donnée.** Pas de valeur de repli inventée, pas de
contenu de démonstration affiché quand une requête échoue. Un écran vide est une
information ; un écran plausible et faux n'en est pas une.

**Ne jamais écrire de fichier de statut de projet en prose.** Un état se mesure
par une barrière exécutable. Les auto-évaluations d'agent s'étaient révélées
fausses sur des points vérifiables.
