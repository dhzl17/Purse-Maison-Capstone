-- 1. Define the 8 roles as a fixed, enforced list
create type public.user_role as enum (
  'super_admin',
  'manager',
  'consignment_team',
  'authenticator',
  'photographer',
  'designer',
  'pricing_team',
  'sales_associate'
);

-- 2. A profile row for each staff member, linked to Supabase's built-in login system
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  full_name text not null,
  email text not null,
  role public.user_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3. Turn on Row-Level Security (nobody can read/write until a policy allows it)
alter table public.profiles enable row level security;

-- 4. Anyone logged in can see their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- 5. Helper to check "is the current user an admin?" without causing recursion issues
create function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin'
  );
$$;

-- 6. Admins can see and manage everyone's profile
create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin());

create policy "Admins can update all profiles"
  on public.profiles for update
  using (public.is_admin());

create policy "Admins can insert profiles"
  on public.profiles for insert
  with check (public.is_admin());

-- 7. Whenever someone new signs up through Supabase Auth, auto-create their profile row
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, username, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'sales_associate')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();