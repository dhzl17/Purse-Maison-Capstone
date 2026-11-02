-- Module 29: Shopify sync
-- Keeps the Shopify store the same as the system: every item with a live, sold or archived listing is one Shopify
-- product, and a paid Shopify order is recorded here as a sale.
--
--   1. Shopify columns on consignment_items and sales_transactions
--   2. shopify_webhook_events: a log of every order notification Shopify sends
--   3. Triggers that mark an item "pending" whenever something Shopify shows changes
--   4. claim_shopify_sync_batch(): used only by the shopify-sync Edge Function
--   5. request_shopify_sync(): the Retry / Resync all buttons (owner and manager)
--   6. shopify_sync_overview: counts for the Shopify Sync card in Settings
--   7. Marks every item that already has a published, reserved, sold or archived listing as pending,
--      so the first sync copies the current data to Shopify
--
-- The sending itself is done by the Edge Functions shopify-sync and shopify-webhook.

begin;

-- ---------------------------------------------------------------- 1. Columns
alter table public.consignment_items
  add column shopify_variant_id text,
  add column shopify_inventory_item_id text,
  add column shopify_synced_at timestamptz,
  add column shopify_sync_error text;

alter table public.consignment_items
  add constraint items_shopify_sync_status_valid
  check (shopify_sync_status in ('not_applicable', 'pending', 'syncing', 'synced', 'failed'));

create index consignment_items_shopify_pending_idx
  on public.consignment_items (updated_at)
  where shopify_sync_status in ('pending', 'syncing');

alter table public.sales_transactions
  add column sale_channel text not null default 'in_store' check (sale_channel in ('in_store', 'shopify')),
  add column shopify_order_id text,
  add column shopify_order_name text;

create index sales_transactions_shopify_order_idx
  on public.sales_transactions (shopify_order_id)
  where shopify_order_id is not null;

-- ---------------------------------------------------------------- 2. Webhook log
create table public.shopify_webhook_events (
  webhook_id text primary key,                 -- X-Shopify-Webhook-Id: a repeated delivery is skipped
  topic text not null,                         -- orders/create or orders/paid
  shopify_order_id text,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error text,
  payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.shopify_webhook_events enable row level security;

-- Read-only for the owner and the manager. Only the shopify-webhook function (secret key) writes here.
create policy "Owner and manager can view the Shopify webhook log"
  on public.shopify_webhook_events for select
  using (public.has_role(array['super_admin', 'manager']::public.user_role[]));

-- ---------------------------------------------------------------- 3. Mark items for sync
-- A listing that is live or finished (published, reserved, sold, archived) exists as a product on Shopify.
create function public.mark_shopify_sync_from_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.inventory_status in ('published', 'reserved', 'sold', 'archived') and (
       tg_op = 'INSERT'
       or new.inventory_status is distinct from old.inventory_status
       or new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.specifications is distinct from old.specifications
       or new.seo_title is distinct from old.seo_title
       or new.seo_description is distinct from old.seo_description
       or new.authenticity_footer is distinct from old.authenticity_footer
       or new.layaway_clause is distinct from old.layaway_clause
       or new.sales_channels is distinct from old.sales_channels) then
    update public.consignment_items
      set shopify_sync_status = 'pending', shopify_sync_error = null
      where id = new.item_id and shopify_sync_status <> 'pending';
  end if;
  return new;
end;
$$;

create trigger mark_shopify_sync_from_listing_trigger
  after insert or update on public.listings
  for each row execute function public.mark_shopify_sync_from_listing();

-- Item fields Shopify shows: brand (vendor), category (product type), price, barcode
create function public.mark_shopify_sync_from_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.brand is distinct from old.brand
      or new.category is distinct from old.category
      or new.price is distinct from old.price
      or new.barcode is distinct from old.barcode)
     and exists (select 1 from public.listings
                 where item_id = new.id and inventory_status in ('published', 'reserved', 'sold', 'archived')) then
    new.shopify_sync_status := 'pending';
    new.shopify_sync_error := null;
  end if;
  return new;
end;
$$;

create trigger mark_shopify_sync_from_item_trigger
  before update on public.consignment_items
  for each row execute function public.mark_shopify_sync_from_item();

-- ---------------------------------------------------------------- 4. Work queue for the shopify-sync function
-- Takes up to batch_size pending items (and any stuck in "syncing" for 10 minutes) and marks them "syncing".
-- SKIP LOCKED lets two runs at the same time take different items.
create function public.claim_shopify_sync_batch(batch_size int default 10)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  update public.consignment_items
    set shopify_sync_status = 'syncing'
    where id in (
      select id from public.consignment_items
      where shopify_sync_status = 'pending'
         or (shopify_sync_status = 'syncing' and updated_at < now() - interval '10 minutes')
      order by updated_at
      limit greatest(1, least(batch_size, 50))
      for update skip locked)
    returning id;
$$;

revoke execute on function public.claim_shopify_sync_batch(int) from public, anon, authenticated;

-- ---------------------------------------------------------------- 5. Retry one item, or resync everything
-- p_item_id null = every item with a published, reserved, sold or archived listing. Returns how many were marked.
create function public.request_shopify_sync(p_item_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  marked int;
begin
  if not public.has_role(array['super_admin', 'manager']::public.user_role[]) then
    raise exception 'Only the owner or the manager can start a Shopify sync';
  end if;

  update public.consignment_items c
    set shopify_sync_status = 'pending', shopify_sync_error = null
    from public.listings l
    where l.item_id = c.id
      and l.inventory_status in ('published', 'reserved', 'sold', 'archived')
      and (p_item_id is null or c.id = p_item_id)
      and c.shopify_sync_status <> 'syncing';
  get diagnostics marked = row_count;
  return marked;
end;
$$;

revoke execute on function public.request_shopify_sync(uuid) from public, anon;
grant execute on function public.request_shopify_sync(uuid) to authenticated;

-- ---------------------------------------------------------------- 6. Counts for the Shopify Sync card
create view public.shopify_sync_overview
with (security_invoker = true)
as
select l.inventory_status, c.shopify_sync_status, count(*)::int as items
from public.listings l
join public.consignment_items c on c.id = l.item_id
where l.inventory_status in ('published', 'reserved', 'sold', 'archived')
group by 1, 2;

-- ---------------------------------------------------------------- 7. First sync: everything already listed
update public.consignment_items c
  set shopify_sync_status = 'pending'
  from public.listings l
  where l.item_id = c.id
    and l.inventory_status in ('published', 'reserved', 'sold', 'archived');

commit;

-- Check: how many items will be sent to Shopify on the first sync
select inventory_status, shopify_sync_status, items from public.shopify_sync_overview order by 1, 2;
