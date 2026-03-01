import { FormEvent, useState } from "react";
import { useAppState } from "../../context/AppContext";

export function LeaderSettingsPage() {
  const { program, updateProgramBranding, updateChoirName } = useAppState();
  const [programName, setProgramName] = useState(program.name);
  const [logoUrl, setLogoUrl] = useState(program.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(program.primaryColor);
  const [accentColor, setAccentColor] = useState(program.accentColor);
  const [message, setMessage] = useState("");

  const [choirNames, setChoirNames] = useState(
    Object.fromEntries(program.choirs.map((choir) => [choir.id, choir.name]))
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    updateProgramBranding({
      name: programName.trim() || program.name,
      logoUrl: logoUrl.trim(),
      primaryColor,
      accentColor
    });

    program.choirs.forEach((choir) => {
      const nextName = (choirNames[choir.id] ?? choir.name).trim() || choir.name;
      const nextShortLabel = nextName.split(" ")[0]?.slice(0, 12) || choir.shortLabel;
      updateChoirName(choir.id, { name: nextName, shortLabel: nextShortLabel });
    });

    setMessage("Settings saved. Theme updates apply across the app.");
  };

  return (
    <div className="leader-grid">
      <section className="leader-panel stack-md">
        <div className="eyebrow">Branding</div>
        <h2>Control the program theme</h2>
        <form className="leader-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Program name</span>
            <input
              value={programName}
              onChange={(event) => setProgramName(event.target.value)}
              placeholder="School program name"
            />
          </label>

          <label className="field">
            <span>Logo image URL</span>
            <input
              value={logoUrl}
              onChange={(event) => setLogoUrl(event.target.value)}
              placeholder="https://example.com/logo.png"
            />
          </label>

          <div className="split-fields">
            <label className="field">
              <span>Primary color</span>
              <input
                type="color"
                value={primaryColor}
                onChange={(event) => setPrimaryColor(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Accent color</span>
              <input
                type="color"
                value={accentColor}
                onChange={(event) => setAccentColor(event.target.value)}
              />
            </label>
          </div>

          <div className="leader-panel stack-md settings-subpanel">
            <div className="eyebrow">Choirs</div>
            {program.choirs.map((choir) => (
              <label key={choir.id} className="field">
                <span>{choir.shortLabel}</span>
                <input
                  value={choirNames[choir.id] ?? choir.name}
                  onChange={(event) =>
                    setChoirNames((current) => ({ ...current, [choir.id]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>

          <button type="submit" className="primary-button">
            Save settings
          </button>
        </form>

        {message ? <div className="alert-card">{message}</div> : null}
      </section>

      <aside className="leader-aside">
        <div className="info-card stack-md">
          <div className="eyebrow">Preview</div>
          <div className="brand-preview">
            {logoUrl.trim() ? <img src={logoUrl.trim()} alt="" className="brand-logo brand-logo-large" /> : null}
            <strong>{programName || program.name}</strong>
            <div className="brand-swatches">
              <span className="brand-swatch" style={{ background: primaryColor }} />
              <span className="brand-swatch" style={{ background: accentColor }} />
            </div>
          </div>
          <p>
            These settings update the theme colors for student, parent, and leader views in
            this prototype.
          </p>
        </div>

        <div className="info-card">
          <div className="eyebrow">Notes</div>
          <ul>
            <li>Use a direct image URL for the logo.</li>
            <li>Choir short labels update automatically from the new name.</li>
            <li>Theme colors apply immediately after saving.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
