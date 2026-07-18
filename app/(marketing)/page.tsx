import Link from "next/link";
import { brand } from "@/lib/brand";

// Public landing page. Everything brand-related reads from lib/brand
// (Constitution IX); privacy copy states the precise posture from the
// architecture spec §1.10 — "no sensitive student data," never "no PII."

const FEATURES = [
  {
    title: "Costumes, props, and sets",
    body: "One inventory that survives the seasons. Assignment grids with size warnings, an alterations queue that knows your next competition, and a phone-friendly checkout so Riser 3 makes it back on the truck.",
  },
  {
    title: "Competitions without retyping",
    body: "Upload the host packet and review an AI-drafted itinerary side-by-side with the source. You edit, you publish — nothing reaches a parent without your approval.",
  },
  {
    title: "Travel that runs itself",
    body: "Rooms and buses with capacity meters, chaperone lists, and printable manifests and door slips — always generated from live data, never a stale spreadsheet.",
  },
  {
    title: "Money tracked, never touched",
    body: "A booster-grade ledger with treasurer-only writes, void-never-delete corrections, budget vs. actual, per-competition cost reports, and a board snapshot PDF for the monthly meeting.",
  },
  {
    title: "Parents without passwords",
    body: "No parent accounts, ever. Families get the weekly digest, published itineraries, volunteer signup, and absence reporting through secure links in every email.",
  },
  {
    title: "A season that hands itself off",
    body: "Rollover wizard, read-only season archive, the trophy case, and a one-click export of everything you own. Officer turnover stops being a data loss event.",
  },
];

export default function LandingPage() {
  return (
    <main className="landing">
      <section className="hero stack">
        <h1>{brand.name}</h1>
        <p className="tagline">The season operating system for competitive show choir.</p>
        <p className="muted">
          Built for directors and booster leadership: rosters, costumes,
          competitions, travel, treasury, and parent communication in one
          place. It tracks the money — it never moves it.
        </p>
        <div className="hero-actions">
          <Link href="/sign-in" className="button-link">
            Staff sign in
          </Link>
          <a href={`mailto:${brand.supportEmail}`} className="button-link secondary">
            Request a pilot
          </a>
        </div>
      </section>

      <section className="flow">
        <h2>The ninety-second demo</h2>
        <ol className="flow-steps">
          <li>
            <strong>Upload the host packet.</strong> The PDF every competition
            emails you, straight in — no retyping.
          </li>
          <li>
            <strong>Review the drafted itinerary.</strong> Source pages
            side-by-side with the editable schedule. Fix, then publish.
          </li>
          <li>
            <strong>Generate the parent packet.</strong> Itinerary, bus lists,
            room lists, meal counts — your program&apos;s actual data, one PDF.
          </li>
        </ol>
      </section>

      <section>
        <h2>What it runs</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature-card">
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="trust">
        <h2>Built to be trusted with a school program</h2>
        <p className="muted">
          {brand.name} holds directory-tier information only — student names,
          grad years, and sizes, plus adult contact details. No health or
          medical data, no birthdates, no addresses, no photos, and no student
          accounts, by architecture. Every family&apos;s links are private and
          revocable, every program&apos;s data is isolated and tested on every
          change, and you can export everything you own at any time.
        </p>
      </section>

      <footer className="landing-footer">
        <span>{brand.name}</span>
        <span className="muted">
          <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
          {" · "}
          <Link href="/sign-in">Staff sign in</Link>
        </span>
      </footer>
    </main>
  );
}
