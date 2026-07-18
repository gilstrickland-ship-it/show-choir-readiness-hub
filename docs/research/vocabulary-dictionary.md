# Vocabulary Dictionary

Use these terms consistently across the product.

| Concept | Approved Term | Avoid | Notes |
|---|---|---|---|
| school-wide entity | `Program` | `Team` when meaning the whole school program | The product is modeled as one program with multiple choirs |
| subgroup within program | `Choir` | `Team` | Applies to Premiere, Spectrum, etc. |
| event date | `Date` | `Date label` | If stored as text for display, that is an internal implementation detail only |
| event type | `Event type` | plain `Type` when editing an event | Helps disambiguate from task type |
| call time | `Call time` | freeform timing hints without structure | Should be paired with time input |
| due information | `Due date` or `Due by` | `Due label` | Choose one and use it everywhere |
| branding colors | `School colors` | `Theme colors`, `theme` in feedback text | Visible term already established in settings |
| logo field | `Logo image` | `Logo image URL` as the primary label | If URL entry remains, explain via helper text |
| scope of visibility | `Applies to` | `Scope` | More natural for non-technical leaders |
| recipients of update | `Recipients` | `Audience` | Clearer for communication tasks |
| delivery urgency | `Delivery` | `Urgency` when paired with `Routine digest`/`Urgent push` | Pairs better with delivery choices |
| non-urgent delivery option | `Include in digest` | `Routine digest` | Reads as an action/outcome |
| urgent delivery option | `Send immediately` | `Urgent push` | Avoids push-notification implementation jargon |
| role | `Student` | lowercase system-role terms in user-facing copy | Title case in UI |
| role | `Parent` | lowercase system-role terms in user-facing copy | Title case in UI |
| role | `Leader` | `admin`, `staff` in user-facing copy unless explicitly distinct | Keep broad enough for directors, volunteers, and student leaders |
| create communication | `Publish` / `Publish update` | `Post` and `publish` mixed arbitrarily | Both are acceptable, but prefer `Publish` consistently in leader tools |
| item sent to users | `Update` | `message` unless intentionally broader | Existing app uses `update`; keep it |
| follow-up work item | `Task` | `action item` unless in explanatory helper text | `Task` is the simplest stable noun |
| reference page | `Guide` | `itinerary` and `guide` mixed inconsistently | `Guide` is the app’s main noun; `itinerary` can be sub-copy if needed |
| readiness status | `Readiness` | ad hoc synonyms like `preparedness` | Keep student-facing status language stable |
| prototype sign-in | `Prototype Sign-In` | `Magic Link Sign-In` | Current implementation does not send real magic links |
| start-over action | `Start over` | `Use a different email` | Better matches the current no-real-email prototype flow |

## Copy Rules

1. Never expose internal property names (`dateLabel`, `dueLabel`, `logoUrl`) in visible UI.
2. Prefer nouns users already understand over abstract system nouns.
3. If the same concept appears in multiple roles, use the same canonical term unless the role truly requires different framing.
4. Use helper text for implementation constraints; do not put the implementation detail into the field label.
5. Title-case role names and task-type labels in the visible UI.

