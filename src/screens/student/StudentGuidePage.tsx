import { Backpack, CheckCircle2, Clock3, MapPin, ShieldAlert } from "lucide-react";
import { useAppState } from "../../context/AppContext";

export function StudentGuidePage() {
  const { activeEvent, getChoirLabel } = useAppState();

  return (
    <div className="stack-lg">
      <section className="guide-hero">
        <span className="type-badge">Competition guide</span>
        <h2>{activeEvent.title}</h2>
        <p className="scope-label">
          {activeEvent.scopeType === "program"
            ? "Program-wide"
            : getChoirLabel(activeEvent.choirId)}
        </p>
        <div className="meta-list compact">
          <div className="meta-item">
            <Clock3 size={16} />
            <span>Call time {activeEvent.callTime}</span>
          </div>
          <div className="meta-item">
            <MapPin size={16} />
            <span>{activeEvent.location}</span>
          </div>
        </div>
      </section>

      <section className="stack-md">
        <div className="section-row">
          <div>
            <div className="eyebrow">Timeline</div>
            <h3>What happens next</h3>
          </div>
        </div>
        <div className="timeline-simple">
          {activeEvent.timeline.map((item) => (
            <div key={`${item.time}-${item.activity}`} className="timeline-simple-item">
              <strong>{item.time}</strong>
              <span>{item.activity}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stack-md">
        <div className="section-row">
          <div>
            <div className="eyebrow">Packing list</div>
            <h3>Bring these items</h3>
          </div>
          <Backpack size={18} />
        </div>
        <div className="list-card">
          {activeEvent.packingList.map((item) => (
            <div key={item} className="list-row">
              <CheckCircle2 size={16} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stack-md">
        <div className="eyebrow">Important notes</div>
        <div className="note-card">
          <ShieldAlert size={18} />
          <div>
            <strong>Arrival rule</strong>
            <p>Be performance-ready on the bus. Hair, makeup, and underlayers should already be done.</p>
          </div>
        </div>
        <div className="note-card">
          <ShieldAlert size={18} />
          <div>
            <strong>What matters next</strong>
            <p>Focus first on the updated call time, then finish your urgent queue tasks before tonight.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
