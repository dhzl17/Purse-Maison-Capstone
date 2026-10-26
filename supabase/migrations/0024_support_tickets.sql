-- Module 24: Support tickets (Help Center → Submit a Ticket)
--   Any active staff member can submit a ticket and see their own tickets.
--   The manager and the owner see every ticket, change its status and write a response.
--   Tickets cannot be deleted, and the original report (subject, description, etc.) cannot be edited.

create type public.ticket_category as enum ('bug', 'access', 'data', 'how_to', 'other');
create type public.ticket_status as enum ('open', 'in_progress', 'resolved');

create table public.support_tickets (
  id bigint generated always as identity primary key,
  created_by uuid not null default auth.uid() references public.profiles(id),
  category public.ticket_category not null default 'other',
  page text check (page is null or length(page) <= 80),
  item_ref text check (item_ref is null or length(item_ref) <= 80),
  subject text not null check (length(trim(subject)) between 3 and 120),
  description text not null check (length(trim(description)) between 10 and 2000),
  status public.ticket_status not null default 'open',
  resolution_note text check (resolution_note is null or length(resolution_note) <= 1000),
  handled_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index support_tickets_created_by_idx on public.support_tickets (created_by);
create index support_tickets_status_idx on public.support_tickets (status, created_at desc);

alter table public.support_tickets enable row level security;

create policy "Staff see their own tickets; manager and owner see all"
  on public.support_tickets for select
  using (created_by = auth.uid()
         or public.has_role(array['manager', 'super_admin']::public.user_role[]));

create policy "Active staff can submit tickets"
  on public.support_tickets for insert
  with check (public.is_staff() and created_by = auth.uid());

create policy "Manager and owner can update tickets"
  on public.support_tickets for update
  using (public.has_role(array['manager', 'super_admin']::public.user_role[]))
  with check (public.has_role(array['manager', 'super_admin']::public.user_role[]));

-- No delete policy: tickets are kept as a record.

-- New tickets always start as Open and are filed under the person who submits them
create function public.prepare_support_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  new.status := 'open';
  new.resolution_note := null;
  new.handled_by := null;
  new.resolved_at := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger prepare_support_ticket_trigger
  before insert on public.support_tickets
  for each row execute function public.prepare_support_ticket();

-- Only the status and the response can change; who handled it and when are recorded automatically
create function public.guard_support_ticket_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by <> old.created_by
     or new.category <> old.category
     or new.subject <> old.subject
     or new.description <> old.description
     or new.page is distinct from old.page
     or new.item_ref is distinct from old.item_ref
     or new.created_at <> old.created_at then
    raise exception 'Only the status and response of a ticket can be changed';
  end if;
  new.handled_by := auth.uid();
  new.updated_at := now();
  new.resolved_at := case when new.status = 'resolved' then coalesce(old.resolved_at, now()) else null end;
  return new;
end;
$$;

create trigger guard_support_ticket_updates_trigger
  before update on public.support_tickets
  for each row execute function public.guard_support_ticket_updates();