-- demo_stage_items.sql  —  puts 30 demo items into the consignment pages for the system demonstration
--
-- Where they land (each item waits for that page's first action):
--   Intake & Agreements      5 items  "Drop-off / Pickup / Courier" (awaiting arrival)
--   Authentication Service   5 items  "Authentication Service" (payment confirmed, waiting for an authenticator)
--   Photography Tasks        5 items  "Photography" (authentic, not yet assigned to a photographer)
--   Design & Listing         5 items  "Photo Editing" (7 listing photos uploaded, waiting for the editing checklist)
--   Manager Approvals        5 items  "Manager Approval" (photos approved, waiting for the manager's decision)
--   Pricing & Markup         5 items  "Pricing & Markup" (approved by the manager, no price set yet)
--
-- How it works: every item is walked through the real workflow (lead -> photos -> negotiation -> agreement ->
-- receiving -> authentication -> photography -> design -> manager), so every database rule is checked exactly
-- as if staff had done it, and the Activity Log shows the full history. The history is then spread over the
-- past few weeks so it reads naturally.
--
-- BEFORE RUNNING: upload the 18 placeholder files (see the instructions that came with this script) to
--   intake-photos/demo-placeholders/   (10 photos)
--   listing-photos/demo-placeholders/  (7 photos)
--   certificates/demo-placeholders/    (certificate.png)
-- The script checks they are there and stops if any is missing.
--
-- Uses: existing ID-verified consignors (picked at random), your active authenticator / photographer / manager
-- accounts (the owner account is used if a role has nobody). Amounts are realistic estimates; change them below.
-- Runs as one transaction: if anything fails, nothing is saved.

begin;

-- ---------------------------------------------------------------- 0. Safety checks
do $$
declare
  missing text;
begin
  select string_agg(f.bucket || '/' || f.name, ', ') into missing
  from (values
    ('intake-photos', 'demo-placeholders/front.jpg'), ('intake-photos', 'demo-placeholders/back.jpg'),
    ('intake-photos', 'demo-placeholders/side_left.jpg'), ('intake-photos', 'demo-placeholders/side_right.jpg'),
    ('intake-photos', 'demo-placeholders/underside.jpg'), ('intake-photos', 'demo-placeholders/inside.jpg'),
    ('intake-photos', 'demo-placeholders/serial_number.jpg'), ('intake-photos', 'demo-placeholders/date_code.jpg'),
    ('intake-photos', 'demo-placeholders/hardware.jpg'), ('intake-photos', 'demo-placeholders/accessories.jpg'),
    ('listing-photos', 'demo-placeholders/front.jpg'), ('listing-photos', 'demo-placeholders/back.jpg'),
    ('listing-photos', 'demo-placeholders/side_left.jpg'), ('listing-photos', 'demo-placeholders/inside.jpg'),
    ('listing-photos', 'demo-placeholders/hardware.jpg'), ('listing-photos', 'demo-placeholders/serial_number.jpg'),
    ('listing-photos', 'demo-placeholders/accessories.jpg'), ('certificates', 'demo-placeholders/certificate.png')
  ) as f(bucket, name)
  where not exists (select 1 from storage.objects o where o.bucket_id = f.bucket and o.name = f.name);
  if missing is not null then
    raise exception 'Upload the placeholder files first. Missing: %', missing;
  end if;

  if exists (select 1 from public.item_photos where storage_path like 'demo-placeholders/%') then
    raise exception 'The demo items were already added. Run demo_stage_items_remove.sql first if you want to add them again.';
  end if;

  if (select count(*) from public.consignors where id_verified) = 0 then
    raise exception 'No ID-verified consignors found to attach the demo items to.';
  end if;
  if not exists (select 1 from public.profiles where is_active and role in ('authenticator', 'super_admin')) then
    raise exception 'No active authenticator or owner account found.';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. The 30 items
create temp table demo_items (
  n int primary key, target text, brand text, model text, color text, category text, hardware text,
  date_code text, notes text, accessories text, asking numeric, payout numeric,
  item_id uuid, consignor_id uuid, started timestamptz, finished timestamptz
) on commit drop;

insert into demo_items (n, target, brand, model, color, category, hardware, date_code, notes, accessories, asking, payout) values
  -- Intake & Agreements
  (1, 'intake', 'Chanel', 'CC Kelly Small', 'Black Calfskin Leather', 'Handbag', 'Aged Gold', null, 'Excellent condition with light marks on the corners. Microchip (G4****AA).', 'Dust bag, Box', 350000, 330000),
  (2, 'intake', 'Chanel', 'Filigree Backpack', 'Black Caviar Leather', 'Backpack', 'Aged Gold', 'Series 28', 'Very good condition, slight wear on the straps.', 'Dust bag', 230000, 210000),
  (3, 'intake', 'Hermes', 'Petite Arcon', 'Etoupe Togo and Swift Leather', 'Shoulder Bag', 'Gold', 'Stamp W (2024)', 'Like new, no visible signs of use.', 'Dust bag, Box', 210000, 190000),
  (4, 'intake', 'Goyard', 'Saint Louis PM', 'White Goyardine Canvas', 'Tote', null, null, 'Very good condition. Comes with a croc Universal clip charm.', 'Dust bag', 85000, 75000),
  (5, 'intake', 'Christian Dior', 'Bobby Small', 'Latte Box Calfskin Leather', 'Shoulder Bag', null, null, 'Excellent condition, light scratches on the hardware.', 'Dust bag, Strap', 125000, 110000),
  -- Authentication Service
  (6, 'authentication', 'Louis Vuitton', 'Keepall 50', 'Monogram Canvas', 'Travel Bag', null, '853 SD', 'Good condition, patina on the handles.', 'Lock, Keys', 65000, 55000),
  (7, 'authentication', 'Chanel', 'Mini Souplissimo Flap Bag', 'Burgundy Suede Calfskin Leather', 'Shoulder Bag', 'Gold', null, 'Excellent condition, soft suede with no stains. Microchip present.', 'Dust bag, Box', 200000, 180000),
  (8, 'authentication', 'Hermes', 'Lindy 26', 'Etoupe Clemence Leather', 'Handbag', 'Gold', 'Stamp D (2019)', 'Very good condition, light corner wear.', 'Dust bag, Strap', 560000, 520000),
  (9, 'authentication', 'Hermes', 'Birkin 30', 'Black Epsom Leather', 'Handbag', 'Palladium', 'Stamp C (2018)', 'Excellent condition, structure intact, light hardware scratches.', 'Dust bag, Box, Lock, Keys', 1000000, 950000),
  (10, 'authentication', 'Chanel', 'Mini Duma Backpack', 'Gray Quilted Caviar Leather', 'Backpack', 'Light Gold', null, 'Like new. Microchip present.', 'Dust bag, Box', 210000, 190000),
  -- Photography Tasks
  (11, 'photography', 'Chanel', '23B Hobo Bag Chain Edging', 'Gray Quilted Lambskin Leather', 'Shoulder Bag', 'Aged Gold', null, 'Excellent condition. Microchip present.', 'Dust bag, Box', 260000, 240000),
  (12, 'photography', 'Fendi', 'Medium Baguette FF', 'Light Yellow Nappa Leather', 'Shoulder Bag', 'Gold', null, 'Very good condition, clean interior.', 'Dust bag, Strap', 95000, 85000),
  (13, 'photography', 'Chanel', 'Le Boy Small', 'Black Caviar Leather', 'Shoulder Bag', 'Ruthenium', 'Series 26', 'Very good condition, light wear on the corners.', 'Dust bag', 230000, 210000),
  (14, 'photography', 'Loro Piana', 'Extra Pocket L19', 'Whisper White/Sun Gold Tender Calfskin Leather', 'Handbag', null, null, 'Like new, kept in its dust bag.', 'Dust bag, Box, Strap', 185000, 170000),
  (15, 'photography', 'Christian Dior', 'Bobby Small', 'Latte Box Calfskin Leather', 'Shoulder Bag', null, null, 'Very good condition, light marks on the flap.', 'Dust bag, Strap', 120000, 105000),
  -- Design & Listing
  (16, 'design', 'Chanel', 'Le Boy Old Medium', 'Black Caviar Leather', 'Shoulder Bag', 'Ruthenium', null, 'Very good condition. Microchip present.', 'Dust bag, Box', 265000, 240000),
  (17, 'design', 'Hermes', 'Picotin 18 Tressage', 'Mauve Sylvestre Epsom Leather', 'Handbag', 'Palladium', 'Stamp D (2019)', 'Excellent condition, clean interior.', 'Dust bag', 300000, 280000),
  (18, 'design', 'Hermes', 'Garden Party Tote 36 (GPT)', 'Rose Sakura Clemence Leather', 'Tote', 'Palladium', 'Stamp T (2015)', 'Good condition, light softening of the leather.', 'Dust bag', 155000, 140000),
  (19, 'design', 'Chanel', 'Classic Wallet On Chain (WOC)', 'Black Caviar Leather', 'Crossbody', 'Gold', null, 'Excellent condition. Microchip (P3****N8).', 'Dust bag, Box', 165000, 150000),
  (20, 'design', 'Hermes', 'Constance Slim Wallet', 'Black Epsom Leather', 'Wallet', 'Gold', 'Stamp U (2022)', 'Like new, no visible signs of use.', 'Dust bag, Box', 135000, 120000),
  -- Pricing & Markup
  (21, 'pricing', 'Hermes', 'Mini Kelly II', 'Gold Epsom Leather', 'Handbag', 'Gold', 'Stamp D (2019)', 'Excellent condition, corners intact.', 'Dust bag, Box, Strap', 1600000, 1500000),
  (22, 'pricing', 'Hermes', 'Birkin 25 Retourne', 'Toundra Togo Leather', 'Handbag', 'Palladium', 'Stamp B (2023)', 'Like new, plastic still on the hardware.', 'Dust bag, Box, Lock, Keys', 1350000, 1250000),
  (23, 'pricing', 'Hermes', 'Birkin 30 Retourne Tressage de Cuir', 'Blue Du Nord/Bleu Encre Epsom and Swift Leather', 'Handbag', 'Palladium', 'Stamp D (2019)', 'Excellent condition, light marks on the base.', 'Dust bag, Box, Lock, Keys', 1200000, 1100000),
  (24, 'pricing', 'Chanel', 'Classic Double Flap Medium', 'Beige Clair Quilted Caviar Leather', 'Shoulder Bag', 'Gold', null, 'Excellent condition. Microchip (K9****5C).', 'Dust bag, Box', 450000, 420000),
  (25, 'pricing', 'Hermes', 'Jypsiere Mini', 'Gold Evercolor Leather', 'Crossbody', 'Gold', 'Stamp U (2022)', 'Like new, no visible signs of use.', 'Dust bag, Box, Strap', 450000, 420000),
  -- Manager Approvals
  (26, 'manager', 'Hermes', 'Constance 18', 'Etoupe Epsom Leather', 'Shoulder Bag', 'Rose Gold', 'Stamp B (2023)', 'Like new, kept with its box and dust bag.', 'Dust bag, Box', 850000, 800000),
  (27, 'manager', 'Chanel', 'Classic Double Flap Small', 'Black Caviar Leather', 'Shoulder Bag', 'Gold', null, 'Excellent condition. Microchip present.', 'Dust bag, Box', 430000, 400000),
  (28, 'manager', 'Chanel', 'Mini Souplissimo Flap Bag', 'Dark Brown Grained Calfskin Leather', 'Shoulder Bag', 'Gold', null, 'Very good condition, light marks on the flap. Microchip present.', 'Dust bag', 200000, 180000),
  (29, 'manager', 'Hermes', 'Constance 18 Mirror', 'Gris Misty Epsom Leather', 'Shoulder Bag', 'Permabrass', 'Stamp W (2024)', 'Like new, no visible signs of use.', 'Dust bag, Box', 900000, 850000),
  (30, 'manager', 'Hermes', 'Birkin 25 Retourne', 'Alezan Togo Leather', 'Handbag', 'Gold', 'Stamp W (2024)', 'Like new, plastic still on the hardware.', 'Dust bag, Box, Lock, Keys', 1400000, 1300000);

-- Existing ID-verified consignors, picked at random (reused only if there are fewer than 30)
with c as (select id, row_number() over (order by random()) as r, count(*) over () as total
           from public.consignors where id_verified)
update demo_items d set consignor_id = c.id
from c where c.r = ((d.n - 1) % c.total) + 1;

-- Timeline: each item arrived some days ago (earlier stages = more recent) and reached its current stage recently
update demo_items set
  started = now() - make_interval(days => case target when 'intake' then 6 when 'authentication' then 11
                                                      when 'photography' then 15 when 'design' then 19
                                                      when 'manager' then 23 else 27 end + (n % 5)),
  finished = now() - make_interval(hours => 1 + (n * 7) % 20);

-- No emails to consignors for this back-dated history, and allow past appointment dates for items already received
alter table public.consignment_items disable trigger queue_stage_notifications_trigger;
alter table public.consignment_items disable trigger check_appointment_not_past;

-- ---------------------------------------------------------------- 2. Walk each item through the workflow
do $$
declare
  d record;
  v_item uuid;
  v_code text;
  v_agreement uuid;
  v_auth uuid;
  v_authenticator uuid := (select id from public.profiles where is_active and role = 'authenticator' order by created_at limit 1);
  v_photographer uuid := (select id from public.profiles where is_active and role = 'photographer' order by created_at limit 1);
  v_manager uuid := (select id from public.profiles where is_active and role = 'manager' order by created_at limit 1);
  v_owner uuid := (select id from public.profiles where is_active and role = 'super_admin' order by created_at limit 1);
  rank int;
  intake_types text[] := array['front','back','side_left','side_right','underside','inside','serial_number','date_code','hardware','accessories'];
  listing_types text[] := array['front','back','side_left','inside','hardware','serial_number','accessories'];
  channels text[] := array['instagram','facebook','messenger','walk_in','website','whatsapp'];
  methods text[] := array['drop_off','walk_in','pickup','courier'];
  k int;
begin
  v_authenticator := coalesce(v_authenticator, v_owner);
  v_photographer := coalesce(v_photographer, v_owner);
  v_manager := coalesce(v_manager, v_owner);

  for d in select * from demo_items order by n loop
    rank := array_position(array['intake','authentication','photography','design','manager','pricing'], d.target);

    -- Inquiry and lead
    insert into public.consignment_items
      (consignor_id, brand, model, color, category, hardware, date_code, condition_notes, inquiry_channel, inquiry_notes, asking_price)
    values
      (d.consignor_id, d.brand, d.model, d.color, d.category, d.hardware, d.date_code, d.notes,
       channels[1 + d.n % array_length(channels, 1)], 'Consignor sent photos and asked about consigning this item.', d.asking)
    returning id, item_code into v_item, v_code;
    update demo_items set item_id = v_item where n = d.n;

    update public.consignment_items set lead_status = 'qualified' where id = v_item;          -- -> Initial Photos
    foreach k in array array[1,2,3,4,5,6,7,8,9,10] loop
      insert into public.item_photos (item_id, photo_type, storage_path)
      values (v_item, intake_types[k]::public.photo_type, 'demo-placeholders/' || intake_types[k] || '.jpg');
    end loop;
    update public.consignment_items set lead_status = 'negotiation' where id = v_item;        -- -> Price Negotiation
    insert into public.price_negotiations (item_id, asking_price, counter_offer, notes)
    values (v_item, d.asking, d.payout, 'Agreed payout after reviewing the photos and recent sales.');
    update public.consignment_items set agreed_payout = d.payout, current_stage = 'consignment_approval' where id = v_item;
    update public.consignment_items set current_stage = 'appointment_scheduling' where id = v_item;
    update public.consignment_items
      set fulfillment_method = methods[1 + d.n % array_length(methods, 1)],
          appointment_at = (date_trunc('day', now() at time zone 'Asia/Manila') + make_interval(days => 1 + d.n % 4, hours => 10 + d.n % 6))
                           at time zone 'Asia/Manila',   -- 10 AM to 3 PM, Philippine time
          current_stage = 'dropoff_pickup_courier'
      where id = v_item;
    continue when rank = 1;

    -- Receiving: signed agreement, serial number, accessories (the 10 photos are already on file)
    insert into public.consignment_agreements (consignor_id, item_id, signature_data, signature_method)
    values (d.consignor_id, v_item, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWgAAABuAQMAAAAwBRs/AAAABlBMVEX///8UHlDxx7b5AAADCElEQVR42u2WPYvUQBjHf8nmSJBjDWJhEc9cJ1aWK4rmRLC9j+AHsFjE4ooD50DB8hBLiystxcpCuXgWbmGhjZ3c3EthIWe8QrKaTSxmkk2y2XCWYv7NkGf+88zzOk+gQ4cOHTr8P1j7K3ai1+GJ2GntVDuy2qlmmGoxPurvrydhE+tTe/p7sY1tvhZV+b1W3dRObbSy271brbFFUN2vevu8umkbYWU13gmALe17XNOd+Q0GGKvtXhZidYXDEgCHzeysyKn2YxnAfFFl22wuKWV+9YagSWef4Q21ypK3PY/fArD7M5YEpWxuqSqzIn4CMK6zRzpJAuitgg9kJpG23xYVtnUfwMUFLMfWITGk8gonKLH79I6m2XTywIzZ9gES4VYtkWWnAxCAq7fTmexEUjVaCGSHfdxS37kw8SvseNsHfBygHymZx0MhgCQNvKrucR5AU4DpFXXschYfBpsltoeyFFgIYBygCuU2cIlis5RTFxhw6Ph4CBwgzi4DK8TZ8kxVhdgh4Lq6qWMCIFQhikaa7RVRdnyIzgtIIjAsIMUhBoScrS7XHWIGI+KJjzQB1oG7As6EZfYAkGQOjBMIAMuSwGMgZcgHpdyE47xSSB9JWMuz+pIhIA0ZqN26Jd4OEFn5M6B0mNm8vpSQSIiAyM6LmmXJboWtUh1HIZMgQgBmXkpWKGBf2WtObz0m+CGmIjcxpNLjFndb0zaqIj6Fbhdx9XTF7uuU7VG1buTNb6twxAV7RfeCisLYAEhepUFYfremdm+UHvxavMZ9pFDNqCVxUJxuGEXslcdXTxzsidL72tsQgCE5AOid06xnue4vT2YtyHyeUnqV0zt6x2BRNI1KGyAd1PVo30XYNlQSlZ305htdvRMlv3UlbyYg00nI4iKCu43aPgMUT7Sry9YSFQuKyH1r1PFdZ+u9/j5qndxuTbbZys5qM6cd6zULrs1l9oBfesAt7Kh1f4blJFNLRnN1XcgUotbpekOzPhkKTgPnIg80S865y6ok5K1xkqiI7oe4Q4d/Fn8AgqrzrIhieTwAAAAASUVORK5CYII=', 'drawn')
    returning id into v_agreement;
    update public.consignment_items
      set agreement_id = v_agreement, serial_number = 'DEMO-' || lpad(d.n::text, 3, '0'),
          accessories_included = d.accessories, current_stage = 'arrivals_receiving'
      where id = v_item;
    update public.consignment_items set current_stage = 'authentication_payment' where id = v_item;

    -- Authentication fee paid
    insert into public.authentication_records (item_id, provider, category)
    values (v_item, 'entrupy', case when d.brand = 'Hermes' then 'hermes_premium' else 'standard' end)
    returning id into v_auth;
    update public.authentication_records
      set payment_reference = 'QRPH-DEMO-' || lpad(d.n::text, 3, '0'), payment_status = 'confirmed'
      where id = v_auth;                                                                        -- -> Authentication Service
    continue when rank = 2;

    -- Authenticated (one check), certificate uploaded
    update public.authentication_records set primary_authenticator_id = v_authenticator where id = v_auth;
    update public.authentication_records set certificate_url = 'demo-placeholders/certificate.png' where id = v_auth;
    update public.authentication_records set primary_result = 'authentic' where id = v_auth;
    update public.authentication_records set final_result = 'authentic' where id = v_auth;   -- -> Photography
    continue when rank = 3;

    -- Photographed: 7 listing photos, front as the cover
    update public.consignment_items set assigned_photographer_id = v_photographer where id = v_item;
    for k in 1 .. array_length(listing_types, 1) loop
      insert into public.listing_photos (item_id, photo_type, storage_path, is_primary, sort_order, uploaded_by)
      values (v_item, listing_types[k]::public.photo_type, 'demo-placeholders/' || listing_types[k] || '.jpg',
              k = 1, k - 1, v_photographer);
    end loop;
    update public.consignment_items set current_stage = 'photo_editing_approval' where id = v_item;   -- -> Design
    continue when rank = 4;

    -- Design approved the photos
    update public.consignment_items
      set photo_edit_checklist = array['background_removal','color_correction','cropping','watermark','quality_check'],
          photos_approved = true
      where id = v_item;                                                                       -- -> Manager Approval
    update public.listing_photos set edited = true where item_id = v_item;
    continue when rank = 5;

    -- Manager approved
    insert into public.manager_reviews (item_id, reviewer_id, decision, notes)
    values (v_item, v_manager, 'approved', 'Details, authentication and photos checked. Approved for pricing.');  -- -> Pricing
  end loop;
end $$;

-- ---------------------------------------------------------------- 3. Spread the history over the past weeks
alter table public.consignment_items disable trigger set_consignment_items_updated_at;

-- Stage history: from the item's start date to its finish time, in workflow order
with h as (
  select sh.id, d.started, d.finished,
         row_number() over (partition by sh.item_id order by sh.to_stage) - 1 as k,
         count(*) over (partition by sh.item_id) as total
  from public.stage_history sh join demo_items d on d.item_id = sh.item_id
)
update public.stage_history sh
set changed_at = h.started + (h.finished - h.started) * (h.k::numeric / greatest(h.total - 1, 1))
from h where h.id = sh.id;

create temp view demo_stage_time as
  select item_id, to_stage, max(changed_at) as at from public.stage_history
  where item_id in (select item_id from demo_items) group by item_id, to_stage;

update public.consignment_items ci set created_at = d.started, updated_at = d.finished
from demo_items d where d.item_id = ci.id;

update public.consignment_items ci set appointment_at = t.at - interval '2 hours'
from demo_items d join demo_stage_time t on t.item_id = d.item_id and t.to_stage = 'arrivals_receiving'
where ci.id = d.item_id;

update public.item_photos p set uploaded_at = t.at + interval '20 minutes'
from demo_stage_time t where t.item_id = p.item_id and t.to_stage = 'initial_photo_submission';

update public.price_negotiations p set logged_at = t.at + interval '1 hour'
from demo_stage_time t where t.item_id = p.item_id and t.to_stage = 'price_negotiation';

update public.consignment_agreements a set signed_at = t.at - interval '10 minutes', created_at = t.at - interval '10 minutes'
from demo_stage_time t where t.item_id = a.item_id and t.to_stage = 'arrivals_receiving';

update public.authentication_records r set
  created_at = pay.at,
  payment_confirmed_at = svc.at,
  service_started_at = svc.at,
  sla_deadline = svc.at + interval '24 hours',
  certificate_uploaded_at = case when r.certificate_url is not null then cert.at end
from demo_stage_time pay
join demo_stage_time svc on svc.item_id = pay.item_id and svc.to_stage = 'authentication_service'
left join demo_stage_time cert on cert.item_id = pay.item_id and cert.to_stage = 'authentication_certificate'
where pay.item_id = r.item_id and pay.to_stage = 'authentication_payment';

update public.listing_photos p set uploaded_at = t.at - interval '30 minutes'
from demo_stage_time t where t.item_id = p.item_id and t.to_stage = 'photo_editing_approval';

update public.manager_reviews m set reviewed_at = t.at
from demo_stage_time t where t.item_id = m.item_id and t.to_stage = 'pricing_markup';

drop view demo_stage_time;

alter table public.consignment_items enable trigger set_consignment_items_updated_at;
alter table public.consignment_items enable trigger queue_stage_notifications_trigger;
alter table public.consignment_items enable trigger check_appointment_not_past;

-- ---------------------------------------------------------------- 4. Result: should be 5 per page
select case
         when ci.current_stage = 'dropoff_pickup_courier' then '1. Intake & Agreements'
         when ci.current_stage = 'authentication_service' then '2. Authentication Service'
         when ci.current_stage = 'photography' then '3. Photography Tasks'
         when ci.current_stage = 'photo_editing_approval' then '4. Design & Listing'
         when ci.current_stage = 'manager_approval' then '5. Manager Approvals'
         when ci.current_stage = 'pricing_markup' then '6. Pricing & Markup'
         else 'UNEXPECTED: ' || ci.current_stage end as page,
       count(*) as items,
       string_agg(ci.item_code, ', ' order by ci.item_code) as item_ids
from demo_items d join public.consignment_items ci on ci.id = d.item_id
group by 1 order by 1;

commit;
