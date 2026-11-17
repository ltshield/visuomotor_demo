# Preset definitions

Every protocol value lives in [`src/core/presets.ts`](../src/core/presets.ts). The trial list for a session is produced from a preset and a seed by [`src/core/schedule.ts`](../src/core/schedule.ts). Custom protocols are built from instructor settings by [`src/core/custom.ts`](../src/core/custom.ts).

## Presets the app runs (v3)

| Preset id | Kind | Link | Reaches | Targets |
|---|---|---|---|---|
| `rotation-sudden-45-v3` | canonical | `?c=k7m2` | 40 | 8 |
| `rotation-gradual-45-v3` | canonical | `?c=p4x9` | 40 | 8 |
| `rotation-quickdemo-45-v3` | demo | `?c=demo` | 16 | 4 |
| `rotation-<…>-custom…-v3` | custom | `?x=<4 characters>` | 16, 40 or 64 | 4 or 8 |

A visitor who opens the site with no code is assigned 50/50 at random between the two canonical presets. The Quick Demo and custom protocols are never assigned at random. Only the two canonical presets are drawn together on the class view; every other preset gets a view of its own and is never pooled with them.

## Versions

| Version | Trial rules | Status |
|---|---|---|
| **v3** | As v2, plus a **speed instruction**: students are asked for one quick, smooth movement per reach, and a reach whose movement (onset → arrival) takes longer than 500 ms is followed by "Too slow". The reach still counts. | **Current** |
| v2 | Reach onto the target and **hold** there for 400 ms until it registers; the cursor then jumps back to the center. No speed instruction. | Retired |
| v1 | A reach ended the instant the hand crossed the target distance; the cursor was then steered back to the center by hand. | Retired |

**Why v3.** Pilot sessions under v2 showed students reaching slowly (often a second or more per reach once the rotation was on). A slow reach leaves time to watch the cursor drift and steer it back while moving, so a student can cancel most of the rotation by the end of each reach without changing where they aim. Their initial direction then hardly changes and the catch trials look like nothing happened. Rotation studies ask for quick movements for exactly this reason. The speed note nudges students that way without discarding anything; the saved data marks each slow reach (`tooSlow`).

Retired presets are kept in `presets.ts` (`RETIRED_PRESETS`) so that files recorded with them can be read against the definition they were made with. The app never runs or assigns them, and their ids are never reused.

## Standard structure (both canonical presets)

| Block (never announced) | Session trials | Reaches | Cursor during the outward reach | Cursor rotation |
|---|---|---|---|---|
| Baseline | 1–8 | 8 | hidden | 0° |
| Adaptation | 9–32 | 24 slots, 22 rotated | visible | per preset (below) |
| Catch trials | 20 and 28 (adaptation slots 12 and 20) | 2 of the 24 slots | visible | 0° |
| Aftereffect | 33–40 | 8 | hidden | 0° |

There is no separate washout block.

**Targets.** Eight targets at 0°, 45°, …, 315° (counterclockwise from screen-right), 240 workspace units from the start. Each block is built from shuffled sets of all eight targets, so every direction appears once in baseline, three times in adaptation (catch trials included) and once in aftereffect. The same direction is never presented twice in a row. The order is fully determined by the session's seed, which is saved with the data.

**The two canonical presets differ only in the perturbation schedule.** A test fails if any other value differs between them.

### `rotation-sudden-45-v3`

+45° on every non-catch adaptation reach, starting on the first.

### `rotation-gradual-45-v3`

The rotation on the *n*-th non-catch adaptation reach:

| Reach *n* | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9–22 |
|---|---|---|---|---|---|---|---|---|---|
| Rotation | 0° | 6.43° | 12.86° | 19.29° | 25.71° | 32.14° | 38.57° | 45° | 45° |

That is 7 equal steps of 45°/7 ≈ 6.43°, then 14 reaches at 45°. (Reach 1 = 0° and reach 8 = 45° exactly; a step of 45°/8 would reach only 39.375° by reach 8.)

**Ramp counter.** Only a non-catch reach advances the ramp. A catch trial applies 0° and leaves the counter untouched, so the ramp resumes exactly where it left off. With the standard catch slots both catch trials fall after the ramp; the rule is tested with catch trials placed inside the ramp as well.

### `rotation-quickdemo-45-v3`

4 baseline, 8 adaptation slots (catch at slot 6, session trial 10) and 4 aftereffect reaches to four targets (0°, 90°, 180°, 270°), with a sudden +45° rotation. It is labelled "Quick Demo" on the start and results pages and is not comparable with the canonical presets.

## Custom protocols (instructor panel)

The instructor page (`/instructor`) builds a protocol from five settings and encodes them in an opaque 4-character link code (`?x=…`):

| Setting | Options | Default |
|---|---|---|
| Schedule | sudden, gradual | sudden |
| Rotation | 15°, 30°, 45°, 60° | 45° |
| Length | Quick: 16 reaches, 4 targets, 1 catch trial · Standard: 40 reaches as above · Extended: 64 reaches (8 baseline, 48 adaptation with catch trials at adaptation slots 16, 32 and 44, 8 aftereffect) | Standard |
| Aftereffect cursor | hidden, visible | hidden |
| Catch trials | on, off | on |

A gradual ramp spans 4 rotated reaches at Quick length and 8 at Standard and Extended. Custom protocols use the same geometry, timing (including the speed instruction) and analysis criteria as the canonical presets.

**Canonical protection.** Settings that match a canonical preset exactly *are* that preset: the panel offers its usual link and id. Any other combination gets an id that names its settings, for example `rotation-sudden-30-custom-v3` or `rotation-gradual-60-custom-extended-aevisible-nocatch-v3`, and is never pooled with canonical data. The panel says so: "Custom sessions will not be pooled with canonical preset data in class comparisons."

**Duration estimate** on the panel: reaches × 4 s + 90 s (instructions and practice) + 30 s (questions). It is deliberately generous; in pilot sessions a reach took about 2.7 s.

## Values shared by all current presets

| Group | Value | Setting |
|---|---|---|
| Geometry | Target distance | 240 wu |
| | Target radius (the visible cursor must rest inside it) | 18 wu |
| | Arrival radius (near edge of the target; every metric stops here) | 222 wu |
| | Start-circle radius (cursor center must be inside) | 14 wu |
| | Cursor dot radius | 6 wu |
| | Workspace half-width | 282 wu |
| | Input gain | 1 wu per CSS pixel of reported mouse movement |
| Timing | Centered hold before the target appears | 400 ms |
| | Hold on the target for the reach to register | 400 ms |
| | Speed instruction: movement (onset → arrival) longer than this shows "Too slow" | 500 ms |
| | Time allowed for a reach to register, from target onset | 6000 ms |
| | Pause after each reach (the target pulses), before the cursor jumps home | 300 ms |
| Criteria | Movement onset | hand reaches 5% of the target distance |
| | Initial direction measured at | 25% of the target distance |
| | Fewest reach samples for metrics | 4 |

"wu" = workspace unit: one CSS pixel on screen when the workspace is drawn at full size.

**Practice** (unrecorded, normal mapping): four reaches with the cursor visible, then two with it hidden. The speed note appears in practice too, so students learn the pace before anything is recorded.

## Sign convention

Positive angles are counterclockwise on screen. During the outward reach

```
cursor = start + R(θ) · (hand − start),     R(θ) = | cos θ  −sin θ |
                                                   | sin θ   cos θ |
```

so a +45° rotation turns the cursor's path 45° counterclockwise from the hand's path, and fully compensating means moving the hand 45° **clockwise** of the target (a hand direction error of −45°).

## Trial rules (v3)

- **Anchor at go.** When the target lights, the virtual hand and the cursor are both placed exactly on the start position. The rotation therefore always pivots about the center.
- **Hold to register.** With the cursor visible, the reach registers once the cursor has stayed inside the target circle for 400 ms; leaving it restarts the count. With the cursor hidden, the unseen hand only has to stay at least the arrival radius from the start, in **any** direction, for 400 ms. Direction is what hidden reaches measure (baseline bias, aftereffects), so it never decides whether they register.
- **Arrival.** Separately, the first moment the hand reaches the arrival radius (222 wu) is recorded. Every metric stops there; settling onto the target and the hold are recorded but not analysed.
- **Speed.** If the movement from onset to arrival took longer than 500 ms, "Too slow" shows until the next target lights and the attempt is saved with `tooSlow: true`. The reach still has to register and still counts.
- **Jump home.** After the reach registers and the target pulses, the virtual hand and the cursor are placed back on the start. There is no return movement, so nothing rotated carries into the next trial and a hidden-cursor reach never reveals where it ended.
- **Time limit.** A reach that has not registered 6 s after the go cue times out and is not repeated. If the hand had arrived, its outward movement is still analysed.
- **Interruptions.** If the mouse is released (Esc) or the window loses focus during a reach, the partial reach is saved as an `interrupted` attempt and the same trial is presented again.

## Changing a protocol

A preset id is a promise: **never edit a released preset in place.** `src/core/presets.test.ts` holds a frozen snapshot of each released preset and fails if one changes.

1. In `src/core/presets.ts`, copy the presets you want to change and give the copies a new id and version (`…-v4`). Move the old ones to `RETIRED_PRESETS`.
2. Change the copies. For pacing, change `timing`; for a different ramp, change `perturbation`.
3. Put the new presets in `ALL_PRESETS` (and `CANONICAL_PRESETS`), and point the existing link codes in `LINK_CODES` (`src/core/assignment.ts`) at them. Links already handed out then lead to the new version; never reuse a code for a different condition.
4. Bump `CUSTOM_VERSION` in `src/core/custom.ts` if custom protocols should follow the new trial rules.
5. Add frozen snapshots for the new presets (and keep the old ones, now as retired) in `src/core/presets.test.ts`, then run `npm test`.

`validatePreset` rejects presets that cannot be balanced (trial counts that are not a multiple of the number of targets, catch slots out of range, a ramp longer than the number of rotated reaches) or whose timing is inconsistent (a target hold or speed limit no shorter than the time limit).
