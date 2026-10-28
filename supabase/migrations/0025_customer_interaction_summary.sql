-- Module 25: Customer Interactions summary (Dashboard chart)
-- One row per month with the number of client inquiries in each outcome. It reads the existing inquiries
-- table (Client Assignment), so real inquiries recorded after launch are counted automatically.
--
--   consigned                 consignor inquiries marked "Purchased / Consigned"
--   consignor_not_proceeded   consignor inquiries resolved without consigning
--   buyer_purchased           buyer inquiries marked "Purchased / Consigned"
--   buyer_not_proceeded       buyer inquiries resolved without buying (only inquired)
--   in_progress               inquiries still pending or assigned, no result yet
-- Months follow Philippine time, by the date the inquiry was recorded.

create view public.customer_interaction_monthly
with (security_invoker = true)
as
select
  date_trunc('month', created_at at time zone 'Asia/Manila')::date as month,
  count(*) filter (where client_role = 'consignor' and transaction_result = 'purchased')::int as consigned,
  count(*) filter (where client_role = 'consignor' and transaction_result <> 'purchased'
                     and inquiry_status = 'resolved')::int as consignor_not_proceeded,
  count(*) filter (where client_role = 'buyer' and transaction_result = 'purchased')::int as buyer_purchased,
  count(*) filter (where client_role = 'buyer' and transaction_result <> 'purchased'
                     and inquiry_status = 'resolved')::int as buyer_not_proceeded,
  count(*) filter (where transaction_result <> 'purchased' and inquiry_status <> 'resolved')::int as in_progress,
  count(*)::int as total_inquiries
from public.inquiries
group by 1;
