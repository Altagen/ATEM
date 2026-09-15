-- Starts again from a blank instance, **without** redoing the reference import.
--
-- The 14,524 cards and 44,510 identified printings stay: re-importing them would
-- take 40 MB and a minute from YGOPRODeck for an identical result, and resolving
-- an already known set code needs no network.
--
-- What goes: accounts, their inventories, the authentication attempt counters,
-- and the provisional printings born from trials — made-up codes, the wiki's
-- suffixed codes that do not resolve.
begin;

truncate table owned_cards, users, auth_attempts restart identity cascade;

delete from card_prints where resolve_status <> 'resolved';

commit;
