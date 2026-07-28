-- ============================================================================
-- Platform — an itinerary knows when its schedule last changed (spec 005 T169)
-- ----------------------------------------------------------------------------
-- THE DEFECT. A published itinerary is LIVE: staff keep editing it on
-- competition day, families see every save immediately, and both halves of the
-- app print a "changed since publishing" notice so nobody is surprised by a time
-- that moved. That notice was computed by reading `itinerary_items.updated_at`
-- across the rows that are still there — so it could see an edit and it could
-- see an addition, and it was structurally blind to the one change that matters
-- most: a DELETION leaves no row to read. Remove "5:40 Load buses" from a
-- published schedule and there was no banner at all. Families kept following a
-- line that no longer existed, and the director was never nudged to tell them.
-- Constitution: a wrongly-rendered call time destroys trust permanently, and a
-- silently-vanished one is the same class of harm.
--
-- WHY A PARENT-SIDE TIMESTAMP AND NOT A SOFT DELETE. The obvious alternative is
-- `itinerary_items.deleted_at`, which would keep the row and let the existing
-- max(updated_at) see it. It was rejected: every read path in the app — the
-- staff editor, the parent page, the .ics feed, the packet PDF, the export, the
-- packet pipeline's item count — would then have to remember to filter, and a
-- read that forgets shows families a deleted item, which is a worse bug than the
-- one being fixed. One timestamp on the PARENT covers deletion by construction,
-- changes no read path, and reduces "changed since publishing" to a single
-- comparison against published_at.
--
-- WHY A TRIGGER AND NOT THE SERVER ACTIONS. itinerary_items has more than one
-- writer: the manual editor's actions, the packet-parse review's bulk insert,
-- and a service-role/PostgREST path that bypasses RLS by design. A rule that
-- exists in one of them is a rule that is true in one of them. This is the same
-- posture 0017 and 0019 take — the invariant lives where no writer can route
-- around it.
--
-- IDEMPOTENT + RE-RUNNABLE, in 0017/0021/0023's style: `add column if not
-- exists`, a backfill that only touches unset rows, `create or replace function`
-- and a drop-then-create trigger.
--
-- DEPLOYMENT. THIS MUST BE APPLIED BEFORE THE APPLICATION CODE THAT READS
-- `items_changed_at` IS DEPLOYED — both itinerary surfaces select the column,
-- and a select naming a column that does not exist fails the whole read.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- §1  The column, and a backfill that does not invent a change
-- ----------------------------------------------------------------------------
-- Added nullable, backfilled, and only THEN given its default and NOT NULL —
-- the one order that does not stamp every existing row with now(), which would
-- make every published itinerary in production announce "Updated just now" the
-- moment this ran.
--
-- The backfill is the greatest of the itinerary's items' `updated_at` — exactly
-- what the old code computed its answer from, so no itinerary's banner changes
-- state on the day this applies — falling back to the itinerary's own
-- timestamps for one with no items at all.

alter table itineraries add column if not exists items_changed_at timestamptz;

update itineraries i
   set items_changed_at = coalesce(
         (select max(x.updated_at) from itinerary_items x where x.itinerary_id = i.id),
         i.updated_at,
         i.created_at,
         now()
       )
 where i.items_changed_at is null;

alter table itineraries alter column items_changed_at set default now();
alter table itineraries alter column items_changed_at set not null;

comment on column itineraries.items_changed_at is
  'Spec 005 T169: when this itinerary''s ITEMS last changed — insert, update, or DELETE — stamped by trg_itinerary_items_changed. "Changed since publishing" is items_changed_at > published_at, which sees a removal that leaves no row behind.';

-- No RLS change. `itineraries_read` already lets every member of the program
-- read the row, and `itineraries_write` already restricts the write to
-- director/admin on a season that is not archived. This column is never written
-- by a client — the trigger below is its only writer.

-- ----------------------------------------------------------------------------
-- §2  The stamp
-- ----------------------------------------------------------------------------
-- AFTER INSERT OR UPDATE OR DELETE, for each row. DELETE is the whole point, so
-- the parent id is read from OLD when NEW does not exist; an UPDATE that moved
-- an item between itineraries (nothing in the app does this today) stamps both
-- ends, because both schedules changed.
--
-- IT IS NOT ON `itineraries`. Publishing and unpublishing are UPDATEs of the
-- parent row, and they must never stamp: publishing is the moment the clock
-- starts, not a change since it. Only the items table fires this.
--
-- SECURITY DEFINER for 0017 §5's and 0023 §2's stated reason: the stamp is an
-- UPDATE of a DIFFERENT table from the one being written, and an UPDATE that
-- RLS filters does not fail — it silently matches zero rows and the itinerary
-- quietly keeps a stale timestamp. The two policies happen to line up today
-- (both want director/admin on an unarchived season), which is exactly the kind
-- of coincidence that stops being true later. Definer removes the question.

create or replace function public.stamp_itinerary_items_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid := case when tg_op = 'DELETE' then null else new.itinerary_id end;
  v_old uuid := case when tg_op = 'INSERT' then null else old.itinerary_id end;
begin
  update itineraries
     set items_changed_at = now()
   where id = any (array_remove(array[v_new, v_old], null));

  -- AFTER … FOR EACH ROW: the return value is ignored.
  return null;
end;
$$;

drop trigger if exists trg_itinerary_items_changed on itinerary_items;
create trigger trg_itinerary_items_changed
  after insert or update or delete on itinerary_items
  for each row execute function public.stamp_itinerary_items_changed();

-- ----------------------------------------------------------------------------
-- §3  Exposure (0018's rule)
-- ----------------------------------------------------------------------------
-- 0007's default privileges hand a newly-created function to `anon`, and this
-- one is SECURITY DEFINER. Calling a trigger function directly always fails for
-- want of a trigger context, so this is posture rather than a hole — but leaving
-- one flagged function behind trains the next reader to ignore the advisor.

revoke execute on function public.stamp_itinerary_items_changed() from public, anon, authenticated;
