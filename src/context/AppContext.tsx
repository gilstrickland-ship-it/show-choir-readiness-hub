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
  initialUsers,
  inviteCodes,
  program as initialProgram
} from "../data";
import { AuthSession, Choir, EventItem, Program, ProgramUser, Task, UpdateItem } from "../types";

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
  program: Program;
  events: EventItem[];
  allTasks: Task[];
  allUpdates: UpdateItem[];
  allUsers: ProgramUser[];
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
  editEvent: (eventId: string, patch: Partial<EventItem>) => void;
  deleteEvent: (eventId: string) => void;
  editTask: (taskId: string, patch: Partial<Task>) => void;
  deleteTask: (taskId: string) => void;
  editUpdate: (updateId: string, patch: Partial<UpdateItem>) => void;
  deleteUpdate: (updateId: string) => void;
  importUsersFromCsv: (csvText: string) => { ok: boolean; added: number; message: string };
  updateUser: (userId: string, patch: Partial<ProgramUser>) => void;
  deleteUser: (userId: string) => void;
  updateProgramBranding: (
    patch: Partial<Pick<Program, "name" | "logoUrl" | "primaryColor" | "accentColor">>
  ) => void;
  updateChoirName: (choirId: string, patch: Partial<Pick<Choir, "name" | "shortLabel">>) => void;
  getChoirLabel: (choirId?: string) => string;
}

const AppContext = createContext<AppState | null>(null);
const STORAGE_KEY = "show-choir-readiness-hub-state";

interface PersistedState {
  program: Program;
  events: EventItem[];
  tasks: Task[];
  updates: UpdateItem[];
  users: ProgramUser[];
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
    program: initialProgram,
    events: initialEvents,
    tasks: initialTasks,
    updates: initialUpdates,
    users: initialUsers,
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
      program: parsed.program ?? initialProgram,
      events: parsed.events ?? initialEvents,
      tasks: parsed.tasks ?? initialTasks,
      updates: parsed.updates ?? initialUpdates,
      users: parsed.users ?? initialUsers,
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
  const [program, setProgram] = useState<Program>(persisted.program);
  const [events, setEvents] = useState(persisted.events);
  const [tasks, setTasks] = useState(persisted.tasks);
  const [updates, setUpdates] = useState(persisted.updates);
  const [users, setUsers] = useState(persisted.users);
  const [session, setSession] = useState<AuthSession>(persisted.session);
  const [activeChoirId, setActiveChoirId] = useState<string | null>(persisted.activeChoirId);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
        JSON.stringify({
        program,
        events,
        tasks,
        updates,
        users,
        session,
        activeChoirId
      })
    );
  }, [activeChoirId, events, program, session, tasks, updates, users]);

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
    const normalized = code.trim().toLowerCase();
    const match = inviteCodes.find((invite) => invite.code.toLowerCase() === normalized);

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

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.documentElement.style.setProperty("--brand-primary", program.primaryColor);
    document.documentElement.style.setProperty("--brand-accent", program.accentColor);
  }, [program.accentColor, program.primaryColor]);

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
      const choirEvent = events.find(
        (event) => event.scopeType === "choir" && event.choirId === activeChoirId
      );

      if (choirEvent) {
        return choirEvent;
      }
    }

    return (
      events.find((event) => event.scopeType === "program") ?? events[0]
    );
  }, [activeChoirId, events]);

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

  const editEvent = (eventId: string, patch: Partial<EventItem>) => {
    setEvents((current) =>
      current.map((event) => (event.id === eventId ? { ...event, ...patch } : event))
    );
  };

  const deleteEvent = (eventId: string) => {
    setEvents((current) => current.filter((event) => event.id !== eventId));
  };

  const editTask = (taskId: string, patch: Partial<Task>) => {
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, ...patch } : task))
    );
  };

  const deleteTask = (taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    setUpdates((current) =>
      current.map((update) =>
        update.linkedTaskId === taskId ? { ...update, linkedTaskId: undefined } : update
      )
    );
  };

  const editUpdate = (updateId: string, patch: Partial<UpdateItem>) => {
    setUpdates((current) =>
      current.map((update) => (update.id === updateId ? { ...update, ...patch } : update))
    );
  };

  const deleteUpdate = (updateId: string) => {
    setUpdates((current) => current.filter((update) => update.id !== updateId));
  };

  const importUsersFromCsv = (csvText: string) => {
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return { ok: false, added: 0, message: "No spreadsheet rows were found." };
    }

    const parsedUsers: ProgramUser[] = [];

    for (const line of lines) {
      const cells = line.split(",").map((cell) => cell.trim());
      const looksLikeHeader =
        cells[0]?.toLowerCase() === "name" && cells[1]?.toLowerCase() === "email";

      if (looksLikeHeader) {
        continue;
      }

      const [name, email, roleCell, choirsCell] = cells;

      if (!name || !email) {
        continue;
      }

      const normalizedRole =
        roleCell?.toLowerCase() === "leader" ||
        roleCell?.toLowerCase() === "parent" ||
        roleCell?.toLowerCase() === "student"
          ? (roleCell.toLowerCase() as ProgramUser["role"])
          : "student";

      const choirTokens = (choirsCell ?? "")
        .split("|")
        .map((value) => value.trim())
        .filter(Boolean);

      const choirIds = choirTokens
        .map((token) => {
          const lowered = token.toLowerCase();
          const byId = program.choirs.find((choir) => choir.id.toLowerCase() === lowered);
          if (byId) {
            return byId.id;
          }
          const byName = program.choirs.find(
            (choir) =>
              choir.name.toLowerCase() === lowered || choir.shortLabel.toLowerCase() === lowered
          );
          return byName?.id;
        })
        .filter((value): value is string => Boolean(value));

      parsedUsers.push({
        id: `user-${Date.now()}-${parsedUsers.length}`,
        name,
        email,
        role: normalizedRole,
        choirIds
      });
    }

    if (parsedUsers.length === 0) {
      return { ok: false, added: 0, message: "No valid user rows were found." };
    }

    setUsers((current) => [...parsedUsers, ...current]);
    return {
      ok: true,
      added: parsedUsers.length,
      message: `Imported ${parsedUsers.length} user${parsedUsers.length === 1 ? "" : "s"}.`
    };
  };

  const updateUser = (userId: string, patch: Partial<ProgramUser>) => {
    setUsers((current) =>
      current.map((user) => (user.id === userId ? { ...user, ...patch } : user))
    );
  };

  const deleteUser = (userId: string) => {
    setUsers((current) => current.filter((user) => user.id !== userId));
  };

  const updateProgramBranding = (
    patch: Partial<Pick<Program, "name" | "logoUrl" | "primaryColor" | "accentColor">>
  ) => {
    setProgram((current) => ({ ...current, ...patch }));
    if (patch.name) {
      setSession((current) => ({ ...current, programName: patch.name ?? current.programName }));
    }
  };

  const updateChoirName = (
    choirId: string,
    patch: Partial<Pick<Choir, "name" | "shortLabel">>
  ) => {
    setProgram((current) => ({
      ...current,
      choirs: current.choirs.map((choir) =>
        choir.id === choirId ? { ...choir, ...patch } : choir
      )
    }));
  };

  const value = useMemo(
    () => ({
      program,
      events,
      allTasks: tasks,
      allUpdates: updates,
      allUsers: users,
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
      editEvent,
      deleteEvent,
      editTask,
      deleteTask,
      editUpdate,
      deleteUpdate,
      importUsersFromCsv,
      updateUser,
      deleteUser,
      updateProgramBranding,
      updateChoirName,
      getChoirLabel
    }),
    [
      activeChoirId,
      activeEvent,
      events,
      program,
      session,
      tasks,
      updates,
      users,
      visibleTasks,
      visibleUpdates
    ]
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
