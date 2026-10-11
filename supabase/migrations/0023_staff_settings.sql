-- Module 23: Settings support
--   1. Each staff member can update their own name and preferences (and nothing else on their profile).
--   2. Safety rules for the owner's Team Accounts screen: you cannot change your own role or deactivate
--      yourself, at least one active owner must always remain, and usernames / login emails are fixed.
-- Creating staff logins and resetting passwords is done by the staff-admin Edge Function, because it needs
-- the secret key, which must never be in the browser.

-- 1. Personal preferences (auto-logout time, notification choices)
alter table public.profiles
  add column preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences) = 'object');

create function public.update_my_profile(new_full_name text default null, new_preferences jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You need to be logged in to update your profile';
  end if;
  if new_full_name is not null and length(trim(new_full_name)) = 0 then
    raise exception 'Full name cannot be empty';
  end if;
  if new_full_name is not null and length(trim(new_full_name)) > 100 then
    raise exception 'Full name is too long (100 characters at most)';
  end if;
  if new_preferences is not null and jsonb_typeof(new_preferences) <> 'object' then
    raise exception 'Preferences must be a JSON object';
  end if;

  update public.profiles
    set full_name = coalesce(trim(new_full_name), full_name),
        preferences = coalesce(new_preferences, preferences)
    where id = auth.uid() and is_active;

  if not found then
    raise exception 'No active staff profile found for your account';
  end if;
end;
$$;

revoke execute on function public.update_my_profile(text, jsonb) from public, anon;
grant execute on function public.update_my_profile(text, jsonb) to authenticated;

-- 2. Guard rails for profile changes made by the owner
create function public.guard_profile_changes()
returns trigger
language plpgsql
as $$
begin
  if new.username is distinct from old.username or new.email is distinct from old.email then
    raise exception 'Usernames and login emails cannot be changed';
  end if;

  if old.id = auth.uid()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'You cannot change your own role or deactivate your own account';
  end if;

  if old.role = 'super_admin' and old.is_active
     and (new.role <> 'super_admin' or not new.is_active)
     and not exists (select 1 from public.profiles
                     where role = 'super_admin' and is_active and id <> old.id) then
    raise exception 'At least one active owner (Super Admin) account must remain';
  end if;
  return new;
end;
$$;

create trigger guard_profile_changes_trigger
  before update on public.profiles
  for each row execute function public.guard_profile_changes();