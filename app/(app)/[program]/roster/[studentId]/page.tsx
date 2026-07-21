import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/tenant";
import { Restricted } from "../../Restricted";
import { createClient } from "@/lib/supabase/server";
import { ROSTER_ROLES, ROSTER_WRITE_ROLES } from "@/lib/nav";
import {
  updateStudent,
  deactivateStudent,
  reactivateStudent,
  addGuardian,
  updateGuardian,
  removeGuardian,
  resendGuardianLinks,
  emailGuardianLinks,
  resetGuardianEmailStatus,
} from "../actions";
import { guardianLinks } from "@/lib/tokens";
import { STUDENT_STATUS_LABELS } from "@/lib/roster/students";

// Student detail — edit name/grad-year/status/sizes, manage guardians, and
// soft-delete (deactivate) with the §9 invariant-1 cascade. board_member reads;
// director/admin write. Free-text fields carry the standing no-health label
// (Constitution III).

interface StudentDetail {
  id: string;
  first_name: string;
  last_name: string;
  grad_year: number | null;
  status: "active" | "inactive" | "graduated";
  sizes: Record<string, string> | null;
}

interface GuardianRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  email_status: "ok" | "bounced" | "unsubscribed";
}

const NO_HEALTH_LABEL = "Do not enter health or medical information.";

export default async function StudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ program: string; studentId: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    deactivated?: string;
    confirm?: string;
    guardian?: string;
    linked?: string;
    token?: string;
    emailed?: string;
  }>;
}) {
  const { program: slug, studentId } = await params;
  const { program, role, season } = await getTenantContext(slug);
  if (!ROSTER_ROLES.includes(role)) {
    return (
      <Restricted slug={slug} surface="People" role={role} allowed={ROSTER_ROLES} />
    );
  }
  const canWrite = ROSTER_WRITE_ROLES.includes(role);
  const { saved, error, deactivated, confirm, guardian, token, emailed } =
    await searchParams;
  const freshLinks = token ? guardianLinks(token) : null;

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
  const guardians = (guardianData as GuardianRow[] | null) ?? [];

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
  const showConfirm = confirm === "deactivate" && canWrite && student.status === "active";
  // Per-guardian confirm gates (querystring round-trip, mirroring the deactivate
  // flow). Both destructive guardian actions — resetting the family's links and
  // removing a guardian — first show an inline confirm box explaining the
  // consequence, so a phone tap never fires them immediately (no hover title).
  const resetConfirmGuardianId = confirm === "reset" ? guardian ?? null : null;
  const removeConfirmGuardianId =
    confirm === "remove_guardian" ? guardian ?? null : null;

  return (
    <section className="stack">
      <p>
        <Link href={`/${slug}/roster`}>← Roster</Link>
      </p>
      <h1>
        {student.first_name} {student.last_name}{" "}
        {student.status === "inactive" && <span className="muted">(inactive)</span>}
      </h1>

      {saved && <p className="alert-ok">Saved.</p>}
      {deactivated && (
        <p className="alert-ok">
          Student deactivated. Costume and travel assignments were released and
          upcoming attendance marked absent.
        </p>
      )}
      {error === "missing_name" && (
        <p className="alert-error">A student needs a first and last name.</p>
      )}
      {error === "save" && <p className="alert-error">Couldn&apos;t save. Try again.</p>}
      {error === "guardian" && (
        <p className="alert-error">A guardian needs a name. Check the details and retry.</p>
      )}
      {error === "links" && (
        <p className="alert-error">Couldn&apos;t generate links. Try again.</p>
      )}
      {error === "email" && (
        <p className="alert-error">Couldn&apos;t send the email. Try again.</p>
      )}
      {error === "email_missing" && (
        <p className="alert-error">
          That guardian has no email on file. Add an email, or reset this
          family&apos;s links and copy them into a message instead.
        </p>
      )}
      {emailed === "ok" && (
        <p className="alert-ok">Family links emailed. Earlier links still work.</p>
      )}
      {emailed === "nokey" && (
        <p className="alert-error">
          Email isn&apos;t configured, so nothing was sent. Copy the links below
          into a message instead.
        </p>
      )}
      {error === "deactivate" && (
        <p className="alert-error">Couldn&apos;t deactivate the student. Try again.</p>
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

      {/* ---- Details + sizes ---- */}
      <h2>Details</h2>
      {canWrite ? (
        <form action={updateStudent} className="stack">
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="studentId" value={student.id} />
          <div className="row-inline">
            <label>
              First name
              <input type="text" name="first_name" defaultValue={student.first_name} required />
            </label>
            <label>
              Last name
              <input type="text" name="last_name" defaultValue={student.last_name} required />
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
            <label>
              Status
              <select name="status" defaultValue={student.status}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="graduated">Graduated</option>
              </select>
            </label>
          </div>

          <fieldset className="stack">
            <legend>Sizes</legend>
            <p className="muted">{NO_HEALTH_LABEL}</p>
            {sizeKeys.length === 0 && (
              <p className="muted">
                No size fields configured. Set them under{" "}
                <Link href={`/${slug}/roster/settings`}>Size fields</Link>.
              </p>
            )}
            <div className="row-inline">
              {sizeKeys.map((key) => (
                <label key={key}>
                  {key}
                  <input type="text" name={`size_${key}`} defaultValue={sizes[key] ?? ""} />
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit">Save changes</button>
        </form>
      ) : (
        <dl className="detail-list">
          <dt>Grad year</dt>
          <dd>{student.grad_year ?? "—"}</dd>
          <dt>Status</dt>
          <dd>{STUDENT_STATUS_LABELS[student.status]}</dd>
          {sizeKeys.map((key) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{sizes[key] ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* ---- Guardians ---- */}
      <h2 id="guardians">Guardians</h2>
      <p className="muted">{NO_HEALTH_LABEL}</p>
      {canWrite && (
        <p className="muted">
          Each family uses private links instead of accounts — the links in the
          newest email always work. <strong>Email links to this family</strong>{" "}
          sends those links to a guardian&apos;s email without disturbing any
          links they already have. <strong>Reset this family&apos;s links</strong>{" "}
          creates a fresh set and turns off every link previously emailed to this
          family — use it if an email was forwarded outside the family or a link
          ended up in the wrong hands.
        </p>
      )}
      {freshLinks && (
        <div className="confirm-box stack" style={{ width: "100%" }}>
          <strong>
            {emailed === "nokey"
              ? "Family links ready (email not sent)."
              : "Family links ready."}
          </strong>
          <p className="muted">
            {emailed === "nokey"
              ? "Email isn't set up for this deployment, so nothing was sent. Copy each link below into a message to the family — they work now, and any links the family already had still work too."
              : "These new links appear once. Copy each one into a message to the family — they work now, and replace every link previously emailed to this family."}
          </p>
          <label className="stack">
            Itinerary link
            <input
              type="text"
              readOnly
              value={freshLinks.itinerary}
              aria-label="Itinerary link"
            />
          </label>
          <label className="stack">
            Volunteer signup link
            <input
              type="text"
              readOnly
              value={freshLinks.signup}
              aria-label="Volunteer signup link"
            />
          </label>
          <label className="stack">
            Report-an-absence link
            <input
              type="text"
              readOnly
              value={freshLinks.absence}
              aria-label="Report-an-absence link"
            />
          </label>
        </div>
      )}
      <table className="members">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Relationship</th>
            <th>Email status</th>
            {canWrite && <th></th>}
          </tr>
        </thead>
        <tbody>
          {guardians.map((g) => (
            <tr key={g.id}>
              {canWrite ? (
                <>
                  <td colSpan={5}>
                    <form action={updateGuardian} className="row-inline">
                      <input type="hidden" name="programId" value={program.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="studentId" value={student.id} />
                      <input type="hidden" name="guardianId" value={g.id} />
                      <input
                        type="text"
                        name="name"
                        defaultValue={g.name}
                        required
                        aria-label="Guardian name"
                      />
                      <input
                        type="email"
                        name="email"
                        defaultValue={g.email ?? ""}
                        aria-label="Guardian email"
                      />
                      <input
                        type="tel"
                        name="phone"
                        defaultValue={g.phone ?? ""}
                        aria-label="Guardian phone"
                      />
                      <input
                        type="text"
                        name="relationship"
                        defaultValue={g.relationship ?? ""}
                        aria-label="Relationship"
                      />
                      <span className="badge">{g.email_status}</span>
                      <button type="submit" className="secondary">
                        Save
                      </button>
                    </form>
                  </td>
                  <td>
                    <div className="stack">
                      <form action={emailGuardianLinks}>
                        <input type="hidden" name="programId" value={program.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="studentId" value={student.id} />
                        <input type="hidden" name="guardianId" value={g.id} />
                        <button
                          type="submit"
                          className="secondary"
                          disabled={!g.email}
                          title={g.email ? undefined : "Add an email first"}
                        >
                          Email links to this family
                        </button>
                      </form>
                      {resetConfirmGuardianId === g.id ? (
                        <div className="confirm-box stack">
                          <p className="muted">
                            This creates a fresh set of links and turns off every
                            link previously emailed to this family. Use it if an
                            email was forwarded outside the family or a link ended
                            up in the wrong hands. The new links appear once, below
                            — email them to the family afterward.
                          </p>
                          <div className="row-inline">
                            <form action={resendGuardianLinks}>
                              <input type="hidden" name="programId" value={program.id} />
                              <input type="hidden" name="slug" value={slug} />
                              <input type="hidden" name="studentId" value={student.id} />
                              <input type="hidden" name="guardianId" value={g.id} />
                              <button type="submit" className="danger">
                                Reset links
                              </button>
                            </form>
                            <Link href={`/${slug}/roster/${student.id}#guardians`}>
                              Cancel
                            </Link>
                          </div>
                        </div>
                      ) : (
                        <Link
                          href={`/${slug}/roster/${student.id}?confirm=reset&guardian=${g.id}#guardians`}
                          className="linklike"
                        >
                          Reset this family&apos;s links
                        </Link>
                      )}
                      {g.email_status !== "ok" && (
                        <form action={resetGuardianEmailStatus}>
                          <input type="hidden" name="programId" value={program.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="studentId" value={student.id} />
                          <input type="hidden" name="guardianId" value={g.id} />
                          <button
                            type="submit"
                            className="secondary"
                            title="Turn this address back on for announcements and weekly digests. Use it after fixing a bounced address, or if the family asked to resubscribe."
                          >
                            Mark deliverable again
                          </button>
                        </form>
                      )}
                      {removeConfirmGuardianId === g.id ? (
                        <div className="confirm-box stack">
                          <p>
                            Remove {g.name} as a guardian? They&apos;ll stop
                            receiving program emails and their family links will
                            stop working.
                          </p>
                          <div className="row-inline">
                            <form action={removeGuardian}>
                              <input type="hidden" name="programId" value={program.id} />
                              <input type="hidden" name="slug" value={slug} />
                              <input type="hidden" name="studentId" value={student.id} />
                              <input type="hidden" name="guardianId" value={g.id} />
                              <button type="submit" className="danger">
                                Confirm remove
                              </button>
                            </form>
                            <Link href={`/${slug}/roster/${student.id}#guardians`}>
                              Cancel
                            </Link>
                          </div>
                        </div>
                      ) : (
                        <Link
                          href={`/${slug}/roster/${student.id}?confirm=remove_guardian&guardian=${g.id}#guardians`}
                          className="linklike danger"
                        >
                          Remove
                        </Link>
                      )}
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td>{g.name}</td>
                  <td>{g.email ?? "—"}</td>
                  <td>{g.phone ?? "—"}</td>
                  <td>{g.relationship ?? "—"}</td>
                  <td>{g.email_status}</td>
                </>
              )}
            </tr>
          ))}
          {guardians.length === 0 && (
            <tr>
              <td colSpan={canWrite ? 6 : 5} className="muted">
                No guardians yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canWrite && (
        <>
          <h3>Add a guardian</h3>
          <form action={addGuardian} className="stack">
            <input type="hidden" name="programId" value={program.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="studentId" value={student.id} />
            <div className="row-inline">
              <label>
                Name
                <input type="text" name="name" required />
              </label>
              <label>
                Email
                <input type="email" name="email" />
              </label>
              <label>
                Phone
                <input type="tel" name="phone" />
              </label>
              <label>
                Relationship
                <input type="text" name="relationship" placeholder="Mother, Father, …" />
              </label>
            </div>
            <button type="submit">Add guardian</button>
          </form>
        </>
      )}

      {/* ---- Deactivate / reactivate ---- */}
      {canWrite && student.status === "active" && (
        <>
          <h2>Deactivate</h2>
          {showConfirm ? (
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
                <Link href={`/${slug}/roster/${student.id}`}>Cancel</Link>
              </form>
            </div>
          ) : (
            <p>
              <Link href={`/${slug}/roster/${student.id}?confirm=deactivate`} className="danger">
                Deactivate student…
              </Link>
            </p>
          )}
        </>
      )}

      {canWrite && student.status === "inactive" && (
        <form action={reactivateStudent}>
          <input type="hidden" name="programId" value={program.id} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="studentId" value={student.id} />
          <button type="submit" className="secondary">
            Reactivate student
          </button>
        </form>
      )}
    </section>
  );
}
