# Feuilles en attente de leur écran

Ces feuilles viennent d'ATEM-old et **ne sont pas chargées** : aucun `@import`
ne les référence, elles n'ajoutent donc rien au paquet livré.

Elles attendent l'écran qu'elles habillent :

| Feuille | Écran | Jalon |
|---|---|---|
| `decks.css` | Atelier de deck, dossiers, vue liste/galerie | M2 |
| `settings.css` | Paramètres du compte, import/export | M3 |
| `pages/profile.css` | Profil public d'un joueur | M4 |
| `pages/scanlist.css` | Scanlistes | M1 (P1) |
| `components.css` | Bibliothèque de composants de la maquette — seules ses règles `.pwd-*` sont reprises, dans `design/password-meter.css` | — |
| `shared-nav.css` | Boîte de réception, panneau de compte mobile, pagineur | M3–M4 |

Les déplacer ici plutôt que de les importer tout de suite est délibéré : une
feuille chargée sans son balisage est du CSS mort, et le contrôle
`scripts/check-dead-css.mjs` la signalerait à juste titre. Quand l'écran arrive,
la feuille remonte d'un cran et son `@import` est ajouté à `design/index.css`.
