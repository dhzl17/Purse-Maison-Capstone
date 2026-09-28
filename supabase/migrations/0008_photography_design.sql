-- 1. Track who's assigned to photograph each item
alter table public.consignment_items
  add column assigned_photographer_id uuid references public.profiles(id);

-- 2. Listing-quality photos — separate from Module 4's intake photos
create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.consignment_items(id) on delete cascade,
  photo_type public.photo_type not null,
  storage_path text not null,
  is_primary boolean not null default false,
  edited boolean not null default false,
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

alter table public.listing_photos enable row level security;

create policy "Staff can view listing photos"
  on public.listing_photos for select
  using (auth.role() = 'authenticated');

create policy "Photographers and admins can upload listing photos"
  on public.listing_photos for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('photographer','super_admin'))
  );

create policy "Designers and admins can edit listing photos"
  on public.listing_photos for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('designer','super_admin'))
  );

-- 3. Design sign-off flag on the item itself
alter table public.consignment_items
  add column photos_approved boolean not null default false;

-- 4. Hard block: can't move to photo editing without the full listing photo set
create function public.check_photography_requirements()
returns trigger
language plpgsql
as $$
declare
  required_count int := 8;
  uploaded_count int;
begin
  if new.current_stage = 'photo_editing_approval' then
    select count(distinct photo_type) into uploaded_count
    from public.listing_photos
    where item_id = new.id
      and photo_type in ('front','back','side_left','side_right','inside','hardware','serial_number','accessories');

    if uploaded_count < required_count then
      raise exception 'Cannot move item % to photo editing: only %/% required listing photos uploaded', new.item_code, uploaded_count, required_count;
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_photography_requirements
  before update on public.consignment_items
  for each row execute function public.check_photography_requirements();

-- 5. Hard block: can't move to manager approval without design sign-off and a chosen cover photo
create function public.check_design_requirements()
returns trigger
language plpgsql
as $$
declare
  primary_count int;
begin
  if new.current_stage = 'manager_approval' then
    if not new.photos_approved then
      raise exception 'Cannot move item % to manager approval: photos have not been approved by design', new.item_code;
    end if;

    select count(*) into primary_count
    from public.listing_photos
    where item_id = new.id and is_primary = true;

    if primary_count <> 1 then
      raise exception 'Cannot move item % to manager approval: exactly one primary listing photo must be selected (found %)', new.item_code, primary_count;
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_design_requirements
  before update on public.consignment_items
  for each row execute function public.check_design_requirements();

-- 6. Widen the update policy again — Photographer and Designer now have real work here too
drop policy "Authorized roles can update items" on public.consignment_items;

create policy "Authorized roles can update items"
  on public.consignment_items for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and role in ('consignment_team', 'pricing_team', 'manager', 'photographer', 'designer', 'super_admin')
    )
  );