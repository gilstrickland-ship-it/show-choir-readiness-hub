import { FormEvent, useState } from "react";
import { useAppState } from "../../context/AppContext";
import { TaskType, UpdateCategory, UpdateUrgency } from "../../types";

const categoryOptions: UpdateCategory[] = ["music", "choreo", "logistics", "costume", "general"];
const taskTypeOptions: TaskType[] = ["listen", "watch", "read", "bring", "confirm"];

export function LeaderPublishPage() {
  const { addLeaderUpdate, program } = useAppState();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<UpdateCategory>("general");
  const [audience, setAudience] = useState<"students" | "parents" | "both">("students");
  const [urgency, setUrgency] = useState<UpdateUrgency>("routine");
  const [scopeType, setScopeType] = useState<"program" | "choir">("choir");
  const [choirId, setChoirId] = useState(program.choirs[0]?.id ?? "");
  const [createTask, setCreateTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("read");
  const [taskPriority, setTaskPriority] = useState<"high" | "medium" | "low">("medium");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!title.trim() || !summary.trim()) {
      return;
    }

    addLeaderUpdate({
      title: title.trim(),
      summary: summary.trim(),
      category,
      audience,
      urgency,
      scopeType,
      choirId: scopeType === "choir" ? choirId : undefined,
      createTask: scopeType === "choir" ? createTask : false,
      taskTitle,
      taskType,
      taskPriority
    });

    setTitle("");
    setSummary("");
    setCategory("general");
    setAudience("students");
    setUrgency("routine");
    setScopeType("choir");
    setChoirId(program.choirs[0]?.id ?? "");
    setCreateTask(false);
    setTaskTitle("");
    setTaskType("read");
    setTaskPriority("medium");
  };

  return (
    <div className="leader-grid">
      <section className="leader-panel">
        <div className="eyebrow">New update</div>
        <h2>Publish to the right audience</h2>
        <form className="leader-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Short headline for the update"
            />
          </label>

          <label className="field">
            <span>Summary</span>
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={4}
              placeholder="What changed, and what should users do next?"
            />
          </label>

          <div className="field">
            <span>Category</span>
            <div className="segmented">
              {categoryOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={category === option ? "segment segment-active" : "segment"}
                  onClick={() => setCategory(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>Scope</span>
            <div className="segmented two-up">
              {[
                { key: "choir", label: "Single choir" },
                { key: "program", label: "Whole program" }
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={scopeType === option.key ? "segment segment-active" : "segment"}
                  onClick={() => setScopeType(option.key as "program" | "choir")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {scopeType === "choir" ? (
            <label className="field">
              <span>Target choir</span>
              <select value={choirId} onChange={(event) => setChoirId(event.target.value)}>
                {program.choirs.map((choir) => (
                  <option key={choir.id} value={choir.id}>
                    {choir.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="field">
            <span>Audience</span>
            <div className="segmented two-up">
              {[
                { key: "students", label: "Students" },
                { key: "parents", label: "Parents" },
                { key: "both", label: "Both" }
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={audience === option.key ? "segment segment-active" : "segment"}
                  onClick={() => setAudience(option.key as typeof audience)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>Urgency</span>
            <div className="segmented two-up">
              {[
                { key: "routine", label: "Routine digest" },
                { key: "urgent", label: "Urgent push" }
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={urgency === option.key ? "segment segment-active" : "segment"}
                  onClick={() => setUrgency(option.key as UpdateUrgency)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={createTask}
              disabled={scopeType === "program"}
              onChange={(event) => setCreateTask(event.target.checked)}
            />
            <span>
              Create a linked student action item
              {scopeType === "program" ? " (choir-only)" : ""}
            </span>
          </label>

          {createTask && scopeType === "choir" ? (
            <div className="linked-task-box">
              <label className="field">
                <span>Task title</span>
                <input
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  placeholder="Review updated ballad counts"
                />
              </label>
              <div className="split-fields">
                <label className="field">
                  <span>Task type</span>
                  <select
                    value={taskType}
                    onChange={(event) => setTaskType(event.target.value as TaskType)}
                  >
                    {taskTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Priority</span>
                  <select
                    value={taskPriority}
                    onChange={(event) =>
                      setTaskPriority(event.target.value as "high" | "medium" | "low")
                    }
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          <button type="submit" className="primary-button">
            Publish update
          </button>
        </form>
      </section>

      <aside className="leader-aside">
        <div className="info-card">
          <div className="eyebrow">Default guardrails</div>
          <ul>
            <li>Use choir scope for rehearsal or performance-specific updates.</li>
            <li>Use program scope for paperwork, broad logistics, or all-program reminders.</li>
            <li>Linked tasks should stay choir-scoped so students only see relevant action items.</li>
          </ul>
        </div>
        <div className="info-card">
          <div className="eyebrow">MVP note</div>
          <p>
            This version supports one program with multiple choirs, including students who
            belong to more than one choir.
          </p>
        </div>
      </aside>
    </div>
  );
}
