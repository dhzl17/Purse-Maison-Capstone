-- demo_stage_items_refresh.sql  —  run on the morning of the demo (optional)
-- Keeps the demo items looking current if some days have passed since demo_stage_items.sql was run:
--   * Intake items: arrival appointments move to the next few days again
--   * Authentication items: the 24-hour authentication clock restarts, so they don't show as overdue
-- Only items still waiting at those two stages are changed.

begin;

update public.consignment_items ci
set appointment_at = (date_trunc('day', now() at time zone 'Asia/Manila') + make_interval(days => 1 + (row_number_mod % 3), hours => 10 + row_number_mod))
                     at time zone 'Asia/Manila'   -- 10 AM to 2 PM, Philippine time
from (select ci2.id, (row_number() over (order by ci2.item_code))::int % 5 as row_number_mod
      from public.consignment_items ci2
      where ci2.current_stage = 'dropoff_pickup_courier'
        and exists (select 1 from public.item_photos p where p.item_id = ci2.id and p.storage_path like 'demo-placeholders/%')) d
where ci.id = d.id;

update public.authentication_records r
set service_started_at = now() - interval '2 hours',
    payment_confirmed_at = now() - interval '2 hours',
    sla_deadline = now() + interval '22 hours'
from public.consignment_items ci
where ci.id = r.item_id
  and ci.current_stage = 'authentication_service'
  and exists (select 1 from public.item_photos p where p.item_id = ci.id and p.storage_path like 'demo-placeholders/%');

commit;
