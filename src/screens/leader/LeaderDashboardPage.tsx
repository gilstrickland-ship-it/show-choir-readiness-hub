import { Link } from "react-router-dom";
import { ClipboardList, Megaphone, Users } from "lucide-react";
import { useAppState } from "../../context/AppContext";

export function LeaderDashboardPage() {
  const { program, events, visibleUpdates } = useAppState();

  const choirEvents = events.filter((event) => event.scopeType === "choir").length;
  const urgentUpdates = visibleUpdates.filter((update) => update.urgency === "urgent").length;

  return (
    <div className="leader-grid">
      <section className="leader-panel stack-md">
        <div className="eyebrow">Overview</div>
        <h2>Start from the dashboard</h2>
        <p>
          Use this page as the leader landing view, then jump into publishing when you need
          to send a new update.
        </p>

        <div className="status-row">
          <div className="metric-card">
            <strong>{program.choirs.length}</strong>
            <span className="muted-line">Active choirs</span>
          </div>
          <div className="metric-card">
            <strong>{choirEvents}</strong>
            <span className="muted-line">Choir events</span>
          </div>
          <div className="metric-card">
            <strong>{urgentUpdates}</strong>
            <span className="muted-line">Urgent updates</span>
          </div>
        </div>

        <Link to="/leader/publish" className="inline-link">
          <Megaphone size={16} />
          Go to publish updates
        </Link>
      </section>

      <aside className="leader-aside">
        <div className="info-card">
          <div className="magic-card-top">
            <Users size={18} />
            <strong>Choirs in this program</strong>
          </div>
          <ul>
            {program.choirs.map((choir) => (
              <li key={choir.id}>{choir.name}</li>
            ))}
          </ul>
        </div>

        <div className="info-card">
          <div className="magic-card-top">
            <ClipboardList size={18} />
            <strong>Leader reminders</strong>
          </div>
          <ul>
            <li>Use Dashboard as the landing page.</li>
            <li>Use Publish for new updates and linked action items.</li>
            <li>Keep choir-specific tasks scoped to the correct ensemble.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
