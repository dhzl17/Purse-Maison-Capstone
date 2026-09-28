-- 1. Editable standard wording (so the client can change it without a migration)
create table public.app_settings (
  key text primary key,
  value text not null
);

insert into public.app_settings (key, value) values
  ('authenticity_footer', 'All items sold by Purse Maison are authenticated by our team. [Replace with the official authenticity guarantee wording]'),
  ('layaway_clause', 'Layaway is available for this item. [Replace with the official layaway terms]');

alter table public.app_settings enable row level security;

create policy "Staff can view app settings"
  on public.app_settings for select
  using (auth.role() = 'authenticated');

create policy "Admins can manage app settings"
  on public.app_settings for all
  using (public.is_admin())
  with check (public.is_admin());

-- 2. Listings — one per item
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.consignment_items(id) on delete cascade,
  title text,
  description text,
  specifications text,
  seo_title text,
  seo_description text,
  authenticity_footer text,
  layaway_clause text,
  sales_channels text[] not null default '{}'
    check (sales_channels <@ array['website','live_selling','social_media']::text[]),
  inventory_status text not null default 'draft'
    check (inventory_status in ('draft','published','reserved','sold','archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.listings enable row level security;

create policy "Staff can view listings"
  on public.listings for select
  using (auth.role() = 'authenticated');

create policy "Designers and admins can create listings"
  on public.listings for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('designer','super_admin'))
  );

create policy "Listing and sales roles can update listings"
  on public.listings for update
  using (
    exists (select 1 from public.profiles
            where id = auth.uid()
              and role in ('designer','manager','sales_associate','super_admin'))
  );

create trigger set_listings_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

-- 3. Outbox of messages waiting to be sent to consignors (a later module does the actual sending)
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  consignor_id uuid not null references public.consignors(id),
  item_id uuid not null references public.consignment_items(id) on delete cascade,
  notification_type text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.notifications enable row level security;

create policy "Staff can view notifications"
  on public.notifications for select
  using (auth.role() = 'authenticated');

-- 4. Auto-build the draft the moment an item reaches Listing Creation
create function public.create_listing_draft()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.current_stage = 'listing_creation' and old.current_stage is distinct from 'listing_creation' then
    insert into public.listings (
      item_id, title, description, specifications,
      seo_title, seo_description, authenticity_footer, layaway_clause
    )
    values (
      new.id,
      trim(concat_ws(' ', new.brand, new.model, new.color)),
      new.condition_notes,
      concat_ws(E'\n',
        'Brand: ' || new.brand,
        'Model: ' || new.model,
        'Color: ' || new.color,
        'Category: ' || new.category,
        'Hardware: ' || new.hardware,
        'Accessories included: ' || new.accessories_included
      ),
      trim(concat_ws(' ', new.brand, new.model, new.color)) || ' | Authenticated Pre-Owned | Purse Maison',
      'Authenticated pre-owned ' || trim(concat_ws(' ', new.brand, new.model, new.color)) || ' available at Purse Maison.',
      (select value from public.app_settings where key = 'authenticity_footer'),
      case when new.price >= 200000
           then (select value from public.app_settings where key = 'layaway_clause')
           else null end
    )
    on conflict (item_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger create_listing_draft_trigger
  after update on public.consignment_items
  for each row execute function public.create_listing_draft();

-- 5. Hard block: can't publish without a title, description, and at least one sales channel
create function public.check_publish_requirements()
returns trigger
language plpgsql
as $$
declare
  l public.listings%rowtype;
begin
  if new.current_stage = 'publish_item' and old.current_stage is distinct from 'publish_item' then
    select * into l from public.listings where item_id = new.id;

    if l.id is null then
      raise exception 'Cannot publish item %: no listing has been created', new.item_code;
    end if;
    if l.title is null or trim(l.title) = '' then
      raise exception 'Cannot publish item %: listing has no title', new.item_code;
    end if;
    if l.description is null or trim(l.description) = '' then
      raise exception 'Cannot publish item %: listing has no description', new.item_code;
    end if;
    if coalesce(cardinality(l.sales_channels), 0) = 0 then
      raise exception 'Cannot publish item %: no sales channel selected', new.item_code;
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_publish_requirements
  before update on public.consignment_items
  for each row execute function public.check_publish_requirements();

-- 6. Publishing makes the listing live and queues the consignor notification
create function public.apply_publish()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.current_stage = 'publish_item' and old.current_stage is distinct from 'publish_item' then
    update public.listings
      set inventory_status = 'published', published_at = now()
      where item_id = new.id;

    insert into public.notifications (consignor_id, item_id, notification_type)
    values (new.consignor_id, new.id, 'item_published');
  end if;
  return new;
end;
$$;

create trigger apply_publish_trigger
  after update on public.consignment_items
  for each row execute function public.apply_publish();

-- 7. Guard the listing status: Sold and Archived are final, and nothing goes live before publishing
create function public.guard_listing_status()
returns trigger
language plpgsql
as $$
declare
  stage_now public.pipeline_stage;
begin
  if new.inventory_status is distinct from old.inventory_status then
    if old.inventory_status in ('sold','archived') then
      raise exception 'A % listing cannot be changed again', old.inventory_status;
    end if;

    select current_stage into stage_now
    from public.consignment_items where id = new.item_id;

    if new.inventory_status in ('published','reserved','sold') and stage_now <> 'publish_item' then
      raise exception 'Listing cannot go live before the item reaches the publish stage (item is in %)', stage_now;
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_listing_status_trigger
  before update on public.listings
  for each row execute function public.guard_listing_status();

-- 8. Marking a listing Sold or Archived moves the item to the matching final stage
create function public.propagate_listing_status()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.inventory_status is distinct from old.inventory_status then
    if new.inventory_status = 'sold' then
      update public.consignment_items set current_stage = 'sold' where id = new.item_id;
    elsif new.inventory_status = 'archived' then
      update public.consignment_items set current_stage = 'archived' where id = new.item_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger propagate_listing_status_trigger
  after update on public.listings
  for each row execute function public.propagate_listing_status();