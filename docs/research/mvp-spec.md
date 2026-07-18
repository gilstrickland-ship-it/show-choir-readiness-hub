# Show Choir Readiness Hub MVP Spec

## Product Goal

Build a mobile-first app that helps high school show choir students know whether they are ready for the next rehearsal or competition.

The core job is:

**turn scattered updates, practice materials, and event expectations into one clear next-step view.**

## Primary Problem

High school show choir students struggle to stay rehearsal- and competition-ready because instructions, practice materials, and expected next steps are scattered across informal channels.

This creates:

- confusion about what changed,
- uncertainty about what to practice,
- missed details before competitions,
- and avoidable stress for both students and families.

## User Roles

### Student (Primary User)

Needs to know:

- what changed,
- what to practice next,
- what to bring,
- what is coming up next,
- and whether they are caught up.

### Director / Captain (Content Owner)

Needs to:

- publish updates,
- attach resource links,
- create actionable tasks,
- and reduce repeated reminders during rehearsal.

### Parent (Secondary, Read-Only User)

Needs visibility into:

- event timing,
- logistics,
- packing expectations,
- and major updates that affect their student.

Parent access exists to reduce confusion and support the student, not to manage the team.

## Product Scope

The MVP includes five product surfaces:

1. Student `Home / Next Up`
2. Student `Practice Queue`
3. Student `Change Digest`
4. Student `Competition Guide`
5. Parent `Read-Only View`

The admin input experience for directors/captains can remain simple in v1.

## MVP Features

## 1. Student Home / Next Up

Purpose:

- Show the next event and the exact actions required before it.

Displays:

- next event title
- event type (`rehearsal`, `competition`, `audition`)
- date/time
- countdown
- top priority tasks
- readiness state: `Caught Up`, `Needs Attention`, or `Behind`

Primary outcome:

- A student should know what to do next within 10 seconds.

## 2. Student Practice Queue

Purpose:

- Give the student a prioritized list of concrete actions.

Task types:

- `Listen`
- `Watch`
- `Read`
- `Bring`
- `Confirm`

Each task includes:

- title
- priority
- optional due time
- optional resource link
- completion toggle

Rule:

- Every task must be short, specific, and start with a verb.

## 3. Student Change Digest

Purpose:

- Show what changed since the last rehearsal or update.

Displays:

- timestamp
- category (`music`, `choreo`, `logistics`, `costume`, `general`)
- short summary
- linked tasks created from the update

Examples:

- cut bars 12-20 in opener
- ripple timing changed in final chorus
- Saturday call time moved to 6:30 AM

## 4. Student Competition Guide

Purpose:

- Give first-timers and returning students a simple, student-friendly explanation of the next event.

Displays:

- timeline
- arrival instructions
- packing list
- venue notes
- FAQ
- what matters next

This should reduce the need to ask basic procedural questions publicly.

## 5. Parent Read-Only View

Purpose:

- Give parents a simple, non-editable view of the logistics that matter to them.

Displays:

- next event title and time
- call time
- location / venue
- packing list or bring items
- major logistics updates
- competition timeline summary
- emergency or high-priority reminders

Parent-specific constraints:

- Parents cannot create or edit content.
- Parents cannot mark student tasks complete.
- Parents do not see internal staff notes.
- Parents should not see a complex task-management interface.

Design rule:

- The parent view should feel like a clean visibility layer on top of the student workflow, not a second full app.

## Parent View Scope Boundaries

Include:

- event logistics
- public reminders
- packing expectations
- event-specific guides

Exclude:

- rehearsal correction details meant only for performers
- internal casting or discipline notes
- social features
- direct messaging
- attendance enforcement

This keeps the parent experience useful without shifting the product into a parent portal.

## Core User Flows

### Student Checks Readiness

1. Open app
2. Land on `Home`
3. See next event and top tasks
4. Open a task
5. Open linked material
6. Mark task complete
7. Readiness state updates

### Student Catches Up After Missing Rehearsal

1. Open app
2. Open `Change Digest`
3. Review updates since last rehearsal
4. Open linked catch-up tasks
5. Complete urgent items in `Practice Queue`

### Student Prepares For First Competition

1. Open app
2. Open upcoming competition
3. Review `Competition Guide`
4. Complete pre-event tasks

### Parent Checks Event Logistics

1. Open app
2. Land on `Parent View`
3. See next event summary
4. Review call time, venue, and bring items
5. Check any major updates

The parent flow should take under 15 seconds for the common case.

## Permissions

### Student Permissions

- View team events
- View tasks assigned to the team
- Mark their own tasks complete
- View updates
- View competition guides

### Director / Captain Permissions

- Create and edit events
- Create and edit updates
- Create and edit tasks
- Create and edit competition guide sections
- Mark updates as parent-visible or student-only

### Parent Permissions

- View parent-visible events
- View parent-visible logistics updates
- View parent-visible competition guide details
- View packing lists and reminders

Parents cannot:

- edit anything
- publish updates
- complete student tasks
- see student-only update items

## Content Model

The MVP works with lightweight manual publishing by a director or captain.

Content owners create:

- events
- updates
- tasks
- competition guide sections

Each update can carry a visibility flag:

- `student_only`
- `parent_visible`

This is the key control that enables the parent view without duplicating content.

## Data Model

### User

- `id`
- `name`
- `role` (`student`, `staff`, `parent`)
- `team_id`
- `student_link_id` (optional, for parent-child linking)

### Team

- `id`
- `name`
- `season_label`

### Event

- `id`
- `team_id`
- `type` (`rehearsal`, `competition`, `audition`)
- `title`
- `start_at`
- `location`
- `description`
- `parent_visible` (boolean)

### Update

- `id`
- `team_id`
- `event_id` (optional)
- `category` (`music`, `choreo`, `logistics`, `costume`, `general`)
- `summary`
- `visibility` (`student_only`, `parent_visible`)
- `created_at`

### Task

- `id`
- `team_id`
- `event_id` (optional)
- `update_id` (optional)
- `title`
- `type` (`listen`, `watch`, `read`, `bring`, `confirm`)
- `priority` (`low`, `medium`, `high`)
- `due_at` (optional)
- `resource_url` (optional)

### UserTaskState

- `id`
- `user_id`
- `task_id`
- `completed_at` (optional)

### CompetitionGuideSection

- `id`
- `event_id`
- `section_type` (`timeline`, `packing`, `faq`)
- `title`
- `body`
- `visibility` (`student_only`, `parent_visible`)
- `sort_order`

## UX Rules

- The student home screen must always answer "what do I need to do next?"
- The parent screen must always answer "what do I need to know for the next event?"
- Do not expose admin complexity to students or parents.
- Prefer plain language over director jargon.
- The parent experience should be simpler than the student experience.

## Out Of Scope

Do not include in MVP:

- chat
- social feed
- DMs
- attendance enforcement
- grading
- video hosting
- calendar sync
- parent messaging
- payment collection
- volunteer coordination

These are adjacent but not required to validate the core readiness value.

## Monetization Fit

The parent view should support monetization, not define the product.

Useful pricing effect:

- students get daily value,
- directors get reduced chaos,
- parents get visibility,
- which makes a team subscription easier to justify.

The likely paid structure remains:

- student access included
- parent read-only access included
- team pays for the shared workspace

## MVP Acceptance Criteria

The MVP is successful if:

1. A student can identify the next required action within 10 seconds.
2. A student who missed rehearsal can find the catch-up path in under 30 seconds.
3. A first-time competitor can understand the event flow from the competition guide.
4. A parent can find call time, location, and bring items in under 15 seconds.
5. A director or captain can publish an update and mark it as parent-visible in under 2 minutes.
6. The parent view improves logistics visibility without becoming the main product surface.

## Recommended Build Order

1. Student `Home / Next Up`
2. Student `Practice Queue`
3. Student `Change Digest`
4. Director/Captain publishing flow
5. Parent `Read-Only View`
6. Student `Competition Guide`

Rationale:

- The core student loop must work first.
- Parent visibility should be layered on after the shared content model exists.
- The parent feature should reuse existing event/update data rather than create a separate content system.
