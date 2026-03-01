import { CheckCircle2, ExternalLink, Filter, Siren } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppState } from "../../context/AppContext";

export function StudentQueuePage() {
  const { getChoirLabel, toggleTask, visibleTasks } = useAppState();
  const [filter, setFilter] = useState<"all" | "urgent">("all");

  const filteredTasks = useMemo(() => {
    const sorted = [...visibleTasks].sort((left, right) => {
      if (left.completed !== right.completed) return left.completed ? 1 : -1;
      const priorityRank = { high: 0, medium: 1, low: 2 };
      return priorityRank[left.priority] - priorityRank[right.priority];
    });

    if (filter === "urgent") {
      return sorted.filter((task) => !task.completed && task.priority === "high");
    }

    return sorted;
  }, [filter, visibleTasks]);

  return (
    <div className="stack-lg">
      <section className="filter-row">
        <div>
          <div className="eyebrow">Practice queue</div>
          <h3>{visibleTasks.filter((task) => !task.completed).length} pending tasks</h3>
        </div>
        <div className="chip-group">
          <button
            type="button"
            className={filter === "all" ? "chip chip-active" : "chip"}
            onClick={() => setFilter("all")}
          >
            <Filter size={14} />
            All
          </button>
          <button
            type="button"
            className={filter === "urgent" ? "chip chip-danger" : "chip"}
            onClick={() => setFilter("urgent")}
          >
            <Siren size={14} />
            Urgent
          </button>
        </div>
      </section>

      {filteredTasks.length === 0 ? (
        <div className="empty-card">No tasks match this filter.</div>
      ) : (
        filteredTasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => toggleTask(task.id)}
            className={task.completed ? "queue-card queue-card-complete" : "queue-card"}
          >
            <div className={task.completed ? "check-bullet check-done" : "check-bullet"}>
              {task.completed ? <CheckCircle2 size={18} /> : null}
            </div>
            <div className="queue-copy">
              <div className="queue-title-row">
                <strong>{task.title}</strong>
                {task.priority === "high" && !task.completed ? (
                  <span className="mini-alert">
                    <Siren size={12} />
                    Urgent
                  </span>
                ) : null}
              </div>
              <div className="queue-meta">
                <span className={`mini-badge mini-${task.category}`}>{task.category}</span>
                <span>{getChoirLabel(task.choirId)}</span>
                <span>{task.type}</span>
                {task.dueLabel ? <span>{task.dueLabel}</span> : null}
                {task.resourceUrl ? (
                  <span className="resource-pill">
                    <ExternalLink size={12} />
                    Link
                  </span>
                ) : null}
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
