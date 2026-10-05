-- 1. Forecast settings the client can tune later
insert into public.app_settings (key, value) values
  ('forecast_horizon_months', '6'),
  ('forecast_min_history_months', '12');

-- 2. Sales from before the system existed (imported from the client's records)
create table public.historical_sales (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null,
  brand text not null check (length(trim(brand)) > 0),
  category text,
  model text,
  quantity int not null default 1 check (quantity >= 1),
  revenue numeric(12,2) not null check (revenue >= 0),
  source text,
  imported_by uuid references public.profiles(id) default auth.uid(),
  imported_at timestamptz not null default now()
);

alter table public.historical_sales enable row level security;

create policy "Staff can view historical sales"
  on public.historical_sales for select
  using (public.is_staff());

create policy "Managers and owners can import historical sales"
  on public.historical_sales for insert
  with check (public.has_role(array['manager','super_admin']::public.user_role[]));

create policy "Managers and owners can correct historical sales"
  on public.historical_sales for update
  using (public.has_role(array['manager','super_admin']::public.user_role[]));

create policy "Owners can delete historical sales"
  on public.historical_sales for delete
  using (public.has_role(array['super_admin']::public.user_role[]));

-- 3. One monthly sales series per brand: imported history + verified sales from the system
create view public.monthly_brand_sales
with (security_invoker = true)
as
with all_sales as (
  select sale_date as sale_day, trim(brand) as brand, quantity, revenue, 'imported' as origin
  from public.historical_sales
  union all
  select (st.sold_at at time zone 'Asia/Manila')::date, trim(ci.brand), 1,
         coalesce(st.sale_price, 0), 'system'
  from public.sales_transactions st
  join public.consignment_items ci on ci.id = st.item_id
  where st.payment_status = 'verified'
)
select
  date_trunc('month', sale_day)::date as sale_month,
  lower(brand) as brand_key,
  min(brand) as brand,
  sum(quantity)::int as units_sold,
  sum(revenue)::numeric(14,2) as revenue,
  bool_or(origin = 'imported') as includes_imported,
  bool_or(origin = 'system') as includes_system
from all_sales
group by 1, 2;

-- 4. Forecast runs: one row each time the model runs
create table public.forecast_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued'
    check (status in ('queued','running','completed','failed')),
  horizon_months int check (horizon_months between 1 and 24),
  brands text[],
  requested_by uuid references public.profiles(id) default auth.uid(),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text
);

-- Only one run can be waiting or in progress at a time
create unique index one_active_forecast_run
  on public.forecast_runs ((status in ('queued','running')))
  where status in ('queued','running');

alter table public.forecast_runs enable row level security;

create policy "Staff can view forecast runs"
  on public.forecast_runs for select
  using (public.is_staff());

create policy "Managers and owners can request a forecast"
  on public.forecast_runs for insert
  with check (public.has_role(array['manager','super_admin']::public.user_role[]));

-- 5. Requests from staff always start as 'queued', with defaults filled in
create function public.prepare_forecast_run()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.status := 'queued';
  end if;

  if new.horizon_months is null then
    new.horizon_months := (select value from public.app_settings
                           where key = 'forecast_horizon_months')::int;
  end if;

  if new.brands is not null then
    new.brands := array(select lower(trim(b)) from unnest(new.brands) as b);
  end if;
  return new;
end;
$$;

create trigger prepare_forecast_run_trigger
  before insert on public.forecast_runs
  for each row execute function public.prepare_forecast_run();

-- 6. Timestamps fill in by themselves; a finished run is locked
create function public.track_forecast_run()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('completed','failed') then
    raise exception 'A finished forecast run cannot be changed';
  end if;

  if new.status = 'running' and old.status <> 'running' then
    new.started_at := now();
  end if;

  if new.status in ('completed','failed') then
    new.finished_at := now();
  end if;
  return new;
end;
$$;

create trigger track_forecast_run_trigger
  before update on public.forecast_runs
  for each row execute function public.track_forecast_run();

-- 7. Per-brand model details for each run (used for the MAE accuracy reporting)
create table public.forecast_brand_models (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.forecast_runs(id) on delete cascade,
  brand_key text not null,
  brand text not null,
  outcome text not null
    check (outcome in ('forecasted','skipped_insufficient_data','failed')),
  months_of_history int,
  arima_order text,
  mae numeric(14,2),
  notes text,
  unique (run_id, brand_key)
);

alter table public.forecast_brand_models enable row level security;

create policy "Staff can view forecast models"
  on public.forecast_brand_models for select
  using (public.is_staff());

-- 8. The predicted values themselves
create table public.forecast_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  brand_key text not null,
  forecast_month date not null
    check (forecast_month = date_trunc('month', forecast_month)::date),
  predicted_units numeric(10,2),
  predicted_revenue numeric(14,2) not null,
  revenue_lower numeric(14,2),
  revenue_upper numeric(14,2),
  confidence_level numeric(3,2) not null default 0.95,
  unique (run_id, brand_key, forecast_month),
  foreign key (run_id, brand_key)
    references public.forecast_brand_models (run_id, brand_key) on delete cascade
);

alter table public.forecast_results enable row level security;

create policy "Staff can view forecast results"
  on public.forecast_results for select
  using (public.is_staff());

-- 9. What the dashboard reads: the latest completed forecast
create view public.latest_forecast
with (security_invoker = true)
as
with latest as (
  select id, finished_at
  from public.forecast_runs
  where status = 'completed'
  order by finished_at desc
  limit 1
)
select
  r.run_id,
  latest.finished_at as generated_at,
  m.brand,
  r.brand_key,
  r.forecast_month,
  r.predicted_units,
  r.predicted_revenue,
  r.revenue_lower,
  r.revenue_upper,
  r.confidence_level,
  m.arima_order,
  m.mae
from latest
join public.forecast_results r on r.run_id = latest.id
join public.forecast_brand_models m
  on m.run_id = r.run_id and m.brand_key = r.brand_key;