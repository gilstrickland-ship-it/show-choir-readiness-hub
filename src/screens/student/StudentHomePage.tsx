import { AlertCircle, ArrowRight, Clock3, Layers3, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { useAppState } from "../../context/AppContext";
import { formatCountdown, formatDisplayDate, formatDisplayTime, formatEventType, formatDueAt, formatTaskType } from "../../utils/formatting";

export function StudentHomePage() {
  const {
    activeChoirId,
    activeEvent,
    getChoirLabel,
    session,
    setActiveChoir,
    visibleTasks,
    visibleUpdates
  } = useAppState();
  const pendingTasks = visibleTasks.filter((task) => !task.completed);
  const urgentTasks = pendingTasks.filter((task) => task.priority === "high").slice(0, 3);
  const completionRatio =
    visibleTasks.length > 0
      ? Math.round(((visibleTasks.length - pendingTasks.length) / visibleTasks.length) * 100)
      : 100;

  let readiness = "Caught Up";
  if (urgentTasks.length > 0) readiness = "Needs Attention";
  if (urgentTasks.length > 2) readiness = "Behind";

  return (
    <div className="stack-lg">
      <section className="stack-md">
        <div className="section-row">
          <div>
            <div className="eyebrow">Choir view</div>
            <h3>{activeChoirId ? getChoirLabel(activeChoirId) : "All My Choirs"}</h3>
          </div>
          {session.choirIds.length > 1 ? (
            <div className="chip-group wrap">
              <button
                type="button"
                className={!activeChoirId ? "chip chip-active" : "chip"}
                onClick={() => setActiveChoir(null)}
              >
                All
              </button>
              {session.choirIds.map((choirId) => (
                <button
                  key={choirId}
                  type="button"
                  className={activeChoirId === choirId ? "chip chip-active" : "chip"}
                  onClick={() => setActiveChoir(choirId)}
                >
                  {getChoirLabel(choirId)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="status-row">
        <div>
          <div className="eyebrow">Readiness</div>
          <div
            className={
              readiness === "Caught Up"
                ? "status-pill status-good"
                : readiness === "Needs Attention"
                  ? "status-pill status-warn"
                  : "status-pill status-risk"
            }
          >
            {readiness}
          </div>
        </div>
        <div className="metric-card">
          <span className="metric-label">Progress</span>
          <strong>{completionRatio}%</strong>
        </div>
      </section>

      <section className="hero-card">
        <div className="hero-top">
          <span className="type-badge">Next {formatEventType(activeEvent.type)}</span>
          <div className="countdown-chip">
            <span>In</span>
            <strong>{formatCountdown(activeEvent.date)}</strong>
          </div>
        </div>
        <h2>{activeEvent.title}</h2>
        <p>{formatDisplayDate(activeEvent.date)}</p>
        <div className="meta-list">
          <div className="meta-item">
            <Layers3 size={16} />
            <span>
              {activeEvent.scopeType === "program"
                ? "Program-wide"
                : getChoirLabel(activeEvent.choirId)}
            </span>
          </div>
          <div className="meta-item">
            <Clock3 size={16} />
            <span>Call time {formatDisplayTime(activeEvent.callTime)}</span>
          </div>
          <div className="meta-item">
            <MapPin size={16} />
            <span>{activeEvent.location}</span>
          </div>
        </div>
        <Link to="/student/guide" className="inline-link">
          View full guide
          <ArrowRight size={16} />
        </Link>
      </section>

      <section className="stack-md">
        <div className="section-row">
          <div>
            <div className="eyebrow">Priority actions</div>
            <h3>Do these next</h3>
          </div>
          <Link to="/student/queue" className="text-link">
            View all
          </Link>
        </div>
        {urgentTasks.length === 0 ? (
          <div className="empty-card">You are caught up. No urgent tasks right now.</div>
        ) : (
          urgentTasks.map((task) => (
            <Link key={task.id} to="/student/queue" className="task-preview-card">
              <div className={`task-dot task-${task.category}`} />
              <div className="task-preview-copy">
                <strong>{task.title}</strong>
                <span>
                  {getChoirLabel(task.choirId)} • {formatTaskType(task.type)}
                  {task.dueAt ? ` • ${formatDueAt(task.dueAt)}` : ""}
                </span>
              </div>
              <ArrowRight size={16} />
            </Link>
          ))
        )}
      </section>

      <section className="stack-md">
        <div className="eyebrow">Latest change</div>
        <h3>What changed most recently</h3>
        {visibleUpdates.length > 0 ? (
          <Link to="/student/updates" className="update-spotlight">
            <div className="update-spotlight-top">
              <span className={`mini-badge mini-${visibleUpdates[0].category}`}>
                {visibleUpdates[0].category}
              </span>
              {visibleUpdates[0].urgency === "urgent" ? (
                <span className="mini-alert">
                  <AlertCircle size={12} />
                  Urgent
                </span>
              ) : null}
            </div>
            <strong>{visibleUpdates[0].title}</strong>
            <p>{visibleUpdates[0].summary}</p>
            <span className="muted-line">
              {visibleUpdates[0].timestampLabel} • {visibleUpdates[0].author} •{" "}
              {visibleUpdates[0].scopeType === "program"
                ? "All Choirs"
                : getChoirLabel(visibleUpdates[0].choirId)}
            </span>
          </Link>
        ) : (
          <div className="empty-card">No updates for this choir view yet.</div>
        )}
      </section>
    </div>
  );
}
