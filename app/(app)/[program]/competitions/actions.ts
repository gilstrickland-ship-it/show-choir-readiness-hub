"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  COMPETITION_WRITE_ROLES,
  COMPETITION_STATUSES,
  COMMON_CAPTIONS,
  seedAttendance,
  competitionEnsembleIds,
  competitionRoster,
  ensembleSetFingerprint,
  ensemblesInProgram,
  resolveCompetition,
  resolveCompetitionId,
  resolveSeasonId,
  type CompetitionStatus,
} from "@/lib/competitions";
import { flag, type FlaggableProgram } from "@/lib/flags";
import { returnPath, programPath } from "@/lib/return-path";
import { inngest, inngestEnabled } from "@/lib/inngest/client";
import { runPacketParse } from "@/lib/ai/packet-parse";

// Competitions CRUD + attendance seed + results (§5, T012). Writes are
// director/admin (§2 "Competitions / itineraries"); every action re-checks the
// role via requireRole (Constitution I) even though RLS also gates it.

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

// ---- Redirect targets are never interpolated from a form field --------------
// Every redirect below is built from two CLIENT-posted values: the program
// `slug` and a competition id. `slug` is the dangerous one — slug="/evil.com"
// interpolated raw gives "//evil.com/competitions", which every browser reads as
// a protocol-relative URL and follows OFF-SITE. programPath validates it against
// the shape the app mints and returns null for anything else; these helpers turn
// that null into "/" rather than into a fallback interpolation of their own
// (lib/return-path). The id gets a shape check for the same reason a path
// segment should never be allowed to carry "..".
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function competitionsHref(slug: string): string {
  return programPath(slug, "competitions") ?? "/";
}

function competitionHref(slug: string, competitionId: string): string {
  if (!UUID.test(competitionId)) return competitionsHref(slug);
  return programPath(slug, `competitions/${competitionId}`) ?? "/";
}

// Where a create/edit launched from the Season page goes back to. `from` is an
// opaque allow-listed key resolved server-side (lib/return-path) — never a
// client-supplied URL. Absent/unknown ⇒ null ⇒ the module-page redirects below
// are unchanged.
function seasonReturn(fd: FormData, slug: string): string | null {
  return returnPath(slug, str(fd, "from"));
}

// A SPARSE save carries only the fields it edits (the Season page's row-edit
// popover: name, date, status; the comp page's ensemble-change confirm: the new
// ensemble set). Full forms — the module pages' — carry the whole record, where
// an absent field still means "cleared", byte-for-byte as before.
function isSparse(fd: FormData): boolean {
  return str(fd, "sparse") === "1";
}

function nullable(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v || null;
}

// Selected ensemble ids from a checkbox group (all `ensemble_ids` values),
// deduplicated and non-empty entries only.
function ensembleIdsFrom(fd: FormData): string[] {
  return Array.from(
    new Set(
      fd
        .getAll("ensemble_ids")
        .map((v) => String(v).trim())
        .filter(Boolean),
    ),
  );
}

// Create a competition with one OR MORE participating ensembles (Feature 004),
// then idempotently seed attendance for the union of their active-season members
// (§5, invariant §9.5). At least one ensemble is required (research D3).
export async function createCompetition(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const seasonId = nullable(formData, "seasonId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  // Quick-add from the Season page comes back to Season with the drawer's
  // competition section reopened on the same error message it always used.
  const back = seasonReturn(formData, slug);
  const listPath = competitionsHref(slug);
  const fail = (code: string): string =>
    back ? `${back}?error=${code}&add=comp` : `${listPath}?error=${code}`;

  const name = str(formData, "name");
  if (!name) redirect(fail("name"));
  if (!seasonId) redirect(fail("season"));

  const status = str(formData, "status") as CompetitionStatus;
  const ensembleIds = ensembleIdsFrom(formData);
  // ≥1 ensemble required (F6, D3): a competition with no ensembles can never seed
  // attendance/meals/checkout. Enforced here in the server action.
  if (ensembleIds.length === 0) redirect(fail("ensemble"));

  const supabase = await createClient();

  // The season and the ensembles arrive as hidden fields / checkbox values, so
  // being a director of `programId` says nothing about who owns those rows.
  // Resolve both inside this program before anything is written (Constitution I).
  if (!(await resolveSeasonId(supabase, programId, seasonId))) redirect(fail("season"));
  if (!(await ensemblesInProgram(supabase, programId, ensembleIds))) {
    redirect(fail("ensemble"));
  }

  const { data, error } = await supabase
    .from("competitions")
    .insert({
      program_id: programId,
      season_id: seasonId,
      name,
      host_school: nullable(formData, "host_school"),
      venue_address: nullable(formData, "venue_address"),
      date: nullable(formData, "date"),
      showchoir_com_url: nullable(formData, "showchoir_com_url"),
      status: COMPETITION_STATUSES.includes(status) ? status : "planned",
    })
    .select("id")
    .single();

  if (error || !data) redirect(fail("save"));

  const { error: junctionErr } = await supabase
    .from("competition_ensembles")
    .insert(
      ensembleIds.map((ensemble_id) => ({
        program_id: programId,
        competition_id: data.id,
        ensemble_id,
      })),
    );
  if (junctionErr) redirect(fail("save"));

  await seedAttendance(supabase, {
    programId,
    competitionId: data.id,
    ensembleIds,
    seasonId,
  });

  revalidatePath(listPath);
  if (back) {
    revalidatePath(back);
    // The fragment scrolls the new row into view; ?created= is what actually
    // highlights it, and still does the whole job on its own.
    redirect(`${back}?created=comp-${data.id}#item-comp-${data.id}`);
  }
  redirect(`${competitionHref(slug, data.id)}?created=1`);
}

// Update core fields + the participating-ensemble set (Feature 004, generalizing
// invariant §9.2). Adding an ensemble seeds only its members; REMOVING one
// requires explicit confirmation (the detail page posts confirm_ensemble=1 once
// the director acknowledges) — on confirm, attendance is removed ONLY for
// students in no remaining ensemble, and their comp-scoped costume checkouts are
// released (mirroring the deactivation invariant, Constitution X). Double-
// rostered students are untouched.
export async function updateCompetition(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  // Spine edit popover (Season page): failures reopen that row's popover, saves
  // land back on the spine. Allow-listed server-side; module-page edits unchanged.
  const back = seasonReturn(formData, slug);
  const compPath = competitionHref(slug, competitionId);
  const fail = (code: string): string =>
    back
      ? `${back}?error=${code}&edit=comp-${competitionId}`
      : `${compPath}?error=${code}`;

  // The spine popover edits three fields and sends three fields; everything it
  // doesn't send is left exactly as it is. That is what keeps a name/date fix
  // from stomping a host school someone else just typed on the detail page —
  // and, below, from computing an ensemble "removal" out of a set the form was
  // never carrying in the first place.
  const sparse = isSparse(formData);
  const sends = (key: string): boolean =>
    !sparse || formData.getAll(key).length > 0;

  const name = str(formData, "name");
  if (sends("name") && !name) redirect(fail("name"));

  const fields: Record<string, unknown> = {};
  if (sends("name")) fields.name = name;
  if (sends("date")) fields.date = nullable(formData, "date");
  if (sends("status")) {
    const status = str(formData, "status") as CompetitionStatus;
    fields.status = COMPETITION_STATUSES.includes(status) ? status : "planned";
  }
  if (sends("host_school")) fields.host_school = nullable(formData, "host_school");
  if (sends("venue_address")) {
    fields.venue_address = nullable(formData, "venue_address");
  }
  if (sends("showchoir_com_url")) {
    fields.showchoir_com_url = nullable(formData, "showchoir_com_url");
  }

  const supabase = await createClient();

  // The competition id is a form field. Scoping only the UPDATE below is not
  // enough: a foreign id matches zero rows there WITHOUT an error, and the
  // junction writes further down would still run against it. Resolve it first
  // and stop (Constitution I) — and take the season off the stored row, so the
  // seeding and release passes below never depend on a form carrying it.
  const resolved = await resolveCompetition(supabase, programId, competitionId);
  if (!resolved) redirect(fail("save"));
  const seasonId = resolved.season_id;

  // Who is going is detail-page work, so a save that says nothing about the
  // ensembles doesn't diff the junction: treating "didn't say" as "remove" is how
  // a concurrent ensemble add turned a date fix into a removal-confirm bounce.
  // The ensemble-change confirm is the one sparse form that DOES post the set,
  // and it posts nothing else — everything it used to replay through hidden
  // inputs is re-read here instead.
  let added: string[] = [];
  let removed: string[] = [];
  let newEnsembleIds: string[] = [];
  const confirmed = str(formData, "confirm_ensemble") === "1";

  // A confirm that carries no ensembles at all used to fall through every branch
  // below and redirect to "Saved." having written nothing — the button said it
  // did something and it did not. It is the same defect as an empty set on the
  // full form, so it gets the same answer.
  if (confirmed && !sends("ensemble_ids")) redirect(fail("ensemble"));

  if (sends("ensemble_ids")) {
    newEnsembleIds = ensembleIdsFrom(formData);
    // ≥1 ensemble required (F6, D3), and every one of them has to be ours.
    if (newEnsembleIds.length === 0) redirect(fail("ensemble"));
    if (!(await ensemblesInProgram(supabase, programId, newEnsembleIds))) {
      redirect(fail("ensemble"));
    }

    const currentEnsembleIds = await competitionEnsembleIds(supabase, competitionId);
    const currentSet = new Set(currentEnsembleIds);
    const newSet = new Set(newEnsembleIds);
    added = newEnsembleIds.filter((id) => !currentSet.has(id));
    removed = currentEnsembleIds.filter((id) => !newSet.has(id));

    const pending = encodeURIComponent(newEnsembleIds.join(","));
    const confirmHref = `${compPath}?confirm=ensemble&pending_ensembles=${pending}`;

    // Guard: removing an ensemble drops students from eligibility — confirm first.
    // The slug arrives as a form field, so the target is built through the
    // fail-closed helper rather than interpolated (lib/return-path).
    if (removed.length > 0 && !confirmed) redirect(confirmHref);

    // THE CONFIRMATION HAS TO BE ABOUT THE SET BEING CHANGED. The confirm screen
    // names the students who lose eligibility, computed from the set it read
    // when it rendered — and it carries a fingerprint of that set. If somebody
    // else has added or removed an ensemble since, the diff computed above is
    // not the one that was approved: the newcomer is in `removed` and would be
    // deleted (with its attendance rows and comp-scoped checkouts) without ever
    // having appeared on screen. Refuse and send them back to a fresh, honest
    // confirmation rather than acting on a set nobody saw.
    if (confirmed) {
      const seen = str(formData, "ensembles_seen");
      if (seen !== ensembleSetFingerprint(currentEnsembleIds)) {
        redirect(`${confirmHref}&error=ensembles_moved`);
      }
    }
  }

  // A sparse form that named no writable field AND moved no ensemble changed
  // nothing. "Saved." would be a report of work that never happened, and the
  // director would go on believing the change landed (the budget builder was
  // fixed for the same lie). Say what actually happened.
  if (Object.keys(fields).length === 0 && added.length === 0 && removed.length === 0) {
    redirect(fail("nothing"));
  }

  // A form that edits only the ensembles has no core fields to write; an UPDATE
  // with nothing in it is a round-trip that can only fail.
  if (Object.keys(fields).length > 0) {
    const { error } = await supabase
      .from("competitions")
      .update(fields)
      .eq("id", competitionId)
      .eq("program_id", programId);

    if (error) redirect(fail("save"));
  }

  // Apply junction changes. A failure here is a real failure — swallowing it is
  // how a "who is going" change reports success and never lands.
  if (added.length > 0) {
    const { error: junctionErr } = await supabase.from("competition_ensembles").insert(
      added.map((ensemble_id) => ({
        program_id: programId,
        competition_id: competitionId,
        ensemble_id,
      })),
    );
    if (junctionErr) redirect(fail("save"));
  }
  if (removed.length > 0) {
    await supabase
      .from("competition_ensembles")
      .delete()
      .eq("program_id", programId)
      .eq("competition_id", competitionId)
      .in("ensemble_id", removed);
  }

  // Seed attendance for newly added ensembles (existing rows untouched).
  if (added.length > 0) {
    await seedAttendance(supabase, {
      programId,
      competitionId,
      ensembleIds: added,
      seasonId,
    });
  }

  // Removal cleanup: drop eligibility for students in NO remaining ensemble.
  if (removed.length > 0) {
    await releaseRemovedStudents(supabase, {
      programId,
      competitionId,
      seasonId,
      removedEnsembleIds: removed,
      remainingEnsembleIds: newEnsembleIds,
    });
  }

  revalidatePath(compPath);
  if (back) {
    revalidatePath(back);
    redirect(`${back}?saved=comp-${competitionId}#item-comp-${competitionId}`);
  }
  redirect(`${compPath}?saved=1`);
}

// Remove attendance + release comp-scoped costume checkouts for students who
// belonged to a removed ensemble but are members of no remaining ensemble
// (double-rostered students survive). Mirrors the deactivation invariant.
async function releaseRemovedStudents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    programId: string;
    competitionId: string;
    seasonId: string;
    removedEnsembleIds: string[];
    remainingEnsembleIds: string[];
  },
): Promise<void> {
  const { programId, competitionId, seasonId, removedEnsembleIds, remainingEnsembleIds } =
    args;

  const removedStudents = await competitionRoster(supabase, {
    programId,
    seasonId,
    ensembleIds: removedEnsembleIds,
  });
  const remainingStudents = new Set(
    await competitionRoster(supabase, {
      programId,
      seasonId,
      ensembleIds: remainingEnsembleIds,
    }),
  );
  const toRemove = removedStudents.filter((id) => !remainingStudents.has(id));
  if (toRemove.length === 0) return;

  // Release their comp-scoped costume checkouts (assignment-backed rows whose
  // student is being removed). Direct piece checkouts have no student and stay.
  const { data: assignRows } = await supabase
    .from("costume_assignments")
    .select("id")
    .eq("program_id", programId)
    .eq("season_id", seasonId)
    .in("student_id", toRemove);
  const assignmentIds = ((assignRows as { id: string }[] | null) ?? []).map((a) => a.id);
  if (assignmentIds.length > 0) {
    await supabase
      .from("costume_checkouts")
      .delete()
      .eq("program_id", programId)
      .eq("competition_id", competitionId)
      .in("assignment_id", assignmentIds);
  }

  // Delete this competition's attendance rows for the removed students.
  await supabase
    .from("attendance")
    .delete()
    .eq("program_id", programId)
    .eq("competition_id", competitionId)
    .in("student_id", toRemove);
}

// "Add missing students" (idempotent; safe to re-run when the roster changes) —
// every active-season member of the participating ensembles who has no
// attendance row for this competition gets one, marked expected. Statuses
// already set are untouched.
export async function reseedAttendance(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const supabase = await createClient();
  const compPath = competitionHref(slug, competitionId);
  // Seeding writes attendance rows keyed on competition_id, so an unresolved
  // competition id here would plant them against another program's competition.
  // The season comes off the resolved row — the form doesn't carry one.
  const resolved = await resolveCompetition(supabase, programId, competitionId);
  if (!resolved) redirect(`${compPath}?error=save`);

  const ensembleIds = await competitionEnsembleIds(supabase, competitionId);
  await seedAttendance(supabase, {
    programId,
    competitionId,
    ensembleIds,
    seasonId: resolved.season_id,
  });

  revalidatePath(compPath);
  redirect(`${compPath}?reseeded=1`);
}

// Save the results row (one per competition; upsert on competition_id). Captions
// come from checkbox fields caption_<name> plus a free-add comma list.
export async function saveResults(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const competitionId = str(formData, "competitionId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);

  const captions: Record<string, boolean> = {};
  for (const name of COMMON_CAPTIONS) {
    if (formData.get(`caption_${name}`) != null) captions[name] = true;
  }
  for (const extra of str(formData, "captions_extra").split(",")) {
    const label = extra.trim();
    if (label) captions[label] = true;
  }

  const scoreRaw = str(formData, "score");
  const score = scoreRaw ? Number(scoreRaw) : null;

  const supabase = await createClient();
  const compPath = competitionHref(slug, competitionId);
  // competition_results is unique per competition, so an unresolved id here can
  // permanently squat another program's single results slot. Resolve first.
  if (!(await resolveCompetitionId(supabase, programId, competitionId))) {
    redirect(`${compPath}?error=results`);
  }

  const { error } = await supabase.from("competition_results").upsert(
    {
      program_id: programId,
      competition_id: competitionId,
      placement: nullable(formData, "placement"),
      division: nullable(formData, "division"),
      score: score !== null && Number.isFinite(score) ? score : null,
      captions,
      notes: nullable(formData, "notes"),
    },
    { onConflict: "competition_id" },
  );

  if (error) redirect(`${compPath}?error=results`);

  revalidatePath(compPath);
  redirect(`${compPath}?results=1`);
}

// Attach an inbound (email-forwarded) packet document to a competition, then
// enqueue the AI parse when the packet_parse flag is on (§14.3, T026). Inbound
// packets land with competition_id null because the parse/review screen needs
// competition context; this is the director's "which competition is this for?"
// step, after which the existing parse pipeline runs (Inngest or inline fallback).
export async function attachPacket(formData: FormData): Promise<void> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const documentId = str(formData, "documentId");
  const competitionId = str(formData, "competitionId");
  await requireRole(programId, COMPETITION_WRITE_ROLES);
  const listPath = competitionsHref(slug);
  if (!competitionId) redirect(`${listPath}?error=attach`);

  const supabase = await createClient();

  // Scope the document + competition to this program before mutating. Both are
  // client-posted ids; attaching to a competition we don't own would file our
  // document — and the parse row below — against another program's record.
  const { data: docData } = await supabase
    .from("documents")
    .select("id, competition_id")
    .eq("id", documentId)
    .eq("program_id", programId)
    .maybeSingle();
  const doc = docData as { id: string; competition_id: string | null } | null;
  if (!doc) redirect(`${listPath}?error=attach`);
  if (!(await resolveCompetitionId(supabase, programId, competitionId))) {
    redirect(`${listPath}?error=attach`);
  }

  await supabase
    .from("documents")
    .update({ competition_id: competitionId })
    .eq("id", documentId)
    .eq("program_id", programId);

  // Parse only when the flag is on (Constitution VIII, server-side gate).
  const { data: prog } = await supabase
    .from("programs")
    .select("tier, feature_overrides")
    .eq("id", programId)
    .maybeSingle();
  const parseOn = flag(
    (prog as FlaggableProgram | null) ?? { tier: "prep", feature_overrides: null },
    "packet_parse",
  );

  if (parseOn) {
    const { data: parse } = await supabase
      .from("packet_parses")
      .insert({
        program_id: programId,
        competition_id: competitionId,
        document_id: documentId,
        status: "queued",
      })
      .select("id")
      .single();
    if (parse) {
      const args = { parseId: (parse as { id: string }).id, programId, competitionId };
      if (inngestEnabled()) {
        try {
          await inngest.send({ name: "packet/parse", data: args });
        } catch {
          await runPacketParse(args.parseId);
        }
      } else {
        await runPacketParse(args.parseId);
      }
    }
  }

  revalidatePath(listPath);
  redirect(`${competitionHref(slug, competitionId)}/packet?uploaded=1`);
}
