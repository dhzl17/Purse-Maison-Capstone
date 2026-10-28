# Mock data (supabase/mock-data)

Demo and testing data for Purse Maison, built from the client's catalog (`Sample_Data.xlsx`, 1,525 items).
The client allowed this file to be used and modified as mock history. Barcodes, brands, item names and prices
are real; every date, consignor, buyer, condition note and outcome is generated. Consignor and buyer names are
fictional, emails use `example.com` and phone numbers are random.

These scripts are **not migrations**. Never move them into `supabase/migrations/`: anyone rebuilding the database
would then wipe it.

## Files

| File | What it does |
|---|---|
| `01_backup.sql` | Copies every table the wipe clears into the `mock_backup_20261015` schema. Refuses to run if a backup already exists, so the original data can't be overwritten. |
| `02_wipe.sql` | Clears consignment items, consignors, sales, client inquiries and activity, historical sales and forecast runs. Keeps staff accounts, settings, markup tiers and the fee schedule. Needs the backup. Restore steps are at the bottom of the file. |
| `03_import.sql` | 945 items, 735 sales and 242 historical sales, Oct 2023 – Oct 13, 2026 (see the workbook). |
| `04_customer_interactions.sql` | 2,454 client inquiries matched to the items and sales from step 3 (details below). |
| `Purse_Maison_Mock_History.xlsx` | Review workbook for steps 1–3: README, monthly summary, and one sheet per data type. Cream columns are generated. |

The Customer Interactions chart also needs the migration
`supabase/migrations/0025_customer_interaction_summary.sql` (a summary view). That one **is** a migration and lives
with the others.

## How to run (Supabase Dashboard → SQL Editor)

Run one file at a time, in this order. Each file is all or nothing: if it stops with an error, nothing was changed.

1. `01_backup.sql`: if asked about Row Level Security, choose **Run and enable RLS**.
2. `02_wipe.sql`
3. `03_import.sql`: if asked about RLS, choose **Run without RLS**.
4. `supabase/migrations/0025_customer_interaction_summary.sql`
5. `04_customer_interactions.sql`: if asked about RLS, choose **Run without RLS**.

Before step 3 there must be at least one active **Sales Associate** and one active **Manager** account (sales are
credited to them). Step 5 also needs an active Sales Associate.

After step 3, run the forecast: **GitHub → Actions → Scheduled jobs → Run workflow**.

## Customer interactions (step 5)

Each inquiry is stored in the existing `inquiries` table (the Client Assignment page) using the fields staff
already fill in, so real inquiries recorded after launch are counted the same way:

| Outcome on the chart | Client Role | Transaction Result | Mock count | Linked to |
|---|---|---|---|---|
| Consigned | Consignor | Purchased / Consigned | 782 | the consignor and the first item of that visit |
| Consignor did not proceed | Consignor | No Purchase / Did Not Consign (resolved) | 350 | 20 of them are visits whose items the store rejected |
| Buyer purchased | Buyer | Purchased / Consigned | 735 | the sold item; same associate as the sale |
| Buyer only inquired | Buyer | No Purchase / Did Not Consign (resolved) | 575 | the item they asked about (on sale at that time) |
| Not on the chart (still open) | either | None, status Assigned | 12 | from the last 10 days |

Rules followed:
- **Consigned:** one inquiry per consignor visit (items brought within 14 days count as one visit), dated a few hours to 3 days before intake.
- **Buyer purchased:** the inquiry is dated after the item was listed and before the sale, and resolved at the sale time.
- **"Did not proceed" volumes:** these follow each month's own activity (about 0.7–0.95 non-buyers per buyer, and 0.3–0.55 non-consignors per consignor).
- **Associates:** inquiries without a sale are shared round-robin among the active sales associates.
- **History dates:** the usual auto-assign and activity-log triggers are switched off during the insert so history keeps its real dates. Matching back-dated entries ("Client … assigned to Associate …", "Inquiry from … marked resolved") are added to Recent Assignment Activity. The triggers are back on when the script ends.

Known pattern: Aug–Sep 2026 shows more consigned inquiries than other months, because step 3 gave all current-stock
items intake dates in those months.

## Code that uses this data

| File | Change |
|---|---|
| `purse_maison_web/js/store.js` | `loadCustomerInteractions()` reads the `customer_interaction_monthly` view. `loadClients()` now loads the newest 1,000 inquiries and the true total count. |
| `purse_maison_web/js/pages/dashboard.js` | Customer Interactions chart (stacked bars, follows the Period filter, all brands). One Key Insight line with buyer and consignor conversion rates. "Total Item Inquiries" shows the true total. |
| `purse_maison_web/js/charts.js` | `makeBarChart(..., { stacked: true })` option. |
| `purse_maison_web/js/pages/clients.js` | Client Inquiries table: 10 per page with the compact pager. Consignor results read "Consigned" or "Did Not Consign". Result options read "Purchased / Consigned" and "No Purchase / Did Not Consign". |

## Checks after importing

```sql
-- Should match the table above (plus any real inquiries)
select client_role, transaction_result, inquiry_status, count(*)
from inquiries group by 1, 2, 3 order by 1, 2, 3;

-- Chart data per month
select * from customer_interaction_monthly order by month desc limit 6;
```

## Undo

To get the data from before the mock import back, run the commented RESTORE block at the bottom of `02_wipe.sql`.
It restores every table from `mock_backup_20261015`, including inquiries and activity, so it also removes step 5.
