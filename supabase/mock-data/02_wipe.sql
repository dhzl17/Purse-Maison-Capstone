-- 02_wipe.sql  —  Purse Maison mock-data import, step 2 of 3
-- Clears all consignment items, consignors, sales, client inquiries/activity, imported history and forecast runs.
-- KEEPS: staff accounts (profiles), app settings, markup tiers, authentication fee schedule, staff invites.
-- Run 01_backup.sql first. This cannot be undone except from that backup.

begin;

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'mock_backup_20261015') then
    raise exception 'Backup schema mock_backup_20261015 not found. Run 01_backup.sql first.';
  end if;
end $$;

truncate table
  public.layaway_payments,
  public.sales_transactions,
  public.notifications,
  public.consignment_assignments,
  public.inquiries,
  public.assignment_activity,
  public.price_negotiations,
  public.stage_history,
  public.item_photos,
  public.listing_photos,
  public.authentication_records,
  public.manager_reviews,
  public.listings,
  public.contract_extensions,
  public.item_withdrawals,
  public.consignment_items,
  public.consignment_agreements,
  public.consignor_accounts,
  public.consignors,
  public.historical_sales,
  public.forecast_results,
  public.forecast_brand_models,
  public.forecast_runs;

-- Item codes start again at PM-1101
alter sequence public.consignment_item_code_seq restart with 1101;

commit;

select 'Wipe complete' as status,
       (select count(*) from public.consignment_items) as items,
       (select count(*) from public.consignors) as consignors,
       (select count(*) from public.inquiries) as inquiries,
       (select count(*) from public.profiles) as staff_accounts_kept;

-- Note: uploaded photo/ID/certificate FILES in Storage are not deleted by SQL. To clear them too, empty the
-- intake-photos, listing-photos, consignor-ids and certificates buckets in Supabase Dashboard > Storage.

/* RESTORE (only if you want the old data back — run as one block):
begin;
truncate table public.layaway_payments, public.sales_transactions, public.notifications, public.consignment_assignments, public.inquiries, public.assignment_activity, public.price_negotiations, public.stage_history, public.item_photos, public.listing_photos, public.authentication_records, public.manager_reviews, public.listings, public.contract_extensions, public.item_withdrawals, public.consignment_items, public.consignment_agreements, public.consignor_accounts, public.consignors, public.historical_sales, public.forecast_results, public.forecast_brand_models, public.forecast_runs;
alter table public.layaway_payments disable trigger user;
alter table public.sales_transactions disable trigger user;
alter table public.notifications disable trigger user;
alter table public.consignment_assignments disable trigger user;
alter table public.inquiries disable trigger user;
alter table public.assignment_activity disable trigger user;
alter table public.price_negotiations disable trigger user;
alter table public.stage_history disable trigger user;
alter table public.item_photos disable trigger user;
alter table public.listing_photos disable trigger user;
alter table public.authentication_records disable trigger user;
alter table public.manager_reviews disable trigger user;
alter table public.listings disable trigger user;
alter table public.contract_extensions disable trigger user;
alter table public.item_withdrawals disable trigger user;
alter table public.consignment_items disable trigger user;
alter table public.consignment_agreements disable trigger user;
alter table public.consignor_accounts disable trigger user;
alter table public.consignors disable trigger user;
alter table public.historical_sales disable trigger user;
alter table public.forecast_results disable trigger user;
alter table public.forecast_brand_models disable trigger user;
alter table public.forecast_runs disable trigger user;
insert into public.forecast_runs select * from mock_backup_20261015.forecast_runs;
insert into public.forecast_brand_models select * from mock_backup_20261015.forecast_brand_models;
insert into public.forecast_results select * from mock_backup_20261015.forecast_results;
insert into public.historical_sales select * from mock_backup_20261015.historical_sales;
insert into public.consignors select * from mock_backup_20261015.consignors;
insert into public.consignor_accounts select * from mock_backup_20261015.consignor_accounts;
insert into public.consignment_agreements select * from mock_backup_20261015.consignment_agreements;
insert into public.consignment_items select * from mock_backup_20261015.consignment_items;
insert into public.item_withdrawals select * from mock_backup_20261015.item_withdrawals;
insert into public.contract_extensions select * from mock_backup_20261015.contract_extensions;
insert into public.listings select * from mock_backup_20261015.listings;
insert into public.manager_reviews select * from mock_backup_20261015.manager_reviews;
insert into public.authentication_records select * from mock_backup_20261015.authentication_records;
insert into public.listing_photos select * from mock_backup_20261015.listing_photos;
insert into public.item_photos select * from mock_backup_20261015.item_photos;
insert into public.stage_history select * from mock_backup_20261015.stage_history;
insert into public.price_negotiations select * from mock_backup_20261015.price_negotiations;
insert into public.assignment_activity select * from mock_backup_20261015.assignment_activity;
insert into public.inquiries select * from mock_backup_20261015.inquiries;
insert into public.consignment_assignments select * from mock_backup_20261015.consignment_assignments;
insert into public.notifications select * from mock_backup_20261015.notifications;
insert into public.sales_transactions select * from mock_backup_20261015.sales_transactions;
insert into public.layaway_payments select * from mock_backup_20261015.layaway_payments;
alter table public.layaway_payments enable trigger user;
alter table public.sales_transactions enable trigger user;
alter table public.notifications enable trigger user;
alter table public.consignment_assignments enable trigger user;
alter table public.inquiries enable trigger user;
alter table public.assignment_activity enable trigger user;
alter table public.price_negotiations enable trigger user;
alter table public.stage_history enable trigger user;
alter table public.item_photos enable trigger user;
alter table public.listing_photos enable trigger user;
alter table public.authentication_records enable trigger user;
alter table public.manager_reviews enable trigger user;
alter table public.listings enable trigger user;
alter table public.contract_extensions enable trigger user;
alter table public.item_withdrawals enable trigger user;
alter table public.consignment_items enable trigger user;
alter table public.consignment_agreements enable trigger user;
alter table public.consignor_accounts enable trigger user;
alter table public.consignors enable trigger user;
alter table public.historical_sales enable trigger user;
alter table public.forecast_results enable trigger user;
alter table public.forecast_brand_models enable trigger user;
alter table public.forecast_runs enable trigger user;
select setval('public.consignment_item_code_seq',
  coalesce((select max(substring(item_code from 4)::int) from public.consignment_items where item_code ~ '^PM-[0-9]+$'), 1100));
commit;
*/