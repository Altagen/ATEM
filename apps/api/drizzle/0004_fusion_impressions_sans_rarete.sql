-- Répare les impressions en double nées du chemin du passcode.
--
-- `ensurePlaceholderPrint` rendait directement une impression neuve quand un
-- passcode était fourni, **sans consulter l'index local** et sans rareté. Un
-- code déjà résolu en « Common » se retrouvait donc avec une seconde impression
-- du même code et de la même langue, à rareté vide — et la collection portait
-- des lignes sur les deux. Signalé par Ange depuis l'atelier : deux fois la
-- même carte, le même code affiché deux fois.
--
-- Le code est corrigé ; ce défaut a tourné, donc la réparation part avec.
--
-- Une rareté vide n'est illégitime que **si une autre impression du même code
-- et de la même langue en porte une** : un code que le catalogue ne connaît pas,
-- identifié par son seul passcode, reste légitimement sans rareté.

-- Les exemplaires de l'impression en double rejoignent la bonne, puis la ligne
-- en double disparaît. `on conflict` : le joueur peut posséder les deux.
with doublons as (
  select vide.id as id_vide, garde.id as id_garde
  from card_prints vide
  join card_prints garde
    on garde.set_code = vide.set_code
   and garde.language = vide.language
   and garde.rarity <> ''
   and garde.id <> vide.id
  where vide.rarity = ''
),
fusion as (
  select o.user_id, d.id_garde as print_id, o.set_code,
         sum(o.quantity) as quantity,
         bool_or(o.is_favorite) as is_favorite,
         min(o.added_at) as added_at
  from owned_cards o join doublons d on d.id_vide = o.print_id
  group by o.user_id, d.id_garde, o.set_code
)
insert into owned_cards (user_id, print_id, set_code, quantity, is_favorite, added_at)
select user_id, print_id, set_code, quantity, is_favorite, added_at from fusion
on conflict (user_id, print_id) do update
  set quantity = least(owned_cards.quantity + excluded.quantity, 1000),
      is_favorite = owned_cards.is_favorite or excluded.is_favorite,
      updated_at = now();
--> statement-breakpoint

delete from owned_cards where print_id in (
  select vide.id
  from card_prints vide
  join card_prints garde
    on garde.set_code = vide.set_code and garde.language = vide.language
   and garde.rarity <> '' and garde.id <> vide.id
  where vide.rarity = ''
);
--> statement-breakpoint

delete from card_prints vide
where vide.rarity = ''
  and exists (
    select 1 from card_prints garde
    where garde.set_code = vide.set_code and garde.language = vide.language
      and garde.rarity <> '' and garde.id <> vide.id
  );
