create or replace function public.prepare_forecast_run()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.status := 'queued';
  end if;

  if new.status = 'running' then
    new.started_at := now();
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