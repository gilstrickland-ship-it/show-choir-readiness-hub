import {
  Navigate,
  Outlet,
  createBrowserRouter,
  NavLink,
  useLocation,
  useNavigate
} from "react-router-dom";
import {
  Bell,
  ClipboardList,
  Compass,
  Home,
  LogOut,
  Megaphone,
  Settings
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
import { LeaderPublishPage } from "./screens/leader/LeaderPublishPage";
import { LeaderSettingsPage } from "./screens/leader/LeaderSettingsPage";
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
  const { program, session, signOut } = useAppState();
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
            <div className="brand-row">
              {program.logoUrl ? <img src={program.logoUrl} alt="" className="brand-logo" /> : null}
              <div className="eyebrow">Show Choir Readiness Hub</div>
            </div>
            <button type="button" className="header-action" onClick={handleSignOut}>
              <LogOut size={14} />
            </button>
          </div>
          <h1>{title}</h1>
          <p>
            {subtitle}
            {program.name ? ` • ${program.name}` : ""}
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
  const { program, signOut } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const isPublishPage = location.pathname.startsWith("/leader/publish");
  const isSettingsPage = location.pathname.startsWith("/leader/settings");

  const handleSignOut = () => {
    signOut();
    navigate("/auth/sign-in", { replace: true });
  };

  return (
    <div className="shell shell-wide">
      <div className="leader-shell">
        <header className="leader-header">
          <div>
            <div className="brand-row">
              {program.logoUrl ? <img src={program.logoUrl} alt="" className="brand-logo" /> : null}
              <div className="eyebrow">
                {isSettingsPage
                  ? "Leader Settings"
                  : isPublishPage
                    ? "Leader Publish"
                    : "Leader Dashboard"}
              </div>
            </div>
            <h1>
              {isSettingsPage ? "Program Settings" : isPublishPage ? "Publish Updates" : "Program Overview"}
            </h1>
            <p>
              {isSettingsPage
                ? "Update school branding, logo, choir names, and other organization settings."
                : isPublishPage
                ? "Post routine or urgent updates and create linked action items."
                : "Start from the dashboard, then jump into publishing when you need to post a change."}
              {program.name ? ` • ${program.name}` : ""}
            </p>
          </div>
          <div className="leader-header-actions">
            <button type="button" className="leader-link" onClick={handleSignOut}>
              <LogOut size={16} />
              Sign Out
            </button>
            <NavLink
              to="/leader/dashboard"
              className={({ isActive }) =>
                isActive ? "leader-link leader-link-active" : "leader-link"
              }
            >
              <Megaphone size={16} />
              Dashboard
            </NavLink>
            <NavLink
              to="/leader/publish"
              className={({ isActive }) =>
                isActive ? "leader-link leader-link-active" : "leader-link"
              }
            >
              <Megaphone size={16} />
              Publish
            </NavLink>
            <NavLink
              to="/leader/settings"
              className={({ isActive }) =>
                isActive ? "leader-link leader-link-active" : "leader-link"
              }
            >
              <Settings size={16} />
              Settings
            </NavLink>
          </div>
        </header>
        <main className="leader-main">
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
    children: [
      { index: true, element: <Navigate to="/leader/dashboard" replace /> },
      { path: "dashboard", element: <LeaderDashboardPage /> },
      { path: "publish", element: <LeaderPublishPage /> },
      { path: "settings", element: <LeaderSettingsPage /> }
    ]
  }
]);
