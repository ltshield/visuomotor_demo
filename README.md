# Visuomotor Learning Lab

A 5–10 minute browser activity for an undergraduate neuromechanics course. Students make quick mouse reaches from a center ring to a target and hold the dot there. Partway through, without announcement, the cursor's motion is rotated 45° relative to the hand. Afterwards the page reveals what happened and shows each student their own trajectories and errors. Optionally, students add an anonymous summary to a class view on the projector.

- **Students:** open a link, press Start, do a short mouse task, read their results, and (if asked) share an anonymous summary with the class.
- **Instructors:** the instructor page (`/instructor`) gives the general link (random assignment), direct links to each condition, custom protocols, and a class view for the projector.
- **No accounts.** Movements are recorded in the browser tab and can be downloaded as JSON and CSV. The only thing that ever leaves the browser is the anonymous class summary a student chooses to share (Cloudflare Pages Functions + D1; optional, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

> **Status.** 577 unit tests pass, and complete simulated sessions pass in real Chrome and Edge, including sharing to a local Cloudflare D1 database and reading it back on the class view. The v2 protocol was piloted with real participants. The current v3 protocol adds a speed instruction that **has not yet been tried with a physical mouse**; do that before using it with a class ([docs/TESTING.md](docs/TESTING.md) has a checklist).

## Start here

| If you are… | Read |
|---|---|
| the professor | [docs/PROFESSOR_QUICKSTART.md](docs/PROFESSOR_QUICKSTART.md) (one page) |
| deploying the site, or setting up class sharing | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
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
| `npm run dev` | Development server with live reload (no class sharing) |
| `npm test` | Unit tests (Vitest), including the class-data API against a real SQLite database |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | Type-check, then build the static site into `dist/` |
| `npm run preview` | Serve the built site at http://localhost:4173/ (no class sharing) |
| `npm run preview:class` | Build, then serve the site **with** class sharing and a local D1 database at http://127.0.0.1:8788/ (Cloudflare's own local runtime, fetched on first use) |
| `npm run e2e` | Complete simulated session in installed Chrome (build first) |
| `npm run verify` | Type-check, unit tests, build and browser run, in order |

## The activity

**Flow:** Welcome → Practice and Experiment → three optional questions → Results (with optional class sharing). Separate pages: the instructor page (`/instructor`) and the class view (`/class/<CODE>`).

**Each reach:** bring the dot into the center ring and hold; a target lights; make one quick, smooth movement to it and hold the dot inside it for 400 ms until it flashes; the dot jumps back to the center. A movement that takes longer than 500 ms is followed by "Too slow" (it still counts). With the cursor hidden, the hand only has to stay at the target's distance, in any direction.

**Two standard conditions**, identical except for how the rotation is introduced:

| Preset id | Link | Rotation during the 22 rotated reaches |
|---|---|---|
| `rotation-sudden-45-v3` | `?c=k7m2` | +45° from the first one |
| `rotation-gradual-45-v3` | `?c=p4x9` | 0° → 45° in 7 equal steps over 8 reaches, then 45° |

Both run 8 baseline reaches (cursor hidden), 24 adaptation slots (cursor visible, with unannounced zero-rotation catch trials at slots 12 and 20) and 8 aftereffect reaches (no rotation, cursor hidden). A link with no code assigns one of the two at random. `?c=demo` runs a clearly labelled 16-reach Quick Demo, and the instructor page builds custom protocols (`?x=…`: rotation 15–60°, 16/40/64 reaches, aftereffect cursor, catch trials) that are never pooled with the standard versions. The condition is never shown to the student before the results page. Details: [docs/PRESETS.md](docs/PRESETS.md).

**Sign convention.** Coordinates are y-up; positive angles are counterclockwise on screen. During the outward reach, `cursor = start + R(θ) · (hand − start)`. Fully compensating for +45° means a hand direction error of −45°.

**Results page.** The catch-trial finding first; then, trial by trial: the rotation applied, the hand's **initial direction** (its aim, measured a quarter of the way out) and the cursor's **path error** (how far its whole outward path strayed from the straight line, so it includes steering). Then summary and per-reach tables, target-aligned path overlays, catch trials up close, a single-reach inspector, a debrief that contrasts aiming with steering using the student's own numbers, downloads, and the optional class share. Only the participant's own data is shown there.

**Class view** (`/class/<CODE>`, for the projector). One thin line per student who shared, the mean and ±1 SD for each version, catch trials marked, path error or initial direction, refreshing every 15 seconds. Descriptive only, and anonymous by design.

## How the code is organised

Protocol, trial logic, recording and analysis are plain TypeScript with no browser dependencies, so they are tested without a browser. The user interface is a thin layer on top.

```
src/
  core/                 DOM-free logic (all unit tested)
    geometry.ts         coordinates, rotation matrix, cursor transformation
    presets.ts          THE protocol configuration; versioned presets (v3 current, v2/v1 retired)
    custom.ts           custom protocols from instructor settings; opaque link codes
    schedule.ts         preset + seed → balanced trial list; gradual ramp
    assignment.ts       random 50/50 assignment, link codes
    engine.ts           trial state machine and movement recorder (hold, arrival, speed, jump home)
    practice.ts         the unrecorded warm-up
    analysis.ts         metrics (initial direction, path error, path measures, timing)
    record.ts           the saved session record (export schema 2.2.0)
    export.ts           JSON and CSV serialisation
    classWire.ts        class-sharing wire format and its validation (shared with the server)
    classShare.ts       builds the anonymous class summary from a session
    session.ts  rng.ts
  server/
    classApi.ts         the class-data API: POST /api/submit, GET /api/class/<code> (D1)
    schema.ts           the D1 schema as the API runs it (= db/schema.sql)
  input/pointerLock.ts  relative mouse input through the Pointer Lock API
  ui/
    Welcome.tsx  TaskScreen.tsx  Reflection.tsx  Instructor.tsx  route.ts  sound.ts  classClient.ts
    results/            results page, charts (Recharts), SVG path overlays, ShareWithClass
    class/              the class view and its aggregation model
functions/api/          Cloudflare Pages Functions routes (thin wrappers around src/server)
db/schema.sql           the class database schema
e2e/                    complete sessions in a real browser with a simulated participant
docs/                   guides and reference
```

Four rules in `engine.ts` keep the perturbation honest: the hand and cursor are anchored to the center when the target appears; arrival is judged on the *hand's* distance from the start; nothing hidden decides whether a hidden-cursor reach registers; and after each reach the hand and cursor jump back to the center, so there is no return movement and nothing rotated carries over.

**Changing a protocol:** never edit a released preset. Add a new versioned one ([docs/PRESETS.md](docs/PRESETS.md)); a test fails if a released preset changes.

## Built with

React, TypeScript and Vite; Recharts for the charts; SVG for the task workspace and path overlays; Cloudflare Pages Functions and D1 for the optional class sharing; Vitest (with Node's built-in SQLite standing in for D1) for unit tests; `playwright-core` (driving the installed Chrome or Edge) for the browser runs.

Developer option: adding `seed=<integer>` to the address (for example `?c=k7m2&seed=42`) fixes the target order, which is useful for testing and demonstrations.

## Known limitations

The main ones: the v3 speed instruction has not yet been tried with a physical mouse; the protocol is short, so individuals may show little measurable learning and the clearest picture is the class average; desktop Chrome and Edge only; full results exist only in the open tab; a class code is not a password. Full list and suggested next steps: [docs/LIMITATIONS_AND_NEXT_STEPS.md](docs/LIMITATIONS_AND_NEXT_STEPS.md).
