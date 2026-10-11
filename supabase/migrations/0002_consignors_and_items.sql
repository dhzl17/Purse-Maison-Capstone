-- 1. Consignors — the people who bring in items
create table public.consignors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  id_verified boolean not null default false,
  id_photo_path text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.consignors enable row level security;

create policy "Staff can view consignors"
  on public.consignors for select
  using (auth.role() = 'authenticated');

create policy "Consignment team and admins can create consignors"
  on public.consignors for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('consignment_team', 'super_admin')
    )
  );

create policy "Consignment team and admins can update consignors"
  on public.consignors for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('consignment_team', 'super_admin')
    )
  );

-- 2. A sequence so every item gets a readable code like PM-1101
create sequence public.consignment_item_code_seq start 1101;

-- 3. Consignment items — the core record for each physical item
create table public.consignment_items (
  id uuid primary key default gen_random_uuid(),
  item_code text unique not null default ('PM-' || nextval('public.consignment_item_code_seq')::text),
  consignor_id uuid not null references public.consignors(id),
  brand text not null,
  model text,
  color text,
  category text,
  hardware text,
  microchip_number text unique,
  serial_number text unique,
  date_code text,
  condition_notes text,
  accessories_included text,
  price numeric(12,2),
  consignor_payout numeric(12,2),
  markup numeric(12,2),
  barcode text unique,
  status text not null default 'intake',
  shopify_product_id text,
  shopify_sync_status text not null default 'not_applicable',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.consignment_items enable row level security;

create policy "Staff can view consignment items"
  on public.consignment_items for select
  using (auth.role() = 'authenticated');

create policy "Consignment team and admins can create items"
  on public.consignment_items for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('consignment_team', 'super_admin')
    )
  );

create policy "Consignment team and admins can update items"
  on public.consignment_items for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('consignment_team', 'super_admin')
    )
  );

-- 4. Keep updated_at current automatically on every edit
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_consignment_items_updated_at
  before update on public.consignment_items
  for each row execute function public.set_updated_at();