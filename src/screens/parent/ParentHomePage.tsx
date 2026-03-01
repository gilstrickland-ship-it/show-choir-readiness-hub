import { ArrowRight, Clock3, Layers3, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { useAppState } from "../../context/AppContext";

export function ParentHomePage() {
  const { activeEvent, getChoirLabel, visibleUpdates } = useAppState();
  const parentUpdates = visibleUpdates.filter(
    (update) => update.audience === "parents" || update.audience === "both"
  );

  return (
    <div className="stack-lg">
      <section className="parent-hero">
        <div className="eyebrow">Next event</div>
        <h2>{activeEvent.title}</h2>
        <div className="meta-list compact">
          <div className="meta-item">
            <Layers3 size={16} />
            <span>
              {activeEvent.scopeType === "program"
                ? "All Choirs"
                : getChoirLabel(activeEvent.choirId)}
            </span>
          </div>
          <div className="meta-item">
            <Clock3 size={16} />
            <span>Call time {activeEvent.callTime}</span>
          </div>
          <div className="meta-item">
            <MapPin size={16} />
            <span>{activeEvent.location}</span>
          </div>
        </div>
        <Link to="/parent/guide" className="inline-link parent-link">
          View full itinerary
          <ArrowRight size={16} />
        </Link>
      </section>

      <section className="stack-md">
        <div className="eyebrow">Major updates</div>
        <h3>What parents need to know</h3>
        {parentUpdates.length === 0 ? (
          <div className="empty-card">No parent-visible updates yet.</div>
        ) : (
          parentUpdates.slice(0, 3).map((update) => (
            <div key={update.id} className="parent-update-card">
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
            </div>
          ))
        )}
      </section>

      <section className="stack-md">
        <div className="eyebrow">Quick packing check</div>
        <h3>Top items to confirm</h3>
        <div className="list-card list-card-soft">
          {activeEvent.packingList.slice(0, 4).map((item) => (
            <div key={item} className="list-row">
              <span className="parent-bullet" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
