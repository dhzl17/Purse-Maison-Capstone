-- 1. Helpers: is the current user active staff, and do they hold one of these roles?
create function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

create function public.has_role(allowed public.user_role[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role = any(allowed)
  );
$$;

-- 2. Four private buckets, each with a size limit and allowed file types
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('intake-photos',  'intake-photos',  false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('listing-photos', 'listing-photos', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('consignor-ids',  'consignor-ids',  false,  5242880, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('certificates',   'certificates',   false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf']);

-- 3. Viewing files
create policy "Staff can view item files"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('intake-photos','listing-photos','certificates')
    and public.is_staff()
  );

create policy "Only intake and management can view consignor IDs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'consignor-ids'
    and public.has_role(array['consignment_team','manager','super_admin']::public.user_role[])
  );

-- 4. Intake photos: consignment team, filed under the item's id
create policy "Consignment team can upload intake photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'intake-photos'
    and public.has_role(array['consignment_team','super_admin']::public.user_role[])
    and exists (select 1 from public.consignment_items
                where id::text = (storage.foldername(name))[1])
  );

create policy "Consignment team can replace intake photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'intake-photos'
    and public.has_role(array['consignment_team','super_admin']::public.user_role[])
  )
  with check (
    bucket_id = 'intake-photos'
    and exists (select 1 from public.consignment_items
                where id::text = (storage.foldername(name))[1])
  );

-- 5. Listing photos: photographers upload, designers upload edited versions
create policy "Photo and design teams can upload listing photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and public.has_role(array['photographer','designer','super_admin']::public.user_role[])
    and exists (select 1 from public.consignment_items
                where id::text = (storage.foldername(name))[1])
  );

create policy "Photo and design teams can replace listing photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'listing-photos'
    and public.has_role(array['photographer','designer','super_admin']::public.user_role[])
  )
  with check (
    bucket_id = 'listing-photos'
    and exists (select 1 from public.consignment_items
                where id::text = (storage.foldername(name))[1])
  );

-- 6. Consignor IDs: consignment team, filed under the consignor's id
create policy "Consignment team can upload consignor IDs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'consignor-ids'
    and public.has_role(array['consignment_team','super_admin']::public.user_role[])
    and exists (select 1 from public.consignors
                where id::text = (storage.foldername(name))[1])
  );

create policy "Consignment team can replace consignor IDs"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'consignor-ids'
    and public.has_role(array['consignment_team','super_admin']::public.user_role[])
  )
  with check (
    bucket_id = 'consignor-ids'
    and exists (select 1 from public.consignors
                where id::text = (storage.foldername(name))[1])
  );

-- 7. Authentication certificates: same roles that can update authentication records
create policy "Authentication roles can upload certificates"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'certificates'
    and public.has_role(array['authenticator','consignment_team','super_admin']::public.user_role[])
    and exists (select 1 from public.consignment_items
                where id::text = (storage.foldername(name))[1])
  );

create policy "Authentication roles can replace certificates"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'certificates'
    and public.has_role(array['authenticator','consignment_team','super_admin']::public.user_role[])
  )
  with check (
    bucket_id = 'certificates'
    and exists (select 1 from public.consignment_items
                where id::text = (storage.foldername(name))[1])
  );

-- 8. Deleting files: owner only, so records never point to a missing file
create policy "Only the owner can delete files"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('intake-photos','listing-photos','consignor-ids','certificates')
    and public.has_role(array['super_admin']::public.user_role[])
  );