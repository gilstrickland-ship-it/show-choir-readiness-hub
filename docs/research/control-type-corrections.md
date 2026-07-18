# Control-Type Correction Map

| Screen | Field | Current Control | Recommended Control | Why |
|---|---|---|---|---|
| `/leader/dashboard` event drawer | Date | generic text input labeled `Date label` | `input type="date"` | Prevents formatting guesswork and matches the user’s mental model of choosing a date |
| `/leader/dashboard` event drawer | Countdown | generic text input | remove editable field; compute from event date and optionally show read-only preview | Users should not hand-author countdown strings; this is derived system output |
| `/leader/dashboard` event drawer | Call time | generic text input | `input type="time"` | Prevents inconsistent time formats and speeds entry |
| `/leader/dashboard` task drawer | Due date / Due by | generic text input labeled `Due label` | `input type="date"` or `input type="datetime-local"` | Prevents ambiguous due-date text and makes task timing consistent |
| `/leader/settings` branding | Logo image | generic text input | `input type="url"` if the prototype remains URL-based | Constrains format and matches the real expectation of a link |
| `/leader/settings` roster search | Search users | `input type="text"` | `input type="search"` | Better semantics for search and improved browser-native behavior |
| `/auth/sign-in` | Name | generic text input | keep as `input type="text"` | Correct control already; issue is label semantics, not control type |
| `/join` | Invite code | generic text input | keep as `input type="text"` while manual code path exists | The control is acceptable; the semantics issue is that it is over-emphasized in the prototype |
| `/leader/settings` | Paste CSV rows | `textarea` | keep `textarea` | Correct control for multiline pasted CSV |
| `/leader/publish` | Category / Applies to / Recipients / Delivery | segmented buttons | keep segmented buttons | The controls are good; labels need semantic refinement |

## Recommended Type-Level Follow-Up

The control issues above point to these source-of-truth changes:

- `EventItem.dateLabel` should become:
  - `date: string` (ISO date), with display formatting derived in the UI
- `Task.dueLabel` should become:
  - `dueAt?: string` (ISO date/time), with display formatting derived in the UI

These changes remove the need for leaders to manually type presentation strings that the system should generate.

