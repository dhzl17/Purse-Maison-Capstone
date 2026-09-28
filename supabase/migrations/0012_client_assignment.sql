-- 1. Fixes a gap from Module 1: staff couldn't see each other's names, so an assignment screen couldn't show who was assigned
create policy "Staff can view the staff directory"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- 2. Inquiries (walk-in and online)
create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_phone text,
  client_email text,
  client_role text not null check (client_role in ('buyer','consignor')),
  is_vip boolean not null default false,
  inquiry_channel text not null check (inquiry_channel in
    ('facebook','instagram','tiktok','messenger','whatsapp','website','walk_in','phone','email')),
  consignor_id uuid references public.consignors(id),
  item_id uuid references public.consignment_items(id),
  inquiry_status text not null default 'pending' check (inquiry_status in ('pending','assigned','resolved')),
  transaction_result text not null default 'none' check (transaction_result in ('none','purchased','no_purchase')),
  assigned_associate_id uuid references public.profiles(id),
  assigned_at timestamptz,
  resolved_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.inquiries enable row level security;

create policy "Staff can view inquiries"
  on public.inquiries for select
  using (auth.role() = 'authenticated');

create policy "Front-line roles can record inquiries"
  on public.inquiries for insert
  with check (
    exists (select 1 from public.profiles
            where id = auth.uid()
              and role in ('consignment_team','sales_associate','manager','super_admin'))
  );

create policy "Front-line roles can update inquiries"
  on public.inquiries for update
  using (
    exists (select 1 from public.profiles
            where id = auth.uid()
              and role in ('consignment_team','sales_associate','manager','super_admin'))
  );

-- 3. Consignment assignments: which associate handles which item
create table public.consignment_assignments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.consignment_items(id) on delete cascade,
  associate_id uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','in_progress','completed')),
  assigned_by uuid references public.profiles(id) default auth.uid(),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.consignment_assignments enable row level security;

create policy "Staff can view consignment assignments"
  on public.consignment_assignments for select
  using (auth.role() = 'authenticated');

create policy "Managers and consignment team can assign items"
  on public.consignment_assignments for insert
  with check (
    exists (select 1 from public.profiles
            where id = auth.uid()
              and role in ('consignment_team','manager','super_admin'))
  );

create policy "Assigned roles can update consignment assignments"
  on public.consignment_assignments for update
  using (
    exists (select 1 from public.profiles
            where id = auth.uid()
              and role in ('consignment_team','sales_associate','manager','super_admin'))
  );

-- 4. The "Recent Assignment Activity" feed
create table public.assignment_activity (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.assignment_activity enable row level security;

create policy "Staff can view assignment activity"
  on public.assignment_activity for select
  using (auth.role() = 'authenticated');

-- 5. Pick the least busy active sales associate (open inquiries + open consignments; ties go to whoever was assigned longest ago)
create function public.assign_least_busy_associate()
returns uuid
language sql
security definer
as $$
  select p.id
  from public.profiles p
  where p.role = 'sales_associate' and p.is_active
  order by
    (select count(*) from public.inquiries i
       where i.assigned_associate_id = p.id and i.inquiry_status = 'assigned')
    + (select count(*) from public.consignment_assignments c
       where c.associate_id = p.id and c.status in ('pending','in_progress')),
    (select max(i.assigned_at) from public.inquiries i where i.assigned_associate_id = p.id) nulls first,
    p.created_at
  limit 1;
$$;

-- 6. New inquiry: auto-assign if nobody was chosen
create function public.prepare_inquiry()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_associate_id is null then
    new.assigned_associate_id := public.assign_least_busy_associate();
  end if;

  if new.assigned_associate_id is not null then
    new.inquiry_status := 'assigned';
    new.assigned_at := now();
  else
    new.inquiry_status := 'pending';
  end if;
  return new;
end;
$$;

create trigger prepare_inquiry_trigger
  before insert on public.inquiries
  for each row execute function public.prepare_inquiry();

-- 7. Inquiry updates: manual assignment, resolving, and no reopening
create function public.guard_inquiry_updates()
returns trigger
language plpgsql
as $$
begin
  if new.assigned_associate_id is not null
     and new.assigned_associate_id is distinct from old.assigned_associate_id then
    new.assigned_at := now();
    if new.inquiry_status = 'pending' then
      new.inquiry_status := 'assigned';
    end if;
  end if;

  if old.inquiry_status = 'resolved' and new.inquiry_status <> 'resolved' then
    raise exception 'A resolved inquiry cannot be reopened';
  end if;

  if new.inquiry_status = 'resolved' and old.inquiry_status <> 'resolved' then
    if new.assigned_associate_id is null then
      raise exception 'Cannot resolve an inquiry that has not been assigned to an associate';
    end if;
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

create trigger guard_inquiry_updates_trigger
  before update on public.inquiries
  for each row execute function public.guard_inquiry_updates();

-- 8. Consignment assignment: auto-assign if nobody was chosen, and stamp completion time
create function public.prepare_consignment_assignment()
returns trigger
language plpgsql
as $$
begin
  if new.associate_id is null then
    new.associate_id := public.assign_least_busy_associate();
  end if;
  if new.associate_id is null then
    raise exception 'No active sales associate is available to assign';
  end if;
  return new;
end;
$$;

create trigger prepare_consignment_assignment_trigger
  before insert on public.consignment_assignments
  for each row execute function public.prepare_consignment_assignment();

create function public.touch_consignment_assignment()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

create trigger touch_consignment_assignment_trigger
  before update on public.consignment_assignments
  for each row execute function public.touch_consignment_assignment();

-- 9. Write the activity feed automatically
create function public.log_inquiry_activity()
returns trigger
language plpgsql
security definer
as $$
declare
  associate_name text;
begin
  select coalesce(nullif(full_name, ''), '(unnamed)') into associate_name
  from public.profiles where id = new.assigned_associate_id;

  if tg_op = 'INSERT' then
    if new.assigned_associate_id is not null then
      insert into public.assignment_activity (description, actor_id)
      values ('Client "' || new.client_name || '" assigned to Associate "' || associate_name || '"', auth.uid());
    end if;
  else
    if new.assigned_associate_id is distinct from old.assigned_associate_id
       and new.assigned_associate_id is not null then
      insert into public.assignment_activity (description, actor_id)
      values ('Client "' || new.client_name || '" assigned to Associate "' || associate_name || '"', auth.uid());
    elsif new.inquiry_status = 'resolved' and old.inquiry_status <> 'resolved' then
      insert into public.assignment_activity (description, actor_id)
      values ('Inquiry from "' || new.client_name || '" marked resolved', auth.uid());
    end if;
  end if;
  return new;
end;
$$;

create trigger log_inquiry_activity_trigger
  after insert or update on public.inquiries
  for each row execute function public.log_inquiry_activity();

create function public.log_consignment_assignment_activity()
returns trigger
language plpgsql
security definer
as $$
declare
  associate_name text;
  code text;
begin
  select coalesce(nullif(full_name, ''), '(unnamed)') into associate_name
  from public.profiles where id = new.associate_id;
  select item_code into code from public.consignment_items where id = new.item_id;

  insert into public.assignment_activity (description, actor_id)
  values ('Consignment "' || code || '" assigned to Associate "' || associate_name || '"', auth.uid());
  return new;
end;
$$;

create trigger log_consignment_assignment_activity_trigger
  after insert on public.consignment_assignments
  for each row execute function public.log_consignment_assignment_activity();

-- 10. Live views for the assignment screens
create view public.associate_workload
with (security_invoker = true)
as
select
  p.id as associate_id,
  p.full_name,
  w.open_inquiries,
  w.open_consignments,
  case when w.open_inquiries + w.open_consignments = 0 then 'available' else 'assigned' end as status
from public.profiles p
cross join lateral (
  select
    (select count(*) from public.inquiries i
       where i.assigned_associate_id = p.id and i.inquiry_status = 'assigned') as open_inquiries,
    (select count(*) from public.consignment_assignments c
       where c.associate_id = p.id and c.status in ('pending','in_progress')) as open_consignments
) w
where p.role = 'sales_associate' and p.is_active;

create view public.consignor_overview
with (security_invoker = true)
as
select
  c.id,
  c.full_name,
  c.phone,
  c.email,
  count(ci.id) filter (
    where ci.current_stage not in ('closed_fake','closed_rejected','sold','archived')
  ) as active_consignments,
  coalesce(sum(ci.price) filter (
    where ci.current_stage not in ('closed_fake','closed_rejected','sold','archived')
  ), 0) as active_value
from public.consignors c
left join public.consignment_items ci on ci.consignor_id = c.id
group by c.id;