# Testing

Three layers of checking, and one that is still to be done by a person.

| Layer | Command | What it covers |
|---|---|---|
| Type check | `npm run typecheck` | The whole code base compiles under strict TypeScript. |
| Unit tests | `npm test` | Protocol, trial engine, analysis, exports, results data, concealment. Runs in seconds, no browser. |
| Full browser run | `npm run e2e` | A complete session in real Chrome or Edge through real Pointer Lock, with simulated mouse input. |
| **Human check** | (manual) | **Not yet done.** A person using a physical mouse. See the checklist below. |

`npm run verify` runs the first three in order (after a build).

## Results (14 November 2026)

### Unit tests: 305 passed, 0 failed (13 files)

| File | Tests | Covers |
|---|---|---|
| `src/core/geometry.test.ts` | 20 | +45° and 0° rotation, rigid rotation, `cursor = start + R(θ)(hand − start)`, compensation in all 8 directions, signed angles, circle-crossing interpolation |
| `src/core/presets.test.ts` | 15 | Stable preset ids, frozen v1 snapshots, canonical presets differ only in perturbation, validation of bad presets |
| `src/core/schedule.test.ts` | 44 | 8/24/8 structure, catch slots 12 and 20, return to perturbation after a catch, gradual ramp (reach 1 = 0°, equal steps, reach 8 = 45.0°, hold for 14), ramp counter not advanced by catch trials (including catch trials placed inside the ramp), 8-target balance, no immediate repeats, seed reproducibility, Quick Demo |
| `src/core/engine.test.ts` | 42 | Center acquisition and hold, anchoring at go, rotation applied per trial, completion by hand distance with the cursor hidden, interpolation of the crossing, timeouts, return under the normal mapping with no carried offset, interruption in every phase, monotonic timestamps, a full 40-trial session with no announced transitions |
| `src/core/analysis.test.ts` | 41 | Signed error in all 8 target directions, hand vs cursor under rotation, initial direction vs endpoint error on a curved path, path length and efficiency, independence from sampling rate, nulls with reasons for timed-out, interrupted and degenerate reaches, trial grouping, per-participant summary |
| `src/core/assignment.test.ts` | 18 | 50/50 assignment, direct-link codes, codes do not reveal the condition, unknown codes, seed override, "other condition" assignment, session plan |
| `src/core/record.test.ts` | 18 | Every required field recorded for every trial, exact applied angles, metrics match recorded movement, interrupted and timed-out attempts kept and flagged |
| `src/core/export.test.ts` | 22 | JSON round-trip and precision, compact sample arrays, trial CSV and per-sample CSV contents, empty cells for missing values, CSV quoting, file names |
| `src/input/pointerLock.test.ts` | 10 | y-axis flip on input, use of hardware sub-samples only when they sum to the event total, timestamp sanity guard |
| `src/ui/concealment.test.tsx` | 15 | Welcome, task and reflection screens show no revealing words; sudden and gradual task markup is identical; instructor details sit behind a confirmation; embedded-frame notice |
| `src/ui/TaskScreen.test.tsx` | 3 | DOM mouse events move the dot with the correct axis sense; pause and click-to-resume while the mouse stays captured |
| `src/ui/results/model.test.ts` | 32 | The numbers each chart draws equal the recorded movement (a scripted participant's known aim comes back out of the chart data); cursor view; gaps for invalid trials |
| `src/ui/results/ResultsPage.test.tsx` | 25 | Reveal text, debrief content, no class or population data, no predicted outcomes, tables, hand/cursor switch, trial inspector, downloads, "try the other version" |

The automated tests required by the build brief map onto these files as follows: rotation behavior (geometry, engine); gradual ramp and hold, catch scheduling and return to perturbation, 8-target balance (schedule); center-return and no-feedback completion, unannounced transition to aftereffects, valid vs invalid trials (engine, record); signed error in all eight directions (analysis); data capture and export (record, export); stable preset identifiers (presets).

### Full browser runs: all checks passed

Each run opens the built site, checks that the welcome screen reveals nothing, completes the practice and every recorded trial, releases the mouse once in mid-reach and resumes, answers the reflection questions, exercises the results page, downloads all three files, and compares the downloaded metrics with the directions the simulated participant actually aimed in.

| Browser | Link | Viewport | Trials | Checks | Worst difference between aimed and recorded initial direction |
|---|---|---|---|---|---|
| Chrome 157 | Sudden (`?c=k7m2`) | 1366 × 768 | 40 | 53 / 53 | 0.44° |
| Edge 157 | Gradual (`?c=p4x9`) | 1366 × 768 | 40 | 54 / 54 | 0.46° |
| Chrome 157 | General (random; drew Sudden) | 1920 × 1080 | 40 | 53 / 53 | 0.52° |
| Edge 157 | Quick Demo (`?c=demo`) | 1280 × 600 | 16 | 52 / 52 | 0.41° |

The Quick Demo was also run against the development server (`npm run dev`) at 1920 × 1080: 52 / 52.

In the gradual run the rotation actually applied on the first eight rotated reaches was 0.00, 6.43, 12.86, 19.29, 25.71, 32.14, 38.57, 45.00°, followed by 14 reaches at 45°.

**What these runs establish.** In real Chrome and Edge: Pointer Lock is granted from the Start click; movement arrives through trusted pointer events and is counted once; the trial engine, recording, analysis, results page and downloads agree with one another; the condition is not shown before the reveal; releasing the mouse pauses the task and the interrupted reach is repeated and kept in the data.

**What they do not establish.** The input was synthesized through the browser's developer-tools interface, in a browser without a visible window. No physical mouse was involved, so nothing here says how the task *feels*.

Layouts were inspected from screenshots of these runs at 1280 × 600, 1366 × 768 and 1920 × 1080.

### Running the browser test yourself

```bash
npm run build
npm run e2e                                              # Chrome, sudden link
node e2e/full-session.mjs --link gradual --channel msedge
node e2e/full-session.mjs --link demo --width 1280 --height 600
```

It uses the Chrome or Edge already installed on the computer (nothing is downloaded) and starts its own preview server. Screenshots, the downloaded files and `report.json` are written to `e2e/output/`. Add `--headed` to watch it; a visible window captures your real mouse while it has focus.

## Human check with a physical mouse (still to do)

Please run through this once on an ordinary laptop with an ordinary mouse, in Chrome or Edge, using the deployed address.

**Starting**
- [ ] Pressing **Start** hides the normal pointer and shows the white dot.
- [ ] The dot moves at about the speed your normal pointer does, in the direction you move the mouse.

**Practice**
- [ ] Bringing the dot into the center ring and holding still lights a target.
- [ ] Slicing through the target ends the reach; the dot stops where it crossed, then follows the mouse again.
- [ ] On the two hidden-dot practice reaches the dot disappears, and the reach still registers.

**Recorded part**
- [ ] The half-second pause after each reach is tolerable. If the dot feels stuck, shorten `feedbackHoldMs`.
- [ ] Pressing **Esc** shows the Paused card; **Resume** continues and repeats the reach.
- [ ] Switching to another window and back pauses and resumes the same way.
- [ ] Partway through, the dot starts going off to one side (sudden) or drifts gradually (gradual), with nothing announcing it.
- [ ] Near the end the dot is hidden again.

**Results**
- [ ] "Time taken" is within your time slot.
- [ ] The rotation chart matches the version named at the top.
- [ ] Your own paths and the single-reach inspector look like what you remember doing.
- [ ] All three downloads save, and the CSV opens in a spreadsheet.

**Also worth trying**
- [ ] A second computer with a different mouse or display scaling.
- [ ] A trackpad, to see how much harder it is (for advising students).

If the dot's speed feels wrong, adjust `inputGain`; for pacing, adjust `timing`. Make such changes in a new preset version ([PRESETS.md](PRESETS.md)).
