-- 1. Helper: add banking days (skips Saturdays and Sundays)
create function public.add_banking_days(start_date date, days int)
returns date
language plpgsql
immutable
as $$
declare
  d date := start_date;
  n int := 0;
begin
  while n < days loop
    d := d + 1;
    if extract(isodow from d) < 6 then
      n := n + 1;
    end if;
  end loop;
  return d;
end;
$$;

-- 2. Helper: layaway interest (1% per month, waived for a 1-month layaway, max 3 months)
create function public.calculate_layaway_interest(sale_price numeric, months int)
returns numeric
language plpgsql
immutable
as $$
begin
  if months is null or months < 1 or months > 3 then
    raise exception 'Layaway term must be between 1 and 3 months';
  end if;
  if months = 1 then
    return 0;
  end if;
  return round(sale_price * 0.01 * months, 2);
end;
$$;

-- 3. The sale itself: one per item
create table public.sales_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references public.consignment_items(id),
  buyer_name text not null,
  buyer_phone text,
  sales_associate_id uuid references public.profiles(id) default auth.uid(),
  sale_type text not null default 'full_payment' check (sale_type in ('full_payment','layaway')),
  layaway_months int check (layaway_months between 1 and 3),
  sale_price numeric(12,2),
  commission numeric(12,2),
  consignor_payout numeric(12,2),
  layaway_interest numeric(12,2) not null default 0,
  total_due numeric(12,2),
  payment_status text not null default 'pending' check (payment_status in ('pending','verified')),
  payment_verified_by uuid references public.profiles(id),
  payment_verified_at timestamptz,
  payout_status text not null default 'pending' check (payout_status in ('pending','released')),
  payout_due_by date,
  payout_released_at timestamptz,
  sold_at timestamptz not null default now(),
  constraint layaway_needs_term check ((sale_type = 'layaway') = (layaway_months is not null))
);

alter table public.sales_transactions enable row level security;

create policy "Staff can view sales"
  on public.sales_transactions for select
  using (auth.role() = 'authenticated');

create policy "Sales roles can record sales"
  on public.sales_transactions for insert
  with check (
    exists (select 1 from public.profiles
            where id = auth.uid() and role in ('sales_associate','manager','super_admin'))
  );

create policy "Managers and owners can verify payments and release payouts"
  on public.sales_transactions for update
  using (
    exists (select 1 from public.profiles
            where id = auth.uid() and role in ('manager','super_admin'))
  );

-- 4. Installments for layaway sales
create table public.layaway_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales_transactions(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id) default auth.uid()
);

alter table public.layaway_payments enable row level security;

create policy "Staff can view layaway payments"
  on public.layaway_payments for select
  using (auth.role() = 'authenticated');

create policy "Sales roles can record layaway payments"
  on public.layaway_payments for insert
  with check (
    exists (select 1 from public.profiles
            where id = auth.uid() and role in ('sales_associate','manager','super_admin'))
  );

-- 5. Recording a sale: only available items can be sold, and the money figures are copied from the item
create function public.prepare_sale()
returns trigger
language plpgsql
as $$
declare
  item public.consignment_items%rowtype;
  listing_state text;
begin
  select * into item from public.consignment_items where id = new.item_id;
  select inventory_status into listing_state from public.listings where item_id = new.item_id;

  if listing_state is null or listing_state not in ('published','reserved') then
    raise exception 'Item % is not available for sale (listing status: %)',
      item.item_code, coalesce(listing_state, 'no listing');
  end if;

  new.sale_price := item.price;
  new.commission := item.markup;
  new.consignor_payout := item.consignor_payout;

  if new.sale_type = 'layaway' then
    new.layaway_interest := public.calculate_layaway_interest(new.sale_price, new.layaway_months);
  else
    new.layaway_interest := 0;
  end if;

  new.total_due := new.sale_price + new.layaway_interest;
  return new;
end;
$$;

create trigger prepare_sale_trigger
  before insert on public.sales_transactions
  for each row execute function public.prepare_sale();

-- 6. After a sale: full payment marks the item Sold, layaway reserves it until fully paid
create function public.mark_item_after_sale()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.listings
    set inventory_status = case when new.sale_type = 'layaway' then 'reserved' else 'sold' end
    where item_id = new.item_id;
  return new;
end;
$$;

create trigger mark_item_after_sale_trigger
  after insert on public.sales_transactions
  for each row execute function public.mark_item_after_sale();

-- 7. Payment verification and payout release rules
create function public.guard_sale_updates()
returns trigger
language plpgsql
as $$
declare
  paid numeric;
begin
  if old.payment_status = 'verified' and new.payment_status <> 'verified' then
    raise exception 'A verified payment cannot be reversed';
  end if;
  if old.payout_status = 'released' and new.payout_status <> 'released' then
    raise exception 'A released payout cannot be reversed';
  end if;

  if new.payment_status = 'verified' and old.payment_status <> 'verified' then
    if new.sale_type = 'layaway' then
      select coalesce(sum(amount), 0) into paid
      from public.layaway_payments where sale_id = new.id;

      if paid < new.total_due then
        raise exception 'Cannot verify payment: layaway is not fully paid (% of % received)', paid, new.total_due;
      end if;
    end if;

    new.payment_verified_by := auth.uid();
    new.payment_verified_at := now();
    new.payout_due_by := public.add_banking_days(current_date, 14);
  end if;

  if new.payout_status = 'released' and old.payout_status <> 'released' then
    if new.payment_status <> 'verified' then
      raise exception 'Cannot release payout: the buyer payment has not been verified';
    end if;
    new.payout_released_at := now();
  end if;

  return new;
end;
$$;

create trigger guard_sale_updates_trigger
  before update on public.sales_transactions
  for each row execute function public.guard_sale_updates();

-- 8. A layaway item becomes Sold only once its payment is verified
create function public.finalize_verified_sale()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.payment_status = 'verified' and old.payment_status <> 'verified'
     and new.sale_type = 'layaway' then
    update public.listings set inventory_status = 'sold' where item_id = new.item_id;
  end if;
  return new;
end;
$$;

create trigger finalize_verified_sale_trigger
  after update on public.sales_transactions
  for each row execute function public.finalize_verified_sale();