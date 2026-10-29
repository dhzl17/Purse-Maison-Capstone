-- Module 26: Input validation rules
-- The same rules the forms check (purse_maison_web/js/validation.js), enforced by the database so that bad values
-- are rejected even if they are sent some other way.
--
--   Names (consignor, client, buyer, staff)   letters incl. ñ/é, spaces, period, hyphen, apostrophe; at least 2 letters
--   Phone numbers                              PH mobile: 09XXXXXXXXX or +639XXXXXXXXX (spaces and dashes ignored)
--   Emails                                     name@domain.tld
--   Brand, model, color, hardware, date code   letters, numbers, spaces and & . , ' ( ) / + # ; : ! -  ; must contain a letter
--   Serial / microchip / QR PH reference       letters, numbers, hyphen and slash; 2-40 characters
--   Notes                                      at least 3 letters, mostly letters/numbers, no key held down
--   Prices and amounts                         above 0, at most 50,000,000; whole pesos (layaway payments allow centavos)
--   Appointment date and time                  cannot be set in the past (checked only when it is set or changed)
--
-- Empty optional fields (null) are always allowed.
-- Before adding the rules, this script checks the existing records. If any break a rule, it stops and lists them,
-- and nothing is changed. Fix or delete those records, then run it again.

begin;

-- ---------------------------------------------------------------- 1. Rule functions
create function public.is_valid_person_name(v text) returns boolean
language sql immutable as $$
  select v is null or (
    length(v) between 2 and 100
    and v ~ '^[A-Za-zÀ-ÖØ-öø-ÿĀ-ž][A-Za-zÀ-ÖØ-öø-ÿĀ-ž .''’-]*$'
    and length(regexp_replace(v, '[^A-Za-zÀ-ÖØ-öø-ÿĀ-ž]', '', 'g')) >= 2
    and lower(v) !~ '([a-zà-öø-ÿā-ž])\1{3}'
    and v !~ '[.''’-]{2}')
$$;

create function public.is_valid_ph_mobile(v text) returns boolean
language sql immutable as $$
  select v is null or regexp_replace(v, '[ -]', '', 'g') ~ '^(09|\+639)[0-9]{9}$'
$$;

create function public.is_valid_email(v text) returns boolean
language sql immutable as $$
  select v is null or (length(v) <= 120 and v ~ '^[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}$')
$$;

create function public.is_valid_item_text(v text) returns boolean
language sql immutable as $$
  select v is null or (
    length(v) between 1 and 150
    and v ~ '^[0-9A-Za-zÀ-ÖØ-öø-ÿĀ-ž &.,''’()/+#;:!–-]+$'
    and v ~ '[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]'
    and v !~ '(.)\1{4}')
$$;

create function public.is_valid_code(v text) returns boolean
language sql immutable as $$
  select v is null or (v ~ '^[A-Za-z0-9/-]{2,40}$' and v !~ '(.)\1{7}')
$$;

create function public.is_meaningful_text(v text) returns boolean
language sql immutable as $$
  select v is null or (
    length(regexp_replace(v, '[^A-Za-zÀ-ÖØ-öø-ÿĀ-ž]', '', 'g')) >= 3
    and v !~ '([^[:space:]])\1{5}'
    and length(regexp_replace(v, '[^0-9A-Za-zÀ-ÖØ-öø-ÿĀ-ž]', '', 'g')) * 10
        >= length(regexp_replace(v, '[[:space:]]', '', 'g')) * 6)
$$;

create function public.is_valid_amount(v numeric, whole_pesos boolean default true) returns boolean
language sql immutable as $$
  select v is null or (v > 0 and v <= 50000000 and (not whole_pesos or v = trunc(v)))
$$;

-- ---------------------------------------------------------------- 2. Check the existing records first
do $$
declare
  problems text;
begin
  select string_agg(format('  %s: %s', k, v), E'\n') into problems from (
    select 'consignor name' k, full_name v from public.consignors where not public.is_valid_person_name(full_name)
    union all select 'consignor phone', phone from public.consignors where not public.is_valid_ph_mobile(phone)
    union all select 'consignor email', email from public.consignors where not public.is_valid_email(email)
    union all select 'client name', client_name from public.inquiries where not public.is_valid_person_name(client_name)
    union all select 'client phone', client_phone from public.inquiries where not public.is_valid_ph_mobile(client_phone)
    union all select 'client email', client_email from public.inquiries where not public.is_valid_email(client_email)
    union all select 'buyer name', buyer_name from public.sales_transactions where not public.is_valid_person_name(buyer_name)
    union all select 'buyer phone', buyer_phone from public.sales_transactions where not public.is_valid_ph_mobile(buyer_phone)
    union all select 'staff name', full_name from public.profiles where full_name <> '' and not public.is_valid_person_name(full_name)
    union all select item_code || ' brand', brand from public.consignment_items where not public.is_valid_item_text(brand)
    union all select item_code || ' model', model from public.consignment_items where not public.is_valid_item_text(model)
    union all select item_code || ' color', color from public.consignment_items where not public.is_valid_item_text(color)
    union all select item_code || ' hardware', hardware from public.consignment_items where not public.is_valid_item_text(hardware)
    union all select item_code || ' date code', date_code from public.consignment_items where not public.is_valid_item_text(date_code)
    union all select item_code || ' serial number', serial_number from public.consignment_items where not public.is_valid_code(serial_number)
    union all select item_code || ' microchip number', microchip_number from public.consignment_items where not public.is_valid_code(microchip_number)
    union all select item_code || ' inquiry notes', left(inquiry_notes, 60) from public.consignment_items where not public.is_meaningful_text(inquiry_notes)
    union all select item_code || ' condition notes', left(condition_notes, 60) from public.consignment_items where not public.is_meaningful_text(condition_notes)
    union all select item_code || ' photo revision note', left(photo_revision_note, 60) from public.consignment_items where not public.is_meaningful_text(photo_revision_note)
    union all select item_code || ' prices', concat_ws(' / ', asking_price, agreed_payout, price) from public.consignment_items
      where not (public.is_valid_amount(asking_price) and public.is_valid_amount(agreed_payout) and public.is_valid_amount(price))
    union all select 'negotiation', concat_ws(' / ', asking_price, counter_offer, left(notes, 40)) from public.price_negotiations
      where not (public.is_valid_amount(asking_price) and public.is_valid_amount(counter_offer) and public.is_meaningful_text(notes))
    union all select 'layaway payment', amount::text from public.layaway_payments where not public.is_valid_amount(amount, false)
    union all select 'contract extension notes', left(notes, 60) from public.contract_extensions where not public.is_meaningful_text(notes)
    union all select 'manager review notes', left(notes, 60) from public.manager_reviews where not public.is_meaningful_text(notes)
    union all select 'QR PH reference', payment_reference from public.authentication_records where not public.is_valid_code(payment_reference)
    limit 50
  ) bad;

  if problems is not null then
    raise exception E'Some existing records break the new rules. Nothing was changed. Fix or delete these, then run this again:\n%', problems;
  end if;
end $$;

-- ---------------------------------------------------------------- 3. The rules
alter table public.consignors
  add constraint consignors_full_name_valid check (public.is_valid_person_name(full_name)),
  add constraint consignors_phone_valid check (public.is_valid_ph_mobile(phone)),
  add constraint consignors_email_valid check (public.is_valid_email(email));

alter table public.inquiries
  add constraint inquiries_client_name_valid check (public.is_valid_person_name(client_name)),
  add constraint inquiries_client_phone_valid check (public.is_valid_ph_mobile(client_phone)),
  add constraint inquiries_client_email_valid check (public.is_valid_email(client_email));

alter table public.sales_transactions
  add constraint sales_buyer_name_valid check (public.is_valid_person_name(buyer_name)),
  add constraint sales_buyer_phone_valid check (public.is_valid_ph_mobile(buyer_phone));

-- New staff logins start with an empty name for a moment while the account is created
alter table public.profiles
  add constraint profiles_full_name_valid check (full_name = '' or public.is_valid_person_name(full_name));

alter table public.consignment_items
  add constraint items_brand_valid check (public.is_valid_item_text(brand)),
  add constraint items_model_valid check (public.is_valid_item_text(model)),
  add constraint items_color_valid check (public.is_valid_item_text(color)),
  add constraint items_hardware_valid check (public.is_valid_item_text(hardware)),
  add constraint items_date_code_valid check (public.is_valid_item_text(date_code)),
  add constraint items_serial_number_valid check (public.is_valid_code(serial_number)),
  add constraint items_microchip_number_valid check (public.is_valid_code(microchip_number)),
  add constraint items_inquiry_notes_valid check (public.is_meaningful_text(inquiry_notes)),
  add constraint items_condition_notes_valid check (public.is_meaningful_text(condition_notes)),
  add constraint items_photo_revision_note_valid check (public.is_meaningful_text(photo_revision_note)),
  add constraint items_asking_price_valid check (public.is_valid_amount(asking_price)),
  add constraint items_agreed_payout_valid check (public.is_valid_amount(agreed_payout)),
  add constraint items_price_valid check (public.is_valid_amount(price));

alter table public.price_negotiations
  add constraint negotiations_asking_price_valid check (public.is_valid_amount(asking_price)),
  add constraint negotiations_counter_offer_valid check (public.is_valid_amount(counter_offer)),
  add constraint negotiations_notes_valid check (public.is_meaningful_text(notes));

alter table public.layaway_payments
  add constraint layaway_payments_amount_valid check (public.is_valid_amount(amount, false));

alter table public.contract_extensions
  add constraint contract_extensions_notes_valid check (public.is_meaningful_text(notes));

alter table public.manager_reviews
  add constraint manager_reviews_notes_valid check (public.is_meaningful_text(notes));

alter table public.authentication_records
  add constraint auth_payment_reference_valid check (public.is_valid_code(payment_reference));

-- ---------------------------------------------------------------- 4. Appointments cannot be set in the past
-- Only checked when the appointment is set or changed, so items with an appointment that has already passed
-- can still move through the pipeline. (The mock data import switches triggers off, so history is not affected.)
create function public.check_appointment_not_past()
returns trigger
language plpgsql
as $$
begin
  if new.appointment_at is not null
     and (tg_op = 'INSERT' or new.appointment_at is distinct from old.appointment_at) then
    if new.appointment_at < now() then
      raise exception 'The appointment date and time for item % cannot be in the past.', new.item_code;
    end if;
    if new.appointment_at > now() + interval '365 days' then
      raise exception 'The appointment for item % must be within the next 12 months.', new.item_code;
    end if;
  end if;
  return new;
end;
$$;

create trigger check_appointment_not_past
  before insert or update of appointment_at on public.consignment_items
  for each row execute function public.check_appointment_not_past();

commit;
