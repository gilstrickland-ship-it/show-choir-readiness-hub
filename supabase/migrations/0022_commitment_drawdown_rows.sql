-- ============================================================================
-- Platform — What is left on ONE commitment
-- ----------------------------------------------------------------------------
-- 0021 answers the season's question: how much is committed in total, and how
-- much per budget line. It does not answer the question the commitments LIST
-- asks once per row —
--
--     "committed $3,200 · paid $3,050 · $150 still committed"
--
-- — because that figure is per DOCUMENT, and 0021 exposes the per-document
-- drawdown only as `private.commitment_drawdown`, which is revoked from
-- `authenticated` on purpose: it returns rows and would otherwise let any
-- signed-in user read any program's committed amounts by naming its id.
--
-- WHY THIS IS NOT SUMMED IN THE APPLICATION. It could be: fetch the season's
-- linked ledger entries, group by commitment_id, subtract. That is precisely the
-- shape of the defect this codebase has now fixed five times — PostgREST caps a
-- response at `max_rows` (1000) and says nothing when it truncates, so a season
-- past the cap would report commitments as less drawn down than they are, which
-- reads as MORE money still committed and therefore LESS still available. Every
-- money total in this schema is a SQL aggregate for exactly that reason, and a
-- per-row remaining balance is a money total.
--
-- WHY IT TAKES A LIST OF IDS. `ledger_running_balance` (0019 §4) had the same
-- problem — a per-row figure computed over the whole season — and solved it the
-- same way: the caller passes the ids it is actually rendering, so the result is
-- bounded by the page rather than by the season. A page that renders 50 rows
-- asks about 50 commitments. Passing NULL asks about all of them, which is what
-- the tests and any future export want.
--
-- THE DEFINITIONS ARE 0021'S, UNCHANGED. This function adds no arithmetic of its
-- own: it selects from `private.commitment_drawdown`, which is the one place
-- total / drawn / remaining / open / standing are defined, and which
-- lib/treasury `summarizeCommitments` mirrors field for field for the
-- service-role PDF path. Two definitions of "what is left on this purchase
-- order" is how the list and the strip above it would come to disagree.
--
-- READ GATE. `private.ledger_may_read` — the same treasury read matrix plus the
-- consent-gated support read that every other money figure uses. A seat cannot
-- see what is left on a commitment it could not see at all.
--
-- IDEMPOTENT + RE-RUNNABLE, in 0019/0021's style. Adds one function; changes no
-- table, no policy and no trigger.
-- ============================================================================

drop function if exists public.commitment_drawdown_rows(uuid, uuid, uuid[]);

create function public.commitment_drawdown_rows(
  p_program_id     uuid,
  p_season_id      uuid,
  p_commitment_ids uuid[] default null
)
returns table (
  commitment_id   uuid,
  total_cents     bigint,
  drawn_cents     bigint,
  remaining_cents bigint,
  is_open         boolean,
  is_standing     boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not private.ledger_may_read(p_program_id) then
    raise exception 'no money access in this program' using errcode = '42501';
  end if;

  return query
  select d.commitment_id,
         d.total_cents,
         d.drawn_cents,
         d.remaining_cents,
         d.is_open,
         d.is_standing
    from private.commitment_drawdown(p_program_id, p_season_id) d
   where p_commitment_ids is null
      or d.commitment_id = any(p_commitment_ids);
end;
$$;

-- 0007 grants routines broadly and its default privileges hand a newly-created
-- function to `anon`. A SECURITY DEFINER money function reachable at
-- /rest/v1/rpc/<name> by an unauthenticated caller is the defect 0018 exists to
-- clean up, so the ACL is re-asserted here. The in-function gate remains the
-- real control; the grant is defence in depth.
revoke execute on function public.commitment_drawdown_rows(uuid, uuid, uuid[])
  from public, anon;
grant execute on function public.commitment_drawdown_rows(uuid, uuid, uuid[])
  to authenticated;
