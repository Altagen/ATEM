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
- Une page : recherche de carte par nom, avec image *(retirée en M1 : l'écran
  Catalogue qu'elle servait n'existait pas dans ATEM-old et doublait la
  collection — voir plus bas)*

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
| Tests | 11 dans `shared`, 7 dans `api`, tous au vert *(68 dans `api` au 2026-09-10)* |
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

**Audit du 2026-09-10.** Passé sur tout ce qui était livré. Corrigés : la file
de résolution ne reprenait rien au redémarrage (109 lignes en attente l'ont été
au premier lancement corrigé), l'état `unidentified` n'était jamais écrit, les
appels sortants n'avaient pas de délai d'attente, un 429 ne retenait que l'appel
refusé, `?level=abc` répondait 500, la borne de corps ne tenait pas sans
`Content-Length`, le scanner laissait deux écouteurs par ouverture, `?suite=`
partait sans contrôle, et `check-dead-exports` était aveugle à toute la surface
publique des modules. Une barrière de plus : `check-outbound.mjs`.

**Le scan a été essayé sur cartes physiques le 2026-09-10**, au téléphone, sur
le réseau local. C'était le dernier point qu'aucune épreuve ne pouvait couvrir :
aucun navigateur d'épreuve n'a de caméra, et les réglages OCR étaient mesurés
sans que l'ergonomie du geste le soit. Verdict d'Ange : « l'expérience
utilisateur est très confortable ».

Trois défauts trouvés là, et nulle part ailleurs :

- **le champ prenait le focus tout seul** après chaque lecture, ce qui faisait
  monter le clavier par-dessus la barre de déclenchement — il fallait taper à
  côté pour le refermer avant chaque nouvelle photo ;
- **le « +1 » n'avait aucune couleur**, indistinguable du « −1 » d'à côté ;
- **rien ne disait que la lecture travaillait** : l'obturateur grisait, ce qui
  se lit comme une panne. Sa pulsation existait en CSS, branchée nulle part.

Aucun ne se voyait à l'écran d'un ordinateur, et aucune barrière ne pouvait les
signaler. C'est l'argument pour continuer à valider au doigt, écran par écran.

### Scanlistes — livré le 2026-09-11

Inventorier un lot sans le verser : un arrivage, un échange, une boîte à trier.

**Le lot en cours ne quitte pas le navigateur.** C'est ce qui rend sa règle
propre au lieu d'en faire un cas particulier : le « −1 » d'un lot décrémente sa
ligne, plancher à zéro, et ne peut pas atteindre la collection — il n'existe
aucun chemin. La ligne reste visible à zéro, pour montrer ce qu'on vient
d'annuler ; elle est écartée à l'enregistrement.

**Rien ne survit sans validation explicite** (décision d'Ange) : pas de
`localStorage`, pas de demi-état qu'on retrouve trois jours plus tard sans
savoir ce qu'il contient. Le brouillon traverse une navigation interne et meurt
avec l'onglet.

**Le nom n'attend jamais l'ajout.** La ligne entre avec son set code, que le
navigateur tient déjà ; une résolution part en arrière-plan avec 2,5 s de délai.
Si le nom arrive, il se pose ; sinon le code reste et dit l'essentiel.

Le scanner est réutilisé **sans changement de logique** — il rapporte
`{ setCode, quantity, label }` à qui l'a ouvert, au lieu de rendre un objet de
collection.

Trois défauts trouvés en construisant : `resetView()` remplaçait l'objet d'état
que l'écran avait capturé (plus aucun bouton ne répondait) ; une repeinture
asynchrone effaçait la saisie en cours quand un nom arrivait ; et le compteur
d'une ligne portait le style du compteur de page, marge basse comprise.

**Reste à faire** — rien pour M1.

### Les traductions — livrées le 2026-09-11

**Le français est la clé.** `t("Ma collection")` rend la phrase telle quelle en
français, sa traduction en anglais. Les gabarits restent lisibles : on y lit la
phrase, pas un identifiant à résoudre ailleurs. L'objection habituelle — changer
le français orpheline silencieusement l'anglais — ne tient pas :
`scripts/check-translations.mjs` refuse toute chaîne sans traduction **et** toute
traduction que plus rien n'emploie.

**Le dictionnaire couvre aussi le serveur.** L'API répond en français ; le front
cherche la phrase avant de l'afficher. Cela évite d'inventer un code d'erreur
distinct pour chacune de ses trente phrases — et referme le vrai piège : un
écran anglais dont les erreurs parlent français.

**Le vocabulaire Yu-Gi-Oh! n'y est pas.** `Fish`, `WATER`, `Effect Monster` : en
anglais, la valeur brute de l'API **est** l'anglais. `ygo-labels.ts` ne
s'applique donc qu'en français. « Poisson » n'est pas une phrase d'interface.

**La langue vit sur le compte** (`PATCH /auth/me/langue`), pas dans le
navigateur : on la choisit une fois, on la retrouve d'un appareil à l'autre.

**Pas de moteur de pluriel.** Le français s'en passe ici — « ex. » ne s'accorde
pas — et l'anglais est écrit pour se lire juste à n'importe quel nombre : « ×1 »
plutôt que « 1 copies ». Le jour où une phrase ne s'y prêtera pas, il faudra
autre chose.

La barrière a été durcie quatre fois, chaque fois après avoir **vu** du français
sur une capture anglaise : chaînes courtes sans accent (« Scanner »,
« Compact »), gabarits à interpolation (`textContent = \`${n}/${total}
édition(s)\``), tableaux `[string, string][]` (« Attribut », « Niveau »,
« Langue »), tables `_LABELS` (« En ligne », les étapes du scan). Elle rapportait
aussi des numéros de ligne faux — elle blanchissait les commentaires en une
espace, ce qui collapsait les retours à la ligne.

209 chaînes, toutes traduites.

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

### État au 2026-09-12 — démontrable

Un deck se crée, se remplit depuis la collection, et dit s'il est jouable.

| Ligne | |
|---|---|
| Arborescence de dossiers (P1) | **non** — sortie de la tranche, à faire ensuite |
| Liste des decks, état prêt / incomplet | **oui** |
| Recherche par nom, vue liste / galerie (P1) | recherche **oui**, galerie **non** |
| Atelier collection / deck (P1) | **oui** — deux panneaux, qui se relaient sur téléphone |
| « Possédé / manquant » | **oui**, et seulement quand il y a un manque |
| Limite de 3 exemplaires | **oui**, garantie par une contrainte de base |
| Tailles de zone : 40–60 Main, 15 Extra, 15 Side | **oui** — le maximum refuse, le minimum signale |

**Reste pour clore M2** : les dossiers de decks, et la modale d'options (tailles
cibles par deck). Ni l'un ni l'autre n'empêche de construire un deck.

### Audit des decks — 2026-09-13

Passé à la demande d'Ange, avant de clore. Trois surfaces mortes retirées, et
deux cibles tactiles élargies.

**`notes`.** La route l'acceptait, le validait, l'écrivait en base — et aucun
écran ne l'affichait ni ne l'envoyait. Retirée partout, colonne comprise. Son
plafond `LIMITS.deckNotes` servait en réalité à la **note d'un exemplaire de
collection** : renommé `LIMITS.note`, qui est ce qu'il est.

**La couverture** rendait `passcode`, `name` et `image` ; l'écran ne lit que
l'image. `coverImage: string | null` — un deck dont la carte de tête n'a pas
d'illustration retombe sur `null` comme un deck vide, et l'écran pose le dos de
carte dans les deux cas.

**`type` et `frameType`** voyageaient dans chaque ligne de chaque deck sans que
rien ne les lise : la question « est-ce une carte d'Extra Deck ? » se pose à
l'ajout, sur la fiche venue de la collection.

**Au doigt, mesuré sur Pixel 5** dans huit états de l'écran : aucun débordement
horizontal, les menus tiennent dans la largeur. Deux cibles sous 44 px — le
« ⋯ » (40) et les étages du fil d'Ariane (26 de haut) — élargies. Ce qui reste
sous la barre est **l'échelle de toute l'application** : les boutons font 40 px
et les champs 34 partout, écran de collection compris. C'est une décision
globale, pas une retouche de la page des decks.

### Déplacer : « ici », et le glisser-déposer — 2026-09-13

Ange, sur le sélecteur de destination livré la veille : « plutôt que d'avoir un
menu et de sélectionner l'arborescence dans un drop down (qui devient hyper long
quand on a plein de dossiers) il suffit de faire comme avec Google Drive ». Il a
raison, et c'était le point faible de l'étape 3 : un menu déroulant grandit avec
le nombre de dossiers, et il oblige à **se représenter** l'arbre au lieu de le
regarder.

**Déplacer est maintenant un mode, pas une fenêtre.** On choisit « Déplacer… »,
un bandeau s'ouvre, on navigue normalement, et « Déplacer ici » dépose à
l'endroit qu'on a sous les yeux. La navigation tactile reste la seule façon de
désigner un dossier — c'est elle qu'on a soignée, autant s'en servir.

Conséquence assumée : **la destination disparaît aussi de la fenêtre de
création**. Le deck naît là où l'on regarde, et se déplace ensuite comme le
reste. Le même menu déroulant s'y trouvait, avec le même défaut.

**Défaut trouvé par Ange le lendemain** : « en mode liste ça ne fonctionne pas le
drag and drop ? ». L'attribut n'avait pas été posé sur la rangée de deck — un
remplacement qui avait échoué sans bruit — et **mes deux épreuves de glissement
regardaient toutes les deux la galerie**. Une vue sans épreuve casse en silence :
les rangées en ont deux maintenant, dont un dossier glissé dans un autre.

**Le glisser-déposer revient pour le bureau**, comme dans ATEM-old : les
dossiers, la case « .. » et **le fil d'Ariane** sont des cibles de dépôt. Ce qui
serait refusé n'accepte pas le dépôt, si bien que le curseur le dit avant qu'on
lâche.

Deux détails qui ne se devinent pas : le survol de dépôt se peint **sans
repeindre** (une repeinture par `dragover` remplacerait l'élément que le
navigateur suit et interromprait le geste), et le refus affiché par le bandeau
reprend **mot pour mot** la phrase du serveur — lire deux formulations pour un
même refus ferait douter qu'il s'agisse de la même règle.

### L'explorateur de dossiers — 2026-09-13 *(étape 3 sur 3)*

Un étage à la fois, fil d'Ariane, dossiers d'abord et decks ensuite — la forme
d'ATEM-old, à laquelle il avait lui-même fini par revenir après avoir déplié
tout l'arbre d'un coup. Trois divergences, chacune pour une raison :

1. **Le rangement passe par un menu « ⋯ », pas par le glisser-déposer.** Viser
   une cible en maintenant le doigt ne se fait pas sur un téléphone, et c'était
   le seul moyen de déplacer un deck dans ATEM-old.
2. **La recherche traverse les dossiers.** Chercher « dragon » et ne rien
   trouver parce qu'on est dans le mauvais dossier est une réponse fausse à une
   question simple. Chaque résultat dit alors d'où il sort.
3. **Une fenêtre remplace `window.prompt`** pour créer un deck — demandé par
   Ange. Elle porte le nom **et** la destination, ce qu'une invite native ne
   sait pas faire, et le deck naît là où l'on regarde plutôt que d'être créé
   puis déplacé.

**Ce que l'écran grise, le serveur le refuse** : les destinations impossibles
viennent de `folderCanHost`, dans `@atem/shared`, que le service appelle aussi.
C'est la leçon de `checkDeckAdd` dans ATEM-old — la même règle écrite deux fois
finit par diverger, et c'est toujours l'écran qui a raison trop tôt.

### Les dossiers, socle serveur — 2026-09-12 *(étape 2 sur 3)*

`deck_folders` : `id`, `user_id`, `parent_id`, `name`, horodatages. **Pas de
`sort_order`** — ATEM-old l'écrivait à chaque création et son écran triait par
nom de toute façon.

Trois choses qu'ATEM-old faisait bien et qu'on garde : profondeur maximale de
trois étages, détection de cycle au déplacement (sous-arbre compris), et une
suppression qui **réattache** au parent au lieu de cascader. Trois qu'on change :

1. **La cascade en base part.** Son schéma déclarait `on delete cascade` sur
   `parent_id` pendant que son service réattachait : deux réponses
   contradictoires, et c'est la base qui gagne dès qu'une suppression passe
   ailleurs. Ici la base ne répond rien, et la transaction du service est seule
   à réattacher. `decks.folder_id` reste en `set null` — perdre le rangement est
   réparable, perdre les decks ne l'est pas.
2. **Une lecture au lieu de vingt.** `depthOf` relisait toute la table à chaque
   contrôle, trois fois de suite pour une création.
3. **Deux dossiers frères ne portent plus le même nom** — contrainte
   `nulls not distinct`, sans laquelle la règle ne vaudrait pas à la racine,
   c'est-à-dire pas là où l'on crée le plus.

`category`, le `@deprecated` d'ATEM-old, ne revient pas.

Douze épreuves, dont celle qui tient l'ordre des routes (`/decks/dossiers`
déclarée après `/decks/:id` serait avalée) et celle qui vérifie qu'effacer son
compte emporte bien l'arbre malgré le `parent_id` sans cascade.

### Les aperçus de decks — 2026-09-12 *(étape 1 sur 3 de la page des decks)*

Ange : « on peut s'attaquer à la page de deck avec les dossiers et les preview
de cartes ? ». Découpé en trois : les aperçus, puis le socle des dossiers, puis
l'explorateur.

**La couverture se déduit, elle ne se choisit pas.** ATEM-old avait une colonne
`cover_url` — donc un sélecteur à écrire, et une reprise à faire quand la carte
quitte le deck. La nôtre est la carte dont le deck a **le plus d'exemplaires au
Main**, son identité en pratique, départagée par le passcode pour que
l'illustration ne change pas d'un rafraîchissement à l'autre. Zéro colonne, zéro
écran de réglage. Le jour où choisir sa jaquette devient un besoin, la colonne
s'ajoute et cette règle devient le repli.

Les couvertures partent en **une** requête pour toute la liste, pas une par
deck. La page des decks s'ouvre sur la planche d'illustrations ; la liste en
rangées reste à un clic, et garde sa vignette.

### La phrase d'état de l'atelier — 2026-09-12

Ange : « on est à 4/60, on peut mettre "Deck incomplet" ou ce genre de choses ?
on avait quelques trucs comme ça dans ATEM-old ». ATEM-old en avait deux (« non
enregistré », « limite dépassée ») ; la liste de nos decks portait déjà une
pastille « Prêt / Incomplet », mais l'atelier ne disait rien.

`deckStatus(counts, missing)`, dans `@atem/shared`, rend **un seul** verdict,
rangé par gravité : `over` (au-dessus d'une limite) → `missing` (le deck compte
plus d'exemplaires que la collection) → `empty` → `short` (sous le minimum du
Main) → `ready`. Trois avertissements simultanés ne se lisent pas ; on nomme ce
qui empêche de jouer d'abord, ce qui reste à faire ensuite.

Il rend aussi **de quoi écrire la phrase** — le nombre à retirer, ou à ajouter —
pour qu'on n'ait pas à soustraire de tête : « Deck incomplet : encore 39 au Main
(minimum 40). » Et il remplace `deckIsPlayable`, qui répondait par oui ou non à
la même question : la pastille de la liste et la phrase de l'atelier sortent
maintenant du même jugement, deux écrans ne pouvant plus se contredire.

### Pas de brouillon — décision du 2026-09-12

Les cartes s'écrivent **à chaque « ± »**, tout de suite. Il n'y a pas d'état
« non enregistré » à commettre.

ATEM-old travaillait sur un brouillon : son atelier gardait le deck en mémoire,
affichait « non enregistré » et attendait un bouton. La transcription en a
rapporté le bouton sans le brouillon — d'où un « Enregistrer » qui ne touchait
que le nom, et un « Rien à enregistrer » juste après qu'Ange avait retiré des
cartes. De quoi croire son retrait jeté ; il ne l'était pas.

Renommer le bouton en « Renommer » n'a pas suffi, et Ange a mis le doigt sur ce
qui restait : « c'est bizarre comme UX de valider automatiquement les cartes
mais pas le nom… soit tu mets tout à jour soit tu mets rien à jour mais pas
juste la moitié ». **L'atelier n'a donc plus aucun bouton d'enregistrement** :
les cartes partent au « ± », le nom part quand la frappe se calme (700 ms) et
quand le champ rend la main. La barre de comptes dit brièvement « Enregistré »
après chaque écriture — l'inverse de la marque d'ATEM-old, parce que l'invariant
est inverse.

Écrire le nom **ne recharge pas le deck** : c'est un mot qui a changé, pas les
cartes, et l'aller-retour complet emporterait la collection avec lui à chaque
pause de frappe. Vidé, le champ reprend le nom du deck plutôt que d'envoyer une
chaîne vide que le serveur refuserait : un deck a toujours un nom.

**La notion de brouillon reste souhaitée** (« il faudrait la notion de
*brouillon* pour expliquer qu'un deck n'est pas terminé », Ange) mais elle
répond à un autre besoin : dire qu'un deck est **en cours de conception**, pas
que ses cartes attendent d'être écrites. À concevoir à part.

**Deux règles tranchées par Ange**, qui referment deux lacunes du triage :

- **Un deck compte des cartes, pas des impressions.** Trois Dragons Blancs en
  trois codes d'extension restent trois Dragons Blancs. C'est ce qui rend le
  plafond exprimable en base — `deck_cards` porte une ligne par carte, et
  `check (main + extra + side between 0 and 3)` refuse le quatrième exemplaire.
  ATEM-old identifiait ses lignes par `(deck, zone, passcode, set_code)` : la
  même carte vivait sur plusieurs lignes et totalisait six exemplaires. **Lacune
  n°1 refermée par le schéma**, pas par de la vigilance.
- **Un deck est borné par la collection.** On n'y met pas une carte qu'on n'a
  pas, donc il est jouable par construction. **La lacune n°2 — « possédé /
  manquant » — disparaît par décision** plutôt que par implémentation. Reste le
  seul cas qui dérive : vendre une carte engagée. Le manque se calcule alors à
  la lecture, carte par carte, et **ne se signale que s'il y en a un** — quatre
  possédées, trois au deck, une vendue : il ne se passe rien.

`decks.category` n'est pas reconduite : la colonne `@deprecated` qu'ATEM-old
recalculait à chaque écriture.

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

---

## Socle avant M2 — posé le 2026-09-11

Décomposition demandée par Ange : « quels besoins sont au-dessus des autres ? »

**Le socle qui manquait n'était pas le compte, c'était la distinction entre
*possesseur* et *regardeur*.** Voir ADR-009. C'est le seul point dont le coût
augmente avec chaque fonctionnalité écrite avant lui : écrire M2 avec la
confusion aurait donné deux modules à reprendre au lieu d'un.

Fait :

- `ownerId` / `viewerId` séparés dans toutes les signatures de `collection` ;
  `scanlist` ne connaît que `viewerId` — un lot non tranché est privé par nature ;
- la règle d'accès de cette itération, décidée par Ange : pas de RBAC, toute
  session **lit** n'importe quel inventaire, seul le propriétaire **écrit** ;
- suppression de compte, avec l'inventaire de ce qui part — dont
  `auth_attempts`, qui ne cascade pas mais dont la clé porte l'adresse.

**Écarté du socle, et pourquoi.** L'avatar et son menu sont le contenant des
réglages, pas une fondation. L'import/export CSV est parallèle. L'écran de
profil est un *consommateur* du modèle de visibilité, pas son prérequis. Le
changement de mot de passe et de pseudo sont des manques réels mais ne bloquent
rien — sauf le pseudo, qui doit précéder l'annuaire des duellistes, pas les decks.

**Reste ouvert** : le bouton de suppression de compte (l'API est là, l'écran de
réglages viendra en M3), et la barrière qui rendra les lectures d'autrui
structurellement inécrivables — elle naîtra avec sa première route plutôt que
d'être posée à vide.
