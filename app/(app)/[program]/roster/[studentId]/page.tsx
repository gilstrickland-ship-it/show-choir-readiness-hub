import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { createClient } from "@/lib/supabase/server";
import { ROSTER_ROLES, ROSTER_WRITE_ROLES } from "@/lib/nav";
import { updateStudent, deactivateStudent, reactivateStudent } from "../actions";
import {
  STUDENT_STATUS_LABELS,
  type StudentStatus,
} from "@/lib/roster/students";
import { GuardianCard, type GuardianListRow } from "./GuardianCard";
import { AddGuardian } from "./AddGuardian";
import { FreshLinks } from "./FreshLinks";

// One person, read in four groups (spec 005 US10-4): Profile · Sizes ·
// Guardians · Status. The page used to be nine forms in two undifferentiated
// runs — the name, the grad year, the status and every size in one always-open
// block, then a guardian table where each row carried five verbs. Same writes,
// same cascade, same role gate; what changed is that each group now says what it
// is, and each group saves on its own so a size fix cannot clobber a name.
//
// Directory-tier PII only (Constitution III): name, grad year, program-defined
// sizes, guardian contact. No health, medical, emergency-contact, date-of-birth,
// address or photo field exists here, and the free-text fields carry the
// standing caution. board_member reads; director/admin write; costume_manager
// and treasurer have no roster seat at all and never reach this page.

interface StudentDetail {
  id: string;
  first_name: string;
  last_name: string;
  grad_year: number | null;
  status: StudentStatus;
  sizes: Record<string, string> | null;
}

const NO_HEALTH_LABEL = "Do not enter health or medical information.";

// Messages that belong to the page as a whole (a student-level save).
const ERR: Record<string, string> = {
  missing_name: "A student needs a first and last name.",
  save: "Couldn't save. Try again.",
  deactivate: "Couldn't deactivate the student. Try again.",
};

// Messages that belong to the Guardians group but not to one row.
const GUARDIANS_ERR: Record<string, string> = {
  guardian: "A guardian needs a name. Check the details and try again.",
  guardian_gone:
    "That guardian is no longer on this student. Reload the page and try again.",
};

// Messages that belong to ONE guardian row. They arrive with
// `?edit=<guardianId>`, which is also what reopens that row's panel.
const ROW_ERR: Record<string, string> = {
  guardian: "A guardian needs a name. Check the details and try again.",
  links: "Couldn't reset the links. Try again.",
  email: "Couldn't send the email. Try again.",
  email_missing:
    "That guardian has no email on file. Add one in Edit, or reset this family's links and copy them into a message instead.",
};

// The code rides in the URL, so the lookup must be a lookup and not a walk up
// Object.prototype — `?error=constructor` would otherwise hand React a function.
function message(map: Record<string, string>, code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(map, code) ? map[code] : null;
}

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; studentId: string }>;
  // Next hands back an ARRAY for a duplicated param (?edit=a&edit=b), so every
  // read goes through `one()` — a hand-typed URL must not 500 the page.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { program: slug, studentId } = await params;
  const { program, role, season } = await getTenantContext(slug);
  if (!ROSTER_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="People" role={role} allowed={ROSTER_ROLES} />
    );
  }
  const canWrite = ROSTER_WRITE_ROLES.includes(role);

  const sp = await searchParams;
  const one = (key: string): string | null => {
    const v = sp[key];
    return typeof v === "string" ? v : null;
  };

  const supabase = await createClient();
  const { data: studentData } = await supabase
    .from("students")
    .select("id, first_name, last_name, grad_year, status, sizes")
    .eq("id", studentId)
    .eq("program_id", program.id)
    .maybeSingle();
  const student = studentData as StudentDetail | null;
  if (!student) notFound();

  const { data: guardianData } = await supabase
    .from("guardians")
    .select("id, name, email, phone, relationship, email_status")
    .eq("program_id", program.id)
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });
  const guardians = (guardianData as GuardianListRow[] | null) ?? [];

  // Current-season ensemble membership (read-only here; managed under Ensembles).
  const ensembleNames: string[] = [];
  if (season) {
    const { data: memberData } = await supabase
      .from("ensemble_members")
      .select("ensembles(name)")
      .eq("program_id", program.id)
      .eq("season_id", season.id)
      .eq("student_id", studentId);
    for (const m of (memberData as { ensembles: { name: string } | null }[] | null) ?? []) {
      if (m.ensembles?.name) ensembleNames.push(m.ensembles.name);
    }
  }

  const sizeKeys = program.size_fields ?? [];
  const sizes = student.sizes ?? {};
  const detail = `/${slug}/roster/${student.id}`;

  const saved = one("saved");
  const deactivated = one("deactivated");
  const emailed = one("emailed");
  const errorCode = one("error");
  const confirmCode = one("confirm");
  const token = one("token");

  // A guardian row's panel reopens on `?edit=<guardianId>` carrying its own
  // message; without an `edit` a guardian code belongs to the group.
  const openGuardianId = canWrite ? one("edit") : null;
  const rowError = openGuardianId ? message(ROW_ERR, errorCode) : null;
  const guardiansError = openGuardianId ? null : message(GUARDIANS_ERR, errorCode);
  const pageError = message(ERR, errorCode);
  const rowConfirm =
    confirmCode === "reset" || confirmCode === "remove" ? confirmCode : null;

  // The add drawer reopens on a rejected create (no `edit`, a guardian code).
  const addOpen = canWrite && !openGuardianId && errorCode === "guardian";
  const showDeactivateConfirm =
    confirmCode === "deactivate" && canWrite && student.status === "active";

  const bouncing = guardians.filter((g) => g.email_status !== "ok").length;
  const eyebrow = [
    student.grad_year ? `Class of ${student.grad_year}` : "No grad year",
    STUDENT_STATUS_LABELS[student.status],
    `${guardians.length} guardian${guardians.length === 1 ? "" : "s"}`,
  ].join(" · ");

  return (
    <section className="stack people">
      <p>
        <Link href={`/${slug}/roster`}>← Roster</Link>
      </p>
      <div className="page-head">
        <div className="page-head-titles">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="page-h1">
            {student.first_name} {student.last_name}
          </h1>
        </div>
      </div>

      {saved && <p className="alert-ok">Saved.</p>}
      {deactivated && (
        <p className="alert-ok">
          Student deactivated. Costume and travel assignments were released and
          upcoming attendance marked absent.
        </p>
      )}
      {pageError && <p className="alert-error">{pageError}</p>}
      {emailed === "ok" && (
        <p className="alert-ok">Family links emailed. Earlier links still work.</p>
      )}
      {emailed === "nokey" && (
        <p className="alert-error">
          Email isn&apos;t configured, so nothing was sent. Copy the links below
          into a message instead.
        </p>
      )}

      {ensembleNames.length > 0 && (
        <p className="muted">
          Ensembles this season:{" "}
          {ensembleNames.map((n) => (
            <span key={n} className="chip">
              {n}
            </span>
          ))}
        </p>
      )}

      {/* ---------------- Profile ---------------- */}
      <h2 id="profile">Profile</h2>
      {canWrite ? (
        <form action={updateStudent} className="stack person-form">
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="studentId" value={student.id} />
          <input type="hidden" name="sparse" value="1" />
          <input type="hidden" name="section" value="profile" />
          <div className="row-inline">
            <label>
              First name
              <input
                type="text"
                name="first_name"
                defaultValue={student.first_name}
                required
              />
            </label>
            <label>
              Last name
              <input
                type="text"
                name="last_name"
                defaultValue={student.last_name}
                required
              />
            </label>
            <label>
              Grad year
              <input
                type="number"
                name="grad_year"
                min="1990"
                max="2100"
                inputMode="numeric"
                defaultValue={student.grad_year ?? ""}
              />
            </label>
          </div>
          <button type="submit" className="secondary">
            Save profile
          </button>
        </form>
      ) : (
        <dl className="detail-list">
          <dt>Grad year</dt>
          <dd>{student.grad_year ?? "—"}</dd>
        </dl>
      )}

      {/* ---------------- Sizes ---------------- */}
      <h2 id="sizes">Sizes</h2>
      <p className="muted">
        What this student wears, in the fields your program measures. {NO_HEALTH_LABEL}
      </p>
      {sizeKeys.length === 0 ? (
        <p className="muted">
          No size fields set up yet. Choose them under{" "}
          <Link href={`/${slug}/roster/settings`}>Size fields</Link>.
        </p>
      ) : canWrite ? (
        <form action={updateStudent} className="stack person-form">
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="studentId" value={student.id} />
          <input type="hidden" name="sparse" value="1" />
          <input type="hidden" name="sizes" value="1" />
          <input type="hidden" name="section" value="sizes" />
          <div className="row-inline">
            {sizeKeys.map((key) => (
              <label key={key}>
                {key}
                <input type="text" name={`size_${key}`} defaultValue={sizes[key] ?? ""} />
              </label>
            ))}
          </div>
          <button type="submit" className="secondary">
            Save sizes
          </button>
        </form>
      ) : (
        <dl className="detail-list">
          {sizeKeys.map((key) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{sizes[key] ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* ---------------- Guardians ---------------- */}
      <div className="person-section-head">
        <h2 id="guardians">Guardians</h2>
        {canWrite && (
          <AddGuardian
            programId={program.id}
            slug={slug}
            studentId={student.id}
            open={addOpen}
            error={addOpen ? message(GUARDIANS_ERR, errorCode) : null}
          />
        )}
      </div>
      <p className="muted">
        {guardians.length === 0
          ? "Nobody yet — a student with no guardian gets no itinerary, no signup link and no way to report an absence."
          : bouncing > 0
            ? `${bouncing} of ${guardians.length} ${bouncing === 1 ? "address is" : "addresses are"} not receiving email.`
            : "Everyone here is receiving email."}{" "}
        {NO_HEALTH_LABEL}
      </p>
      {canWrite && (
        <p className="muted">
          Families use private links instead of accounts, and the links in the
          newest email always work. <strong>Send family links</strong> emails
          this family their links without disturbing any they already have.
        </p>
      )}
      {guardiansError && <p className="alert-error">{guardiansError}</p>}
      {token && <FreshLinks token={token} emailedNoKey={emailed === "nokey"} />}

      <div className="stack guardian-list">
        {guardians.map((g) => (
          <GuardianCard
            key={g.id}
            programId={program.id}
            slug={slug}
            studentId={student.id}
            guardian={g}
            canWrite={canWrite}
            open={openGuardianId === g.id}
            confirm={openGuardianId === g.id ? rowConfirm : null}
            error={openGuardianId === g.id ? rowError : null}
          />
        ))}
      </div>

      {/* ---------------- Status ---------------- */}
      <h2 id="status">Status</h2>
      {canWrite ? (
        <>
          <form action={updateStudent} className="stack person-form">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="studentId" value={student.id} />
            <input type="hidden" name="sparse" value="1" />
            <input type="hidden" name="section" value="status" />
            <label>
              Status
              <select name="status" defaultValue={student.status}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="graduated">Graduated</option>
              </select>
            </label>
            <button type="submit" className="secondary">
              Save status
            </button>
            <p className="muted">
              Graduated students drop off the directory. Inactive students stay
              on it, greyed out.
            </p>
          </form>

          {student.status === "active" &&
            (showDeactivateConfirm ? (
              <div className="stack confirm-box">
                <p>Deactivating {student.first_name} will:</p>
                <ul>
                  <li>Release their costume assignments (pieces return to inventory).</li>
                  <li>Remove them from travel rooms and buses.</li>
                  <li>Mark them absent for competitions dated today or later.</li>
                </ul>
                <p className="muted">
                  The record is never deleted — it becomes inactive and can be
                  reactivated later.
                </p>
                <form action={deactivateStudent} className="row-inline">
                  <input type="hidden" name="programId" value={program.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="studentId" value={student.id} />
                  <button type="submit" className="danger">
                    Confirm deactivate
                  </button>
                  <Link href={`${detail}#status`}>Cancel</Link>
                </form>
              </div>
            ) : (
              <p>
                <Link href={`${detail}?confirm=deactivate#status`} className="danger">
                  Deactivate student…
                </Link>
              </p>
            ))}

          {student.status === "inactive" && (
            <form action={reactivateStudent}>
              <input type="hidden" name="programId" value={program.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="studentId" value={student.id} />
              <button type="submit" className="secondary">
                Reactivate student
              </button>
            </form>
          )}
        </>
      ) : (
        <p className="muted">{STUDENT_STATUS_LABELS[student.status]}</p>
      )}
    </section>
  );
}
