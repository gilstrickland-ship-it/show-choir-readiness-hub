import { useRef } from "react";
import {
  Navigate,
  Outlet,
  createBrowserRouter,
  NavLink,
  useNavigate
} from "react-router-dom";
import {
  Bell,
  ClipboardList,
  Compass,
  Home,
  LogOut,
  Megaphone
} from "lucide-react";
import { useAppState } from "./context/AppContext";
import { UserRole } from "./types";
import { StudentHomePage } from "./screens/student/StudentHomePage";
import { StudentQueuePage } from "./screens/student/StudentQueuePage";
import { StudentUpdatesPage } from "./screens/student/StudentUpdatesPage";
import { StudentGuidePage } from "./screens/student/StudentGuidePage";
import { ParentHomePage } from "./screens/parent/ParentHomePage";
import { ParentUpdatesPage } from "./screens/parent/ParentUpdatesPage";
import { ParentGuidePage } from "./screens/parent/ParentGuidePage";
import { LeaderDashboardPage } from "./screens/leader/LeaderDashboardPage";
import { SignInPage } from "./screens/auth/SignInPage";
import { JoinTeamPage } from "./screens/auth/JoinTeamPage";

function HomeRedirect() {
  const { session } = useAppState();

  if (!session.email) {
    return <Navigate to="/auth/sign-in" replace />;
  }

  if (!session.role) {
    return <Navigate to="/join" replace />;
  }

  return <Navigate to={`/${session.role}`} replace />;
}

function ProtectedRole({
  allowedRole,
  children
}: {
  allowedRole: UserRole;
  children: JSX.Element;
}) {
  const { session } = useAppState();

  if (!session.email) {
    return <Navigate to="/auth/sign-in" replace />;
  }

  if (!session.role) {
    return <Navigate to="/join" replace />;
  }

  if (session.role !== allowedRole) {
    return <Navigate to={`/${session.role}`} replace />;
  }

  return children;
}

function AppFrame({
  title,
  subtitle,
  navItems
}: {
  title: string;
  subtitle: string;
  navItems: Array<{ to: string; label: string; icon: typeof Home }>;
}) {
  const { session, signOut } = useAppState();
  const navigate = useNavigate();

  const handleSignOut = () => {
    signOut();
    navigate("/auth/sign-in", { replace: true });
  };

  return (
    <div className="shell">
      <div className="phone-frame">
        <header className="app-header">
          <div className="header-row">
            <div className="eyebrow">Show Choir Readiness Hub</div>
            <button type="button" className="header-action" onClick={handleSignOut}>
              <LogOut size={14} />
            </button>
          </div>
          <h1>{title}</h1>
          <p>
            {subtitle}
            {session.programName ? ` • ${session.programName}` : ""}
          </p>
        </header>
        <main className="app-main">
          <Outlet />
        </main>
        <nav className="bottom-nav" aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive ? "nav-link nav-link-active" : "nav-link"
                }
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function LeaderFrame() {
  const { session, signOut } = useAppState();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement | null>(null);

  const handleSignOut = () => {
    signOut();
    navigate("/auth/sign-in", { replace: true });
  };

  const handleConsoleClick = () => {
    navigate("/leader", { replace: true });
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="shell shell-wide">
      <div className="leader-shell">
        <header className="leader-header">
          <div>
            <div className="eyebrow">Leader Console</div>
            <h1>Publish Updates</h1>
            <p>
              Post routine or urgent updates and create linked action items.
              {session.programName ? ` • ${session.programName}` : ""}
            </p>
          </div>
          <div className="leader-header-actions">
            <button type="button" className="leader-link" onClick={handleSignOut}>
              <LogOut size={16} />
              Sign Out
            </button>
            <button
              type="button"
              className="leader-link leader-link-active"
              onClick={handleConsoleClick}
            >
              <Megaphone size={16} />
              Console
            </button>
          </div>
        </header>
        <main className="leader-main" ref={mainRef}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const studentNav = [
  { to: "/student/home", label: "Home", icon: Home },
  { to: "/student/queue", label: "Queue", icon: ClipboardList },
  { to: "/student/updates", label: "Updates", icon: Bell },
  { to: "/student/guide", label: "Guide", icon: Compass }
];

const parentNav = [
  { to: "/parent/home", label: "Home", icon: Home },
  { to: "/parent/updates", label: "Updates", icon: Bell },
  { to: "/parent/guide", label: "Guide", icon: Compass }
];

export const router = createBrowserRouter([
  {
    path: "/",
    element: <HomeRedirect />
  },
  {
    path: "/auth/sign-in",
    element: <SignInPage />
  },
  {
    path: "/join",
    element: <JoinTeamPage />
  },
  {
    path: "/student",
    element: (
      <ProtectedRole allowedRole="student">
        <AppFrame
          title="Student Mode"
          subtitle="Know what changed, what matters next, and how ready you are."
          navItems={studentNav}
        />
      </ProtectedRole>
    ),
    children: [
      { index: true, element: <Navigate to="/student/home" replace /> },
      { path: "home", element: <StudentHomePage /> },
      { path: "queue", element: <StudentQueuePage /> },
      { path: "updates", element: <StudentUpdatesPage /> },
      { path: "guide", element: <StudentGuidePage /> }
    ]
  },
  {
    path: "/parent",
    element: (
      <ProtectedRole allowedRole="parent">
        <AppFrame
          title="Parent Mode"
          subtitle="Glanceable choir logistics without the performer-only detail."
          navItems={parentNav}
        />
      </ProtectedRole>
    ),
    children: [
      { index: true, element: <Navigate to="/parent/home" replace /> },
      { path: "home", element: <ParentHomePage /> },
      { path: "updates", element: <ParentUpdatesPage /> },
      { path: "guide", element: <ParentGuidePage /> }
    ]
  },
  {
    path: "/leader",
    element: (
      <ProtectedRole allowedRole="leader">
        <LeaderFrame />
      </ProtectedRole>
    ),
    children: [{ index: true, element: <LeaderDashboardPage /> }]
  }
]);
