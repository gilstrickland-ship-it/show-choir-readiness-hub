# Project Handoff

This repo contains a working Vite + React + TypeScript prototype for **Show Choir Readiness Hub**.

The goal is to keep a school show choir program aligned in one place:
- students see what changed, what to practice, what to bring, and what is next
- parents get logistics-only visibility
- leaders manage updates, branding, and organization settings

## Current Product Shape

- `student` view:
  - Home
  - Queue
  - Updates
  - Guide
- `parent` view:
  - Home
  - Updates
  - Guide
- `leader` view:
  - Dashboard
  - Publish
  - Settings

## Prototype Access Flow

The auth flow is intentionally simplified for prototype use:

1. Sign-in screen accepts any text or blank input.
2. User continues into the join screen.
3. User can tap one of the built-in role selectors:
   - `Student`
   - `Parent`
   - `Leader`

No real auth backend exists yet.

## Leader Capabilities Implemented

From leader routes:

- `Dashboard`
  - leader landing page
  - can edit and delete all seeded:
    - events
    - updates
    - tasks
- `Publish`
  - create new updates
  - optionally create a linked task
- `Settings`
  - change program name
  - set logo URL
  - change primary and accent colors
  - rename choirs

## Branding / Theme Behavior

Branding is stored in app state and persisted to local storage.

Leaders can change:
- `program.name`
- `program.logoUrl`
- `program.primaryColor`
- `program.accentColor`
- choir names

The current UI theme uses CSS variables:
- `--brand-primary`
- `--brand-accent`

These are applied across student, parent, and leader views.

## Data Model

The prototype uses a **program + multiple choirs** model:

- one `program`
- multiple `choirs`
- students can belong to multiple choirs
- events and updates can be:
  - `program` scoped
  - `choir` scoped

Core types are in:
- `/Users/gil/Documents/codex projects/show choir kids /src/types.ts`

Seed data is in:
- `/Users/gil/Documents/codex projects/show choir kids /src/data.ts`

Shared state is in:
- `/Users/gil/Documents/codex projects/show choir kids /src/context/AppContext.tsx`

## Persistence

This is still a front-end prototype.

State is stored in browser local storage under:
- `show-choir-readiness-hub-state`

There is no real backend, database, or auth provider yet.

## Main Routes

- `/auth/sign-in`
- `/join`
- `/student/home`
- `/student/queue`
- `/student/updates`
- `/student/guide`
- `/parent/home`
- `/parent/updates`
- `/parent/guide`
- `/leader/dashboard`
- `/leader/publish`
- `/leader/settings`

## Deployment

Production is deployed on Vercel:
- [show-choir-readiness-hub.vercel.app](https://show-choir-readiness-hub.vercel.app)

SPA routing is handled by:
- `/Users/gil/Documents/codex projects/show choir kids /vercel.json`

## Local Commands

- install: `npm install`
- dev: `npm run dev`
- build: `npm run build`

## Important Constraints

- This repo is a prototype, not production-ready app infrastructure.
- Keep the program + choir model intact.
- Parent view is logistics-only.
- Avoid reintroducing fake email requirements into the prototype sign-in flow.
- Leader dashboard is the leader landing page.

## Next Practical Build Steps

1. Replace prompt-based edit flows with inline forms or modals.
2. Add real backend persistence.
3. Add real auth and role-based authorization.
4. Add upload support for logo/media instead of URL-only branding.
5. Add leader CRUD for creating and deleting choirs and more program settings.
