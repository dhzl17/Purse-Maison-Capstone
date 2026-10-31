-- 0027: Uploaded e-signatures (replaces the drawn signature pad on Intake & Agreements)
-- Old drawn signatures stay readable: signature_data is kept for them, new rows use signature_path.

-- 1. Private bucket for signature images: PNG or JPG, up to 2 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 2097152, array['image/png', 'image/jpeg']);

-- 2. Signature files are filed as <consignor id>/<item id>/signature-<time>.<ext>
create policy "Intake and management can view signatures"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'signatures'
    and public.has_role(array['consignment_team','manager','super_admin']::public.user_role[])
  );

create policy "Consignment team can upload signatures"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'signatures'
    and public.has_role(array['consignment_team','super_admin']::public.user_role[])
    and exists (select 1 from public.consignment_items
                where id::text = (storage.foldername(name))[2]
                  and consignor_id::text = (storage.foldername(name))[1])
  );

-- No update policy on purpose: a new signature is a new file, so a saved one can't be overwritten.
create policy "Only the owner can delete signatures"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'signatures'
    and public.has_role(array['super_admin']::public.user_role[])
  );

-- 3. Agreements now record the uploaded file, the item it was signed for, how it was signed, and by whom
alter table public.consignment_agreements
  add column item_id uuid references public.consignment_items(id),
  add column signature_path text,
  add column signature_method text not null default 'drawn'
    check (signature_method in ('drawn', 'uploaded')),
  add column recorded_by uuid references public.profiles(id) default auth.uid();

alter table public.consignment_agreements alter column signature_data drop not null;

alter table public.consignment_agreements add constraint agreement_has_signature
  check (signature_data is not null or signature_path is not null);

-- 4. An uploaded signature must be for an item of the same consignor, and filed in that item's folder
create function public.check_agreement_signature()
returns trigger
language plpgsql
as $$
begin
  if new.signature_path is not null then
    if new.item_id is null then
      raise exception 'An uploaded signature must be linked to an item';
    end if;
    if not exists (select 1 from public.consignment_items
                   where id = new.item_id and consignor_id = new.consignor_id) then
      raise exception 'This signature does not belong to the item''s consignor';
    end if;
    if new.signature_path not like new.consignor_id::text || '/' || new.item_id::text || '/%' then
      raise exception 'The signature file is not filed under this consignor and item';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_agreement_signature
  before insert or update on public.consignment_agreements
  for each row execute function public.check_agreement_signature();

-- 5. An item can only be linked to an agreement signed by its own consignor (and for that item)
create function public.check_item_agreement()
returns trigger
language plpgsql
as $$
declare
  a_consignor uuid;
  a_item uuid;
begin
  if new.agreement_id is not null and new.agreement_id is distinct from old.agreement_id then
    select consignor_id, item_id into a_consignor, a_item
    from public.consignment_agreements where id = new.agreement_id;

    if a_consignor is distinct from new.consignor_id
       or (a_item is not null and a_item <> new.id) then
      raise exception 'This agreement belongs to another consignor or item (item %)', new.item_code;
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_item_agreement
  before update of agreement_id on public.consignment_items
  for each row execute function public.check_item_agreement();