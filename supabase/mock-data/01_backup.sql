-- 01_backup.sql  —  Purse Maison mock-data import, step 1 of 3
-- Copies every table the wipe will clear into a separate schema called mock_backup_20261015.
-- Nothing in your real tables changes. It refuses to run if a backup already exists, so it can never
-- overwrite your original data with the mock data by accident.
-- To undo the whole import later, see the RESTORE notes at the bottom of 02_wipe.sql.

begin;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'mock_backup_20261015') then
    raise exception 'A backup (mock_backup_20261015) already exists, so nothing was changed. Your original data is safe in it.';
  end if;
end $$;

create schema mock_backup_20261015;
create table mock_backup_20261015.layaway_payments as table public.layaway_payments;
create table mock_backup_20261015.sales_transactions as table public.sales_transactions;
create table mock_backup_20261015.notifications as table public.notifications;
create table mock_backup_20261015.consignment_assignments as table public.consignment_assignments;
create table mock_backup_20261015.inquiries as table public.inquiries;
create table mock_backup_20261015.assignment_activity as table public.assignment_activity;
create table mock_backup_20261015.price_negotiations as table public.price_negotiations;
create table mock_backup_20261015.stage_history as table public.stage_history;
create table mock_backup_20261015.item_photos as table public.item_photos;
create table mock_backup_20261015.listing_photos as table public.listing_photos;
create table mock_backup_20261015.authentication_records as table public.authentication_records;
create table mock_backup_20261015.manager_reviews as table public.manager_reviews;
create table mock_backup_20261015.listings as table public.listings;
create table mock_backup_20261015.contract_extensions as table public.contract_extensions;
create table mock_backup_20261015.item_withdrawals as table public.item_withdrawals;
create table mock_backup_20261015.consignment_items as table public.consignment_items;
create table mock_backup_20261015.consignment_agreements as table public.consignment_agreements;
create table mock_backup_20261015.consignor_accounts as table public.consignor_accounts;
create table mock_backup_20261015.consignors as table public.consignors;
create table mock_backup_20261015.historical_sales as table public.historical_sales;
create table mock_backup_20261015.forecast_results as table public.forecast_results;
create table mock_backup_20261015.forecast_brand_models as table public.forecast_brand_models;
create table mock_backup_20261015.forecast_runs as table public.forecast_runs;

commit;

-- Row counts of the backup (compare with the live tables if you like)
select 'mock_backup_20261015' as backup_schema, *
from (values
  ('layaway_payments', (select count(*) from mock_backup_20261015.layaway_payments)),
  ('sales_transactions', (select count(*) from mock_backup_20261015.sales_transactions)),
  ('notifications', (select count(*) from mock_backup_20261015.notifications)),
  ('consignment_assignments', (select count(*) from mock_backup_20261015.consignment_assignments)),
  ('inquiries', (select count(*) from mock_backup_20261015.inquiries)),
  ('assignment_activity', (select count(*) from mock_backup_20261015.assignment_activity)),
  ('price_negotiations', (select count(*) from mock_backup_20261015.price_negotiations)),
  ('stage_history', (select count(*) from mock_backup_20261015.stage_history)),
  ('item_photos', (select count(*) from mock_backup_20261015.item_photos)),
  ('listing_photos', (select count(*) from mock_backup_20261015.listing_photos)),
  ('authentication_records', (select count(*) from mock_backup_20261015.authentication_records)),
  ('manager_reviews', (select count(*) from mock_backup_20261015.manager_reviews)),
  ('listings', (select count(*) from mock_backup_20261015.listings)),
  ('contract_extensions', (select count(*) from mock_backup_20261015.contract_extensions)),
  ('item_withdrawals', (select count(*) from mock_backup_20261015.item_withdrawals)),
  ('consignment_items', (select count(*) from mock_backup_20261015.consignment_items)),
  ('consignment_agreements', (select count(*) from mock_backup_20261015.consignment_agreements)),
  ('consignor_accounts', (select count(*) from mock_backup_20261015.consignor_accounts)),
  ('consignors', (select count(*) from mock_backup_20261015.consignors)),
  ('historical_sales', (select count(*) from mock_backup_20261015.historical_sales)),
  ('forecast_results', (select count(*) from mock_backup_20261015.forecast_results)),
  ('forecast_brand_models', (select count(*) from mock_backup_20261015.forecast_brand_models)),
  ('forecast_runs', (select count(*) from mock_backup_20261015.forecast_runs))
) as c(table_name, rows_backed_up);
