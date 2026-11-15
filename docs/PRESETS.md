# Preset definitions

Every protocol value lives in [`src/core/presets.ts`](../src/core/presets.ts). The trial list for a session is produced from a preset and a seed by [`src/core/schedule.ts`](../src/core/schedule.ts).

## Released presets

| Preset id | Kind | Link code | Reaches | Targets |
|---|---|---|---|---|
| `rotation-sudden-45-v1` | canonical | `?c=k7m2` | 40 | 8 |
| `rotation-gradual-45-v1` | canonical | `?c=p4x9` | 40 | 8 |
| `rotation-quickdemo-45-v1` | demo | `?c=demo` | 16 | 4 |

A visitor who opens the site with no code is assigned 50/50 at random between the two canonical presets. The Quick Demo is never assigned at random.

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

### `rotation-sudden-45-v1`

+45° on every non-catch adaptation reach, starting on the first.

### `rotation-gradual-45-v1`

The rotation on the *n*-th non-catch adaptation reach:

| Reach *n* | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9–22 |
|---|---|---|---|---|---|---|---|---|---|
| Rotation | 0° | 6.43° | 12.86° | 19.29° | 25.71° | 32.14° | 38.57° | 45° | 45° |

That is 7 equal steps of 45°/7 ≈ 6.43°, then 14 reaches at 45°.

> **Note on the step size.** The build brief asked for reach 1 = exactly 0°, reach 8 = exactly 45°, *and* steps of 45°/8 = 5.625°. Those cannot all hold (0° + 7 × 5.625° = 39.375°). The two end points were each stated twice, so they were honoured and the step that follows from them, 45°/7, was used. To use 5.625° steps instead, change `rampReaches` to 9 (reach 9 = 45°, then 13 held) in a **new** preset version.

**Ramp counter.** Only a non-catch reach advances the ramp. A catch trial applies 0° and leaves the counter untouched, so the ramp resumes exactly where it left off. With the standard catch slots both catch trials fall after the ramp; the rule is tested with catch trials placed inside the ramp as well.

### `rotation-quickdemo-45-v1`

4 baseline, 8 adaptation slots (catch at slot 6, session trial 10) and 4 aftereffect reaches to four targets (0°, 90°, 180°, 270°), with a sudden +45° rotation. It is labelled "Quick Demo" on the start and results pages and is not comparable with the canonical presets.

## Values shared by all presets

| Group | Value | Setting |
|---|---|---|
| Geometry | Target distance | 240 wu |
| | Target radius (drawn) | 18 wu |
| | Start-circle radius (cursor centre must be inside) | 14 wu |
| | Cursor dot radius | 6 wu |
| | Workspace half-width | 282 wu |
| | Input gain | 1 wu per CSS pixel of reported mouse movement |
| Timing | Centred hold before the target appears | 400 ms |
| | Time allowed for a reach, from target onset | 4000 ms |
| | Pause after each reach (visible cursor frozen at its crossing point) | 500 ms |
| Criteria | Movement onset | hand reaches 5% of the target distance |
| | Initial direction measured at | 25% of the target distance |
| | Fewest reach samples for metrics | 4 |

"wu" = workspace unit: one CSS pixel on screen when the workspace is drawn at full size.

**Practice** (unrecorded, normal mapping): four reaches with the cursor visible, then two with it hidden.

## Sign convention

Positive angles are counterclockwise on screen. During the outward reach

```
cursor = start + R(θ) · (hand − start),     R(θ) = | cos θ  −sin θ |
                                                   | sin θ   cos θ |
```

so a +45° rotation turns the cursor's path 45° counterclockwise from the hand's path, and fully compensating means moving the hand 45° **clockwise** of the target (a hand direction error of −45°).

## Trial rules that are the same in every preset

- **Anchor at go.** When the target lights, the virtual hand and the cursor are both placed exactly on the start position. The rotation therefore always pivots about the center.
- **Completion by hand distance.** A reach ends when the *hand* has travelled the target distance in any direction, or at the timeout. It never depends on hitting the target, so hidden-cursor reaches end exactly like visible ones.
- **Return under the normal mapping.** After the pause the virtual hand is moved to where the cursor was last drawn, and the cursor is visible with no rotation until the next reach. Nothing rotated carries into the return or the next trial.
- **Interruptions.** If the mouse is released (Esc) or the window loses focus during a reach, the partial reach is saved as an `interrupted` attempt and the same trial is presented again. A reach that times out is saved as `timeout` and is not repeated.

## Changing a protocol

A preset id is a promise: **never edit a released preset in place.** `src/core/presets.test.ts` holds a frozen snapshot of each released preset and fails if one changes.

1. In `src/core/presets.ts`, copy the preset you want to change and give the copy a new id and version, for example `rotation-sudden-45-v2`.
2. Change the copy. For pacing, change `timing`; for a different ramp, change `perturbation`.
3. Add the new preset to `ALL_PRESETS` (and to `CANONICAL_PRESETS` if it replaces a canonical one).
4. Add a link code for it in `LINK_CODES` in `src/core/assignment.ts`. Never reuse or reassign an existing code.
5. Add a frozen snapshot for it in `src/core/presets.test.ts`, then run `npm test`.

`validatePreset` rejects presets that cannot be balanced (trial counts that are not a multiple of the number of targets, catch slots out of range, a ramp longer than the number of rotated reaches).
