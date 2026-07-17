import Link from "next/link";

// Tenant shell placeholder. T005 resolves program + membership + role here and
// makes navigation role-aware and feature-flag gated (server-side 404). For now
// this is a typed shell exposing the nav slots for each domain surface.

interface NavItem {
  slot: string;
  label: string;
}

const NAV: readonly NavItem[] = [
  { slot: "dashboard", label: "Dashboard" },
  { slot: "roster", label: "Roster" },
  { slot: "costumes", label: "Costumes" },
  { slot: "competitions", label: "Competitions" },
  { slot: "events", label: "Events" },
  { slot: "travel", label: "Travel" },
  { slot: "treasury", label: "Treasury" },
  { slot: "comms", label: "Comms" },
  { slot: "settings", label: "Settings" },
];

export default async function ProgramLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ program: string }>;
}) {
  const { program } = await params;

  return (
    <div>
      <nav>
        <ul>
          {NAV.map((item) => (
            <li key={item.slot}>
              <Link href={`/${program}/${item.slot}`}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <main>{children}</main>
    </div>
  );
}
