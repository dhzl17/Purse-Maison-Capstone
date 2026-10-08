-- Module 20: Double-authentication rules and automatic stage moves for stages 10-12.
-- Authenticators cannot edit items directly, so the stage moves happen here on their behalf.

-- 1. Guard every change to an authentication record
create function public.guard_authentication_updates()
returns trigger
language plpgsql
as $$
declare
  is_owner boolean := public.has_role(array['super_admin']::public.user_role[]);
  from_editor boolean := auth.uid() is null;  -- SQL Editor / scheduled jobs
begin
  -- Assigned people must be active authenticators (or the owner)
  if new.primary_authenticator_id is distinct from old.primary_authenticator_id
     and new.primary_authenticator_id is not null
     and not exists (select 1 from public.profiles
                     where id = new.primary_authenticator_id and is_active
                       and role in ('authenticator','super_admin')) then
    raise exception 'The 1st authenticator must be an active authenticator account';
  end if;
  if new.secondary_authenticator_id is distinct from old.secondary_authenticator_id
     and new.secondary_authenticator_id is not null
     and not exists (select 1 from public.profiles
                     where id = new.secondary_authenticator_id and is_active
                       and role in ('authenticator','super_admin')) then
    raise exception 'The 2nd authenticator must be an active authenticator account';
  end if;

  -- Double authentication means two different people
  if new.primary_authenticator_id is not null
     and new.primary_authenticator_id = new.secondary_authenticator_id then
    raise exception 'Double authentication needs two different people';
  end if;

  -- Nobody can be swapped out after recording a result
  if old.primary_result is not null and new.primary_authenticator_id is distinct from old.primary_authenticator_id then
    raise exception 'The 1st authenticator cannot be changed after recording a result';
  end if;
  if old.secondary_result is not null and new.secondary_authenticator_id is distinct from old.secondary_authenticator_id then
    raise exception 'The 2nd authenticator cannot be changed after recording a result';
  end if;

  -- Results: only after payment, only by the assigned person, and frozen once final
  if new.primary_result is distinct from old.primary_result
     or new.secondary_result is distinct from old.secondary_result then
    if new.payment_status <> 'confirmed' then
      raise exception 'Results cannot be recorded before the authentication payment is confirmed';
    end if;
    if old.final_result is not null then
      raise exception 'The final result is already recorded and cannot be changed';
    end if;
  end if;

  if new.primary_result is distinct from old.primary_result then
    if new.primary_authenticator_id is null then
      raise exception 'Assign the 1st authenticator before recording their result';
    end if;
    if not (from_editor or is_owner or auth.uid() = new.primary_authenticator_id) then
      raise exception 'Only the 1st authenticator can record the 1st result';
    end if;
  end if;

  if new.secondary_result is distinct from old.secondary_result then
    if new.secondary_authenticator_id is null then
      raise exception 'Assign the 2nd authenticator before recording their result';
    end if;
    if not (from_editor or is_owner or auth.uid() = new.secondary_authenticator_id) then
      raise exception 'Only the 2nd authenticator can record the 2nd result';
    end if;
  end if;

  -- A final result typed in directly is only for settling a disagreement, by the owner
  if new.final_result is distinct from old.final_result then
    if old.final_result is not null then
      raise exception 'The final result is already recorded and cannot be changed';
    end if;
    if not (from_editor or is_owner) then
      raise exception 'Only the owner can settle a disagreement between authenticators';
    end if;
    if new.primary_result is null or new.secondary_result is null
       or new.primary_result = new.secondary_result then
      raise exception 'A final result can only be set by hand when both authenticators disagree';
    end if;
  end if;

  -- Certificate upload time is recorded automatically
  if new.certificate_url is distinct from old.certificate_url and new.certificate_url is not null then
    new.certificate_uploaded_at := now();
  end if;
  return new;
end;
$$;

-- Runs before reconcile_authentication_result_trigger (triggers fire in name order)
create trigger guard_authentication_updates_trigger
  before update on public.authentication_records
  for each row execute function public.guard_authentication_updates();

-- 2. A final result needs the certificate on file (runs after the automatic reconcile)
create function public.check_final_result_requirements()
returns trigger
language plpgsql
as $$
begin
  if new.final_result is not null and old.final_result is null
     and (new.certificate_url is null or trim(new.certificate_url) = '') then
    raise exception 'Upload the authentication certificate before the final result is recorded';
  end if;
  return new;
end;
$$;

create trigger verify_final_result_trigger
  before update on public.authentication_records
  for each row execute function public.check_final_result_requirements();

-- 3. Move the item through stages 10-12 as the work happens
--    assigned an authenticator -> Authentication Process (customer sees "In progress")
--    certificate uploaded      -> Authentication Certificate
--    (the final result then branches to Photography or Closed - Fake, from Module 6)
create function public.advance_authentication_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.primary_authenticator_id is not null or new.secondary_authenticator_id is not null) then
    update public.consignment_items
      set current_stage = 'authentication_process'
      where id = new.item_id and current_stage = 'authentication_service';
  end if;

  if new.certificate_url is not null then
    update public.consignment_items
      set current_stage = 'authentication_certificate'
      where id = new.item_id and current_stage in ('authentication_service','authentication_process');
  end if;
  return new;
end;
$$;

-- Runs after advance_after_payment_trigger and before apply_authentication_outcome_trigger
create trigger advance_authentication_stage_trigger
  after update on public.authentication_records
  for each row execute function public.advance_authentication_stage();