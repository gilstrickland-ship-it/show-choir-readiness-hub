// Shared read-only banner for archived-season data (§9 invariant 4, T040).
// Archiving a season freezes all its season-scoped rows read-only at the RLS
// layer (the vault). Today archived data is only reachable through History
// (trophy case) and the rollover surface, since season-scoped pages always use
// the ACTIVE season — but this component is the single, reusable surface for
// signalling "you are looking at a frozen past season" wherever archived data is
// rendered now or when archived-season browsing lands later.
export function ArchivedBanner({
  seasonLabel,
  archivedAtLabel,
}: {
  seasonLabel?: string;
  archivedAtLabel?: string | null;
}) {
  return (
    <div
      className="confirm-box"
      role="status"
      style={{ width: "100%", borderStyle: "dashed" }}
    >
      <strong>Read-only archived season{seasonLabel ? ` · ${seasonLabel}` : ""}.</strong>{" "}
      <span className="muted">
        This season is archived — its roster, results, and documents stay
        browsable but nothing here can be changed.
        {archivedAtLabel ? ` Archived ${archivedAtLabel}.` : ""}
      </span>
    </div>
  );
}
