# Visuomotor Learning Lab

A 5–10 minute browser activity for an undergraduate neuromechanics course. Students make quick mouse reaches from a center ring through targets. Partway through, without announcement, the cursor's motion is rotated 45° relative to the hand. Afterwards the page reveals what happened and shows each student their own trajectories and errors.

- **Students:** open a link, press Start, do a short mouse task, read their results.
- **Instructors:** hand out one general link (random assignment) or a direct link to one condition.
- **No accounts, no server, no database.** Movements are recorded in the browser tab and can be downloaded as JSON and CSV. Nothing is uploaded.

> **Status.** The software passes 305 unit tests and complete simulated sessions in real Chrome and Edge. It has **not yet been tried by a person with a physical mouse**; do that before using it with a class ([docs/TESTING.md](docs/TESTING.md) has a checklist).

## Start here

| If you are… | Read |
|---|---|
| the professor | [docs/PROFESSOR_QUICKSTART.md](docs/PROFESSOR_QUICKSTART.md) (one page) |
| deploying the site | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| analysing downloaded data | [docs/METRICS.md](docs/METRICS.md), [docs/EXPORT_SCHEMA.md](docs/EXPORT_SCHEMA.md) |
| changing a protocol | [docs/PRESETS.md](docs/PRESETS.md) |
| checking what was tested | [docs/TESTING.md](docs/TESTING.md) |
| planning what comes next | [docs/LIMITATIONS_AND_NEXT_STEPS.md](docs/LIMITATIONS_AND_NEXT_STEPS.md) |

## Run it locally

Requires Node 22.12 or newer. The activity itself needs desktop Chrome or Edge and a physical mouse.

```bash
npm install
npm run dev          # development server at http://localhost:5173/
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server with live reload |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | Type-check, then build the static site into `dist/` |
| `npm run preview` | Serve the built site at http://localhost:4173/ |
| `npm run e2e` | Complete simulated session in installed Chrome (build first) |
| `npm run verify` | Type-check, unit tests, build and browser run, in order |

## The activity

**Flow:** Welcome → Practice and Experiment → Brief reflection → Results. A small **For instructors** page (`#/instructors`) lists the links and the preset definitions.

**Two standard conditions**, identical except for how the rotation is introduced:

| Preset id | Link | Rotation during the 22 rotated reaches |
|---|---|---|
| `rotation-sudden-45-v1` | `?c=k7m2` | +45° from the first one |
| `rotation-gradual-45-v1` | `?c=p4x9` | 0° → 45° in 7 equal steps over 8 reaches, then 45° |

Both run 8 baseline reaches (cursor hidden), 24 adaptation slots (cursor visible, with unannounced zero-rotation catch trials at slots 12 and 20) and 8 aftereffect reaches (no rotation, cursor hidden). A link with no code assigns one of the two at random. `?c=demo` runs a clearly labelled 16-reach Quick Demo. The condition is never shown to the student before the results page. Details: [docs/PRESETS.md](docs/PRESETS.md).

**Sign convention.** Coordinates are y-up; positive angles are counterclockwise on screen. During the outward reach, `cursor = start + R(θ) · (hand − start)`. Fully compensating for +45° means a hand direction error of −45°.

**Results page.** Rotation applied on every trial with the blocks and catch trials marked; initial direction error on every trial; target-aligned path overlays (baseline, first and last rotated reaches, each catch trial beside its neighbours, first aftereffect reach); signed lateral deviation against progress for the catch trials; a single-reach inspector; a debrief; downloads. A switch shows either the hand path or the cursor as displayed. Only the participant's own data is ever shown.

## How the code is organised

Protocol, trial logic, recording and analysis are plain TypeScript with no browser dependencies, so they can be reused and are tested without a browser. The user interface is a thin layer on top.

```
src/
  core/                 DOM-free logic (all unit tested)
    geometry.ts         coordinates, rotation matrix, cursor transformation
    presets.ts          THE protocol configuration; versioned presets
    schedule.ts         preset + seed → balanced trial list; gradual ramp
    assignment.ts       random 50/50 assignment, opaque link codes
    engine.ts           trial state machine and movement recorder
    practice.ts         the unrecorded warm-up
    analysis.ts         metrics (signed error, initial direction, path measures)
    record.ts           the saved session record (export schema)
    export.ts           JSON and CSV serialisation
    session.ts          session plan and shared types
    rng.ts              seeded random numbers
  input/
    pointerLock.ts      relative mouse input through the Pointer Lock API
  ui/
    Welcome.tsx  TaskScreen.tsx  Reflection.tsx  Instructor.tsx
    results/            results page, charts (Recharts), SVG path overlays
      model.ts          turns a session record into the numbers each chart draws
e2e/
  full-session.mjs      complete session in a real browser
  lib/participant.mjs   simulated participant
docs/                   guides and reference
```

Three rules in `engine.ts` keep the perturbation honest: the hand and cursor are anchored to the center when the target appears; a reach completes when the *hand* has travelled the target distance (never by hitting a possibly hidden cursor); and the return to the center always uses the normal mapping, re-anchored so nothing rotated carries over.

**Changing a protocol:** never edit a released preset. Add a new versioned one ([docs/PRESETS.md](docs/PRESETS.md)); a test fails if a released preset changes.

## Built with

React, TypeScript and Vite; Recharts for the per-trial and lateral-deviation charts; SVG for the task workspace and path overlays; Vitest for unit tests; `playwright-core` (driving the installed Chrome or Edge) for the browser run. Hosted as static files, for example on Cloudflare Pages.

Developer option: adding `seed=<integer>` to the address (for example `?c=k7m2&seed=42`) fixes the target order, which is useful for testing and demonstrations.

## Known limitations

The main ones: no test yet with a physical mouse; after a hidden-cursor reach the cursor reappears for the return, which shows roughly where the reach ended; the protocol is short, so individuals may show little or no measurable learning; desktop Chrome and Edge only; results exist only in the open tab. Full list and suggested next steps: [docs/LIMITATIONS_AND_NEXT_STEPS.md](docs/LIMITATIONS_AND_NEXT_STEPS.md).
