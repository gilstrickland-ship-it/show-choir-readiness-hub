import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  initialEvents,
  initialTasks,
  initialUpdates,
  inviteCodes,
  program
} from "../data";
import { AuthSession, EventItem, Task, UpdateItem } from "../types";

interface NewUpdateInput {
  title: string;
  summary: string;
  category: UpdateItem["category"];
  audience: UpdateItem["audience"];
  urgency: UpdateItem["urgency"];
  scopeType: UpdateItem["scopeType"];
  choirId?: string;
  createTask: boolean;
  taskTitle?: string;
  taskType?: Task["type"];
  taskPriority?: Task["priority"];
}

interface AppState {
  program: typeof program;
  events: EventItem[];
  activeChoirId: string | null;
  activeEvent: EventItem;
  visibleTasks: Task[];
  visibleUpdates: UpdateItem[];
  session: AuthSession;
  signIn: (email: string) => void;
  joinProgram: (code: string) => { ok: boolean; message: string };
  signOut: () => void;
  setPushEnabled: (enabled: boolean) => void;
  setActiveChoir: (choirId: string | null) => void;
  toggleTask: (taskId: string) => void;
  addLeaderUpdate: (input: NewUpdateInput) => void;
  getChoirLabel: (choirId?: string) => string;
}

const AppContext = createContext<AppState | null>(null);
const STORAGE_KEY = "show-choir-readiness-hub-state";

interface PersistedState {
  tasks: Task[];
  updates: UpdateItem[];
  session: AuthSession;
  activeChoirId: string | null;
}

function getDefaultSession(): AuthSession {
  return {
    email: "",
    role: null,
    programName: null,
    choirIds: [],
    pushEnabled: false
  };
}

function getDefaultState(): PersistedState {
  return {
    tasks: initialTasks,
    updates: initialUpdates,
    session: getDefaultSession(),
    activeChoirId: null
  };
}

function loadInitialState(): PersistedState {
  if (typeof window === "undefined") {
    return getDefaultState();
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return getDefaultState();
  }

  try {
    const parsed = JSON.parse(saved) as Partial<PersistedState>;
    return {
      tasks: parsed.tasks ?? initialTasks,
      updates: parsed.updates ?? initialUpdates,
      session: parsed.session ?? getDefaultSession(),
      activeChoirId:
        parsed.activeChoirId === undefined ? null : parsed.activeChoirId
    };
  } catch {
    return getDefaultState();
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const persisted = useMemo(loadInitialState, []);
  const [tasks, setTasks] = useState(persisted.tasks);
  const [updates, setUpdates] = useState(persisted.updates);
  const [session, setSession] = useState<AuthSession>(persisted.session);
  const [activeChoirId, setActiveChoirId] = useState<string | null>(persisted.activeChoirId);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tasks,
        updates,
        session,
        activeChoirId
      })
    );
  }, [activeChoirId, session, tasks, updates]);

  useEffect(() => {
    if (session.role !== "student" && activeChoirId && !session.choirIds.includes(activeChoirId)) {
      setActiveChoirId(session.choirIds[0] ?? null);
    }
  }, [activeChoirId, session.choirIds, session.role]);

  const signIn = (email: string) => {
    setSession((current) => ({
      ...current,
      email
    }));
  };

  const joinProgram = (code: string) => {
    const normalized = code.trim().toUpperCase();
    const match = inviteCodes.find((invite) => invite.code === normalized);

    if (!match) {
      return {
        ok: false,
        message: "That invite code is invalid or expired. Ask your leader for a fresh code."
      };
    }

    const joinedChoirIds = match.choirIds ?? [];
    setSession((current) => ({
      ...current,
      role: match.role,
      programName: program.name,
      choirIds: joinedChoirIds
    }));
    setActiveChoirId(joinedChoirIds[0] ?? null);

    const choirMessage =
      joinedChoirIds.length > 0
        ? ` with ${joinedChoirIds.length} choir membership${joinedChoirIds.length > 1 ? "s" : ""}`
        : "";

    return {
      ok: true,
      message: `Joined ${program.name} as ${match.role}${choirMessage}.`
    };
  };

  const signOut = () => {
    setSession(getDefaultSession());
    setActiveChoirId(null);
  };

  const setPushEnabled = (enabled: boolean) => {
    setSession((current) => ({ ...current, pushEnabled: enabled }));
  };

  const getChoirLabel = (choirId?: string) => {
    if (!choirId) {
      return "All Choirs";
    }

    return program.choirs.find((choir) => choir.id === choirId)?.shortLabel ?? "Unknown Choir";
  };

  const visibleTasks = useMemo(() => {
    if (session.role !== "student") {
      return [];
    }

    const choirSet = new Set(session.choirIds);
    const memberTasks = tasks.filter((task) => choirSet.has(task.choirId));

    if (!activeChoirId) {
      return memberTasks;
    }

    return memberTasks.filter((task) => task.choirId === activeChoirId);
  }, [activeChoirId, session.choirIds, session.role, tasks]);

  const visibleUpdates = useMemo(() => {
    let scoped = updates;

    if (session.role === "student") {
      const choirSet = new Set(session.choirIds);
      scoped = updates.filter(
        (update) =>
          update.scopeType === "program" ||
          (update.choirId ? choirSet.has(update.choirId) : false)
      );
    }

    if (activeChoirId) {
      scoped = scoped.filter(
        (update) => update.scopeType === "program" || update.choirId === activeChoirId
      );
    }

    return scoped;
  }, [activeChoirId, session.choirIds, session.role, updates]);

  const activeEvent = useMemo(() => {
    if (activeChoirId) {
      const choirEvent = initialEvents.find(
        (event) => event.scopeType === "choir" && event.choirId === activeChoirId
      );

      if (choirEvent) {
        return choirEvent;
      }
    }

    return (
      initialEvents.find((event) => event.scopeType === "program") ?? initialEvents[0]
    );
  }, [activeChoirId]);

  const toggleTask = (taskId: string) => {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, completed: !task.completed } : task
      )
    );
  };

  const addLeaderUpdate = (input: NewUpdateInput) => {
    const linkedTaskId =
      input.createTask && input.taskTitle && input.scopeType === "choir" && input.choirId
        ? `task-${Date.now()}`
        : undefined;

    const newTask: Task | null =
      linkedTaskId &&
      typeof input.taskTitle === "string" &&
      typeof input.taskType === "string" &&
      typeof input.taskPriority === "string" &&
      input.choirId
        ? {
            id: linkedTaskId,
            choirId: input.choirId,
            title: input.taskTitle,
            type: input.taskType,
            category: input.category,
            priority: input.taskPriority,
            completed: false
          }
        : null;

    if (newTask) {
      setTasks((current) => [newTask, ...current]);
    }

    setUpdates((current) => [
      {
        id: `update-${Date.now()}`,
        title: input.title,
        summary: input.summary,
        category: input.category,
        audience: input.audience,
        urgency: input.urgency,
        author: "Leadership Team",
        timestampLabel: "Just now",
        scopeType: input.scopeType,
        choirId: input.scopeType === "choir" ? input.choirId : undefined,
        linkedTaskId
      },
      ...current
    ]);
  };

  const value = useMemo(
    () => ({
      program,
      events: initialEvents,
      activeChoirId,
      activeEvent,
      visibleTasks,
      visibleUpdates,
      session,
      signIn,
      joinProgram,
      signOut,
      setPushEnabled,
      setActiveChoir: setActiveChoirId,
      toggleTask,
      addLeaderUpdate,
      getChoirLabel
    }),
    [activeChoirId, activeEvent, session, visibleTasks, visibleUpdates]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error("useAppState must be used within AppProvider");
  }

  return context;
}
