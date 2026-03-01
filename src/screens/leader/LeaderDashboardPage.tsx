import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Megaphone, Users, X } from "lucide-react";
import { useAppState } from "../../context/AppContext";
import { EventItem, Task, UpdateItem } from "../../types";
import {
  formatCountdown,
  formatDisplayDate,
  formatDisplayTime,
  formatDueAt
} from "../../utils/formatting";

type EditorState =
  | { kind: "event"; draft: EventItem }
  | { kind: "update"; draft: UpdateItem }
  | { kind: "task"; draft: Task }
  | null;

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

  const [editor, setEditor] = useState<EditorState>(null);

  const choirEvents = events.filter((event) => event.scopeType === "choir").length;
  const urgentUpdates = visibleUpdates.filter((update) => update.urgency === "urgent").length;

  useEffect(() => {
    if (!editor) {
      return;
    }

    if (editor.kind === "event") {
      const fresh = events.find((event) => event.id === editor.draft.id);
      if (!fresh) {
        setEditor(null);
      }
    }

    if (editor.kind === "update") {
      const fresh = allUpdates.find((update) => update.id === editor.draft.id);
      if (!fresh) {
        setEditor(null);
      }
    }

    if (editor.kind === "task") {
      const fresh = allTasks.find((task) => task.id === editor.draft.id);
      if (!fresh) {
        setEditor(null);
      }
    }
  }, [allTasks, allUpdates, editor, events]);

  const saveEditor = () => {
    if (!editor) {
      return;
    }

    if (editor.kind === "event") {
      editEvent(editor.draft.id, editor.draft);
    }

    if (editor.kind === "update") {
      editUpdate(editor.draft.id, editor.draft);
    }

    if (editor.kind === "task") {
      editTask(editor.draft.id, editor.draft);
    }

    setEditor(null);
  };

  return (
    <>
      <div className={editor ? "stack-lg drawer-open" : "stack-lg"}>
        <section className="leader-panel stack-md">
          <div className="eyebrow">Overview</div>
          <h2>Start from the dashboard</h2>
          <p>
            Leaders can review, edit, and delete events, updates, and tasks from one place.
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
                        {event.scopeType === "program" ? "Program-wide" : getChoirLabel(event.choirId)}{" "}
                        • {event.location}
                      </div>
                    </div>
                    <div className="leader-item-actions">
                      <button
                        type="button"
                        className="segment"
                        data-testid={event.id === events[0]?.id ? "event-edit-first" : undefined}
                        onClick={() => setEditor({ kind: "event", draft: { ...event } })}
                      >
                        Edit
                      </button>
                      <button type="button" className="segment" onClick={() => deleteEvent(event.id)}>
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
                          data-testid={
                            update.id === allUpdates[0]?.id ? "update-edit-first" : undefined
                          }
                          onClick={() => setEditor({ kind: "update", draft: { ...update } })}
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
                        {task.dueAt ? ` • ${formatDueAt(task.dueAt)}` : ""}
                      </div>
                    </div>
                    <div className="leader-item-actions">
                      <button
                        type="button"
                        className="segment"
                        data-testid={task.id === allTasks[0]?.id ? "task-edit-first" : undefined}
                        onClick={() => setEditor({ kind: "task", draft: { ...task } })}
                      >
                        Edit
                      </button>
                      <button type="button" className="segment" onClick={() => deleteTask(task.id)}>
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
                <li>Edit opens the full item in a drawer.</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>

      {editor ? (
        <div className="leader-drawer-backdrop" onClick={() => setEditor(null)}>
          <aside
            className="leader-drawer"
            data-testid="leader-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="leader-drawer-header">
              <div>
                <div className="eyebrow">Edit item</div>
                <strong>
                  {editor.kind === "event"
                    ? "Event"
                    : editor.kind === "update"
                      ? "Update"
                      : "Task"}
                </strong>
              </div>
              <button
                type="button"
                className="header-action drawer-close"
                data-testid="drawer-close"
                onClick={() => setEditor(null)}
                aria-label="Close editor"
              >
                <X size={14} />
              </button>
            </div>

            {editor.kind === "event" ? (
              <div className="leader-form">
                <label className="field">
                  <span>Title</span>
                  <input
                    value={editor.draft.title}
                    onChange={(event) =>
                      setEditor({
                        kind: "event",
                        draft: { ...editor.draft, title: event.target.value }
                      })
                    }
                  />
                </label>
                <div className="split-fields">
                  <label className="field">
                    <span>Event type</span>
                    <select
                      value={editor.draft.type}
                      onChange={(event) =>
                        setEditor({
                          kind: "event",
                          draft: {
                            ...editor.draft,
                            type: event.target.value as EventItem["type"]
                          }
                        })
                      }
                    >
                      <option value="rehearsal">Rehearsal</option>
                      <option value="competition">Competition</option>
                      <option value="audition">Audition</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Applies to</span>
                    <select
                      value={editor.draft.scopeType}
                      onChange={(event) =>
                        setEditor({
                          kind: "event",
                          draft: {
                            ...editor.draft,
                            scopeType: event.target.value as EventItem["scopeType"],
                            choirId:
                              event.target.value === "program" ? undefined : editor.draft.choirId
                          }
                        })
                      }
                    >
                      <option value="choir">Choir</option>
                      <option value="program">Program</option>
                    </select>
                  </label>
                </div>
                {editor.draft.scopeType === "choir" ? (
                  <label className="field">
                    <span>Choir</span>
                    <select
                      value={editor.draft.choirId ?? program.choirs[0]?.id ?? ""}
                      onChange={(event) =>
                        setEditor({
                          kind: "event",
                          draft: { ...editor.draft, choirId: event.target.value }
                        })
                      }
                    >
                      {program.choirs.map((choir) => (
                        <option key={choir.id} value={choir.id}>
                          {choir.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={editor.draft.date}
                    onChange={(event) =>
                      setEditor({
                        kind: "event",
                        draft: { ...editor.draft, date: event.target.value }
                      })
                    }
                  />
                </label>
                <div className="split-fields">
                  <label className="field">
                    <span>Call time</span>
                    <input
                      type="time"
                      value={editor.draft.callTime}
                      onChange={(event) =>
                        setEditor({
                          kind: "event",
                          draft: { ...editor.draft, callTime: event.target.value }
                        })
                      }
                    />
                  </label>
                </div>
                <div className="info-card">
                  <div className="eyebrow">Preview</div>
                  <strong>{formatDisplayDate(editor.draft.date)}</strong>
                  <p>
                    {formatCountdown(editor.draft.date)} • Call time{" "}
                    {formatDisplayTime(editor.draft.callTime)}
                  </p>
                </div>
                <label className="field">
                  <span>Location</span>
                  <input
                    value={editor.draft.location}
                    onChange={(event) =>
                      setEditor({
                        kind: "event",
                        draft: { ...editor.draft, location: event.target.value }
                      })
                    }
                  />
                </label>
              </div>
            ) : null}

            {editor.kind === "update" ? (
              <div className="leader-form">
                <label className="field">
                  <span>Title</span>
                  <input
                    value={editor.draft.title}
                    onChange={(event) =>
                      setEditor({
                        kind: "update",
                        draft: { ...editor.draft, title: event.target.value }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Summary</span>
                  <textarea
                    rows={4}
                    value={editor.draft.summary}
                    onChange={(event) =>
                      setEditor({
                        kind: "update",
                        draft: { ...editor.draft, summary: event.target.value }
                      })
                    }
                  />
                </label>
                <div className="split-fields">
                  <label className="field">
                    <span>Category</span>
                    <select
                      value={editor.draft.category}
                      onChange={(event) =>
                        setEditor({
                          kind: "update",
                          draft: {
                            ...editor.draft,
                            category: event.target.value as UpdateItem["category"]
                          }
                        })
                      }
                    >
                      <option value="music">Music</option>
                      <option value="choreo">Choreo</option>
                      <option value="logistics">Logistics</option>
                      <option value="costume">Costume</option>
                      <option value="general">General</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Recipients</span>
                    <select
                      value={editor.draft.audience}
                      onChange={(event) =>
                        setEditor({
                          kind: "update",
                          draft: {
                            ...editor.draft,
                            audience: event.target.value as UpdateItem["audience"]
                          }
                        })
                      }
                    >
                      <option value="students">Students</option>
                      <option value="parents">Parents</option>
                      <option value="both">Both</option>
                    </select>
                  </label>
                </div>
                <div className="split-fields">
                  <label className="field">
                    <span>Delivery</span>
                    <select
                      value={editor.draft.urgency}
                      onChange={(event) =>
                        setEditor({
                          kind: "update",
                          draft: {
                            ...editor.draft,
                            urgency: event.target.value as UpdateItem["urgency"]
                          }
                        })
                      }
                    >
                      <option value="routine">Routine</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Applies to</span>
                    <select
                      value={editor.draft.scopeType}
                      onChange={(event) =>
                        setEditor({
                          kind: "update",
                          draft: {
                            ...editor.draft,
                            scopeType: event.target.value as UpdateItem["scopeType"],
                            choirId:
                              event.target.value === "program" ? undefined : editor.draft.choirId
                          }
                        })
                      }
                    >
                      <option value="choir">Choir</option>
                      <option value="program">Program</option>
                    </select>
                  </label>
                </div>
                {editor.draft.scopeType === "choir" ? (
                  <label className="field">
                    <span>Choir</span>
                    <select
                      value={editor.draft.choirId ?? program.choirs[0]?.id ?? ""}
                      onChange={(event) =>
                        setEditor({
                          kind: "update",
                          draft: { ...editor.draft, choirId: event.target.value }
                        })
                      }
                    >
                      {program.choirs.map((choir) => (
                        <option key={choir.id} value={choir.id}>
                          {choir.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}

            {editor.kind === "task" ? (
              <div className="leader-form">
                <label className="field">
                  <span>Title</span>
                  <input
                    value={editor.draft.title}
                    onChange={(event) =>
                      setEditor({
                        kind: "task",
                        draft: { ...editor.draft, title: event.target.value }
                      })
                    }
                  />
                </label>
                <div className="split-fields">
                  <label className="field">
                    <span>Choir</span>
                    <select
                      value={editor.draft.choirId}
                      onChange={(event) =>
                        setEditor({
                          kind: "task",
                          draft: { ...editor.draft, choirId: event.target.value }
                        })
                      }
                    >
                      {program.choirs.map((choir) => (
                        <option key={choir.id} value={choir.id}>
                          {choir.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Task type</span>
                    <select
                      value={editor.draft.type}
                      onChange={(event) =>
                        setEditor({
                          kind: "task",
                          draft: { ...editor.draft, type: event.target.value as Task["type"] }
                        })
                      }
                    >
                      <option value="listen">Listen</option>
                      <option value="watch">Watch</option>
                      <option value="read">Read</option>
                      <option value="bring">Bring</option>
                      <option value="confirm">Confirm</option>
                    </select>
                  </label>
                </div>
                <div className="split-fields">
                  <label className="field">
                    <span>Category</span>
                    <select
                      value={editor.draft.category}
                      onChange={(event) =>
                        setEditor({
                          kind: "task",
                          draft: {
                            ...editor.draft,
                            category: event.target.value as Task["category"]
                          }
                        })
                      }
                    >
                      <option value="music">Music</option>
                      <option value="choreo">Choreo</option>
                      <option value="logistics">Logistics</option>
                      <option value="costume">Costume</option>
                      <option value="general">General</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Priority</span>
                    <select
                      value={editor.draft.priority}
                      onChange={(event) =>
                        setEditor({
                          kind: "task",
                          draft: {
                            ...editor.draft,
                            priority: event.target.value as Task["priority"]
                          }
                        })
                      }
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span>Due date</span>
                  <input
                    type="datetime-local"
                    value={editor.draft.dueAt ?? ""}
                    onChange={(event) =>
                      setEditor({
                        kind: "task",
                        draft: {
                          ...editor.draft,
                          dueAt: event.target.value || undefined
                        }
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Resource link</span>
                  <input
                    value={editor.draft.resourceUrl ?? ""}
                    onChange={(event) =>
                      setEditor({
                        kind: "task",
                        draft: {
                          ...editor.draft,
                          resourceUrl: event.target.value || undefined
                        }
                      })
                    }
                  />
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={editor.draft.completed}
                    onChange={(event) =>
                      setEditor({
                        kind: "task",
                        draft: { ...editor.draft, completed: event.target.checked }
                      })
                    }
                  />
                  <span>Completed</span>
                </label>
              </div>
            ) : null}

            <div className="leader-drawer-actions">
              <button type="button" className="secondary-button leader-secondary" onClick={() => setEditor(null)}>
                Cancel
              </button>
            <button
              type="button"
              className="primary-button"
              data-testid="drawer-save"
              onClick={saveEditor}
            >
              Save changes
            </button>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
