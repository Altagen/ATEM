-- Repairs the duplicate printings born from the passcode path.
--
-- `ensurePlaceholderPrint` returned a brand new printing directly when a
-- passcode was provided, **without consulting the local index** and with no
-- rarity. A code already resolved as “Common” therefore ended up with a second
-- printing of the same code and language, with an empty rarity — and the
-- collection held rows on both. Reported by Ange from the workshop: the same card
-- twice, the same code displayed twice.
--
-- The code is fixed; this defect ran, so the repair ships with the fix.
--
-- An empty rarity is only illegitimate **if another printing of the same code
-- and language carries one**: a code the catalogue does not know, identified by
-- its passcode alone, legitimately stays without a rarity.

-- The duplicate printing's copies join the right one, then the duplicate row
-- disappears. `on conflict`: the player may own both.
with duplicates as (
  select empty.id as empty_id, kept.id as kept_id
  from card_prints empty
  join card_prints kept
    on kept.set_code = empty.set_code
   and kept.language = empty.language
   and kept.rarity <> ''
   and kept.id <> empty.id
  where empty.rarity = ''
),
merged as (
  select o.user_id, d.kept_id as print_id, o.set_code,
         sum(o.quantity) as quantity,
         bool_or(o.is_favorite) as is_favorite,
         min(o.added_at) as added_at
  from owned_cards o join duplicates d on d.empty_id = o.print_id
  group by o.user_id, d.kept_id, o.set_code
)
insert into owned_cards (user_id, print_id, set_code, quantity, is_favorite, added_at)
select user_id, print_id, set_code, quantity, is_favorite, added_at from merged
on conflict (user_id, print_id) do update
  set quantity = least(owned_cards.quantity + excluded.quantity, 1000),
      is_favorite = owned_cards.is_favorite or excluded.is_favorite,
      updated_at = now();
--> statement-breakpoint

delete from owned_cards where print_id in (
  select empty.id
  from card_prints empty
  join card_prints kept
    on kept.set_code = empty.set_code and kept.language = empty.language
   and kept.rarity <> '' and kept.id <> empty.id
  where empty.rarity = ''
);
--> statement-breakpoint

delete from card_prints empty
where empty.rarity = ''
  and exists (
    select 1 from card_prints kept
    where kept.set_code = empty.set_code and kept.language = empty.language
      and kept.rarity <> '' and kept.id <> empty.id
  );
