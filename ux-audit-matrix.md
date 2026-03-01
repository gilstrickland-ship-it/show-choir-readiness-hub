# Screen-by-Screen UX Audit Matrix

| Screen | Element | Current Text / Control | Issue Type | Severity | Recommended Replacement | Copy Only | Control Change | Type / Model Change |
|---|---|---|---|---|---|---|---|---|
| `/auth/sign-in` | eyebrow | `Magic Link Sign-In` | Inconsistent vocabulary | P1 | `Prototype Sign-In` | Yes | No | No |
| `/auth/sign-in` | input label | `Name or email (optional)` | Ambiguous label | P2 | `Your name (optional)` | Yes | No | No |
| `/auth/sign-in` | helper paragraph | “This MVP skips real email authentication…” | Excess cognitive load | P2 | shorten to one sentence; keep prototype framing | Yes | No | No |
| `/auth/sign-in` | success card copy | “Continue to join your program with the correct invite code.” | Mismatched role framing | P2 | `Choose your role to continue.` | Yes | No | No |
| `/join` | page title | `Enter your invite code` | Mismatched role framing | P1 | `Choose your role` | Yes | No | No |
| `/join` | intro copy | “Use the invite code for your role…” | Mismatched role framing | P1 | explain quick role buttons as primary path; keep typed code as secondary/manual path | Yes | No | No |
| `/join` | primary field label | `Invite code` | Acceptable but weak as primary | P2 | keep if manual path remains; visually de-emphasize | Maybe | No | No |
| `/join` | primary action button | `Join choir` | Inconsistent vocabulary | P1 | `Join program` | Yes | No | No |
| `/join` | secondary action button | `Use a different email` | Inconsistent vocabulary | P2 | `Start over` | Yes | No | No |
| `/student/home` | choir selector title | `Choir view` | Acceptable | — | keep | — | — | — |
| `/student/home` | event chip | `Next {type}` | Minor casing roughness | P2 | title-case event type in display (`Next Competition`) | No | No | No |
| `/student/home` | event date display | `{activeEvent.dateLabel}` text | Derived display only | P2 | okay for display; source should come from structured date field | No | No | Yes |
| `/student/home` | metadata | `Program-wide` / choir short label | Acceptable | — | keep | — | — | — |
| `/student/home` | CTA | `View full guide` | Acceptable | — | keep | — | — | — |
| `/student/queue` | heading | `X pending tasks` | Acceptable | — | keep | — | — | — |
| `/student/queue` | filter labels | `All`, `Urgent` | Acceptable | — | keep | — | — | — |
| `/student/queue` | task type metadata | raw lowercase values (`listen`, `watch`) | Inconsistent vocabulary | P2 | display title case (`Listen`, `Watch`) | Yes | No | No |
| `/student/queue` | resource badge | `Link` | Slightly vague | P2 | `Open link` or `Resource` | Yes | No | No |
| `/student/updates` | eyebrow | `Change digest` | Strong | — | keep | — | — | — |
| `/student/updates` | CTA | `View task` | Strong | — | keep | — | — | — |
| `/student/guide` | type badge | `Competition guide` | Strong | — | keep | — | — | — |
| `/student/guide` | note label | `Arrival rule` | Acceptable | — | keep | — | — | — |
| `/parent/home` | CTA | `View full itinerary` | Strong | — | keep | — | — | — |
| `/parent/home` | section | `Major updates` | Strong | — | keep | — | — | — |
| `/parent/home` | empty state | `No parent-visible updates yet.` | Slightly technical | P2 | `No updates for parents yet.` | Yes | No | No |
| `/parent/updates` | eyebrow | `Parent feed` | Over-technical phrasing | P2 | `Parent updates` | Yes | No | No |
| `/parent/updates` | heading | `Choir logistics only` | Strong | — | keep | — | — | — |
| `/parent/guide` | eyebrow | `Event logistics` | Strong | — | keep | — | — | — |
| `/leader/dashboard` | event drawer field | `Type` | Slightly generic | P2 | `Event type` | Yes | No | No |
| `/leader/dashboard` | event drawer field | `Scope` | Ambiguous label | P1 | `Applies to` | Yes | No | No |
| `/leader/dashboard` | event drawer field | `Date label` text input | Internal model leak + Wrong control type | P0 | `Date` with date picker | No | Yes | Yes |
| `/leader/dashboard` | event drawer field | `Countdown` text input | Wrong control type / should be derived | P0 | remove editable field; show read-only derived countdown | No | Yes | Yes |
| `/leader/dashboard` | event drawer field | `Call time` text input | Wrong control type | P1 | `Call time` with time picker | No | Yes | Yes |
| `/leader/dashboard` | update drawer field | `Audience` | Slightly technical | P1 | `Recipients` | Yes | No | No |
| `/leader/dashboard` | update drawer field | `Urgency` | Slightly technical | P1 | `Delivery` | Yes | No | No |
| `/leader/dashboard` | update drawer field | `Scope` | Ambiguous label | P1 | `Applies to` | Yes | No | No |
| `/leader/dashboard` | task drawer field | `Type` | Slightly generic | P2 | `Task type` | Yes | No | No |
| `/leader/dashboard` | task drawer field | `Due label` text input | Internal model leak + Wrong control type | P0 | `Due date` or `Due by` with structured date/time control | No | Yes | Yes |
| `/leader/dashboard` | task drawer field | `Resource URL` | Over-technical phrasing | P1 | `Resource link` | Yes | No | No |
| `/leader/dashboard` | task drawer toggle | `Completed` | Acceptable | — | keep | — | — | — |
| `/leader/publish` | field | `Scope` | Ambiguous label | P1 | `Applies to` | Yes | No | No |
| `/leader/publish` | field | `Target choir` | Slightly redundant | P1 | `Choir` | Yes | No | No |
| `/leader/publish` | field | `Audience` | Slightly technical | P1 | `Recipients` | Yes | No | No |
| `/leader/publish` | field | `Urgency` | Slightly technical | P1 | `Delivery` | Yes | No | No |
| `/leader/publish` | segmented option | `Routine digest` | Over-technical phrasing | P1 | `Include in digest` | Yes | No | No |
| `/leader/publish` | segmented option | `Urgent push` | Over-technical phrasing | P1 | `Send immediately` | Yes | No | No |
| `/leader/publish` | toggle copy | `Create a linked student action item` | Over-technical phrasing | P2 | `Add a follow-up task for students` | Yes | No | No |
| `/leader/publish` | field | `Task title` | Acceptable | — | keep | — | — | — |
| `/leader/settings` | heading | `Control the program theme` | Inconsistent vocabulary | P1 | `Manage program branding` | Yes | No | No |
| `/leader/settings` | field | `Logo image URL` | Over-technical phrasing | P2 | `Logo image` + helper text | Yes | Maybe | No |
| `/leader/settings` | save success message | `Settings saved. Theme updates apply across the app.` | Inconsistent vocabulary | P1 | `Settings saved. School colors and branding now update across the app.` | Yes | No | No |
| `/leader/settings` | section title | `Import from spreadsheet` | Slightly imprecise | P1 | `Import users` | Yes | No | No |
| `/leader/settings` | field | `Spreadsheet rows` | Over-technical phrasing | P1 | `Paste CSV rows` | Yes | No | No |
| `/leader/settings` | search input | text input for search | Wrong control type (minor) | P2 | `input type="search"` | No | Yes | No |
| `/leader/settings` | preview note | `These settings update the theme colors...` | Inconsistent vocabulary | P1 | `These settings update school colors and branding...` | Yes | No | No |

