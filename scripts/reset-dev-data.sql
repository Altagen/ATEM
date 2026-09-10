-- Repart d'une instance vierge, **sans** refaire l'import du référentiel.
--
-- Les 14 524 cartes et les 44 510 impressions identifiées restent : les
-- réimporter demanderait 40 Mo et une minute à YGOPRODeck pour un résultat
-- identique, et la résolution d'un set code déjà connu se fait sans réseau.
--
-- Ce qui part : les comptes, leurs inventaires, les compteurs de tentatives
-- d'authentification, et les impressions provisoires nées des essais — codes
-- inventés, codes suffixés du wiki qui ne résolvent pas.
begin;

truncate table owned_cards, users, auth_attempts restart identity cascade;

delete from card_prints where resolve_status <> 'resolved';

commit;
