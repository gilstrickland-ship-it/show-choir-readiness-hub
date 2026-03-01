# UX Semantics Audit for Show Choir Readiness Hub

## Executive Summary

This audit focuses on semantics and heuristic usability issues that are **technically functional but semantically wrong, misleading, or unnecessarily hard to use**.

The top issues fall into three patterns:

1. **Internal model terms leaking into the UI**
   - `Date label`
   - `Due label`
   - residual `theme` language in settings feedback
   - `Logo image URL` where the user cares about the logo, not the implementation detail first

2. **Wrong control types for structured data**
   - event date is a freeform text field instead of a date picker
   - call time is a freeform text field instead of a time picker
   - task due information is a freeform text field instead of a date/time control
   - logo entry should at minimum use a `url` field if it remains URL-based

3. **Mismatch between prototype shortcuts and visible UI framing**
   - the sign-in screen still uses `Magic Link Sign-In`
   - the join screen still frames typed invite code entry as primary, even though one-tap role buttons are now the real prototype path
   - some labels still imply the user is joining a single choir, while the product is modeled as a program with multiple choirs

## What To Fix First

Fix these first because they materially affect comprehension or data entry quality:

1. Replace `Date label` with `Date` and use a date picker.
2. Replace `Due label` with `Due date` or `Due by` and use a structured date/time control.
3. Replace the event `Call time` text field with a time picker.
4. Remove manual editing of `Countdown`; it should be derived from event date/time.
5. Align all settings copy with `School colors` / `branding` terminology and remove leftover `theme` wording.
6. Reframe the join flow so the primary action is choosing a role, not typing a code.

## Priority Fix List

### P0

| Screen | Element | Current | Replace With | Impact |
|---|---|---|---|---|
| `/leader/dashboard` event drawer | Event date field | `Date label` text input | `Date` using `input type="date"` | UI + type/state |
| `/leader/dashboard` task drawer | Task due field | `Due label` text input | `Due date` or `Due by` using `input type="date"` or `datetime-local` | UI + type/state |
| `/leader/dashboard` event drawer | Countdown field | editable `Countdown` text input | remove editable field; show derived countdown preview from date/time | UI + type/state |

### P1

| Screen | Element | Current | Replace With | Impact |
|---|---|---|---|---|
| `/leader/dashboard` event drawer | Call time field | `Call time` text input | `Call time` using `input type="time"` | UI + type/state |
| `/leader/settings` | Heading + success message | `Control the program theme` / `Theme updates apply across the app.` | `Manage program branding` / `School colors and branding updated across the app.` | Copy only |
| `/join` | Screen purpose | `Enter your invite code` | `Choose your role` with invite code entry positioned as a secondary/manual path | Copy + layout emphasis |
| `/join` | Primary submit button | `Join choir` | `Join program` | Copy only |
| `/auth/sign-in` | Eyebrow | `Magic Link Sign-In` | `Prototype Sign-In` or `Quick Sign-In` | Copy only |
| `/leader/publish` | Audience/urgency language | `Audience`, `Urgency`, `Routine digest`, `Urgent push` | `Recipients`, `Delivery`, `Include in digest`, `Send immediately` | Copy only |
| `/leader/publish` and dashboard drawers | `Scope` | `Scope` | `Applies to` | Copy only |
| `/leader/publish` | `Target choir` | `Target choir` | `Choir` | Copy only |
| `/leader/dashboard` task drawer | `Resource URL` | `Resource URL` | `Resource link` | Copy only |
| `/leader/settings` | user import labels | `Import from spreadsheet`, `Spreadsheet rows` | `Import users`, `Paste CSV rows` | Copy only |

### P2

| Screen | Element | Current | Replace With | Impact |
|---|---|---|---|---|
| `/auth/sign-in` | Name field label | `Name or email (optional)` | `Your name (optional)` | Copy only |
| `/auth/sign-in` success message | join instruction | `Continue to join your program with the correct invite code.` | `Choose your role to continue.` | Copy only |
| `/join` | secondary button | `Use a different email` | `Start over` | Copy only |
| `/leader/settings` | `Logo image URL` | `Logo image URL` | `Logo image` + helper text `Paste an image URL` | Copy only (or UI if helper added) |
| `/leader/settings` | roster search field | `type="text"` search input | `type="search"` | UI only |
| `/student/queue` | task metadata | lowercase task types (`watch`, `read`, etc.) | title-cased display labels (`Watch`, `Read`, etc.) | Copy only |
| `/parent/updates` | page eyebrow | `Parent feed` | `Updates` or `Parent updates` | Copy only |

## Implementation Notes

### Recommended Internal Model Changes

The visible semantics issues point to a real data-model smell:

- `EventItem.dateLabel` should not be the only event date source.
- `Task.dueLabel` should not be the only task due-date source.

Recommended model evolution:

- add `EventItem.date` (ISO date string)
- keep `dateLabel` only as a derived display value, or remove it entirely in favor of formatting `date`
- add `Task.dueAt` (ISO date/time string or nullable)
- keep `dueLabel` only as a derived display value, or remove it entirely in favor of formatting `dueAt`

### Derived Values

These should be computed, not manually entered:

- countdown
- formatted event date
- formatted due-date display text

## Acceptance Criteria For The Follow-On Fix Pass

The follow-on implementation pass should be considered complete only if:

1. No visible UI field uses `label` suffix language in the product.
2. No critical date/time field uses raw freeform text where a browser picker is available.
3. No settings copy still refers to `theme` when the visible product term is `School colors`.
4. The join screen clearly communicates that role selection is the primary prototype path.
5. All leader-facing management labels use user-facing language rather than implementation-facing language.

