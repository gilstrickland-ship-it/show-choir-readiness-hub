export type UserRole = "student" | "parent" | "leader";
export type InviteRole = UserRole;
export type UpdateCategory = "music" | "choreo" | "logistics" | "costume" | "general";
export type Audience = "students" | "parents" | "both";
export type UpdateUrgency = "routine" | "urgent";
export type TaskType = "listen" | "watch" | "read" | "bring" | "confirm";
export type TaskPriority = "high" | "medium" | "low";
export type ScopeType = "program" | "choir";

export interface InviteCode {
  code: string;
  role: InviteRole;
  label: string;
  choirIds?: string[];
}

export interface AuthSession {
  email: string;
  role: UserRole | null;
  programName: string | null;
  choirIds: string[];
  pushEnabled: boolean;
}

export interface Choir {
  id: string;
  name: string;
  shortLabel: string;
}

export interface Program {
  id: string;
  name: string;
  choirs: Choir[];
}

export interface Task {
  id: string;
  choirId: string;
  title: string;
  type: TaskType;
  category: UpdateCategory;
  priority: TaskPriority;
  completed: boolean;
  dueLabel?: string;
  resourceUrl?: string;
}

export interface UpdateItem {
  id: string;
  title: string;
  summary: string;
  category: UpdateCategory;
  audience: Audience;
  urgency: UpdateUrgency;
  author: string;
  timestampLabel: string;
  scopeType: ScopeType;
  choirId?: string;
  linkedTaskId?: string;
}

export interface TimelineItem {
  time: string;
  activity: string;
}

export interface EventItem {
  id: string;
  choirId?: string;
  scopeType: ScopeType;
  title: string;
  type: "rehearsal" | "competition" | "audition";
  dateLabel: string;
  countdownLabel: string;
  callTime: string;
  location: string;
  packingList: string[];
  timeline: TimelineItem[];
}
