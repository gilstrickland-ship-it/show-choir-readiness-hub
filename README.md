# Show Choir Readiness Hub

Show Choir Readiness Hub is a mobile-first product concept for high school show choir students.

It is designed to solve one specific problem:

**students struggle to stay rehearsal- and competition-ready because instructions, practice materials, and next steps are scattered across informal channels.**

The product turns that fragmented workflow into a simple, structured readiness experience so a student can quickly answer:

**What changed? What do I need to practice? What do I need to bring? What happens next?**

## Why This Exists

Public-source research in this repo points to the same recurring pattern:

- students do not always know what to expect at competitions,
- practice materials are split across tracks, videos, handbooks, chats, and verbal reminders,
- catch-up after missing rehearsal is messy,
- and the result is confusion, stress, and preventable lost time.

The goal is not to build a generic school coordination app.

The goal is to build a focused readiness tool for show choir students first, then decide later whether the pattern extends into a broader platform.

## Product Direction

The first version is a **student readiness hub**, not a social app.

Core MVP surfaces:

- `Home / Next Up`
- `Practice Queue`
- `Change Digest`
- `Competition Guide`
- `Parent Read-Only View`

The product should help a student feel:

- caught up,
- prepared,
- less anxious,
- and clear on what to do next.

## Users

### Student

Primary user.

Needs to know:

- what changed,
- what to practice next,
- what to bring,
- and whether they are ready for the next event.

### Director / Captain

Content owner.

Needs to:

- publish updates,
- attach resources,
- create tasks,
- and reduce repeated reminders.

### Parent

Secondary read-only user.

Needs:

- event timing,
- logistics,
- packing visibility,
- and major updates that affect their student.

## Monetization Direction

The most likely early business model is a **team subscription**:

- students use the app,
- parents get read-only visibility,
- directors/captains manage the shared content,
- and the team/program/booster pays.

Likely pricing shape:

- free or pilot usage for initial validation,
- then a seasonal team subscription for active programs.

## Repository Contents

- [show-choir-problem-discovery.md](/Users/gil/Documents/codex%20projects/show%20choir%20kids%20/show-choir-problem-discovery.md): public-source research summary and recommended problem statement
- [source-log.csv](/Users/gil/Documents/codex%20projects/show%20choir%20kids%20/source-log.csv): source log of public posts and references used in the research pass
- [evidence-matrix.md](/Users/gil/Documents/codex%20projects/show%20choir%20kids%20/evidence-matrix.md): category scoring and weighted ranking of candidate problem areas
- [problem-briefs.md](/Users/gil/Documents/codex%20projects/show%20choir%20kids%20/problem-briefs.md): top 3 problem briefs
- [mvp-spec.md](/Users/gil/Documents/codex%20projects/show%20choir%20kids%20/mvp-spec.md): current MVP product spec, including the parent read-only role

## Current Product Thesis

The strongest current product thesis is:

**Build a simple, student-first app that gives one reliable place for readiness: next event, top tasks, major changes, and competition clarity.**

That means the product should avoid becoming:

- a generic social network,
- a bloated school admin suite,
- or a catch-all collaboration platform too early.

## Suggested Next Build Steps

1. Turn the MVP spec into screen-by-screen wireframes.
2. Define the technical architecture (frontend, backend, auth, schema, API).
3. Build a prototype for one team and validate repeated usage during a live competition cycle.

## Status

This repo currently contains:

- research,
- product framing,
- and MVP definition.

It does **not** yet contain application code.
