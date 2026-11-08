alter type public.photo_type add value if not exists 'extra';
alter table public.listing_photos add column if not exists sort_order integer;

update public.listing_photos lp
set sort_order = r.rn
from (
  select id, row_number() over (partition by item_id order by is_primary desc, uploaded_at, id) - 1 as rn
  from public.listing_photos
) r
where lp.id = r.id
  and lp.sort_order is null;

drop policy if exists "Photographers can arrange and replace listing photos" on public.listing_photos;
create policy "Photographers can arrange and replace listing photos"
  on public.listing_photos for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('photographer','super_admin'))
    and exists (select 1 from public.consignment_items ci
                where ci.id = listing_photos.item_id and ci.current_stage = 'photography')
  );

drop policy if exists "Photographers can remove listing photos" on public.listing_photos;
create policy "Photographers can remove listing photos"
  on public.listing_photos for delete
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('photographer','super_admin'))
    and exists (select 1 from public.consignment_items ci
                where ci.id = listing_photos.item_id and ci.current_stage = 'photography')
  );

create or replace function public.check_photography_requirements()
returns trigger
language plpgsql
as $$
declare
  min_photos constant int := 7;
  photo_count int;
begin
  if new.current_stage = 'photo_editing_approval' then
    select count(*) into photo_count from public.listing_photos where item_id = new.id;
    if photo_count < min_photos then
      raise exception 'Cannot move item % to photo editing: upload at least % listing photos (currently %)',
        new.item_code, min_photos, photo_count;
    end if;
  end if;
  return new;
end;
$$;

-- ============================== INTAKE PHOTOS ==============================

drop policy if exists "Consignment team can replace intake photos" on public.item_photos;
create policy "Consignment team can replace intake photos"
  on public.item_photos for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('consignment_team','super_admin'))
    and exists (select 1 from public.consignment_items ci
                where ci.id = item_photos.item_id
                  and ci.current_stage in ('customer_inquiry','lead_qualification','initial_photo_submission',
                                           'price_negotiation','consignment_approval','appointment_scheduling',
                                           'dropoff_pickup_courier'))
  );

drop policy if exists "Consignment team can remove intake photos" on public.item_photos;
create policy "Consignment team can remove intake photos"
  on public.item_photos for delete
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('consignment_team','super_admin'))
    and exists (select 1 from public.consignment_items ci
                where ci.id = item_photos.item_id
                  and ci.current_stage in ('customer_inquiry','lead_qualification','initial_photo_submission',
                                           'price_negotiation','consignment_approval','appointment_scheduling',
                                           'dropoff_pickup_courier'))
  );


create or replace function public.check_receiving_requirements()
returns trigger
language plpgsql
as $$
declare
  consignor_verified boolean;
  min_photos constant int := 10;
  photo_count int;
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

    select count(*) into photo_count from public.item_photos where item_id = new.id;
    if photo_count < min_photos then
      raise exception 'Cannot mark item % as received: at least % photos are needed (currently %)', new.item_code, min_photos, photo_count;
    end if;

  end if;
  return new;
end;
$$;

create or replace function public.check_early_stage_requirements()
returns trigger
language plpgsql
as $$
declare
  photo_count int;
begin
  if new.current_stage is not distinct from old.current_stage then
    return new;
  end if;

  if new.current_stage = 'price_negotiation' then
    select count(*) into photo_count from public.item_photos where item_id = new.id;
    if photo_count < 10 then
      raise exception 'Cannot move item % to price negotiation: at least 10 photos are needed (currently %)',
        new.item_code, photo_count;
    end if;
  end if;

  if new.current_stage = 'consignment_approval' then
    if new.asking_price is null then
      raise exception 'Cannot move item % to consignment approval: no asking price recorded', new.item_code;
    end if;
    if new.agreed_payout is null then
      raise exception 'Cannot move item % to consignment approval: no agreed payout recorded', new.item_code;
    end if;
  end if;

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