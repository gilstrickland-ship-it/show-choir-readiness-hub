import { Bell } from "lucide-react";
import { useAppState } from "../../context/AppContext";

export function ParentUpdatesPage() {
  const { getChoirLabel, visibleUpdates } = useAppState();
  const parentUpdates = visibleUpdates.filter(
    (update) => update.audience === "parents" || update.audience === "both"
  );

  return (
    <div className="stack-lg">
      <section>
        <div className="eyebrow">Parent feed</div>
        <h3>Choir logistics only</h3>
      </section>

      {parentUpdates.length === 0 ? (
        <div className="empty-card">
          <Bell size={18} />
          No parent updates yet.
        </div>
      ) : (
        parentUpdates.map((update) => (
          <article key={update.id} className="parent-update-card">
            <div className="timeline-top">
              <span className={`mini-badge mini-${update.category}`}>{update.category}</span>
              <span className="muted-line">
                {update.scopeType === "program"
                  ? "All Choirs"
                  : getChoirLabel(update.choirId)}
              </span>
            </div>
            <strong>{update.title}</strong>
            <p>{update.summary}</p>
            <span className="muted-line">
              {update.timestampLabel} • {update.author}
            </span>
          </article>
        ))
      )}
    </div>
  );
}
