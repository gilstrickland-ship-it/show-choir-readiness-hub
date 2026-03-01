import { FormEvent, useState } from "react";
import { useAppState } from "../../context/AppContext";

export function LeaderSettingsPage() {
  const {
    program,
    allUsers,
    updateProgramBranding,
    updateChoirName,
    importUsersFromCsv,
    updateUser,
    deleteUser
  } = useAppState();
  const [programName, setProgramName] = useState(program.name);
  const [logoUrl, setLogoUrl] = useState(program.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(program.primaryColor);
  const [accentColor, setAccentColor] = useState(program.accentColor);
  const [spreadsheetText, setSpreadsheetText] = useState("");
  const [userSearch, setUserSearch] = useState("");
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

    setMessage("Settings saved. School colors and branding now update across the app.");
  };

  const handleImportUsers = () => {
    const result = importUsersFromCsv(spreadsheetText);
    setMessage(result.message);
    if (result.ok) {
      setSpreadsheetText("");
    }
  };

  const normalizedUserSearch = userSearch.trim().toLowerCase();
  const filteredUsers = allUsers.filter((user) => {
    if (!normalizedUserSearch) {
      return true;
    }

    const choirText = user.choirIds
      .map(
        (choirId) =>
          program.choirs.find((choir) => choir.id === choirId)?.name ??
          program.choirs.find((choir) => choir.id === choirId)?.shortLabel ??
          choirId
      )
      .join(" ")
      .toLowerCase();

    return [user.name, user.email, user.role, choirText]
      .join(" ")
      .toLowerCase()
      .includes(normalizedUserSearch);
  });

  return (
    <div className="stack-lg">
      <div className="leader-grid">
        <section className="leader-panel stack-md">
          <div className="eyebrow">Branding</div>
          <h2>Manage program branding</h2>
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
              <span>Logo image</span>
              <input
                type="url"
                value={logoUrl}
                onChange={(event) => setLogoUrl(event.target.value)}
                placeholder="https://example.com/logo.png"
              />
              <small className="muted-line">Paste a direct image URL for this prototype.</small>
            </label>

            <div className="field">
              <span>School colors</span>
              <div className="color-swatch-row">
                <label className="color-swatch-field">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(event) => setPrimaryColor(event.target.value)}
                    aria-label="Primary color"
                  />
                  <span className="color-swatch" style={{ background: primaryColor }} />
                  <small>Primary</small>
                </label>
                <label className="color-swatch-field">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(event) => setAccentColor(event.target.value)}
                    aria-label="Accent color"
                  />
                  <span className="color-swatch" style={{ background: accentColor }} />
                  <small>Accent</small>
                </label>
              </div>
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

            <button type="submit" className="primary-button" data-testid="settings-save">
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
            </div>
            <p>
              These settings update school colors and branding for student, parent, and leader
              views in this prototype.
            </p>
          </div>

          <div className="info-card">
            <div className="eyebrow">Notes</div>
            <ul>
              <li>Use a direct image URL for the logo.</li>
              <li>Choir short labels update automatically from the new name.</li>
              <li>School colors apply immediately after saving.</li>
            </ul>
          </div>
        </aside>
      </div>

      <div className="leader-grid">
        <section className="leader-panel stack-md">
          <div className="eyebrow">Users</div>
          <h2>Import users</h2>
          <p>
            Paste CSV rows in the format: <strong>name, email, role, choirs</strong>. Use
            `|` between choir names in the fourth column.
          </p>

          <div className="leader-form">
            <label className="field">
              <span>Paste CSV rows</span>
              <textarea
                rows={6}
                value={spreadsheetText}
                onChange={(event) => setSpreadsheetText(event.target.value)}
                placeholder={"name, email, role, choirs\nJamie Smith, jamie@example.com, student, Premiere|Spectrum"}
              />
            </label>

            <button
              type="button"
              className="primary-button"
              data-testid="user-import"
              onClick={handleImportUsers}
            >
              Import users
            </button>
          </div>
        </section>

        <aside className="leader-aside">
          <div className="info-card">
            <div className="eyebrow">Import notes</div>
            <ul>
              <li>Accepted roles: student, parent, leader.</li>
              <li>The choir column is optional.</li>
              <li>Choir names can use full names or short labels.</li>
            </ul>
          </div>
        </aside>
      </div>

      <section className="leader-panel stack-md">
        <div className="eyebrow">Roster</div>
        <h2>Manage users</h2>
        <label className="field">
          <span>Search users</span>
          <input
            type="search"
            data-testid="user-search"
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
            placeholder="Search by name, email, role, or choir"
          />
        </label>
        <div className="stack-md">
          {filteredUsers.map((user) => (
            <div key={user.id} className="list-card leader-manage-card">
              <div className="leader-manage-top">
                <div className="split-fields">
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={user.name}
                      onChange={(event) => updateUser(user.id, { name: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Email</span>
                    <input
                      value={user.email}
                      onChange={(event) => updateUser(user.id, { email: event.target.value })}
                    />
                  </label>
                </div>
                <div className="leader-item-actions">
                  <button
                    type="button"
                    className="segment"
                    onClick={() => deleteUser(user.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="split-fields">
                <label className="field">
                  <span>Role</span>
                  <select
                    value={user.role}
                    onChange={(event) =>
                      updateUser(user.id, {
                        role: event.target.value as typeof user.role
                      })
                    }
                  >
                    <option value="student">Student</option>
                    <option value="parent">Parent</option>
                    <option value="leader">Leader</option>
                  </select>
                </label>
                <label className="field">
                  <span>Choirs</span>
                  <input
                    value={user.choirIds.map((choirId) => program.choirs.find((choir) => choir.id === choirId)?.shortLabel ?? choirId).join(" | ")}
                    onChange={(event) => {
                      const choirIds = event.target.value
                        .split("|")
                        .map((value) => value.trim().toLowerCase())
                        .filter(Boolean)
                        .map((token) => {
                          const byId = program.choirs.find((choir) => choir.id.toLowerCase() === token);
                          if (byId) {
                            return byId.id;
                          }
                          const byName = program.choirs.find(
                            (choir) =>
                              choir.name.toLowerCase() === token ||
                              choir.shortLabel.toLowerCase() === token
                          );
                          return byName?.id;
                        })
                        .filter((value): value is string => Boolean(value));

                      updateUser(user.id, { choirIds });
                    }}
                  />
                </label>
              </div>
            </div>
          ))}
          {filteredUsers.length === 0 ? (
            <div className="empty-card">No users match this search.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
