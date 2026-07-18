-- ============================================================================
-- Platform — Auto-create profiles for auth users
-- ----------------------------------------------------------------------------
-- Several tables reference profiles(id) (ledger actors, absence resolvers,
-- checkout stampers), but nothing created profiles rows for new auth users —
-- so those foreign keys failed silently for any account that never got a
-- profile. Standard Supabase pattern: a trigger on auth.users inserts the
-- matching profiles row; plus a backfill for existing users. Tolerant of
-- environments where auth.users is not trigger-able by the migration role.
-- ============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

do $trg$
begin
  execute 'drop trigger if exists on_auth_user_created on auth.users';
  execute 'create trigger on_auth_user_created
             after insert on auth.users
             for each row execute function public.handle_new_auth_user()';
exception when insufficient_privilege then
  raise notice 'cannot create trigger on auth.users — create it as a superuser';
end
$trg$;

-- Backfill profiles for existing auth users.
insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;
