import { FormEvent, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Mail, Sparkles } from "lucide-react";
import { useAppState } from "../../context/AppContext";

export function SignInPage() {
  const { session, signIn } = useAppState();
  const [email, setEmail] = useState(session.email);
  const [sent, setSent] = useState(Boolean(session.email));

  const normalizedEmail = useMemo(() => email.trim(), [email]);
  const displayIdentity = normalizedEmail || "Prototype User";

  if (session.email && session.role) {
    return <Navigate to={`/${session.role}`} replace />;
  }

  if (session.email && !session.role) {
    return <Navigate to="/join" replace />;
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    signIn(displayIdentity);
    setSent(true);
  };

  return (
    <div className="shell">
      <div className="phone-frame auth-frame">
        <div className="auth-panel">
          <div className="eyebrow">Magic Link Sign-In</div>
          <h1>Get into your choir fast</h1>
          <p>
            Show Choir Readiness Hub helps students, parents, and leaders stay in sync.
            Check what changed, what to practice, what to bring, and what happens next, all
            in one place.
          </p>
          <p>
            Leaders can include directors, volunteers, student leaders, and board members,
            so the full management team can help coordinate communication for students and
            parents.
          </p>
          <p>
            This MVP skips real email authentication. Enter anything you want, or leave it
            blank, then continue to your program role selection.
          </p>

          <form onSubmit={handleSubmit} className="leader-form">
            <label className="field">
              <span>Name or email (optional)</span>
              <div className="input-with-icon">
                <Mail size={16} />
                <input
                  type="text"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Your name"
                />
              </div>
            </label>

            <button type="submit" className="primary-button">
              Continue
            </button>
          </form>

          {sent ? (
            <div className="magic-card">
              <div className="magic-card-top">
                <Sparkles size={18} />
                <strong>You are in</strong>
              </div>
              <p>
                You are signed in as <strong>{displayIdentity}</strong>. Continue to join
                your program with the correct invite code.
              </p>
              <Link to="/join" className="inline-link">
                Continue to program join
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
