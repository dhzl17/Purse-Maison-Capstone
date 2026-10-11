-- 1. The fixed list of photo angles an item needs
create type public.photo_type as enum (
  'front', 'back', 'side_left', 'side_right', 'underside', 'inside',
  'serial_number', 'date_code', 'microchip', 'hardware', 'accessories', 'lifestyle'
);

-- 2. A record of every photo uploaded for every item
create table public.item_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.consignment_items(id) on delete cascade,
  photo_type public.photo_type not null,
  storage_path text not null,
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

alter table public.item_photos enable row level security;

create policy "Staff can view item photos"
  on public.item_photos for select
  using (auth.role() = 'authenticated');

create policy "Consignment team and admins can upload photos"
  on public.item_photos for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('consignment_team', 'super_admin')
    )
  );

-- 3. The signed consignment agreement (canvas signature + timestamp, as scoped earlier)
create table public.consignment_agreements (
  id uuid primary key default gen_random_uuid(),
  consignor_id uuid not null references public.consignors(id),
  signature_data text not null,
  signed_at timestamptz not null default now(),
  ip_address text,
  created_at timestamptz not null default now()
);

alter table public.consignment_agreements enable row level security;

create policy "Staff can view agreements"
  on public.consignment_agreements for select
  using (auth.role() = 'authenticated');

create policy "Consignment team and admins can create agreements"
  on public.consignment_agreements for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('consignment_team', 'super_admin')
    )
  );

-- 4. Link each item to the agreement that covers it
alter table public.consignment_items
  add column agreement_id uuid references public.consignment_agreements(id);

-- 5. The actual hard block
create function public.check_receiving_requirements()
returns trigger
language plpgsql
as $$
declare
  consignor_verified boolean;
  required_photo_count int := 10;
  uploaded_required_count int;
begin
  if new.current_stage = 'arrivals_receiving' then

    select id_verified into consignor_verified
    from public.consignors where id = new.consignor_id;

    if not coalesce(consignor_verified, false) then
      raise exception 'Cannot mark item % as received: consignor ID has not been verified', new.item_code;
    end if;

    if new.agreement_id is null then
      raise exception 'Cannot mark item % as received: no signed consignment agreement on file', new.item_code;
    end if;

    if new.accessories_included is null or trim(new.accessories_included) = '' then
      raise exception 'Cannot mark item % as received: accessories have not been recorded', new.item_code;
    end if;

    if new.serial_number is null or trim(new.serial_number) = '' then
      raise exception 'Cannot mark item % as received: serial number has not been recorded', new.item_code;
    end if;

    select count(distinct photo_type) into uploaded_required_count
    from public.item_photos
    where item_id = new.id
      and photo_type in ('front','back','side_left','side_right','underside','inside','serial_number','date_code','hardware','accessories');

    if uploaded_required_count < required_photo_count then
      raise exception 'Cannot mark item % as received: only %/% required photos uploaded', new.item_code, uploaded_required_count, required_photo_count;
    end if;

  end if;
  return new;
end;
$$;

create trigger enforce_receiving_requirements
  before update on public.consignment_items
  for each row execute function public.check_receiving_requirements();