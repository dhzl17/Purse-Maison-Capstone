-- 1. Define all 18 stages, plus the terminal/closed states an item can land in
create type public.pipeline_stage as enum (
  'customer_inquiry',
  'lead_qualification',
  'initial_photo_submission',
  'price_negotiation',
  'consignment_approval',
  'appointment_scheduling',
  'dropoff_pickup_courier',
  'arrivals_receiving',
  'authentication_payment',
  'authentication_service',
  'authentication_process',
  'authentication_certificate',
  'photography',
  'photo_editing_approval',
  'manager_approval',
  'pricing_markup',
  'listing_creation',
  'publish_item',
  'closed_fake',
  'closed_rejected',
  'sold',
  'archived'
);

-- 2. Replace last module's placeholder status column with the real stage tracker
alter table public.consignment_items drop column status;

alter table public.consignment_items
  add column current_stage public.pipeline_stage not null default 'customer_inquiry';

-- 3. The audit log — a permanent record of every stage an item has ever passed through
create table public.stage_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.consignment_items(id) on delete cascade,
  from_stage public.pipeline_stage,
  to_stage public.pipeline_stage not null,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  notes text
);

alter table public.stage_history enable row level security;

create policy "Staff can view stage history"
  on public.stage_history for select
  using (auth.role() = 'authenticated');

create policy "System can insert stage history"
  on public.stage_history for insert
  with check (auth.role() = 'authenticated');

-- 4. Log the very first stage the moment an item is created
create function public.log_stage_creation()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.stage_history (item_id, from_stage, to_stage, changed_by)
  values (new.id, null, new.current_stage, auth.uid());
  return new;
end;
$$;

create trigger log_consignment_item_stage_creation
  after insert on public.consignment_items
  for each row execute function public.log_stage_creation();

-- 5. Log every stage change automatically from then on
create function public.log_stage_change()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.current_stage is distinct from old.current_stage then
    insert into public.stage_history (item_id, from_stage, to_stage, changed_by)
    values (new.id, old.current_stage, new.current_stage, auth.uid());
  end if;
  return new;
end;
$$;

create trigger log_consignment_item_stage_change
  after update on public.consignment_items
  for each row execute function public.log_stage_change();