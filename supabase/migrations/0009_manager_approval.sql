-- 1. A permanent record of every manager decision
create table public.manager_reviews (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.consignment_items(id) on delete cascade,
  reviewer_id uuid references public.profiles(id) default auth.uid(),
  decision text not null check (decision in ('approved','rejected','returned_for_revision')),
  return_reason text check (return_reason in ('photos','item_details')),
  notes text,
  reviewed_at timestamptz not null default now(),
  constraint return_needs_reason
    check (decision <> 'returned_for_revision' or return_reason is not null)
);

alter table public.manager_reviews enable row level security;

create policy "Staff can view manager reviews"
  on public.manager_reviews for select
  using (auth.role() = 'authenticated');

create policy "Managers and admins can record decisions"
  on public.manager_reviews for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('manager','super_admin')
    )
  );

-- 2. Recording a decision automatically moves the item to the right place
create function public.apply_manager_decision()
returns trigger
language plpgsql
security definer
as $$
declare
  stage_now public.pipeline_stage;
begin
  select current_stage into stage_now
  from public.consignment_items where id = new.item_id;

  if stage_now <> 'manager_approval' then
    raise exception 'Cannot record a manager decision: item is not awaiting manager approval (currently in %)', stage_now;
  end if;

  if new.decision = 'approved' then
    update public.consignment_items
      set current_stage = 'pricing_markup'
      where id = new.item_id;

  elsif new.decision = 'rejected' then
    update public.consignment_items
      set current_stage = 'closed_rejected'
      where id = new.item_id;

  elsif new.decision = 'returned_for_revision' then
    if new.return_reason = 'photos' then
      update public.consignment_items
        set current_stage = 'photo_editing_approval', photos_approved = false
        where id = new.item_id;
    else
      update public.consignment_items
        set current_stage = 'arrivals_receiving'
        where id = new.item_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger apply_manager_decision_trigger
  after insert on public.manager_reviews
  for each row execute function public.apply_manager_decision();