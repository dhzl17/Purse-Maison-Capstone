-- 1. Staff accounts now require an invite from the owner first
create table public.staff_invites (
  email text primary key check (email = lower(trim(email))),
  role public.user_role not null,
  full_name text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.staff_invites enable row level security;

create policy "Owners manage staff invites"
  on public.staff_invites for all
  using (public.is_admin())
  with check (public.is_admin());

-- 2. Links between a consignor's login and their consignor record(s)
create table public.consignor_accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  consignor_id uuid not null references public.consignors(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (user_id, consignor_id)
);

alter table public.consignor_accounts enable row level security;

create policy "Staff can view consignor accounts"
  on public.consignor_accounts for select
  using (public.is_staff());

create policy "Consignors can view their own link"
  on public.consignor_accounts for select
  using (user_id = auth.uid());

create policy "Owners can remove consignor links"
  on public.consignor_accounts for delete
  using (public.is_admin());

-- 3. Link a confirmed login to every consignor record with the same email
create function public.link_consignor_accounts(target_email text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.consignor_accounts (user_id, consignor_id)
  select u.id, c.id
  from auth.users u
  join public.consignors c on lower(trim(c.email)) = lower(trim(u.email))
  where lower(trim(u.email)) = lower(trim(target_email))
    and u.email_confirmed_at is not null
  on conflict do nothing;
$$;

revoke execute on function public.link_consignor_accounts(text) from public, anon, authenticated;

-- 4. New accounts: staff only if invited; everyone else is a possible consignor
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.staff_invites%rowtype;
begin
  select * into invite from public.staff_invites where email = lower(trim(new.email));

  if found then
    insert into public.profiles (id, username, full_name, email, role)
    values (new.id, split_part(new.email, '@', 1), coalesce(invite.full_name, ''),
            new.email, invite.role);
    delete from public.staff_invites where email = invite.email;
  end if;

  if new.email_confirmed_at is not null then
    perform public.link_consignor_accounts(new.email);
  end if;
  return new;
end;
$$;

-- 5. Link when a consignor confirms their email...
create function public.handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    perform public.link_consignor_accounts(new.email);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.handle_user_email_confirmed();

-- ...or when staff record or correct a consignor's email after they signed up
create function public.handle_consignor_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null then
    perform public.link_consignor_accounts(new.email);
  end if;
  return new;
end;
$$;

create trigger link_consignor_on_email
  after insert or update of email on public.consignors
  for each row execute function public.handle_consignor_email();

-- 6. Staff-only data: replace every "anyone logged in" rule with "active staff only"
do $$
declare
  p record;
  open_rule constant text := '(auth.role() = ''authenticated''::text)';
begin
  for p in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (qual = open_rule or with_check = open_rule)
  loop
    if p.qual = open_rule then
      execute format('alter policy %I on %I.%I using (public.is_staff())',
                     p.policyname, p.schemaname, p.tablename);
    end if;
    if p.with_check = open_rule then
      execute format('alter policy %I on %I.%I with check (public.is_staff())',
                     p.policyname, p.schemaname, p.tablename);
    end if;
  end loop;
end;
$$;

-- 7. Plain-language status for consignors
create function public.stage_label(stage public.pipeline_stage)
returns text
language sql
immutable
as $$
  select case stage
    when 'customer_inquiry'           then 'Inquiry received'
    when 'lead_qualification'         then 'Inquiry received'
    when 'initial_photo_submission'   then 'Under review'
    when 'price_negotiation'          then 'Under review'
    when 'consignment_approval'       then 'Under review'
    when 'appointment_scheduling'     then 'Awaiting drop-off'
    when 'dropoff_pickup_courier'     then 'Awaiting drop-off'
    when 'arrivals_receiving'         then 'Received at our store'
    when 'authentication_payment'     then 'Awaiting authentication fee'
    when 'authentication_service'     then 'Being authenticated'
    when 'authentication_process'     then 'Being authenticated'
    when 'authentication_certificate' then 'Being authenticated'
    when 'photography'                then 'Being photographed'
    when 'photo_editing_approval'     then 'Being photographed'
    when 'manager_approval'           then 'Preparing your listing'
    when 'pricing_markup'             then 'Preparing your listing'
    when 'listing_creation'           then 'Preparing your listing'
    when 'publish_item'               then 'Listed for sale'
    when 'sold'                       then 'Sold'
    when 'closed_fake'                then 'Did not pass authentication'
    when 'closed_rejected'            then 'Not accepted for consignment'
    when 'archived'                   then 'Withdrawn or returned'
  end;
$$;

-- 8. What the portal shows: the consignor's own items only
create function public.my_consignments()
returns table (
  item_code text,
  brand text,
  model text,
  color text,
  status text,
  last_updated timestamptz,
  listed_on date,
  contract_end_date date,
  days_remaining int,
  expected_payout numeric,
  payout_status text,
  payout_due_by date,
  payout_released_at timestamptz,
  pull_out_fee numeric,
  pull_out_fee_paid boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ci.item_code, ci.brand, ci.model, ci.color,
    case when l.inventory_status = 'reserved' then 'Reserved by a buyer'
         else public.stage_label(ci.current_stage) end,
    ci.updated_at,
    l.published_at::date,
    case when l.inventory_status in ('published','reserved')
         then l.published_at::date + l.contract_days end,
    case when l.inventory_status in ('published','reserved')
         then (l.published_at::date + l.contract_days) - current_date end,
    coalesce(st.consignor_payout, ci.consignor_payout),
    st.payout_status, st.payout_due_by, st.payout_released_at,
    w.pull_out_fee, w.fee_paid
  from public.consignor_accounts ca
  join public.consignment_items ci on ci.consignor_id = ca.consignor_id
  left join public.listings l on l.item_id = ci.id
  left join public.sales_transactions st
    on st.item_id = ci.id and st.payment_status = 'verified'
  left join public.item_withdrawals w on w.item_id = ci.id
  where ca.user_id = auth.uid()
  order by ci.created_at desc;
$$;

-- 9. An item's timeline in plain language (repeated steps collapsed)
create function public.my_item_history(code text)
returns table (status text, changed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select status, changed_at
  from (
    select public.stage_label(sh.to_stage) as status,
           sh.changed_at,
           lag(public.stage_label(sh.to_stage)) over (order by sh.changed_at) as previous
    from public.stage_history sh
    join public.consignment_items ci on ci.id = sh.item_id
    join public.consignor_accounts ca on ca.consignor_id = ci.consignor_id
    where ca.user_id = auth.uid() and ci.item_code = code
  ) steps
  where previous is distinct from status
  order by changed_at;
$$;