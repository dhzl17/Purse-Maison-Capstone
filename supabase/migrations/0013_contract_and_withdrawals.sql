-- 1. Policy numbers the client can edit later
insert into public.app_settings (key, value) values
  ('pull_out_fee', '2500'),
  ('pull_out_window_days', '60');

-- 2. Contract length per listing (60 days by default, extendable)
alter table public.listings
  add column contract_days int not null default 60 check (contract_days >= 1);

-- 3. Contract extensions — only valid with the consignor's agreement
create table public.contract_extensions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.consignment_items(id) on delete cascade,
  extra_days int not null check (extra_days >= 1),
  consignor_agreed boolean not null,
  notes text,
  recorded_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint extension_needs_agreement check (consignor_agreed = true)
);

alter table public.contract_extensions enable row level security;

create policy "Staff can view contract extensions"
  on public.contract_extensions for select
  using (auth.role() = 'authenticated');

create policy "Authorized roles can record extensions"
  on public.contract_extensions for insert
  with check (
    exists (select 1 from public.profiles
            where id = auth.uid()
              and role in ('consignment_team','manager','super_admin'))
  );

create function public.apply_contract_extension()
returns trigger
language plpgsql
security definer
as $$
declare
  listing_state text;
begin
  select inventory_status into listing_state
  from public.listings where item_id = new.item_id;

  if listing_state is null or listing_state not in ('published','reserved') then
    raise exception 'Only a live listing can be extended (listing status: %)',
      coalesce(listing_state, 'no listing');
  end if;

  update public.listings
    set contract_days = contract_days + new.extra_days
    where item_id = new.item_id;
  return new;
end;
$$;

create trigger apply_contract_extension_trigger
  after insert on public.contract_extensions
  for each row execute function public.apply_contract_extension();

-- 4. Live countdown for every live listing
create view public.contract_status
with (security_invoker = true)
as
select
  l.item_id,
  ci.item_code,
  l.published_at,
  l.contract_days,
  (l.published_at::date + l.contract_days) as contract_end_date,
  (l.published_at::date + l.contract_days) - current_date as days_remaining,
  case
    when (l.published_at::date + l.contract_days) - current_date <= 0 then 'expired'
    when (l.published_at::date + l.contract_days) - current_date <= 7 then 'expiring_soon'
    else 'active'
  end as contract_state
from public.listings l
join public.consignment_items ci on ci.id = l.item_id
where l.published_at is not null
  and l.inventory_status in ('published','reserved');

-- 5. Withdrawals and the pull-out fee
create table public.item_withdrawals (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.consignment_items(id) on delete cascade,
  reason text,
  days_since_posting int,
  pull_out_fee numeric(12,2),
  fee_paid boolean not null default false,
  fee_paid_at timestamptz,
  status text not null default 'requested' check (status in ('requested','released')),
  requested_by uuid references public.profiles(id) default auth.uid(),
  requested_at timestamptz not null default now(),
  released_at timestamptz
);

alter table public.item_withdrawals enable row level security;

create policy "Staff can view withdrawals"
  on public.item_withdrawals for select
  using (auth.role() = 'authenticated');

create policy "Authorized roles can request withdrawals"
  on public.item_withdrawals for insert
  with check (
    exists (select 1 from public.profiles
            where id = auth.uid()
              and role in ('consignment_team','manager','super_admin'))
  );

create policy "Managers and owners can process withdrawals"
  on public.item_withdrawals for update
  using (
    exists (select 1 from public.profiles
            where id = auth.uid() and role in ('manager','super_admin'))
  );

-- 6. Requesting a withdrawal: check eligibility and calculate the fee automatically
create function public.prepare_withdrawal()
returns trigger
language plpgsql
as $$
declare
  item public.consignment_items%rowtype;
  posted timestamptz;
  window_days int;
  fee numeric;
begin
  select * into item from public.consignment_items where id = new.item_id;

  if item.current_stage in ('sold','archived','closed_fake','closed_rejected') then
    raise exception 'Item % can no longer be withdrawn (it is %)', item.item_code, item.current_stage;
  end if;

  if exists (select 1 from public.sales_transactions where item_id = new.item_id) then
    raise exception 'Item % has a sale in progress and cannot be withdrawn', item.item_code;
  end if;

  select published_at into posted from public.listings where item_id = new.item_id;

  if posted is null then
    new.days_since_posting := null;
    new.pull_out_fee := 0;
  else
    window_days := (select value from public.app_settings where key = 'pull_out_window_days')::int;
    fee := (select value from public.app_settings where key = 'pull_out_fee')::numeric;
    new.days_since_posting := current_date - posted::date;
    new.pull_out_fee := case when new.days_since_posting < window_days then fee else 0 end;
  end if;

  new.fee_paid := (new.pull_out_fee = 0);
  return new;
end;
$$;

create trigger prepare_withdrawal_trigger
  before insert on public.item_withdrawals
  for each row execute function public.prepare_withdrawal();

-- 7. Rules for processing: the fee can't be edited, and the item is only released once the fee is paid
create function public.guard_withdrawal_updates()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'released' then
    raise exception 'A released withdrawal cannot be changed';
  end if;

  if new.pull_out_fee is distinct from old.pull_out_fee
     or new.days_since_posting is distinct from old.days_since_posting then
    raise exception 'The pull-out fee is calculated automatically and cannot be edited';
  end if;

  if new.fee_paid and not old.fee_paid then
    new.fee_paid_at := now();
  end if;

  if new.status = 'released' and old.status <> 'released' then
    if not new.fee_paid then
      raise exception 'Cannot release the item: the pull-out fee of % has not been paid', new.pull_out_fee;
    end if;
    new.released_at := now();
  end if;
  return new;
end;
$$;

create trigger guard_withdrawal_updates_trigger
  before update on public.item_withdrawals
  for each row execute function public.guard_withdrawal_updates();

-- 8. Releasing a withdrawn item archives it
create function public.apply_withdrawal_release()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.status = 'released' and old.status <> 'released' then
    update public.listings set inventory_status = 'archived' where item_id = new.item_id;
    update public.consignment_items
      set current_stage = 'archived'
      where id = new.item_id and current_stage <> 'archived';
  end if;
  return new;
end;
$$;

create trigger apply_withdrawal_release_trigger
  after update on public.item_withdrawals
  for each row execute function public.apply_withdrawal_release();