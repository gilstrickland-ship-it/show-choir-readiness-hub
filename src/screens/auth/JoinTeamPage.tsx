import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useAppState } from "../../context/AppContext";

export function JoinTeamPage() {
  const { joinProgram, session, signOut } = useAppState();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  if (!session.email) {
    return <Navigate to="/auth/sign-in" replace />;
  }

  if (session.role) {
    return <Navigate to={`/${session.role}`} replace />;
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = joinProgram(code);
    setMessage(result.message);
    setIsError(!result.ok);
  };

  const handleQuickJoin = (inviteCode: string) => {
    const result = joinProgram(inviteCode);
    setCode(inviteCode);
    setMessage(result.message);
    setIsError(!result.ok);
  };

  const handleSignOut = () => {
    signOut();
    navigate("/auth/sign-in", { replace: true });
  };

  return (
    <div className="shell">
      <div className="phone-frame auth-frame">
        <div className="auth-panel">
          <div className="eyebrow">Join Your Team</div>
          <h1>Enter your invite code</h1>
          <p>
            You are signed in as <strong>{session.email}</strong>. Use the invite code for your
            role to join the program in the correct view.
          </p>

          <form onSubmit={handleSubmit} className="leader-form">
            <label className="field">
              <span>Invite code</span>
              <div className="input-with-icon">
                <KeyRound size={16} />
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Student"
                />
              </div>
            </label>

            <button type="submit" className="primary-button">
              Join choir
            </button>
          </form>

          <div className="info-card">
            <div className="magic-card-top">
              <ShieldCheck size={18} />
              <strong>Prototype test codes</strong>
            </div>
            <div className="segmented">
              <button
                type="button"
                className="segment"
                data-testid="join-student"
                onClick={() => handleQuickJoin("Student")}
              >
                Student
              </button>
              <button
                type="button"
                className="segment"
                data-testid="join-parent"
                onClick={() => handleQuickJoin("Parent")}
              >
                Parent
              </button>
              <button
                type="button"
                className="segment"
                data-testid="join-leader"
                onClick={() => handleQuickJoin("Leader")}
              >
                Leader
              </button>
            </div>
          </div>

          {message ? (
            <div className={isError ? "alert-card alert-card-error" : "alert-card"}>
              {message}
            </div>
          ) : null}

          <button type="button" className="secondary-button" onClick={handleSignOut}>
            <LogOut size={16} />
            Use a different email
          </button>
        </div>
      </div>
    </div>
  );
}
