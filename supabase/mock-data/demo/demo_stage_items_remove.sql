-- demo_stage_items_remove.sql  —  removes everything demo_stage_items.sql added (for after the demo, or to start over)
-- Finds the demo items by their placeholder photos, so your real items are never touched.
-- Also removes anything done to them during the demo (sales, photos, authentication, reviews, history).
-- If a demo item was published to Shopify during the demo, click "Remove extra Shopify products" in
-- Settings afterwards to take it off the store.
-- The placeholder files in Storage are not deleted; remove the demo-placeholders folders by hand if you like.

begin;

create temp table demo_ids on commit drop as
  select distinct item_id as id from public.item_photos where storage_path like 'demo-placeholders/%';

select count(*) as demo_items_found from demo_ids;

delete from public.sales_transactions where item_id in (select id from demo_ids);
update public.inquiries set item_id = null where item_id in (select id from demo_ids);

-- The item and its agreement point at each other, so unlink them first (rules switched off for this one step)
alter table public.consignment_items disable trigger user;
update public.consignment_items set agreement_id = null where id in (select id from demo_ids);
alter table public.consignment_items enable trigger user;

delete from public.consignment_agreements where item_id in (select id from demo_ids);
delete from public.consignment_items where id in (select id from demo_ids);   -- photos, history, authentication,
                                                                             -- reviews, listings follow automatically
commit;
