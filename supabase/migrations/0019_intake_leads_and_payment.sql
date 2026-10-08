-- Module 19: Inquiry-to-drop-off details (stages 1-7), ID type, payment reference,
-- and the 7-photo listing set from the client's process document.

-- 1. Which government ID the consignor presented (the photo itself is in the consignor-ids bucket).
--    The ID number is deliberately not stored.
alter table public.consignors
  add column id_type text
    check (id_type in ('passport','drivers_license','umid','prc_id','philsys_id'));

-- 2. Lead, negotiation and drop-off details on the item itself (one record, so stages can't disagree)
alter table public.consignment_items
  add column inquiry_channel text
    check (inquiry_channel in ('facebook','instagram','tiktok','messenger','whatsapp',
                               'website','walk_in','phone','email')),
  add column inquiry_notes text,
  add column lead_status text not null default 'new'
    check (lead_status in ('new','qualified','need_more_photos','negotiation','rejected','cancelled')),
  add column asking_price numeric(12,2) check (asking_price > 0),
  add column agreed_payout numeric(12,2) check (agreed_payout > 0),
  add column fulfillment_method text
    check (fulfillment_method in ('walk_in','drop_off','pickup','courier')),
  add column appointment_at timestamptz;

-- 3. Negotiation history: every asking price / counteroffer exchange, never edited afterwards
create table public.price_negotiations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.consignment_items(id) on delete cascade,
  asking_price numeric(12,2) check (asking_price > 0),
  counter_offer numeric(12,2) check (counter_offer > 0),
  notes text,
  logged_by uuid references public.profiles(id) default auth.uid(),
  logged_at timestamptz not null default now(),
  check (asking_price is not null or counter_offer is not null)
);

alter table public.price_negotiations enable row level security;

create policy "Staff can view price negotiations"
  on public.price_negotiations for select
  using (public.is_staff());

create policy "Consignment team and management can log negotiations"
  on public.price_negotiations for insert
  with check (public.has_role(array['consignment_team','manager','super_admin']::public.user_role[]));

-- Each logged exchange also updates the item's current asking price
create function public.apply_price_negotiation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.asking_price is not null then
    update public.consignment_items set asking_price = new.asking_price where id = new.item_id;
  end if;
  return new;
end;
$$;

create trigger apply_price_negotiation_trigger
  after insert on public.price_negotiations
  for each row execute function public.apply_price_negotiation();

-- 4. Lead status drives the early stages automatically (client process, Step 2)
--    Qualified -> photo submission, Negotiation -> price negotiation,
--    Rejected / Cancelled -> closed, Need More Photos -> stays in lead qualification.
create function public.apply_lead_status()
returns trigger
language plpgsql
as $$
declare
  early_stages constant public.pipeline_stage[] := array[
    'customer_inquiry','lead_qualification','initial_photo_submission','price_negotiation',
    'consignment_approval','appointment_scheduling','dropoff_pickup_courier']::public.pipeline_stage[];
begin
  if new.lead_status is not distinct from old.lead_status then
    return new;
  end if;

  if not (old.current_stage = any(early_stages)) then
    raise exception 'Cannot change the lead status of item %: it is already past drop-off (currently in %)',
      new.item_code, old.current_stage;
  end if;

  if new.lead_status in ('rejected','cancelled') then
    new.current_stage := 'closed_rejected';
  elsif new.lead_status = 'qualified'
        and old.current_stage in ('customer_inquiry','lead_qualification') then
    new.current_stage := 'initial_photo_submission';
  elsif new.lead_status = 'need_more_photos'
        and old.current_stage = 'customer_inquiry' then
    new.current_stage := 'lead_qualification';
  elsif new.lead_status = 'negotiation'
        and old.current_stage in ('customer_inquiry','lead_qualification','initial_photo_submission') then
    new.current_stage := 'price_negotiation';
  end if;
  return new;
end;
$$;

-- Named so it runs before the enforce_* checks (Postgres runs same-timing triggers alphabetically)
create trigger apply_lead_status_trigger
  before update on public.consignment_items
  for each row execute function public.apply_lead_status();

-- 5. Hard blocks for the early stages, each naming the exact missing item
create function public.check_early_stage_requirements()
returns trigger
language plpgsql
as $$
declare
  uploaded_required_count int;
begin
  if new.current_stage is not distinct from old.current_stage then
    return new;
  end if;

  -- Step 3: the full initial photo set before negotiation
  if new.current_stage = 'price_negotiation' then
    select count(distinct photo_type) into uploaded_required_count
    from public.item_photos
    where item_id = new.id
      and photo_type in ('front','back','side_left','side_right','underside','inside',
                         'serial_number','date_code','hardware','accessories');
    if uploaded_required_count < 10 then
      raise exception 'Cannot move item % to price negotiation: only %/10 required photos uploaded',
        new.item_code, uploaded_required_count;
    end if;
  end if;

  -- Step 5: an agreed payout before consignment approval
  if new.current_stage = 'consignment_approval' then
    if new.asking_price is null then
      raise exception 'Cannot move item % to consignment approval: no asking price recorded', new.item_code;
    end if;
    if new.agreed_payout is null then
      raise exception 'Cannot move item % to consignment approval: no agreed payout recorded', new.item_code;
    end if;
  end if;

  -- Step 7: how and when the item is arriving
  if new.current_stage = 'dropoff_pickup_courier' then
    if new.fulfillment_method is null then
      raise exception 'Cannot mark item % as in transit: no fulfillment method chosen', new.item_code;
    end if;
    if new.appointment_at is null then
      raise exception 'Cannot mark item % as in transit: no appointment date set', new.item_code;
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_early_stage_requirements
  before update on public.consignment_items
  for each row execute function public.check_early_stage_requirements();

-- 6. QR PH payment reference: required to confirm payment; confirming moves the item into the queue
alter table public.authentication_records
  add column payment_reference text;

create function public.check_payment_reference()
returns trigger
language plpgsql
as $$
begin
  if new.payment_status = 'confirmed' and old.payment_status is distinct from 'confirmed' then
    if new.payment_reference is null or trim(new.payment_reference) = '' then
      raise exception 'Cannot confirm the authentication payment: enter the QR PH reference number';
    end if;
    new.payment_confirmed_at := now();
  end if;
  if old.payment_status = 'confirmed' and new.payment_status <> 'confirmed' then
    raise exception 'A confirmed authentication payment cannot be undone';
  end if;
  return new;
end;
$$;

create trigger check_payment_reference_trigger
  before update on public.authentication_records
  for each row execute function public.check_payment_reference();

create function public.advance_after_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status = 'confirmed' and old.payment_status is distinct from 'confirmed' then
    update public.consignment_items
      set current_stage = 'authentication_service'
      where id = new.item_id and current_stage = 'authentication_payment';
  end if;
  return new;
end;
$$;

create trigger advance_after_payment_trigger
  after update on public.authentication_records
  for each row execute function public.advance_after_payment();

-- 7. Listing photo set per the client's Step 13: front, back, one side, interior,
--    hardware, serial number, accessories (7 shots; either side counts)
create or replace function public.check_photography_requirements()
returns trigger
language plpgsql
as $$
declare
  fixed_count int;
  has_side boolean;
  missing text[];
begin
  if new.current_stage = 'photo_editing_approval' then
    select count(distinct photo_type) into fixed_count
    from public.listing_photos
    where item_id = new.id
      and photo_type in ('front','back','inside','hardware','serial_number','accessories');

    select exists (select 1 from public.listing_photos
                   where item_id = new.id and photo_type in ('side_left','side_right'))
      into has_side;

    if fixed_count < 6 or not has_side then
      select array_agg(t order by ord) into missing
      from unnest(array['front','back','inside','hardware','serial_number','accessories'])
           with ordinality as u(t, ord)
      where not exists (select 1 from public.listing_photos
                        where item_id = new.id and photo_type::text = t);
      if not has_side then missing := array_append(coalesce(missing, '{}'::text[]), 'side'); end if;

      raise exception 'Cannot move item % to photo editing: missing listing photos (%)',
        new.item_code, array_to_string(missing, ', ');
    end if;
  end if;
  return new;
end;
$$;