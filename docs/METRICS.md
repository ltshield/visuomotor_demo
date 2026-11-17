# Metric definitions

All metrics are computed in [`src/core/analysis.ts`](../src/core/analysis.ts) from the recorded samples. The results page, the session JSON and the CSV files all show these same values.

## Conventions

| | |
|---|---|
| Coordinates | Workspace units (wu). Origin at the central start position, +x right, **+y up**. |
| Angles | Degrees. Target directions are measured counterclockwise from +x (screen-right). |
| Sign | **Positive = counterclockwise on screen**, for rotations and for every error. |
| Time | Milliseconds on the browser's monotonic clock (`performance.now()`), taken from each mouse event's own timestamp, not from animation frames. |
| Hand | The *virtual unperturbed hand position*: the running sum of mouse movements since the reach was anchored at the start. |
| Cursor | Where the dot was drawn: `start + R(θ) · (hand − start)`. Recorded only when the dot was visible. |

For every trial let

- **u** = unit vector from the start toward the target,
- **r** = position − start (of the hand, or of the cursor),
- **D** = target distance (240 wu).

## Which part of the movement is analysed

Only the **outward reach**: from the go cue (target onset, when hand and cursor are anchored at the start) to the instant the hand first reaches distance D from the start.

That instant is found by linear interpolation between the two samples that bracket it, so the endpoint lies exactly on the target circle and does not depend on how often the mouse reports. The sample after the crossing is kept in the raw data but excluded from metrics.

The return to the center, the hold, and any movement during the pause after the reach are recorded separately and are **never** included in these metrics.

## Per-sample quantities

| Name | Formula | Meaning |
|---|---|---|
| Progress | `u · r = u_x·r_x + u_y·r_y` | Distance travelled along the straight line to the target. |
| Signed lateral deviation | `u_x·r_y − u_y·r_x` (2-D cross product) | Distance to the side of that line. Positive = counterclockwise (to the left when facing the target). |

## Per-trial metrics

Computed separately for the **hand** path and, when the cursor was visible, for the **cursor** path.

| Metric | Definition |
|---|---|
| **Initial direction error** (°) | `atan2(lateral, progress)` at the point where the path **first reaches 25% of D** from the start (interpolated). It reflects the planned movement, before most visual corrections can act. It is *not* the final error. |
| **Endpoint direction error** (°) | `atan2(lateral, progress)` at the crossing of the target distance. |
| **Maximum absolute lateral deviation** (wu) | Largest distance of the path from the straight start→target line. |
| **Signed lateral deviation at maximum** (wu) | The signed value at that point; its sign tells which side. |
| **Mean absolute lateral deviation** (wu) | Mean of \|lateral deviation\| along the path, weighted by path length (trapezoid rule per segment). Being length-weighted, it describes the path's shape and is not affected by pauses or by the mouse's report rate. |
| **Mean signed lateral deviation** (wu) | The same average **keeping the sign** (`meanSignedLateralDeviation`, schema 2.1). This is the *whole-path error*: how far, on average along its length, the path ran to one side of the straight line. Deviations on opposite sides cancel, so an S-shaped path scores near 0 while its absolute mean does not. A straight path at angle *e* to the target line, out to radius *R*, scores R·sin(*e*)/2. |
| **Path length** (wu) | Sum of the distances between successive path points, start to crossing. |
| **Path efficiency** | Straight-line distance from start to crossing ÷ path length. 1 = perfectly straight. |

Timing metrics (one per trial):

| Metric | Definition |
|---|---|
| **Movement onset** | The hand first reaches 5% of D from the start (interpolated). |
| **Reaction time** (ms) | Movement onset − go cue. |
| **Movement duration** (ms) | Crossing of the target distance − movement onset. |

## Relationships worth knowing

- Rotation is rigid, so the cursor is always exactly as far from the start as the hand. Both cross the target distance at the same instant.
- For a straight reach, **cursor direction error = hand direction error + applied rotation**.
- With a +45° rotation, a hand aimed straight at the target gives a cursor error of +45°; a hand aimed 45° clockwise (−45°) puts the cursor on the target.
- The "full compensation" reference line on the results chart is `−(applied rotation)`: 0° in baseline, on catch trials and in the aftereffect block; −45° under the full rotation.

## When metrics are withheld

A trial's metrics are `null`, with a reason, rather than a misleading number:

| `invalidReason` | When |
|---|---|
| `timeout` | The hand did not reach the target distance within the time allowed. |
| `interrupted` | The mouse was released or the window lost focus during the reach. (The trial is then repeated; the repeat is the attempt that counts.) |
| `too-few-samples` | The reach contains fewer than 4 samples (for example one enormous mouse jump), too few to describe a trajectory. |

The recorded samples of such attempts are still saved and can be viewed in the trial inspector.

## Summary values on the results page

Descriptive statistics of **one participant's own** initial hand direction error:

| Row | Trials (standard protocol) |
|---|---|
| Baseline reaches | 1–8 |
| First rotated reaches | the first 4 non-catch adaptation reaches (9–12) |
| Last rotated reaches | the last 4 non-catch adaptation reaches (29–32) |
| Catch trial 1, 2 | 20, 28 |
| First aftereffect reach | 33 |
| All aftereffect reaches | 33–40 |

Each row gives the mean over the trials that have a valid value, how many did, and the mean rotation applied. "Relative to your baseline" is the row's value minus the baseline mean. These are not inferential statistics, and no data from other people is shown anywhere in the app.

## Path error (whole-path error of what the participant saw)

The results page, the summary table and the class view also show a **path error** for every reach: the **cursor's** mean signed lateral deviation, as a **percentage of D**. On reaches made with the cursor hidden (baseline, and the aftereffect block when hidden) the rotation was 0°, so the cursor would have followed the hand exactly, and the hand's value is used.

Why the cursor and not the hand: once someone has adapted, their **hand** path is meant to run off to the side of the straight line to the target (that is what cancels the rotation). A hand-path "error" would score good adaptation as a large error. The cursor path is the error the participant experienced.

How it differs from the initial direction error:

- The **initial direction** is measured a quarter of the way out, before most corrections can act: it shows the participant's *aim*.
- The **path error** covers the whole outward reach, so it also includes **steering** during the movement.

Someone who keeps aiming at the target but steers the cursor back mid-reach shows a shrinking path error with little change in initial direction. Slow movements leave a lot of time for steering, so in slow movers the two measures can tell quite different stories. The debrief compares the hand's direction at the start and at arrival on the last rotated reaches to make this visible to the participant.

Expected shape: about 0% in baseline; a jump in the rotation direction (positive for a +45° rotation) when the rotation appears; a decline as the participant compensates; and negative values on catch trials and in the aftereffect block if compensation carries over.

## Target-aligned plots

To lay reaches to different targets over one another, each path is expressed as (progress, lateral deviation), which is a rotation of the path that puts its target on the axis. Overlay panels draw the target straight up, so a counterclockwise deviation appears to the **left**. The catch-trial plots put progress on the horizontal axis and lateral deviation on the vertical axis, both as a percentage of D.

Aligning removes the target direction but not direction-specific habits or biomechanics. Where reaches to different targets are compared, the page says so.
