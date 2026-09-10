# ATEM — Vision & périmètre

## En une phrase

ATEM est un service web auto-hébergeable qui donne aux joueurs de Yu-Gi-Oh! papier
un inventaire numérique de leur collection, un atelier de construction de decks, et
un assistant de duel en présentiel — sans jamais simuler les règles du jeu.

## Ce que ce n'est PAS (non-goals)

Ces exclusions sont structurantes. Toute demande future qui les contredit est un
changement de périmètre, pas une évolution.

1. **Pas un simulateur de jeu.** Aucune résolution d'effet, de chaîne, de timing ou
   de légalité de coup. Des reproductions fidèles existent déjà (EDOPro, Master Duel).
2. **Pas de suivi des cartes jouées en duel.** L'assistant consigne des métadonnées
   de partie (tours, phases, dommages, vainqueur), jamais le déroulé carte par carte.
3. **Pas une place de marché.** Pas de transaction, pas de vente, pas d'échange.
   Les prix éventuellement affichés sont indicatifs et proviennent du référentiel.
4. **Pas de scan d'image de carte.** L'OCR lit le **set code imprimé**, pas l'artwork.
5. **Pas de source de vérité sur les cartes.** Le référentiel appartient à YGOPRODeck.
   ATEM en héberge un miroir, ne le corrige pas et ne le complète pas à la main.

## Positionnement

Le service améliore l'**ambiance du jeu en présentiel**. Il ne remplace pas la partie,
il l'accompagne : on joue avec ses vraies cartes sur une vraie table, ATEM tient les
comptes et garde la mémoire.

## Personas

| Persona | Besoin principal | Priorité |
|---|---|---|
| **Le collectionneur** | Inventorier vite un gros volume de cartes physiques, retrouver ce qu'il possède | P0 |
| **Le deckbuilder** | Construire des decks à partir de ce qu'il possède réellement | P0 |
| **Le duelliste** | Consulter les profils/decks des autres, lancer un duel | P0 |
| **L'organisateur** | Animer une communauté, guildes, tournois | Différé |
| **L'hébergeur** | Déployer et administrer l'instance | Différé |

## Ordre de priorité retenu

**Maintenant** — Collection · Decks · Paramètres utilisateur · Duellistes (annuaire
social) · Consultation des profils/decks/collections d'autrui.

**Différé, cadré plus tard** — Mécanique de duel · Tournois · Guildes · Boîte de
réception · Zone d'administration · Personnalisation avancée du profil.

Le noyau technique (voir `01-domain-model.md` et `02-architecture.md`) doit rendre ces
éléments différés *possibles sans réécriture*, sans les implémenter aujourd'hui.

## Modèle de déploiement

Une instance = **une communauté**. Pas de multi-tenant. Le premier usage visé est
personnel ou en petit groupe ; le volet communautaire s'ajoute au même modèle de
données sans cloisonnement supplémentaire.
