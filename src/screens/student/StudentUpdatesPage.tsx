import { ArrowRight, Bell, Siren } from "lucide-react";
import { Link } from "react-router-dom";
import { useAppState } from "../../context/AppContext";

export function StudentUpdatesPage() {
  const { getChoirLabel, visibleUpdates } = useAppState();

  return (
    <div className="stack-lg">
      <section>
        <div className="eyebrow">Change digest</div>
        <h3>What changed since you last checked</h3>
      </section>

      {visibleUpdates.length === 0 ? (
        <div className="empty-card">
          <Bell size={20} />
          No recent updates.
        </div>
      ) : (
        <div className="timeline">
          {visibleUpdates.map((update) => (
            <article key={update.id} className="timeline-item">
              <div className="timeline-rail" />
              <div className="timeline-dot" />
              <div className="timeline-card">
                <div className="timeline-top">
                  <span className={`mini-badge mini-${update.category}`}>{update.category}</span>
                  {update.urgency === "urgent" ? (
                    <span className="mini-alert">
                      <Siren size={12} />
                      Urgent
                    </span>
                  ) : null}
                </div>
                <strong>{update.title}</strong>
                <p>{update.summary}</p>
                <div className="timeline-footer">
                  <span>
                    {update.timestampLabel} • {update.author} •{" "}
                    {update.scopeType === "program"
                      ? "All Choirs"
                      : getChoirLabel(update.choirId)}
                  </span>
                  {update.linkedTaskId ? (
                    <Link to="/student/queue" className="text-link">
                      View task
                      <ArrowRight size={14} />
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
