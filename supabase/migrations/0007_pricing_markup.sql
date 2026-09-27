-- 1. The markup tiers from your scope document, as thresholds rather than fixed bands
--    ('lte' = "and below", 'gte' = "and above")
create table public.markup_tier_schedule (
  id serial primary key,
  threshold_price numeric(12,2) not null,
  comparison text not null check (comparison in ('lte','gte')),
  category_restriction text,
  markup_type text not null check (markup_type in ('flat','percentage')),
  markup_value numeric(12,2) not null
);

insert into public.markup_tier_schedule (threshold_price, comparison, category_restriction, markup_type, markup_value) values
  (10000, 'lte', null, 'flat', 3000),
  (20000, 'lte', null, 'flat', 6000),
  (49000, 'lte', 'shoes_wallets', 'flat', 10000),
  (50000, 'gte', null, 'flat', 13000),
  (100000, 'gte', null, 'flat', 18000),
  (200000, 'gte', null, 'percentage', 12);

alter table public.markup_tier_schedule enable row level security;

create policy "Staff can view markup tier schedule"
  on public.markup_tier_schedule for select
  using (auth.role() = 'authenticated');

-- 2. The lookup logic: prefer the highest matching "and above" tier, otherwise the tightest "and below" tier
create function public.calculate_markup(item_price numeric, item_category text)
returns numeric
language plpgsql
as $$
declare
  matched_tier record;
  result numeric;
begin
  select * into matched_tier
  from public.markup_tier_schedule
  where comparison = 'gte'
    and item_price >= threshold_price
    and (category_restriction is null or category_restriction = item_category)
  order by threshold_price desc
  limit 1;

  if matched_tier is null then
    select * into matched_tier
    from public.markup_tier_schedule
    where comparison = 'lte'
      and item_price <= threshold_price
      and (category_restriction is null or category_restriction = item_category)
    order by threshold_price asc
    limit 1;
  end if;

  if matched_tier is null then
    raise exception 'No markup tier applies to price % and category % — needs manual pricing', item_price, item_category;
  end if;

  if matched_tier.markup_type = 'percentage' then
    result := item_price * (matched_tier.markup_value / 100);
  else
    result := matched_tier.markup_value;
  end if;

  return result;
end;
$$;

-- 3. Auto-fill markup and consignor payout the moment a price is set
create function public.set_item_markup()
returns trigger
language plpgsql
as $$
begin
  if new.price is not null then
    new.markup := public.calculate_markup(new.price, new.category);
    new.consignor_payout := new.price - new.markup;
  end if;
  return new;
end;
$$;

create trigger auto_calculate_markup
  before insert or update on public.consignment_items
  for each row execute function public.set_item_markup();

-- 4. Approval flags + the hard block for reaching listing
alter table public.consignment_items
  add column price_approved boolean not null default false,
  add column payout_confirmed boolean not null default false;

create function public.check_pricing_requirements()
returns trigger
language plpgsql
as $$
begin
  if new.current_stage = 'listing_creation' then
    if new.price is null or new.markup is null then
      raise exception 'Cannot proceed to listing for item %: price and markup have not been set', new.item_code;
    end if;
    if not new.price_approved then
      raise exception 'Cannot proceed to listing for item %: final price has not been approved', new.item_code;
    end if;
    if not new.payout_confirmed then
      raise exception 'Cannot proceed to listing for item %: consignor payout has not been confirmed', new.item_code;
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_pricing_requirements
  before update on public.consignment_items
  for each row execute function public.check_pricing_requirements();

-- 5. Widen who can actually edit items — Pricing Team and Manager need this now, not just Consignment Team
drop policy "Consignment team and admins can update items" on public.consignment_items;

create policy "Authorized roles can update items"
  on public.consignment_items for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('consignment_team', 'pricing_team', 'manager', 'super_admin')
    )
  );