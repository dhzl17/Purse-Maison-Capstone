-- 1. Setting for the portal link shown at the bottom of every email (fill in once the portal is live)
insert into public.app_settings (key, value) values ('portal_url', '');

-- 2. Outbox upgrades: message details, who it went to, retries, and a 'skipped' status
alter table public.notifications
  add column details jsonb not null default '{}'::jsonb,
  add column recipient_email text,
  add column attempts int not null default 0,
  add column last_error text;

alter table public.notifications drop constraint notifications_status_check;
alter table public.notifications add constraint notifications_status_check
  check (status in ('pending','sent','failed','skipped'));

alter table public.notifications add constraint notifications_type_check
  check (notification_type in ('item_received','authentication_failed','item_published',
                               'item_sold','payout_released','contract_ending','item_withdrawn'));

-- Each milestone is emailed once per item (clear any old duplicates first)
delete from public.notifications n
using public.notifications older
where n.item_id = older.item_id
  and n.notification_type = older.notification_type
  and (n.created_at, n.id) > (older.created_at, older.id);

create unique index one_notification_per_milestone
  on public.notifications (item_id, notification_type);

-- 3. One helper that every milestone uses to queue an email
create function public.queue_notification(p_item uuid, p_type text, p_details jsonb default '{}')
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (consignor_id, item_id, notification_type, details)
  select ci.consignor_id, ci.id, p_type, coalesce(p_details, '{}'::jsonb)
  from public.consignment_items ci
  where ci.id = p_item
  on conflict (item_id, notification_type) do nothing;
$$;

revoke execute on function public.queue_notification(uuid, text, jsonb) from public, anon, authenticated;

-- 4. Publishing: same as Module 10, now with the contract end date in the email
create or replace function public.apply_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.current_stage = 'publish_item' and old.current_stage is distinct from 'publish_item' then
    update public.listings
      set inventory_status = 'published', published_at = now()
      where item_id = new.id;

    perform public.queue_notification(new.id, 'item_published',
      jsonb_build_object('contract_end_date',
        (select published_at::date + contract_days from public.listings where item_id = new.id)));
  end if;
  return new;
end;
$$;

-- 5. Item received, or failed authentication
create function public.queue_stage_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.current_stage is distinct from old.current_stage then
    if new.current_stage = 'arrivals_receiving' then
      perform public.queue_notification(new.id, 'item_received');
    elsif new.current_stage = 'closed_fake' then
      perform public.queue_notification(new.id, 'authentication_failed');
    end if;
  end if;
  return new;
end;
$$;

create trigger queue_stage_notifications_trigger
  after update of current_stage on public.consignment_items
  for each row execute function public.queue_stage_notifications();

-- 6. Sold (once the payment is verified) and payout released
create function public.queue_sale_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status = 'verified' and old.payment_status <> 'verified' then
    perform public.queue_notification(new.item_id, 'item_sold',
      jsonb_build_object('payout', new.consignor_payout, 'payout_due_by', new.payout_due_by));
  end if;

  if new.payout_status = 'released' and old.payout_status <> 'released' then
    perform public.queue_notification(new.item_id, 'payout_released',
      jsonb_build_object('payout', new.consignor_payout));
  end if;
  return new;
end;
$$;

create trigger queue_sale_notifications_trigger
  after update on public.sales_transactions
  for each row execute function public.queue_sale_notifications();

-- 7. Withdrawn item released back to the consignor
create function public.queue_withdrawal_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'released' and old.status <> 'released' then
    perform public.queue_notification(new.item_id, 'item_withdrawn',
      jsonb_build_object('pull_out_fee', new.pull_out_fee));
  end if;
  return new;
end;
$$;

create trigger queue_withdrawal_notification_trigger
  after update on public.item_withdrawals
  for each row execute function public.queue_withdrawal_notification();

-- 8. Contract ending within 7 days (the sender calls this each time it runs)
create function public.queue_contract_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  queued int;
begin
  insert into public.notifications (consignor_id, item_id, notification_type, details)
  select ci.consignor_id, cs.item_id, 'contract_ending',
         jsonb_build_object('contract_end_date', cs.contract_end_date,
                            'days_remaining', cs.days_remaining)
  from public.contract_status cs
  join public.consignment_items ci on ci.id = cs.item_id
  where cs.days_remaining between 1 and 7
  on conflict (item_id, notification_type) do nothing;

  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke execute on function public.queue_contract_reminders() from public, anon, authenticated;
grant execute on function public.queue_contract_reminders() to service_role;