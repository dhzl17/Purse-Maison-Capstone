-- Module 22: Pricing & Markup fixes (client process Step 16)
--   1. The "shoes & wallets only" tier now matches the categories staff actually pick (Shoes, Wallet, ...).
--   2. Approving the final price and confirming the payout moves the item to Listing Creation by itself.
--   3. Changing the price after approval clears both approvals, so nobody publishes an unapproved price.

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