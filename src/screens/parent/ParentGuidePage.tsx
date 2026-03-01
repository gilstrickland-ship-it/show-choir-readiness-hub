import { CheckCircle2, Clock3, MapPin } from "lucide-react";
import { useAppState } from "../../context/AppContext";
import { formatDisplayDate, formatDisplayTime } from "../../utils/formatting";

export function ParentGuidePage() {
  const { activeEvent, getChoirLabel } = useAppState();

  return (
    <div className="stack-lg">
      <section className="parent-hero">
        <div className="eyebrow">Event logistics</div>
        <h2>{activeEvent.title}</h2>
        <p>{formatDisplayDate(activeEvent.date)}</p>
        <p className="scope-label">
          {activeEvent.scopeType === "program"
            ? "All Choirs"
            : getChoirLabel(activeEvent.choirId)}
        </p>
        <div className="meta-list compact">
          <div className="meta-item">
            <Clock3 size={16} />
            <span>Call time {formatDisplayTime(activeEvent.callTime)}</span>
          </div>
          <div className="meta-item">
            <MapPin size={16} />
            <span>{activeEvent.location}</span>
          </div>
        </div>
      </section>

      <section className="stack-md">
        <div className="eyebrow">Day timeline</div>
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
        <div className="eyebrow">Packing list</div>
        <div className="list-card list-card-soft">
          {activeEvent.packingList.map((item) => (
            <div key={item} className="list-row">
              <CheckCircle2 size={16} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
