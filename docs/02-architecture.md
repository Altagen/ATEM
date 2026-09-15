# ATEM — Décisions d'architecture

Format : une décision = un contexte, un choix, ses conséquences. Une décision se
révise en ajoutant un ADR qui la remplace, jamais en la modifiant en silence.

---

## ADR-001 — Une instance = une communauté

**Choix.** Pas de multi-tenant. Aucune notion de « scope » ou d'organisation dans les
requêtes. L'usage premier visé est personnel ou en petit groupe ; le volet
communautaire viendra enrichir le même espace de données.

**Conséquences.** Auth locale simple (email + mot de passe scrypt). L'administrateur
est l'hébergeur. Aucune requête n'a besoin de filtrer par tenant — ce qui supprime
toute une classe de fuites de données. Si un jour il faut du multi-tenant, ce sera une
réécriture assumée de la couche d'accès, pas une adaptation.

---

## ADR-002 — TypeScript de bout en bout, monorepo

**Choix.** Monorepo pnpm, TypeScript côté serveur comme côté client, avec un paquet de
types de domaine partagé entre les deux.

**Pourquoi.** `tesseract.js` impose du JavaScript côté navigateur pour l'OCR, ce qui fixe
déjà le front. Rester en TS côté serveur maximise la réutilisation d'ATEM-old
(composants d'interface, maquette, intégration API) et évite de dupliquer les types du
domaine dans deux langages.

**À trancher au jalon M0, en regardant ce qu'ATEM-old utilise déjà.** Framework front,
framework serveur, ORM, moteur de base. Ces choix suivent ATEM-old **par défaut**, sauf
si l'inspection révèle qu'ils font partie du problème. Ce sont des choix réversibles,
contrairement aux ADR-001/003/004 — ils n'ont donc pas à être tranchés maintenant.

---

## ADR-003 — Résolution paresseuse, miroir optionnel *(à trancher au M1)*

**Contexte.** ATEM-old résout à la demande : `cardsetsinfo.php` sur le code scanné,
puis `cardinfo.php?id=` pour la fiche EN et FR, puis persistance locale. Une carte
déjà rencontrée n'est plus jamais redemandée. C'est fonctionnel et éprouvé.

Un miroir complet reste possible — le dump entier tient en une requête (14 524 cartes,
21 Mo, 22 s mesurées ; 11 661 en FR).

**Choix.** On garde la **résolution paresseuse** d'ATEM-old comme mécanisme principal.
Elle suffit à tout le parcours prioritaire : scanner, ajouter, filtrer sa collection —
puisqu'on ne filtre que des cartes qu'on possède, donc déjà résolues.

**Ce qui reste ouvert.** Le miroir complet devient nécessaire seulement si la
recherche par **nom** doit porter sur les 14 524 cartes plutôt que sur la collection.
À trancher au M1, quand le besoin sera concret. Ce n'est pas un choix structurant :
l'import de dump remplit les mêmes tables que la résolution paresseuse.

**Ce qui est décidé quoi qu'il arrive.** Aucune requête d'affichage ne touche l'API
externe : tout passe par la base locale. Les images sont mises en cache localement et
servies par ATEM, jamais chaînées vers YGOPRODeck.

---

## ADR-004 — Bascule EN à l'interrogation, code imprimé à l'identité

**Contexte.** Contrainte C2 : `cardsetsinfo.php` ne connaît que les codes anglais.
`LOB-FR001` ne répond pas.

**Choix.** Reprendre la mécanique d'ATEM-old : interroger avec l'équivalent EN
(`LTGY-FR008` → `LTGY-EN008`), et persister **deux** impressions — celle du joueur avec
son code français, et sa contrepartie anglaise. Identité d'une impression :
`(set_code, rarity, language)`.

**Conséquences.** La collection conserve le code réellement imprimé sur la carte — ce
que le joueur voit, scanne et retrouve à l'export. Un scan fonctionne quelle que soit
la langue d'impression, sans que l'utilisateur ait à le savoir.

**Limite connue.** Les sets dont la numérotation diffère entre régions ne se résoudront
pas par cette bascule. L'écran de correction manuelle du set code, déjà prévu au scan,
est le rattrapage.

---

## ADR-005 — Traduction des énumérations à notre charge

**Contexte.** Contrainte C3 : l'API ne localise que `name` et `desc`. `type`, `race`,
`attribute` et `frameType` restent en anglais.

**Choix.** Les valeurs brutes anglaises sont **stockées telles quelles** (elles servent
de clés stables pour les filtres et la logique). La traduction est une table de
libellés côté interface, maintenue dans ATEM.

**Conséquence.** Les filtres de collection fonctionnent sur les valeurs canoniques
anglaises, indépendamment de la langue affichée. Un filtre reste valide si l'on change
de langue.

**Corollaire du fallback.** 2 863 cartes n'ont pas de version française. En locale `fr`,
l'affichage retombe sur l'anglais pour ces cartes, visiblement mais sans erreur.

---

## ADR-006 — Pas de couche temps réel dans le squelette

**Contexte.** La mécanique de duel est différée, et son mode d'usage (écran partagé
posé entre deux joueurs, ou deux téléphones synchronisés) n'est pas tranché. Ce choix
détermine s'il faut du temps réel — mais il ne bloque aucune fonctionnalité prioritaire.

**Choix.** Le squelette est en requête/réponse pur. Aucune infrastructure de
synchronisation n'est mise en place.

**Ce que ça impose dès maintenant.** Le module `duel` existe comme frontière vide et
nommée, et aucun module prioritaire n'écrit dans son périmètre. Ajouter du temps réel
plus tard sera une addition à ce module, pas une refonte transversale.

---

## Frontières de modules

Chaque module possède ses tables et expose un contrat explicite. Un module ne lit
**jamais** directement les tables d'un autre.

```
referential   Card, CardPrint, CardSet, CardImage, CardLocalization, ReferentialImport
              → import, rafraîchissement, recherche, résolution de set code
              → LECTURE SEULE pour tous les autres modules (D5)

identity      User, UserProfile, sessions
              → inscription, connexion, préférences, visibilité

collection    CollectionItem, ScanList, ScanListEntry
              → dépend de : referential (résolution), identity (propriétaire)

decks         DeckFolder, Deck, DeckEntry
              → dépend de : referential (cartes), collection (« est-ce que je l'ai ? »)

social        Friendship, Block
              → dépend de : identity
              → arbitre l'accès en lecture aux collections/decks d'autrui

data          ImportJob, export CSV, effacement de compte
              → traverse collection et decks via leurs contrats, jamais leurs tables

duel          (vide — frontière réservée, ADR-006)
guild         (vide — frontière réservée)
```

**Règle d'accès en lecture croisée.** Consulter la collection ou les decks d'un autre
joueur passe par un point de contrôle unique qui combine la visibilité déclarée dans
`UserProfile` et la relation dans `social` (amitié, blocage). Une seule implémentation,
appelée partout — jamais de vérification recopiée dans chaque endpoint.

---

## ADR-007 — Deux formes de set code, pas une

**Contexte.** Découvert en exécutant l'import réel, pas en le concevant.

Les deux points d'entrée de YGOPRODeck se contredisent : le dump complet écrit
`LOB-001`, tandis que `cardsetsinfo.php` répond sur `LOB-EN001`. Et les cartes
physiques portent l'une ou l'autre forme selon leur année d'impression — les
premières éditions anglaises n'avaient pas de code de région.

Joindre sur le code anglais, comme le faisait ATEM-old, sépare donc deux moitiés
du même catalogue : la fiche d'une carte affichait « 0 édition » alors que la base
en contenait 44 496.

**Choix.** Deux formes distinctes, pour deux usages qui n'ont rien à voir :

| Forme | Rôle | Exemple |
|---|---|---|
| **canonique** — région retirée | clé de **jointure locale** | `LTGY-FR008` → `LTGY-008` |
| **anglaise** — région basculée | code d'**interrogation distante** | `LTGY-FR008` → `LTGY-EN008` |

Les confondre était le défaut. Le code imprimé sur la carte du joueur reste, lui,
l'identité de son impression.

**Vérifié sur les données réelles.** Le découpage couvre **100 %** des 44 517
impressions, contre 88,2 % pour la forme d'ATEM-old — 5 249 de plus, dont toutes
les éditions européennes à une lettre (`PSV-E088`) et tous les numéros commençant
par une lettre (`NECH-ENS10`, `25YC-ENP01`). 33 935 clés canoniques, dont
**8 collisions** (0,02 %), absorbées par l'écran de correction manuelle.

**Les 12 codes sans tiret** (`DB13`, `DB5`) sont malformés à la source : ils sont
comptés et écartés, jamais devinés.

---

## ADR-008 — L'impression non résolue n'a pas de carte

**Contexte.** `POST /collection` doit répondre immédiatement : le joueur vient de
scanner sa carte et attend son « +1 ». On ne peut pas attendre YGOPRODeck dans le
chemin de requête.

ATEM-old réglait ça en fabriquant une carte au **passcode négatif**, dérivé d'un
hachage du set code. La convention était implicite, recopiée à la main dans
quatre modules sous la forme `if (cardId > 0)`, sans garde-fou de type — et deux
set codes pouvaient produire le même passcode par collision, ce qui n'était testé
nulle part. Il en existait **trois implémentations concurrentes**.

**Choix.** `card_prints.card_passcode` est **nullable**. Une impression non
résolue n'a simplement pas de carte, et `resolve_status` le dit. Deux contraintes
en base rendent l'invariant impossible à violer :

```sql
resolve_status in ('resolved', 'pending', 'unidentified')
(resolve_status = 'resolved') = (card_passcode is not null)
```

Aucune ligne fabriquée, aucun nombre dont le signe porte un sens, aucune
collision possible. Une seule fonction — `ensurePlaceholderPrint`, exposée par
`referential` — crée une ligne provisoire.

---

## ADR-009 — Le propriétaire et le regardeur ne sont pas la même personne

*Décidé le 2026-09-11, avant M2.*

**Contexte.** Tous les services s'écrivaient `(db, userId, …)`, et ce `userId`
voulait dire deux choses à la fois : *à qui appartient cette donnée* et *qui la
demande*. Le code était sûr — mais **sûr par accident** : il tenait parce qu'on
ne pouvait pas être quelqu'un d'autre. Douze requêtes filtraient là-dessus.

Or les priorités d'Ange comportent, juste après les decks, « regarder le profil,
les decks et la collection des autres joueurs ». Le jour où une route de lecture
porte l'identité d'un autre joueur dans son chemin, chaque requête qui aura
oublié de distinguer les deux devient une fuite — et un `POST` qui recopierait
ce motif laisserait n'importe qui écrire chez n'importe qui.

Écrire M2 avec la confusion, c'est se donner deux modules à reprendre au lieu
d'un. Reprendre un filtre de sécurité après coup, sur du code qui marche, est le
chemin exact qui a rendu ATEM-old intenable.

**Choix.** Deux noms, et ils ne se confondent plus :

| | |
|---|---|
| `ownerId` | à qui appartient la donnée. Une **lecture** le prend. |
| `viewerId` | qui demande, tel que la session l'établit. Une **écriture** le prend, et lui seul. |

**La règle d'accès, pour cette itération** (décidée par Ange) : pas de RBAC.
Toute session peut **lire** la collection et les decks de n'importe qui. Seul le
propriétaire **écrit**. Un réglage de visibilité viendra plus tard ; il se posera
sur le chemin de lecture, qui est déjà le seul endroit où le filtrer.

**Ce qui reste privé.** Une scanliste ne se partage pas : un lot qu'on n'a pas
encore tranché est un brouillon de décision, pas un inventaire. Ce module ne
connaît donc que `viewerId`, et n'a pas de notion de propriétaire.

**Ce que la règle interdit, et qu'il faudra rendre impossible.** Une écriture ne
doit **jamais** recevoir une identité venue du chemin de la requête. Aujourd'hui
aucune route ne porte l'identité d'autrui, donc rien à garder ; quand les
Duellistes arriveront, ces lectures seront montées sur un sous-ensemble qui
refuse structurellement tout ce qui n'est pas `GET`, plutôt que sur une
vigilance de relecture. La barrière naîtra avec son premier consommateur —
poser dès maintenant un garde qui ne garde rien serait du code mort.

**Complément du 2026-09-13 — 404 en lecture, 403 en écriture.** Demandé par
Ange : « même si on tente d'aller sur la route pour le modifier, au final on
n'ait un 403 ».

Les deux refus ne disent pas la même chose, et la différence dépend du sens.
Une **lecture** refusée répond « introuvable » : confirmer qu'un deck existe
serait déjà une fuite tant qu'on n'a pas le droit de le voir. Une **écriture**
refusée répond « ce deck n'est pas le vôtre » — parce que le jour où l'on
regarde le deck d'un autre joueur, il est sous nos yeux, et « introuvable »
serait un mensonge que rien n'explique. Le service `deckPourEcriture` charge la
ligne par son seul identifiant, puis compare le propriétaire : 404 si elle
n'existe pas, 403 si elle n'est pas la nôtre.

La garantie vit **dans le service**, jamais dans l'écran. Cacher le crayon est
une politesse ; ce qui protège, c'est le refus du serveur, et il est éprouvé
route par route — `PATCH`, `DELETE`, `PUT /cards`.

Les **dossiers** gardent le 404 dans les deux sens, et ce n'est pas un oubli :
un dossier est le classement de son propriétaire, il ne se regarde pas. Rien ne
le mettra jamais sous les yeux d'un autre, donc « introuvable » y reste vrai.

**Ce qui manque encore, et qui ne peut pas être écrit aujourd'hui.** Le crayon
de la fiche doit disparaître pour qui n'est pas propriétaire. Il faudrait pour
cela que la fiche puisse afficher le deck d'un autre — ce qu'aucune route ne
permet encore. Écrire dès maintenant un `isOwner` que rien ne peut rendre faux
donnerait une condition toujours vraie, invérifiable par une épreuve : du décor.
Le jour où la lecture s'ouvre, c'est un champ dans la réponse et un `when()`
autour du crayon ; le refus serveur, lui, est déjà là et n'aura pas à être
repris.
