import { FormEvent, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Mail, Sparkles } from "lucide-react";
import { useAppState } from "../../context/AppContext";

export function SignInPage() {
  const { session, signIn } = useAppState();
  const [email, setEmail] = useState(session.email);
  const [sent, setSent] = useState(Boolean(session.email));

  const normalizedEmail = useMemo(() => email.trim(), [email]);

  if (session.email && session.role) {
    return <Navigate to={`/${session.role}`} replace />;
  }

  if (session.email && !session.role) {
    return <Navigate to="/join" replace />;
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return;
    }

    signIn(normalizedEmail);
    setSent(true);
  };

  return (
    <div className="shell">
      <div className="phone-frame auth-frame">
        <div className="auth-panel">
          <div className="eyebrow">Magic Link Sign-In</div>
          <h1>Get into your choir fast</h1>
          <p>
            This MVP simulates email magic link login. Enter your email, then continue to
            your program invite code.
          </p>

          <form onSubmit={handleSubmit} className="leader-form">
            <label className="field">
              <span>Email address</span>
              <div className="input-with-icon">
                <Mail size={16} />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="student@school.edu"
                />
              </div>
            </label>

            <button type="submit" className="primary-button">
              Send magic link
            </button>
          </form>

          {sent ? (
            <div className="magic-card">
              <div className="magic-card-top">
                <Sparkles size={18} />
                <strong>Magic link sent</strong>
              </div>
              <p>
                You are signed in as <strong>{normalizedEmail}</strong>. Continue to join
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
