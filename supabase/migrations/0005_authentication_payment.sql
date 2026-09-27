-- 1. The fixed fee schedule from your scope document
create table public.authentication_fee_schedule (
  id serial primary key,
  provider text not null,
  category text not null,
  fee numeric(10,2) not null,
  unique (provider, category)
);

insert into public.authentication_fee_schedule (provider, category, fee) values
  ('entrupy', 'standard', 1800),
  ('entrupy', 'hermes_premium', 8500),
  ('legitgrail', 'footwear_standard', 1100),
  ('legitgrail', 'chanel_hermes_premium', 1800);

alter table public.authentication_fee_schedule enable row level security;

create policy "Staff can view fee schedule"
  on public.authentication_fee_schedule for select
  using (auth.role() = 'authenticated');

-- 2. One authentication record per item
create table public.authentication_records (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.consignment_items(id) on delete cascade,
  provider text not null,
  category text not null,
  fee numeric(10,2),
  payment_status text not null default 'pending' check (payment_status in ('pending','confirmed')),
  payment_confirmed_at timestamptz,
  primary_authenticator_id uuid references public.profiles(id),
  secondary_authenticator_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.authentication_records enable row level security;

create policy "Staff can view authentication records"
  on public.authentication_records for select
  using (auth.role() = 'authenticated');

create policy "Consignment team and admins can create authentication records"
  on public.authentication_records for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('consignment_team','super_admin'))
  );

create policy "Authenticators and admins can update authentication records"
  on public.authentication_records for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('authenticator','consignment_team','super_admin'))
  );

-- 3. Auto-calculate the fee the moment a record is created — never entered by hand
create function public.set_authentication_fee()
returns trigger
language plpgsql
as $$
begin
  select fee into new.fee
  from public.authentication_fee_schedule
  where provider = new.provider and category = new.category;

  if new.fee is null then
    raise exception 'No fee schedule found for provider % / category %', new.provider, new.category;
  end if;

  return new;
end;
$$;

create trigger auto_calculate_authentication_fee
  before insert on public.authentication_records
  for each row execute function public.set_authentication_fee();

-- 4. Hard block: can't start authentication service until payment is confirmed
create function public.check_authentication_payment()
returns trigger
language plpgsql
as $$
declare
  payment_ok boolean;
begin
  if new.current_stage = 'authentication_service' then
    select (payment_status = 'confirmed') into payment_ok
    from public.authentication_records
    where item_id = new.id;

    if not coalesce(payment_ok, false) then
      raise exception 'Cannot start authentication service for item %: payment has not been confirmed', new.item_code;
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_authentication_payment
  before update on public.consignment_items
  for each row execute function public.check_authentication_payment();