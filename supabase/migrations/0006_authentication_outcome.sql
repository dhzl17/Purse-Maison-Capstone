-- 1. New fields for the SLA clock, certificate, and double authentication
alter table public.authentication_records
  add column service_started_at timestamptz,
  add column sla_deadline timestamptz,
  add column certificate_url text,
  add column certificate_uploaded_at timestamptz,
  add column primary_result text check (primary_result in ('authentic','fake')),
  add column secondary_result text check (secondary_result in ('authentic','fake')),
  add column final_result text check (final_result in ('authentic','fake'));

-- 2. The moment payment is confirmed, start the 24-hour SLA clock automatically
create function public.start_authentication_clock()
returns trigger
language plpgsql
as $$
begin
  if new.payment_status = 'confirmed' and old.payment_status is distinct from 'confirmed' then
    new.service_started_at := now();
    new.sla_deadline := now() + interval '24 hours';
  end if;
  return new;
end;
$$;

create trigger start_authentication_clock_trigger
  before update on public.authentication_records
  for each row execute function public.start_authentication_clock();

-- 3. If both authenticators agree, auto-set the final result — no manual step needed
create function public.reconcile_authentication_result()
returns trigger
language plpgsql
as $$
begin
  if new.primary_result is not null
     and new.secondary_result is not null
     and new.primary_result = new.secondary_result
     and new.final_result is null then
    new.final_result := new.primary_result;
  end if;
  return new;
end;
$$;

create trigger reconcile_authentication_result_trigger
  before update on public.authentication_records
  for each row execute function public.reconcile_authentication_result();

-- 4. Once a final result exists, automatically move the item to the right next stage
create function public.apply_authentication_outcome()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.final_result is distinct from old.final_result and new.final_result is not null then
    if new.final_result = 'authentic' then
      update public.consignment_items set current_stage = 'photography' where id = new.item_id;
    elsif new.final_result = 'fake' then
      update public.consignment_items set current_stage = 'closed_fake' where id = new.item_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger apply_authentication_outcome_trigger
  after update on public.authentication_records
  for each row execute function public.apply_authentication_outcome();

-- 5. A live view showing which items are at risk of missing their SLA
create view public.authentication_sla_status
with (security_invoker = true)
as
select
  ar.id as authentication_id,
  ar.item_id,
  ci.item_code,
  ar.service_started_at,
  ar.sla_deadline,
  ar.final_result,
  case
    when ar.final_result is not null then 'completed'
    when ar.sla_deadline is null then 'not_started'
    when now() > ar.sla_deadline then 'breached'
    when now() > ar.sla_deadline - interval '2 hours' then 'at_risk'
    else 'on_track'
  end as sla_status
from public.authentication_records ar
join public.consignment_items ci on ci.id = ar.item_id;