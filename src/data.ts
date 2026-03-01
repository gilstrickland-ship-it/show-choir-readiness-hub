import { EventItem, InviteCode, Program, ProgramUser, Task, UpdateItem } from "./types";

export const program: Program = {
  id: "central-high",
  name: "Central High Show Choir Program",
  logoUrl: "",
  primaryColor: "#7a2d20",
  accentColor: "#efab54",
  choirs: [
    { id: "premiere", name: "Premiere Company", shortLabel: "Premiere" },
    { id: "spectrum", name: "Spectrum Ensemble", shortLabel: "Spectrum" },
    { id: "treble", name: "Treble Select", shortLabel: "Treble" }
  ]
};

export const initialEvents: EventItem[] = [
  {
    id: "midwest-regionals-premiere",
    choirId: "premiere",
    scopeType: "choir",
    title: "Midwest Regional Championship",
    type: "competition",
    date: "2026-03-07",
    callTime: "06:15",
    location: "North High School Auditorium",
    packingList: [
      "Full costume set A",
      "Black character shoes",
      "Hair spray and bobby pins",
      "Clear water bottle",
      "Nut-free snacks",
      "Makeup kit"
    ],
    timeline: [
      { time: "6:15 AM", activity: "Call time at the choir room" },
      { time: "6:45 AM", activity: "Bus departs" },
      { time: "8:15 AM", activity: "Unload and move to warmup" },
      { time: "9:10 AM", activity: "Warmup room A" },
      { time: "10:00 AM", activity: "Performance time" },
      { time: "10:45 AM", activity: "Critique" },
      { time: "12:00 PM", activity: "Lunch and reset" },
      { time: "4:00 PM", activity: "Awards" }
    ]
  },
  {
    id: "spectrum-runthrough",
    choirId: "spectrum",
    scopeType: "choir",
    title: "Spectrum Full Runthrough",
    type: "rehearsal",
    date: "2026-03-06",
    callTime: "15:45",
    location: "Choir Room B",
    packingList: ["Dance shoes", "Pencil", "Water bottle"],
    timeline: [
      { time: "3:45 PM", activity: "Stretch and vocal warmup" },
      { time: "4:10 PM", activity: "Opener clean run" },
      { time: "4:45 PM", activity: "Ballad notes" },
      { time: "5:30 PM", activity: "Full runthrough" }
    ]
  },
  {
    id: "program-waiver-deadline",
    scopeType: "program",
    title: "Program Travel Paperwork Deadline",
    type: "audition",
    date: "2026-03-14",
    callTime: "15:30",
    location: "Front office",
    packingList: ["Signed waiver", "Emergency contacts"],
    timeline: [
      { time: "8:00 AM", activity: "Forms accepted before school" },
      { time: "3:30 PM", activity: "Final paperwork cutoff" }
    ]
  }
];

export const initialTasks: Task[] = [
  {
    id: "task-1",
    choirId: "premiere",
    title: "Watch Premiere ballad cleanup video",
    type: "watch",
    category: "choreo",
    priority: "high",
    completed: false,
    dueAt: "2026-03-01T21:00",
    resourceUrl: "https://example.com/choreo-video"
  },
  {
    id: "task-2",
    choirId: "premiere",
    title: "Listen to alto part for bars 42-60",
    type: "listen",
    category: "music",
    priority: "high",
    completed: false,
    dueAt: "2026-03-02T15:30",
    resourceUrl: "https://example.com/alto-track"
  },
  {
    id: "task-3",
    choirId: "premiere",
    title: "Confirm travel waiver is turned in",
    type: "confirm",
    category: "logistics",
    priority: "high",
    completed: false
  },
  {
    id: "task-4",
    choirId: "spectrum",
    title: "Pack black character shoes",
    type: "bring",
    category: "costume",
    priority: "medium",
    completed: true
  },
  {
    id: "task-5",
    choirId: "spectrum",
    title: "Read Spectrum runthrough notes",
    type: "read",
    category: "general",
    priority: "medium",
    completed: false,
    resourceUrl: "https://example.com/competition-notes"
  }
];

export const initialUpdates: UpdateItem[] = [
  {
    id: "update-1",
    title: "Program paperwork reminder",
    summary: "All students in every choir need travel waivers turned in by Friday afternoon.",
    category: "logistics",
    audience: "both",
    urgency: "urgent",
    author: "Mrs. Howard",
    timestampLabel: "15 min ago",
    scopeType: "program"
  },
  {
    id: "update-2",
    title: "Premiere ballad cleanup posted",
    summary: "New Premiere cleanup video is live. Focus on the bridge counts and last ripple timing.",
    category: "choreo",
    audience: "students",
    urgency: "routine",
    author: "Avery (Captain)",
    timestampLabel: "1 hr ago",
    scopeType: "choir",
    choirId: "premiere",
    linkedTaskId: "task-1"
  },
  {
    id: "update-3",
    title: "Spectrum packing reminder",
    summary: "Spectrum students should bring full costume set A, backup tights, and a clear water bottle.",
    category: "costume",
    audience: "parents",
    urgency: "routine",
    author: "Booster Lead",
    timestampLabel: "3 hr ago",
    scopeType: "choir",
    choirId: "spectrum"
  }
];

export const inviteCodes: InviteCode[] = [
  {
    code: "Student",
    role: "student",
    label: "Student invite",
    choirIds: ["premiere", "spectrum"]
  },
  {
    code: "Parent",
    role: "parent",
    label: "Parent invite"
  },
  {
    code: "Leader",
    role: "leader",
    label: "Leader invite",
    choirIds: ["premiere", "spectrum", "treble"]
  }
];

export const initialUsers: ProgramUser[] = [
  {
    id: "user-1",
    name: "Avery Stone",
    email: "avery@centralchoir.org",
    role: "leader",
    choirIds: ["premiere", "spectrum"]
  },
  {
    id: "user-2",
    name: "Jordan Lee",
    email: "jordan@student.central.edu",
    role: "student",
    choirIds: ["premiere"]
  },
  {
    id: "user-3",
    name: "Maya Carter",
    email: "maya.parent@example.com",
    role: "parent",
    choirIds: ["premiere", "spectrum"]
  }
];
