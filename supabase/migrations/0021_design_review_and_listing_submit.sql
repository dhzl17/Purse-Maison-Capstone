-- Module 21: Design stage rules (client process Steps 14 and 17)
--   Step 14: editing checklist, one cover photo, approval auto-advances to Manager Approval,
--            "needs revision" goes back to Photography with the reason attached.
--   Step 17: the designer submits the finished listing; only submitted listings can be published.

-- 1. Editing checklist and revision note on the item
alter table public.consignment_items
  add column photo_edit_checklist text[] not null default '{}'
    check (photo_edit_checklist <@ array['background_removal','color_correction','cropping',
                                         'watermark','quality_check']::text[]),
  add column photo_revision_note text;

-- 2. At most one cover (primary) photo per item
create unique index one_primary_listing_photo
  on public.listing_photos (item_id) where is_primary;

-- 3. Approval, revision and resubmission rules
create function public.apply_photo_review()
returns trigger
language plpgsql
as $$
declare
  required constant text[] := array['background_removal','color_correction','cropping','watermark','quality_check'];
  missing text[];
  primary_count int;
begin
  -- Approving the photos: full checklist + exactly one cover photo, then straight to the manager
  if new.photos_approved and not old.photos_approved then
    if new.current_stage <> 'photo_editing_approval' then
      raise exception 'Photos for item % can only be approved during photo editing (currently in %)',
        new.item_code, new.current_stage;
    end if;

    select array_agg(r) into missing from unnest(required) as r
    where not (r = any(new.photo_edit_checklist));
    if missing is not null then
      raise exception 'Cannot approve photos for item %: editing checklist incomplete (%)',
        new.item_code, replace(array_to_string(missing, ', '), '_', ' ');
    end if;

    select count(*) into primary_count from public.listing_photos where item_id = new.id and is_primary;
    if primary_count <> 1 then
      raise exception 'Cannot approve photos for item %: choose one cover photo', new.item_code;
    end if;

    new.current_stage := 'manager_approval';
  end if;

  -- Sending back to the photographer needs a reason, and resets the review
  if new.current_stage = 'photography' and old.current_stage = 'photo_editing_approval' then
    if new.photo_revision_note is null or trim(new.photo_revision_note) = '' then
      raise exception 'Cannot return item % to photography: give the reason for the revision', new.item_code;
    end if;
    new.photos_approved := false;
    new.photo_edit_checklist := '{}';
  end if;

  -- Photographer resubmits: the old note is cleared
  if new.current_stage = 'photo_editing_approval' and old.current_stage = 'photography' then
    new.photo_revision_note := null;
  end if;
  return new;
end;
$$;

-- Named to run before enforce_design_requirements, which re-checks the move to manager approval
create trigger apply_photo_review_trigger
  before update on public.consignment_items
  for each row execute function public.apply_photo_review();

-- 4. Listing hand-off from the designer to the manager
alter table public.listings
  add column submitted_at timestamptz,
  add column submitted_by uuid references public.profiles(id);

create function public.check_listing_submitted()
returns trigger
language plpgsql
as $$
declare
  sent timestamptz;
begin
  if new.current_stage = 'publish_item' and old.current_stage is distinct from 'publish_item' then
    select submitted_at into sent from public.listings where item_id = new.id;
    if sent is null then
      raise exception 'Cannot publish item %: the designer has not submitted the listing yet', new.item_code;
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_listing_submitted
  before update on public.consignment_items
  for each row execute function public.check_listing_submitted();

-- Submitting stamps who and when; any later edit to the text withdraws the submission
create function public.track_listing_submission()
returns trigger
language plpgsql
as $$
begin
  if new.submitted_at is not null and old.submitted_at is null then
    new.submitted_at := now();
    new.submitted_by := auth.uid();
  elsif old.submitted_at is not null and new.inventory_status = 'draft' and (
        new.title is distinct from old.title or new.description is distinct from old.description
        or new.specifications is distinct from old.specifications or new.seo_title is distinct from old.seo_title
        or new.seo_description is distinct from old.seo_description
        or new.sales_channels is distinct from old.sales_channels) then
    new.submitted_at := null;
    new.submitted_by := null;
  end if;
  return new;
end;
$$;

create trigger track_listing_submission_trigger
  before update on public.listings
  for each row execute function public.track_listing_submission();