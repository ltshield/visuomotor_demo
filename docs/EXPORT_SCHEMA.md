# Export schema

The results page offers three downloads. All are produced in the browser from the same in-memory `SessionRecord` ([`src/core/record.ts`](../src/core/record.ts)) by [`src/core/export.ts`](../src/core/export.ts). Nothing is uploaded.

| File | Contents |
|---|---|
| `motor-learning_<preset-id>_<YYYYMMDD-HHMM>_session.json` | Everything: protocol, seed, every attempt, every mouse sample, all metrics. |
| `…_trials.csv` | One row per attempt, with all metrics. |
| `…_events.csv` | One row per recorded mouse sample. |

The time in the file name is the session's start time in **UTC**. Schema version: **1.0.0** (`schemaVersion` in the JSON). Missing values are `null` in JSON and empty cells in CSV.

Units and signs: workspace units (wu), origin at the start, +x right, +y up; degrees, positive = counterclockwise; milliseconds on the browser's monotonic clock (origin = page load). See [METRICS.md](METRICS.md).

## Session JSON

Numbers inside sample arrays are rounded to 3 decimals (0.001 wu, 0.001 ms). All other numbers keep full precision.

### Top level

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | string | Version of this schema. |
| `app` | `{name, version}` | The application that produced the file. |
| `conventions` | object of strings | Plain-language key to units and signs, so the file can be read on its own. |
| `sessionId` | string | Random label for this run. Not a participant identifier; nothing links two runs. |
| `createdAtIso`, `completedAtIso` | string | Wall-clock start and end (ISO 8601, UTC). |
| `preset` | object | The **complete** preset that was run: `id`, `version`, `kind`, `label`, `description`, `structure`, `perturbation`, `geometry`, `timing`, `criteria`. See [PRESETS.md](PRESETS.md). |
| `assignment` | object | `presetId`; `method` (`random-50-50`, `direct-link` or `participant-chose-other-condition`); `linkCode`; `ignoredLinkCode` (an unrecognised code in the link); `conditionConcealed`. |
| `runNumber` | number | 1 for the first run since the page was opened, 2 for the next, … |
| `previousPresetIds` | string[] | Presets already completed in this visit (possible carry-over). |
| `seed` | number | Reproduces the target order: `generateSchedule(preset, seed)`. |
| `schedule` | object[] | The planned trials: `index`, `trialNumber`, `phase`, `slotInPhase`, `isCatch`, `perturbedReachNumber`, `targetIndex`, `targetAngleDeg`, `rotationDeg`, `feedback`. |
| `environment` | object | `userAgent`, `language`, `viewport`, `screen`, `devicePixelRatio`, `displayScale` (CSS px per wu), `moveEventSource`, `moveEvents`, `moveSamples`, `frameIntervalMs`. |
| `timing` | object | `taskStartedMs`, `practiceEndedMs`, `experimentStartedMs`, `experimentEndedMs` (monotonic clock). |
| `durations` | object | `practiceMs`, `experimentMs`, `totalTaskMs`. |
| `practice` | object | `included`, `reachesCompleted`, `attempts`. Practice movements themselves are not recorded. |
| `interruptions` | object[] | Each pause: `tMs`, `reason` (`pointer-lock-lost`, `window-blur`, `tab-hidden`), `trialNumber`, `attempt`, `enginePhase`, `resumedAtMs`. |
| `reflection` | object or null | `skipped`, `noticed` (free text), `changedAim` (`yes`/`no`/`unsure`), `device` (`mouse`/`trackpad`/`other`). |
| `trials` | object[] | Every **attempt**, in the order it happened (below). |
| `summary` | object | Descriptive summary of the participant's initial hand direction error (see [METRICS.md](METRICS.md)). |

### `trials[]` — one entry per attempt

A trial normally has one attempt. If a reach was interrupted, that attempt is kept and the trial has a second one. **Use the entries with `isFinalAttempt: true` for analysis.**

| Field | Type | Meaning |
|---|---|---|
| `trialNumber`, `trialIndex` | number | 1-based and 0-based position in the session. |
| `attempt` | number | 1-based attempt number for this trial. |
| `isFinalAttempt` | boolean | The attempt that counts for this trial. |
| `phase` | string | `baseline`, `adaptation` or `aftereffect`. |
| `slotInPhase` | number | 1-based position within the phase. |
| `isCatch` | boolean | Zero-rotation catch trial within adaptation. |
| `perturbedReachNumber` | number or null | Running count of non-catch adaptation reaches (the ramp counter). |
| `targetIndex`, `targetAngleDeg`, `targetX`, `targetY` | number | The target. |
| `configuredRotationDeg` | number | Rotation the schedule called for. |
| `appliedRotationDeg` | number | Rotation actually used in the cursor transformation. |
| `feedback` | string | `visible` or `hidden` (cursor during the outward reach). |
| `cursorVisibleDuringReach` | boolean | Whether the cursor was drawn during the reach. |
| `outcome` | string | `completed`, `timeout` or `interrupted`. |
| `valid` | boolean | Completed, and metrics could be computed. |
| `invalidReason` | string or null | `timeout`, `interrupted` or `too-few-samples`. |
| `startAnchorOffset` | `{x, y}` | Small cursor offset from the exact center that was removed when the reach was anchored. |
| `times` | object | `acquireStartMs`, `holdStartMs`, `goCueMs`, `movementOnsetMs`, `completionMs`, `reachEndMs`, `attemptEndMs`. |
| `crossing` | object or null | Interpolated crossing of the target distance: `tMs`, `handX`, `handY`, `cursorX`, `cursorY` (cursor fields null when hidden). |
| `metrics` | object | `valid`, `nullReason`, `reachSampleCount`, `reactionTimeMs`, `movementDurationMs`, `hand`, `cursor`. `hand` and `cursor` each hold `initialDirectionErrorDeg`, `endpointDirectionErrorDeg`, `maxAbsLateralDeviation`, `signedLateralDeviationAtMax`, `meanAbsLateralDeviation`, `pathLength`, `pathEfficiency`, or are null. |
| `samples` | object | The recorded movement, in three segments (below). |

### `trials[].samples`

Arrays are column-wise: entry *i* of every array in a segment belongs to the same mouse sample.

| Segment | Arrays | Meaning |
|---|---|---|
| `preReach` | `tMs`, `dx`, `dy`, `x`, `y` | Return to the center and the hold before the go cue. Normal mapping, so `(x, y)` is both hand and cursor. Positions are confined to the workspace, so they can differ from the running sum of `dx`, `dy`. |
| `reach` | `tMs`, `dx`, `dy`, `handX`, `handY`, `cursorX`, `cursorY` | The outward reach. The first sample is the anchored start at the go cue. The last sample is the first one at or beyond the target distance. `cursorX`/`cursorY` are `null` (not arrays) when the cursor was hidden. For every sample, `cursor = R(appliedRotationDeg) · hand`. |
| `postReach` | `tMs`, `dx`, `dy`, `x`, `y` | Hand movement during the pause after the reach, continuing the reach's hand coordinates. The cursor was frozen (or hidden) during this time. |

`dx`, `dy` are the mouse movement that produced each sample, in workspace units with **+y up** (the browser's `movementY` is negated). At `inputGain` 1 they equal the browser's reported movement in CSS pixels.

## Trial CSV (`…_trials.csv`)

One row per attempt. Columns, in order:

`session_id`, `preset_id`, `preset_version`, `assignment_method`, `condition_concealed`, `run_number`, `seed`, `trial_number`, `attempt`, `is_final_attempt`, `phase`, `slot_in_phase`, `is_catch`, `perturbed_reach_number`, `target_index`, `target_angle_deg`, `target_x`, `target_y`, `configured_rotation_deg`, `applied_rotation_deg`, `feedback`, `cursor_visible_during_reach`, `outcome`, `valid`, `invalid_reason`, `go_cue_ms`, `movement_onset_ms`, `completion_ms`, `reaction_time_ms`, `movement_duration_ms`, `reach_sample_count`,

then seven hand metrics and the same seven cursor metrics:

`hand_initial_direction_error_deg`, `hand_endpoint_direction_error_deg`, `hand_max_abs_lateral_dev`, `hand_signed_lateral_dev_at_max`, `hand_mean_abs_lateral_dev`, `hand_path_length`, `hand_path_efficiency`, `cursor_…` (same seven),

then `crossing_hand_x`, `crossing_hand_y`, `crossing_cursor_x`, `crossing_cursor_y`.

Booleans are `true` / `false`. Numbers are rounded to 4 decimals. Metric cells are empty for invalid attempts; cursor cells are empty when the cursor was hidden.

To analyse, keep rows with `is_final_attempt = true` and `valid = true`.

## Event CSV (`…_events.csv`)

One row per recorded mouse sample.

| Column | Meaning |
|---|---|
| `session_id`, `trial_number`, `attempt` | Which attempt the sample belongs to. |
| `segment` | `pre_reach`, `reach` or `post_reach`. **Only `reach` is used for metrics.** |
| `sample_index` | 0-based index within the segment. |
| `t_ms` | Time on the monotonic clock. |
| `t_from_go_ms` | Time relative to the go cue (negative before it; empty if the reach never started). |
| `dx`, `dy` | Mouse movement for this sample (wu, +y up). |
| `hand_x`, `hand_y` | Virtual hand position. |
| `cursor_x`, `cursor_y` | Cursor position. Equal to the hand in `pre_reach`; empty when hidden; the frozen position in `post_reach`. |
| `cursor_displayed` | Whether the cursor was on screen. |
| `hand_progress`, `hand_lateral` | Target-aligned hand coordinates (`reach` rows only). |
| `cursor_progress`, `cursor_lateral` | Target-aligned cursor coordinates (`reach` rows with a visible cursor only). |

## Reading the files

```python
import json, pandas as pd

session = json.load(open("motor-learning_rotation-sudden-45-v1_20261114-1530_session.json"))
finals = [t for t in session["trials"] if t["isFinalAttempt"] and t["valid"]]
errors = [(t["trialNumber"], t["metrics"]["hand"]["initialDirectionErrorDeg"]) for t in finals]

trials = pd.read_csv("motor-learning_rotation-sudden-45-v1_20261114-1530_trials.csv")
trials = trials[trials.is_final_attempt & trials.valid]
```

## Schema changes

Bump `SCHEMA_VERSION` in `src/core/record.ts` when a field is renamed, removed or changes meaning (major), or when fields are added (minor), and update this page.
