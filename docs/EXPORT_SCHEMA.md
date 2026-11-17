# Export schema

The results page offers three downloads. All are produced in the browser from the same in-memory `SessionRecord` ([`src/core/record.ts`](../src/core/record.ts)) by [`src/core/export.ts`](../src/core/export.ts). Nothing is uploaded. (Class sharing, if a student opts in, sends a separate small summary; see [DEPLOYMENT.md](DEPLOYMENT.md).)

| File | Contents |
|---|---|
| `motor-learning_<preset-id>_<YYYYMMDD-HHMM>_session.json` | Everything: protocol, seed, every attempt, every mouse sample, all metrics. |
| `…_trials.csv` | One row per attempt, with all metrics. |
| `…_events.csv` | One row per recorded mouse sample. |

The time in the file name is the session's start time in **UTC**. Schema version: **2.2.0** (`schemaVersion` in the JSON). Missing values are `null` in JSON and empty cells in CSV.

Units and signs: workspace units (wu), origin at the start, +x right, +y up; degrees, positive = counterclockwise; milliseconds on the browser's monotonic clock (origin = page load). See [METRICS.md](METRICS.md).

**What the metrics cover.** Every reach metric is measured over the outward reach only: from the **go cue** to **arrival**, the first (interpolated) moment the hand is `crossing.radius` from the start. With a target hold, which every current preset has, that radius is `targetDistance − targetRadius`: **222 wu** for the standard geometry (240 − 18), the near edge of the target. (For a preset without a hold, such as the retired v1 presets, it is `targetDistance` itself.) After arrival the participant steers onto the target and holds it until the reach registers; those samples are saved but no metric uses them.

## Session JSON

Numbers inside sample arrays are rounded to 3 decimals (0.001 wu, 0.001 ms). All other numbers keep full precision.

### Top level

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | string | Version of this schema: `"2.2.0"`. |
| `app` | `{name, version}` | The application that produced the file (`visuomotor-learning-lab`, `2.2.0`). |
| `conventions` | object of strings | Plain-language key to units and signs, so the file can be read on its own: `coordinates`, `angles`, `rotation`, `time`, `lateralDeviation`, `directionError`, `arrival`, `registering`, `speed`, `sampleRounding`. |
| `sessionId` | string | Random label for this run. Not a participant identifier; nothing links two runs. |
| `createdAtIso` | string | Wall-clock time the session started (Start pressed), ISO 8601, UTC. |
| `completedAtIso` | string | `createdAtIso` + `durations.totalTaskMs`: about when the last recorded trial ended. |
| `preset` | object | The **complete** preset that was run (below). |
| `assignment` | object | How the preset was chosen (below). |
| `runNumber` | number | 1 for the first run since the page was opened, 2 for the next, … |
| `previousPresetIds` | string[] | Presets already completed in this visit, oldest first (possible carry-over). |
| `seed` | number | Reproduces the target order: `generateSchedule(preset, seed)`. |
| `schedule` | object[] | The planned trials: `index`, `trialNumber`, `phase`, `slotInPhase`, `isCatch`, `perturbedReachNumber`, `targetIndex`, `targetAngleDeg`, `rotationDeg`, `feedback`. |
| `environment` | object | `userAgent`, `language`, `viewport`, `screen`, `devicePixelRatio`, `displayScale` (CSS px per wu), `moveEventSource` (`pointermove` or `mousemove`), `moveEvents`, `moveSamples`, `frameIntervalMs`. |
| `timing` | object | Monotonic clock: `taskStartedMs` (task screen opened), `practiceEndedMs` (null if practice was skipped), `experimentStartedMs` (clicked to begin the recorded reaches), `experimentEndedMs` (last recorded trial ended). |
| `durations` | object | `practiceMs` (null without practice), `experimentMs`, `totalTaskMs`. |
| `practice` | object | `included`, `reachesCompleted`, `attempts` (includes repeats after a timed-out or interrupted practice reach). Practice movements themselves are not recorded. |
| `interruptions` | object[] | Each pause: `tMs`, `reason` (`pointer-lock-lost`, `window-blur`, `tab-hidden`), `trialNumber`, `attempt`, `enginePhase` (`acquire`, `hold`, `reach` or `feedback`), `resumedAtMs` (null if never resumed). |
| `reflection` | object or null | The answers given after the task (below). |
| `trials` | object[] | Every **attempt**, in the order it happened (below). |
| `summary` | object | Descriptive summary of the participant's initial hand direction error (below). |

### `preset`

`id`, `version`, `kind`, `label`, `description`, `structure`, `perturbation`, `geometry`, `timing`, `criteria`. See [PRESETS.md](PRESETS.md). `kind` is `canonical` (one of the two standard conditions), `demo` (the Quick Demo) or `custom` (built from instructor settings; never pooled with canonical data).

The values the analysis depends on, with those of every current preset:

| Field | Standard value | Meaning |
|---|---|---|
| `geometry.targetDistance` | 240 | Start to target center (wu). Called D in [METRICS.md](METRICS.md). |
| `geometry.targetRadius` | 18 | Target radius (wu). Sets the arrival radius, D − 18 = 222. |
| `geometry.startRadius` | 14 | The cursor must be this close to the start to count as centered (wu). |
| `geometry.inputGain` | 1 | wu of hand movement per CSS pixel of mouse movement. |
| `timing.holdMs` | 400 | Centre hold before the target appears (ms). |
| `timing.targetHoldMs` | 400 | Time in the target zone for a reach to register (ms). Absent or 0 means the reach registers the instant the hand arrives (v1). |
| `timing.maxMovementMs` | 500 | Speed instruction (v3): a movement from onset to arrival longer than this is followed by "Too slow" and flagged `tooSlow`. The reach still counts. Absent in v1 and v2 presets. |
| `timing.reachTimeoutMs` | 6000 | Time allowed from the go cue for the reach to register (ms). |
| `timing.feedbackHoldMs` | 300 | Pause after each reach, before the cursor jumps back to the center (ms). |
| `criteria.onsetFraction` | 0.05 | Movement onset at 5% of D. |
| `criteria.initialDirectionFraction` | 0.25 | Initial direction measured at 25% of D. |
| `criteria.minReachSamples` | 4 | Fewer outward-reach samples than this: no metrics. |

### `assignment`

| Field | Type | Meaning |
|---|---|---|
| `presetId` | string | The preset that was run (equals `preset.id`). |
| `method` | string | `random-50-50` (fair coin between the two canonical presets), `direct-link` (a `?c=` link to a shipped preset, or a `?x=` link whose settings are exactly a shipped preset), `custom-link` (a `?x=` link with custom settings), or `participant-chose-other-condition`. |
| `linkCode` | string or null | The code that selected the preset: the `c` code (such as `k7m2`) or the `x` code of a custom link. |
| `ignoredLinkCode` | string or null | A code that was in the link but not understood. |
| `conditionConcealed` | boolean | False only when the participant already knew which condition they were starting. |
| `customSettings` | object or null | For `custom-link` only: the instructor settings the preset was built from, `schedule` (`sudden`/`gradual`), `angleDeg` (15, 30, 45 or 60), `tier` (`quick`/`standard`/`extended`), `aftereffect` (`hidden`/`visible`), `catchTrials` (boolean). Null otherwise. |

### `reflection`

| Field | Type | Meaning |
|---|---|---|
| `skipped` | boolean | True when the participant pressed Skip; the other fields are then empty. |
| `noticed` | string | Free text: what, if anything, seemed to change. |
| `consciousAdjustment` | string or null | "Did you consciously try to adjust where you aimed during the task?": `yes`, `somewhat`, `no`, `unsure`, or null if unanswered. |
| `changedAim` | null | Always null since schema 2 (the schema 1 question it replaced). Kept so the shape of `reflection` did not change. |
| `device` | string or null | Self-reported pointing device: `mouse`, `trackpad`, `other`. |

### `summary`

Computed from the final attempt of every scheduled trial.

| Field | Meaning |
|---|---|
| `metric` | Always `"hand.initialDirectionErrorDeg"`: the value summarised. |
| `trialsScheduled`, `trialsValid` | Scheduled trials, and how many have metrics. |
| `trialsTimedOut` | Trials whose time limit came before the hand **arrived** (`invalidReason: "timeout"`). A reach that arrived but did not register is valid and not counted here. |
| `trialsDegenerate` | Trials with `invalidReason: "too-few-samples"`. |
| `baseline`, `earlyPerturbed`, `latePerturbed`, `aftereffect` | Each `{trialNumbers, n, meanDeg, meanRotationDeg}`: the trials in the group, how many were valid, their mean value, and the mean rotation applied. |
| `catchTrials` | `[{trialNumber, valueDeg, neighbourBefore, neighbourAfter}]`: each catch trial and the nearest rotated trials on either side. |
| `firstAftereffect` | `{trialNumber, valueDeg}`. |

### `trials[]`: one entry per attempt

A trial normally has one attempt. If a reach was interrupted, that attempt is kept and the trial has a second one. A timed-out reach is not repeated. **Use the entries with `isFinalAttempt: true` for analysis.**

| Field | Type | Meaning |
|---|---|---|
| `trialNumber`, `trialIndex` | number | 1-based and 0-based position in the session. |
| `attempt` | number | 1-based attempt number for this trial. |
| `isFinalAttempt` | boolean | The attempt that counts for this trial (the last one recorded). |
| `phase` | string | `baseline`, `adaptation` or `aftereffect`. |
| `slotInPhase` | number | 1-based position within the phase. |
| `isCatch` | boolean | Zero-rotation catch trial within adaptation. |
| `perturbedReachNumber` | number or null | Running count of non-catch adaptation reaches (the ramp counter). |
| `targetIndex`, `targetAngleDeg`, `targetX`, `targetY` | number | The target. |
| `configuredRotationDeg` | number | Rotation the schedule called for. |
| `appliedRotationDeg` | number | Rotation actually used in the cursor transformation. |
| `feedback` | string | `visible` or `hidden` (cursor during the reach). |
| `cursorVisibleDuringReach` | boolean | Whether the cursor was drawn during the reach. |
| `outcome` | string | `completed` (the reach registered: the target zone was held for `preset.timing.targetHoldMs`), `timeout` (the time limit ran out first) or `interrupted` (pointer lock or focus lost during the reach; the trial is presented again). |
| `holdCompleted` | boolean | True when the reach registered. |
| `tooSlow` | boolean or null | True when the movement (onset → arrival) took longer than `preset.timing.maxMovementMs` and the participant was shown "Too slow"; false when it was quick enough; null when the preset has no speed instruction or the hand never arrived. Slow reaches are kept and analysed like any other. Added in 2.2.0. |
| `valid` | boolean | True when the hand **arrived** and metrics could be computed. Can be true for a `timeout` whose hold never registered. |
| `invalidReason` | string or null | When `valid` is false: `timeout` (time ran out before the hand arrived), `interrupted` or `too-few-samples`. Same as `metrics.nullReason`. |
| `startAnchorOffset` | `{x, y}` | Small cursor offset from the exact center that was removed when the reach was anchored at the go cue. |
| `times` | object | Timestamps (below). |
| `crossing` | object or null | The arrival (below). Null if the hand never arrived. |
| `metrics` | object | All metrics (below). |
| `samples` | object | The recorded movement, in three segments (below). |

### `trials[].times`

All on the monotonic clock (ms).

| Field | Meaning |
|---|---|
| `acquireStartMs` | The attempt began (the cursor had just been placed on the center). |
| `holdStartMs` | Start of the final, successful center hold. |
| `goCueMs` | Target appeared and hand and cursor were anchored at the start: the start of the outward reach. |
| `movementOnsetMs` | Hand first reached 5% of D (interpolated). |
| `completionMs` | **Arrival**: the hand first reached `crossing.radius` (interpolated). Movement duration and every path metric end here. Null if the hand never arrived. |
| `holdCompletionMs` | The reach registered: exactly the start of the final stay in the target zone + `targetHoldMs`. Null if it never registered. |
| `reachEndMs` | The reach phase ended (registration, time limit or interruption), as the engine noticed it, which can be up to one display frame after the event. |
| `attemptEndMs` | The attempt's record was closed, after the pause. |

### `trials[].crossing`

The name is kept from schema 1, where the radius was always the target distance.

| Field | Meaning |
|---|---|
| `tMs` | Arrival time (equals `times.completionMs`). |
| `handX`, `handY` | Hand position at arrival, exactly `radius` from the start. |
| `cursorX`, `cursorY` | Cursor position at that instant; null when the cursor was hidden. |
| `radius` | The arrival radius (wu): `targetDistance − targetRadius` = 222 with a target hold, `targetDistance` without one. |
| `sampleIndex` | Index into the `samples.reach` arrays of the first sample at or beyond `radius`. Samples before it are the outward reach; from it onward are settling onto the target and holding. |

### `trials[].metrics`

| Field | Meaning |
|---|---|
| `valid`, `nullReason` | As `valid` and `invalidReason` above. |
| `reachSampleCount` | Samples in the outward reach: the go-cue sample through the first sample at or beyond the arrival radius (`crossing.sampleIndex + 1`). All recorded reach samples when the hand never arrived. |
| `reactionTimeMs` | Go cue → movement onset. |
| `movementDurationMs` | Movement onset → arrival. Does not include settling or the hold. |
| `hand`, `cursor` | Path metrics of the hand and of the displayed cursor (below). `cursor` is null when the cursor was hidden; both are null when `valid` is false. |

Each of `hand` and `cursor` holds (definitions in [METRICS.md](METRICS.md)):

| Field | Unit | Meaning |
|---|---|---|
| `initialDirectionErrorDeg` | deg | Direction where the path first reaches 25% of D. |
| `endpointDirectionErrorDeg` | deg | Direction at arrival. |
| `maxAbsLateralDeviation` | wu | Largest distance from the start→target line. |
| `signedLateralDeviationAtMax` | wu | The signed value at that point. |
| `meanAbsLateralDeviation` | wu | Mean distance from the line, averaged along the path's length. |
| `meanSignedLateralDeviation` | wu | The same average keeping the sign: the whole-path error. Added in 2.1.0. |
| `pathLength` | wu | Length of the path from the start to arrival. |
| `pathEfficiency` | ratio | Straight-line distance from start to arrival ÷ `pathLength`. 1 = perfectly straight. |

### `trials[].samples`

Arrays are column-wise: entry *i* of every array in a segment belongs to the same mouse sample.

| Segment | Arrays | Meaning |
|---|---|---|
| `preReach` | `tMs`, `dx`, `dy`, `x`, `y` | Movement at the center before the go cue (keeping the cursor in, or bringing it back to, the start circle). Normal mapping, so `(x, y)` is both hand and cursor. Positions are confined to the workspace, so they can differ from the running sum of `dx`, `dy`. |
| `reach` | `tMs`, `dx`, `dy`, `handX`, `handY`, `cursorX`, `cursorY` | The whole reach phase, from the go cue until the reach registered, timed out or was interrupted. The first sample is the anchored start at the go cue. Samples before `crossing.sampleIndex` are the outward reach; the rest are settling onto the target and holding. `cursorX`/`cursorY` are `null` (not arrays) when the cursor was hidden. For every sample, `cursor = R(appliedRotationDeg) · hand`. |
| `postReach` | `tMs`, `dx`, `dy`, `x`, `y` | Always empty since schema 2: after the pause the cursor jumps back to the center, so there is no return movement. Kept so the file keeps its shape. |

`dx`, `dy` are the mouse movement that produced each sample, in workspace units with **+y up** (the browser's `movementY` is negated). At `inputGain` 1 they equal the browser's reported movement in CSS pixels.

## Trial CSV (`…_trials.csv`)

One row per attempt (including interrupted and timed-out ones), 55 columns, in this order (`TRIALS_CSV_HEADER` in `export.ts`):

| # | Column | Source in the session JSON |
|---|---|---|
| 1 | `session_id` | `sessionId` |
| 2 | `preset_id` | `preset.id` |
| 3 | `preset_version` | `preset.version` |
| 4 | `assignment_method` | `assignment.method` |
| 5 | `condition_concealed` | `assignment.conditionConcealed` |
| 6 | `run_number` | `runNumber` |
| 7 | `seed` | `seed` |
| 8 | `trial_number` | `trialNumber` |
| 9 | `attempt` | `attempt` |
| 10 | `is_final_attempt` | `isFinalAttempt` |
| 11 | `phase` | `phase` |
| 12 | `slot_in_phase` | `slotInPhase` |
| 13 | `is_catch` | `isCatch` |
| 14 | `perturbed_reach_number` | `perturbedReachNumber` |
| 15 | `target_index` | `targetIndex` |
| 16 | `target_angle_deg` | `targetAngleDeg` |
| 17 | `target_x` | `targetX` |
| 18 | `target_y` | `targetY` |
| 19 | `configured_rotation_deg` | `configuredRotationDeg` |
| 20 | `applied_rotation_deg` | `appliedRotationDeg` |
| 21 | `feedback` | `feedback` |
| 22 | `cursor_visible_during_reach` | `cursorVisibleDuringReach` |
| 23 | `outcome` | `outcome` |
| 24 | `hold_completed` | `holdCompleted` |
| 25 | `too_slow` | `tooSlow` (empty without a speed instruction or when the hand never arrived) |
| 26 | `valid` | `valid` |
| 27 | `invalid_reason` | `invalidReason` |
| 28 | `go_cue_ms` | `times.goCueMs` |
| 29 | `movement_onset_ms` | `times.movementOnsetMs` |
| 30 | `completion_ms` | `times.completionMs` (**arrival**) |
| 31 | `hold_completion_ms` | `times.holdCompletionMs` (the reach registered) |
| 32 | `reaction_time_ms` | `metrics.reactionTimeMs` |
| 33 | `movement_duration_ms` | `metrics.movementDurationMs` |
| 34 | `reach_sample_count` | `metrics.reachSampleCount` |
| 35 | `hand_initial_direction_error_deg` | `metrics.hand.initialDirectionErrorDeg` |
| 36 | `hand_endpoint_direction_error_deg` | `metrics.hand.endpointDirectionErrorDeg` |
| 37 | `hand_max_abs_lateral_dev` | `metrics.hand.maxAbsLateralDeviation` |
| 38 | `hand_signed_lateral_dev_at_max` | `metrics.hand.signedLateralDeviationAtMax` |
| 39 | `hand_mean_abs_lateral_dev` | `metrics.hand.meanAbsLateralDeviation` |
| 40 | `hand_mean_signed_lateral_dev` | `metrics.hand.meanSignedLateralDeviation` |
| 41 | `hand_path_length` | `metrics.hand.pathLength` |
| 42 | `hand_path_efficiency` | `metrics.hand.pathEfficiency` |
| 43 | `cursor_initial_direction_error_deg` | `metrics.cursor.initialDirectionErrorDeg` |
| 44 | `cursor_endpoint_direction_error_deg` | `metrics.cursor.endpointDirectionErrorDeg` |
| 45 | `cursor_max_abs_lateral_dev` | `metrics.cursor.maxAbsLateralDeviation` |
| 46 | `cursor_signed_lateral_dev_at_max` | `metrics.cursor.signedLateralDeviationAtMax` |
| 47 | `cursor_mean_abs_lateral_dev` | `metrics.cursor.meanAbsLateralDeviation` |
| 48 | `cursor_mean_signed_lateral_dev` | `metrics.cursor.meanSignedLateralDeviation` |
| 49 | `cursor_path_length` | `metrics.cursor.pathLength` |
| 50 | `cursor_path_efficiency` | `metrics.cursor.pathEfficiency` |
| 51 | `crossing_hand_x` | `crossing.handX` |
| 52 | `crossing_hand_y` | `crossing.handY` |
| 53 | `crossing_cursor_x` | `crossing.cursorX` |
| 54 | `crossing_cursor_y` | `crossing.cursorY` |
| 55 | `arrival_radius` | `crossing.radius` |

Booleans are `true` / `false`. Numbers are rounded to 4 decimals. Text containing a comma, quote or line break is quoted. Metric cells are empty for invalid attempts; cursor cells are empty when the cursor was hidden; `crossing_*` and `arrival_radius` are empty when the hand never arrived; `hold_completion_ms` is empty when the reach never registered.

To analyse, keep rows with `is_final_attempt = true` and `valid = true`.

## Event CSV (`…_events.csv`)

One row per recorded mouse sample, 18 columns, in this order (`EVENTS_CSV_HEADER` in `export.ts`):

`session_id`, `trial_number`, `attempt`, `segment`, `sample_index`, `t_ms`, `t_from_go_ms`, `dx`, `dy`, `hand_x`, `hand_y`, `cursor_x`, `cursor_y`, `cursor_displayed`, `hand_progress`, `hand_lateral`, `cursor_progress`, `cursor_lateral`

| Column | Meaning |
|---|---|
| `session_id`, `trial_number`, `attempt` | Which attempt the sample belongs to. |
| `segment` | `pre_reach` (`samples.preReach`), `reach` (the outward reach: `samples.reach` before `crossing.sampleIndex`) or `settle` (`samples.reach` from `crossing.sampleIndex` on: steering onto the target and holding). An attempt in which the hand never arrived has no `settle` rows. **Only the `reach` rows, ended by the interpolated arrival point, are used for metrics.** |
| `sample_index` | 0-based. For `pre_reach`, the index within `samples.preReach`. `reach` and `settle` share one running index into `samples.reach`, so the first `settle` row has index `crossing.sampleIndex`. |
| `t_ms` | Time on the monotonic clock. |
| `t_from_go_ms` | Time relative to the go cue (negative before it; empty if there was no go cue). |
| `dx`, `dy` | Mouse movement for this sample (wu, +y up). |
| `hand_x`, `hand_y` | Virtual hand position. |
| `cursor_x`, `cursor_y` | Cursor position. Equal to the hand in `pre_reach`; empty in `reach` and `settle` when the cursor was hidden. |
| `cursor_displayed` | Whether the cursor was on screen (`true` in `pre_reach`; `cursorVisibleDuringReach` in `reach` and `settle`). |
| `hand_progress`, `hand_lateral` | Target-aligned hand coordinates (`reach` and `settle` rows only). |
| `cursor_progress`, `cursor_lateral` | Target-aligned cursor coordinates (`reach` and `settle` rows with a visible cursor only). |

The arrival point itself is not a row: it lies between the last `reach` row and the first `settle` row, and is in the trial CSV's `crossing_*` columns. So for a valid attempt `reach_sample_count` in the trial CSV is one more than its number of `reach` rows. There are no `post_reach` rows since schema 2.

## Reading the files

```python
import json, pandas as pd

session = json.load(open("motor-learning_rotation-sudden-45-v3_20261114-1530_session.json"))
finals = [t for t in session["trials"] if t["isFinalAttempt"] and t["valid"]]
errors = [(t["trialNumber"], t["metrics"]["hand"]["initialDirectionErrorDeg"]) for t in finals]

trials = pd.read_csv("motor-learning_rotation-sudden-45-v3_20261114-1530_trials.csv")
trials = trials[trials.is_final_attempt & trials.valid]

# Path error as on the results page: the cursor's whole-path error in % of D,
# or the hand's on reaches made with the cursor hidden (rotation 0).
D = session["preset"]["geometry"]["targetDistance"]
seen = trials.cursor_mean_signed_lateral_dev.fillna(
    trials.hand_mean_signed_lateral_dev.where(trials.applied_rotation_deg == 0))
trials["path_error_pct"] = seen / D * 100
```

## Schema changes

Bump `SCHEMA_VERSION` in `src/core/record.ts` when a field is renamed, removed or changes meaning (major), or when fields are added (minor), and update this page.

| Version | Changes |
|---|---|
| **2.2.0** | The speed instruction of the v3 presets: `preset.timing.maxMovementMs` (500 ms) and, per attempt, `tooSlow` (true when the movement from onset to arrival took longer and the participant was shown "Too slow"; null without a speed instruction or when the hand never arrived), the convention `speed`, and the CSV column `too_slow` (column 25; later columns move up by one). Additive. |
| **2.1.0** | Adds `metrics.hand.meanSignedLateralDeviation` and `metrics.cursor.meanSignedLateralDeviation`, the whole-path error (signed lateral deviation averaged along the outward path), and the CSV columns `hand_mean_signed_lateral_dev` and `cursor_mean_signed_lateral_dev`. Nothing else changes; 2.0.0 files lack only this. |
| **2.0.0** | Hold-to-complete and the jump home (v2 presets). `samples.reach` now runs to the end of the hold, not just to the crossing; `crossing` is the arrival at `crossing.radius` (new) and gains `sampleIndex`; `times.completionMs` is that arrival; `valid` means "the hand arrived", so a timed-out reach can be valid. New: `holdCompleted`, `times.holdCompletionMs`, `preset.timing.targetHoldMs`, `reflection.consciousAdjustment`. `samples.postReach` is always empty; `reflection.changedAim` is no longer asked (always null). Also new in 2.0.0 files: `assignment.customSettings`, the `custom-link` method and preset `kind` `custom`. CSV: new `hold_completed`, `hold_completion_ms` and `arrival_radius` columns; in the events CSV a `settle` segment replaces `post_reach`. |
| **1.0.0** | First release (v1 presets). A reach ended the instant the hand crossed the target distance (240 wu), and the cursor was then steered back to the center by hand (`samples.postReach`). `crossing` had only `tMs`, `handX`, `handY`, `cursorX`, `cursorY`. |

**Reading a 1.0.0 file.** It has no `crossing.sampleIndex`: the last `samples.reach` sample is the first one at or beyond the target distance, which is how the app's own analysis treats it.
