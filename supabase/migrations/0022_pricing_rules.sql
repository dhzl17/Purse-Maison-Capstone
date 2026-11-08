-- Module 22: Pricing & Markup fixes (client process Step 16)
--   1. The "shoes & wallets only" tier now matches the categories staff actually pick (Shoes, Wallet, ...).
--   2. Approving the final price and confirming the payout moves the item to Listing Creation by itself.
--   3. Changing the price after approval clears both approvals, so nobody publishes an unapproved price.
--   4. Client pricing formula: markup is chosen from the agreed payout, the platform fee is stored separately,
--      and the suggested price is payout + markup + platform fee, rounded up to the next ₱100.

-- 1. Same tier logic as Module 7, with the item category normalised before matching
create or replace function public.calculate_markup(item_price numeric, item_category text)
returns numeric
language plpgsql
as $$
declare
  matched_tier record;
  cat text := lower(trim(coalesce(item_category, '')));
  result numeric;
begin
  if cat in ('shoes', 'shoe', 'footwear', 'wallet', 'wallets', 'shoes & wallets', 'shoes_wallets') then
    cat := 'shoes_wallets';
  end if;

  select * into matched_tier
  from public.markup_tier_schedule
  where comparison = 'gte'
    and item_price >= threshold_price
    and (category_restriction is null or category_restriction = cat)
  order by threshold_price desc
  limit 1;

  if matched_tier is null then
    select * into matched_tier
    from public.markup_tier_schedule
    where comparison = 'lte'
      and item_price <= threshold_price
      and (category_restriction is null or category_restriction = cat)
    order by threshold_price asc
    limit 1;
  end if;

  if matched_tier is null then
    raise exception 'No markup tier covers a price of % for category "%" — this price range needs the client''s markup rule',
      item_price, coalesce(item_category, 'none');
  end if;

  if matched_tier.markup_type = 'percentage' then
    result := item_price * (matched_tier.markup_value / 100);
  else
    result := matched_tier.markup_value;
  end if;
  return result;
end;
$$;

-- 2 and 3. Approval hand-off and price-change reset
create function public.apply_pricing_approval()
returns trigger
language plpgsql
as $$
begin
  -- A new price after approval needs approving again
  if new.price is distinct from old.price
     and old.price_approved and new.price_approved is not distinct from old.price_approved then
    new.price_approved := false;
    new.payout_confirmed := false;
  end if;

  -- Both boxes ticked during pricing -> straight to Listing Creation
  if new.current_stage = 'pricing_markup' and new.price_approved and new.payout_confirmed
     and not (old.price_approved and old.payout_confirmed) then
    new.current_stage := 'listing_creation';
  end if;
  return new;
end;
$$;

-- Named to run before enforce_pricing_requirements, which still checks the move to Listing Creation
create trigger apply_pricing_approval_trigger
  before update on public.consignment_items
  for each row execute function public.apply_pricing_approval();


alter table public.consignment_items add column if not exists platform_fee numeric(12,2);

create or replace function public.markup_for_payout(payout numeric)
returns numeric
language sql
immutable
as $$
  select case
    when payout <= 10000 then 3000::numeric
    when payout <= 20000 then 6000::numeric
    when payout < 50000 then 10000::numeric
    when payout < 100000 then 13000::numeric
    when payout < 151000 then 18000::numeric
    else payout * 0.12
  end;
$$;

create or replace function public.platform_fee_for(price_before_fee numeric)
returns numeric
language sql
immutable
as $$
  select case when price_before_fee < 200000 then price_before_fee * 0.045 else 9000::numeric end;
$$;

create or replace function public.suggest_price(payout numeric)
returns numeric
language sql
immutable
as $$
  select ceil((payout + public.markup_for_payout(payout)
               + public.platform_fee_for(payout + public.markup_for_payout(payout))) / 100) * 100;
$$;

-- Replaces the Module 7 function; the trigger on consignment_items stays the same.
-- It recalculates only when price, agreed payout or category changes, so old items keep their figures.
create or replace function public.set_item_markup()
returns trigger
language plpgsql
as $$
declare
  base numeric;
begin
  if new.price is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.price is not distinct from old.price
     and new.agreed_payout is not distinct from old.agreed_payout
     and new.category is not distinct from old.category then
    return new;
  end if;

  if new.agreed_payout is not null then
    base := new.agreed_payout + public.markup_for_payout(new.agreed_payout);
    new.consignor_payout := new.agreed_payout;
    new.platform_fee := round(public.platform_fee_for(base), 2);
    new.markup := new.price - new.agreed_payout - new.platform_fee;
    if new.markup < 0 then
      raise exception 'The price % is too low for item %: it must be at least % (agreed payout plus platform fee)',
        new.price, new.item_code, new.agreed_payout + new.platform_fee;
    end if;
  else
    -- No agreed payout on file (older items): keep the previous price-based rule
    new.markup := public.calculate_markup(new.price, new.category);
    new.consignor_payout := new.price - new.markup;
    new.platform_fee := null;
  end if;
  return new;
end;
$$;