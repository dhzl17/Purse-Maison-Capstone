-- 0028: Daily totals for the Dashboard's date-range filter
-- Same sources and rules as monthly_brand_sales (0015) and customer_interaction_monthly (0025),
-- grouped per day instead of per month so the Dashboard can total any range of dates.
-- Read-only views: no tables or data change, and the monthly views (used by forecasting) stay as they are.

-- 1. One row per day per brand: imported history + verified sales recorded in the system
create view public.daily_brand_sales
with (security_invoker = true)
as
with all_sales as (
  select sale_date as sale_day, trim(brand) as brand, quantity, revenue
  from public.historical_sales
  union all
  select (st.sold_at at time zone 'Asia/Manila')::date, trim(ci.brand), 1, coalesce(st.sale_price, 0)
  from public.sales_transactions st
  join public.consignment_items ci on ci.id = st.item_id
  where st.payment_status = 'verified'
)
select
  sale_day,
  lower(brand) as brand_key,
  min(brand) as brand,
  sum(quantity)::int as units_sold,
  sum(revenue)::numeric(14,2) as revenue
from all_sales
group by 1, 2;

-- 2. One row per day of client inquiries by outcome (dates in Philippine time)
create view public.customer_interaction_daily
with (security_invoker = true)
as
select
  (created_at at time zone 'Asia/Manila')::date as day,
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