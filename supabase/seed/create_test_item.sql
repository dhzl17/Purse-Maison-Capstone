do $$
declare
  v_brand text := 'Seed Brand';
  v_price numeric := 75000;
  v_consignor uuid;
  v_agreement uuid;
  v_item uuid;
begin
  insert into public.consignors (full_name, phone, id_verified)
  values ('Seed Consignor', '0917-000-0000', true)
  returning id into v_consignor;

  insert into public.consignment_agreements (consignor_id, signature_data)
  values (v_consignor, 'seed-signature')
  returning id into v_agreement;

  insert into public.consignment_items (
    consignor_id, brand, model, color, category, serial_number,
    accessories_included, condition_notes, price, agreement_id,
    price_approved, payout_confirmed
  )
  values (
    v_consignor, v_brand, 'Seed Model', 'Black', 'handbag',
    'SEED-' || substr(gen_random_uuid()::text, 1, 8),
    'Dust bag', 'Excellent condition', v_price, v_agreement,
    true, true
  )
  returning id into v_item;

  insert into public.item_photos (item_id, photo_type, storage_path)
  select v_item, t.kind::public.photo_type, 'seed/' || t.kind || '.jpg'
  from unnest(array['front','back','side_left','side_right','underside','inside',
                    'serial_number','date_code','hardware','accessories']) as t(kind);

  update public.consignment_items set current_stage = 'arrivals_receiving' where id = v_item;

  insert into public.authentication_records (item_id, provider, category)
  values (v_item, 'entrupy', 'standard');

  update public.authentication_records set payment_status = 'confirmed' where item_id = v_item;

  update public.consignment_items set current_stage = 'authentication_service' where id = v_item;

  update public.authentication_records
    set primary_result = 'authentic', secondary_result = 'authentic'
    where item_id = v_item;

  insert into public.listing_photos (item_id, photo_type, storage_path, is_primary)
  select v_item, t.kind::public.photo_type, 'seed/listing_' || t.kind || '.jpg', (t.kind = 'front')
  from unnest(array['front','back','side_left','side_right','inside',
                    'hardware','serial_number','accessories']) as t(kind);

  update public.consignment_items set current_stage = 'photo_editing_approval' where id = v_item;

  update public.consignment_items
    set photos_approved = true, current_stage = 'manager_approval'
    where id = v_item;

  insert into public.manager_reviews (item_id, decision) values (v_item, 'approved');

  update public.consignment_items set current_stage = 'listing_creation' where id = v_item;

  update public.listings
    set description = 'Seed listing', sales_channels = array['website']
    where item_id = v_item;

  update public.consignment_items set current_stage = 'publish_item' where id = v_item;
end;
$$;