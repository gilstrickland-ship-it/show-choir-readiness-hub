import { Link } from "react-router-dom";
import { ClipboardList, Megaphone, Users } from "lucide-react";
import { useAppState } from "../../context/AppContext";

export function LeaderDashboardPage() {
  const {
    program,
    events,
    allTasks,
    allUpdates,
    visibleUpdates,
    getChoirLabel,
    editEvent,
    deleteEvent,
    editTask,
    deleteTask,
    editUpdate,
    deleteUpdate
  } = useAppState();

  const choirEvents = events.filter((event) => event.scopeType === "choir").length;
  const urgentUpdates = visibleUpdates.filter((update) => update.urgency === "urgent").length;

  const handleEditEvent = (eventId: string, currentTitle: string, currentLocation: string) => {
    const nextTitle = window.prompt("Edit event title", currentTitle);
    if (nextTitle === null) {
      return;
    }
    const nextLocation = window.prompt("Edit event location", currentLocation);
    if (nextLocation === null) {
      return;
    }
    editEvent(eventId, {
      title: nextTitle.trim() || currentTitle,
      location: nextLocation.trim() || currentLocation
    });
  };

  const handleEditTask = (taskId: string, currentTitle: string, currentDueLabel?: string) => {
    const nextTitle = window.prompt("Edit task title", currentTitle);
    if (nextTitle === null) {
      return;
    }
    const nextDueLabel = window.prompt("Edit due label", currentDueLabel ?? "");
    if (nextDueLabel === null) {
      return;
    }
    editTask(taskId, {
      title: nextTitle.trim() || currentTitle,
      dueLabel: nextDueLabel.trim() || undefined
    });
  };

  const handleEditUpdate = (updateId: string, currentTitle: string, currentSummary: string) => {
    const nextTitle = window.prompt("Edit update title", currentTitle);
    if (nextTitle === null) {
      return;
    }
    const nextSummary = window.prompt("Edit update summary", currentSummary);
    if (nextSummary === null) {
      return;
    }
    editUpdate(updateId, {
      title: nextTitle.trim() || currentTitle,
      summary: nextSummary.trim() || currentSummary
    });
  };

  return (
    <div className="stack-lg">
      <section className="leader-panel stack-md">
        <div className="eyebrow">Overview</div>
        <h2>Start from the dashboard</h2>
        <p>
          Leaders can now review, edit, and delete all seeded events, updates, and tasks
          from this page.
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

      <div className="leader-grid">
        <section className="leader-panel stack-md">
          <div className="eyebrow">Manage events</div>
          <div className="stack-md">
            {events.map((event) => (
              <div key={event.id} className="list-card leader-manage-card">
                <div className="leader-manage-top">
                  <div>
                    <strong>{event.title}</strong>
                    <div className="muted-line">
                      {event.scopeType === "program"
                        ? "Program-wide"
                        : getChoirLabel(event.choirId)}{" "}
                      • {event.location}
                    </div>
                  </div>
                  <div className="leader-item-actions">
                    <button
                      type="button"
                      className="segment"
                      onClick={() => handleEditEvent(event.id, event.title, event.location)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="segment"
                      onClick={() => deleteEvent(event.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="leader-aside">
          <div className="leader-panel stack-md">
            <div className="eyebrow">Manage updates</div>
            <div className="stack-md">
              {allUpdates.map((update) => (
                <div key={update.id} className="list-card leader-manage-card">
                  <div className="leader-manage-top">
                    <div>
                      <strong>{update.title}</strong>
                      <div className="muted-line">
                        {update.scopeType === "program"
                          ? "Program-wide"
                          : getChoirLabel(update.choirId)}{" "}
                        • {update.timestampLabel}
                      </div>
                    </div>
                    <div className="leader-item-actions">
                      <button
                        type="button"
                        className="segment"
                        onClick={() => handleEditUpdate(update.id, update.title, update.summary)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="segment"
                        onClick={() => deleteUpdate(update.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <div className="leader-grid">
        <section className="leader-panel stack-md">
          <div className="eyebrow">Manage tasks</div>
          <div className="stack-md">
            {allTasks.map((task) => (
              <div key={task.id} className="list-card leader-manage-card">
                <div className="leader-manage-top">
                  <div>
                    <strong>{task.title}</strong>
                    <div className="muted-line">
                      {getChoirLabel(task.choirId)} • {task.priority} priority
                      {task.dueLabel ? ` • ${task.dueLabel}` : ""}
                    </div>
                  </div>
                  <div className="leader-item-actions">
                    <button
                      type="button"
                      className="segment"
                      onClick={() => handleEditTask(task.id, task.title, task.dueLabel)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="segment"
                      onClick={() => deleteTask(task.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
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
              <li>All seeded content is editable directly from this page.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
