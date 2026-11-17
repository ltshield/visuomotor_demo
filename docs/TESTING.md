# Testing

Four layers of checking, and one that still needs a person.

| Layer | Command | What it covers |
|---|---|---|
| Type check | `npm run typecheck` | The whole code base compiles under strict TypeScript, including the server routes. |
| Unit tests | `npm test` | Protocol, trial engine, analysis, exports, results data, concealment, the class-data API (against a real SQLite database), the class view. Runs in seconds, no browser. |
| Full browser run | `npm run e2e` | A complete session in real Chrome or Edge through real Pointer Lock, with simulated mouse input. |
| Browser run with class sharing | see below | The same, against Cloudflare's own local runtime and a local D1 database: shares the session and checks it on the class view. |
| **Human check** | (manual) | v2 was piloted with real participants; **v3 (the speed instruction) still needs a person with a physical mouse.** Checklist below. |

`npm run verify` runs type check, unit tests, build and one browser run, in order.

## Results (17 November 2026)

### Unit tests: 577 passed, 0 failed (22 files)

| File | Tests | Covers |
|---|---|---|
| `src/core/geometry.test.ts` | 20 | Rotation and cursor transformation, compensation in all 8 directions, signed angles, circle-crossing interpolation |
| `src/core/presets.test.ts` | 37 | Stable ids; frozen snapshots of v3 (current) and v2 and v1 (retired); v3 = v2 + speed limit; canonical presets differ only in perturbation; arrival radius; `isTooSlow`; validation of bad presets |
| `src/core/custom.test.ts` | 36 | Custom protocols from instructor settings; canonical protection over every setting combination; frozen link codes; duration estimate |
| `src/core/schedule.test.ts` | 44 | 8/24/8 structure, catch slots, gradual ramp (0° … 45° in 7 steps), ramp counter not advanced by catch trials, balance, no immediate repeats, seed reproducibility |
| `src/core/engine.test.ts` | 72 | Center hold, anchoring, rotation, hold-to-register (visible and hidden cursor), arrival, the speed instruction ("too-slow" note from arrival until the next go cue; reaction time not judged; hidden reaches alike), timeouts, jump home, interruptions, timestamps, concealment of the view |
| `src/core/analysis.test.ts` | 52 | Signed error in all directions, hand vs cursor, initial vs endpoint direction, lateral deviation and the whole-path error (signed mean: side kept, S-shapes cancel), path length and efficiency, sampling-rate independence, nulls with reasons |
| `src/core/assignment.test.ts` | 18 | 50/50 assignment, link codes, custom links, seed override |
| `src/core/record.test.ts` | 19 | Every field recorded, schema and app 2.2.0, metrics match the movement, interrupted and timed-out attempts kept |
| `src/core/export.test.ts` | 24 | JSON round-trip, CSV contents and header, file names |
| `src/core/classShare.test.ts` | 8 | The anonymous class summary: one entry per reach, both numbers, no samples/free text/device details, accepted by the server's checks |
| `src/server/classApi.test.ts` | 39 | Schema parity with `db/schema.sql`; storage; atomic batches with roll-back; re-sending replaces; class full; class-code validation; oversized and malformed bodies; only the matching class returned; anonymity; opaque ETag and 304; adding the path-error column to an older database; no database configured |
| `src/input/pointerLock.test.ts` | 10 | Input axis sense, hardware sub-samples, timestamp guard |
| `src/ui/concealment.test.tsx` | 22 | No revealing words on the welcome, task and reflection screens; identical task markup in both conditions |
| `src/ui/TaskScreen.test.tsx` | 8 | Mouse events move the dot correctly; pause and resume; sound toggle |
| `src/ui/route.test.ts` | 6 | `/instructor`, `/class/<CODE>` and the legacy hash addresses |
| `src/ui/Instructor.test.tsx` | 23 | Preset selector, canonical protection, duration estimate, links, reference text (incl. the speed rule), class-view set-up |
| `src/ui/classClient.test.ts` | 10 | Every server answer, and a missing server, become a sentence; nothing throws |
| `src/ui/class/model.test.ts` | 12 | Grouping by exact protocol (never pooled), mean and sample SD, per-student summaries, both measures, chart columns |
| `src/ui/class/ClassView.test.tsx` | 8 | Invalid code, empty class, counts and means, measure switch, polling with the ETag, keeping data through a failed refresh, stopping on a site without a server |
| `src/ui/results/model.test.ts` | 49 | Chart numbers equal the recorded movement; path error of the seen path; aim vs arrival; catch callout |
| `src/ui/results/ResultsPage.test.tsx` | 54 | Reveal, callout, explanations, debrief (incl. aiming vs steering), tables, path-error chart, speed line, downloads, privacy wording |
| `src/ui/results/ShareWithClass.test.tsx` | 6 | Opt-in only, never pre-filled, validation, success and error messages, preview of what is sent, no sharing of a second run |

### Full browser runs

All five passed every check, against `npm run preview:class` (Cloudflare's local runtime with a local D1 database).

| Browser | Link | Viewport | Trials | Class share | Checks | Worst aimed vs recorded initial direction | Worst path-error difference |
|---|---|---|---|---|---|---|---|
| Chrome 157 | Sudden (`?c=k7m2`) | 1366 × 768 | 40 | yes | 103 / 103 | 0.57° | 0.20 wu |
| Edge 157 | Gradual (`?c=p4x9`) | 1366 × 768 | 40 | yes | 104 / 104 | 0.51° | 0.14 wu |
| Chrome 157 | General (random; drew Gradual) | 1920 × 1080 | 40 | yes | 104 / 104 | 0.49° | 0.10 wu |
| Edge 157 | Quick Demo (`?c=demo`) | 1280 × 600 | 16 | yes (own view) | 102 / 102 | 0.57° | 0.08 wu |
| Chrome 157 | Custom (sudden 30°, Quick, visible aftereffect, no catch) | 1366 × 768 | 16 | no | 96 / 96 | 0.45° | 0.08 wu |

In the gradual runs the rotation applied on the first eight rotated reaches was 0.00, 6.43, 12.86, 19.29, 25.71, 32.14, 38.57, 45.00°, then 45° for the remaining 14. Besides the deliberately slow reach, 0 to 3 reaches per run were slow by chance (the simulated mouse occasionally stalls); in every run the note appeared after exactly the reaches recorded as too slow.

The class-data API was also checked directly against the same local runtime: storing and replacing a session, an empty class, the 304 answer, invalid codes, malformed and oversized bodies, wrong methods, and the app's own pages at `/instructor` and `/class/<CODE>`. A database created from the earlier schema gained the new column automatically on first use.

Each run opens the built site, checks that the welcome screen reveals nothing, completes the practice and every recorded trial, makes **one reach deliberately slowly** (checking that "Too slow" appears exactly after the reaches recorded as too slow), releases the mouse once mid-reach and resumes, answers the reflection questions, exercises the results page (including the path-error chart), downloads all three files, and compares the downloaded metrics with the directions the simulated participant actually aimed in, including the whole-path error of each straight reach. With `--class`, it then shares the session from the results page and checks it on the class view in both measures.

**What these runs establish.** In real Chrome and Edge: Pointer Lock, trusted input, the trial engine, recording, analysis, results page and downloads agree with one another; the condition is not shown before the reveal; the speed note follows the recorded movement time; sharing works end to end through Cloudflare's runtime and D1.

**What they do not establish.** The input was synthesized through the browser's developer-tools interface, without a visible window. Nothing here says how the task *feels*.

### Running the browser tests yourself

```bash
npm run build
npm run e2e                                              # Chrome, sudden link
node e2e/full-session.mjs --link gradual --channel msedge
node e2e/full-session.mjs --link demo --width 1280 --height 600
node e2e/full-session.mjs --link custom                  # builds a custom protocol on the instructor page first
```

With class sharing (two terminals):

```bash
npm run preview:class                                    # serves http://127.0.0.1:8788/ with a local D1
node e2e/full-session.mjs --link sudden --url http://127.0.0.1:8788/ --class TEST1
```

The browser runs use the Chrome or Edge already installed (nothing is downloaded). Screenshots, the downloaded files and `report.json` go to `e2e/output/`. Add `--headed` to watch; a visible window captures your real mouse while it has focus.

## Human check with a physical mouse

Please run through this on an ordinary laptop with an ordinary mouse, in Chrome or Edge, using the deployed address.

**Starting**
- [ ] Pressing **Start** hides the normal pointer and shows the white dot, which moves at about your normal pointer speed.

**Practice**
- [ ] Holding the dot in the center ring lights a target. Moving onto it and holding still makes it flash, then the dot jumps back to the center.
- [ ] On the two hidden-dot practice reaches, reaching out to the target's distance and holding still registers the reach.
- [ ] A deliberately slow reach shows "Too slow"; a normal quick reach does not.

**Recorded part**
- [ ] With quick, smooth reaches, "Too slow" appears rarely. If it appears on most reaches that feel natural, the 500 ms limit is too strict for your mouse: note the movement times in the downloaded CSV and adjust `maxMovementMs` in a new preset version.
- [ ] **Esc** shows the Paused card; **Resume** continues and repeats the reach.
- [ ] Partway through, the dot starts going off to one side (sudden) or drifts gradually (gradual), with nothing announcing it.

**Results**
- [ ] "Time taken" fits your slot; the Speed line reports how many reaches were slow.
- [ ] The path-error chart jumps when the rotation starts and shrinks afterwards; your catch trials and first aftereffect reaches look plausible.
- [ ] All three downloads save, and the CSV opens in a spreadsheet.

**Class sharing (if set up)**
- [ ] Sharing to a test code shows "Your data has been added to the class view." and the curve appears on `/class/<CODE>` within 15 seconds; then delete the test data.

If the dot's speed feels wrong, adjust `inputGain`; for pacing, adjust `timing`. Make such changes in a new preset version ([PRESETS.md](PRESETS.md)).
