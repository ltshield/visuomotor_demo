# Limitations and next steps

## Limitations of this release

1. **Not yet tried by a person with a physical mouse.** All verification so far used automated tests and simulated mouse input in real Chrome and Edge. Dot speed, comfort of the pacing and the real session length still need a human check ([TESTING.md](TESTING.md) has the checklist).
2. **Hidden-cursor reaches are followed by a visible return.** As specified, the cursor reappears for the return to the center, starting where the reach ended. That shows the participant roughly where a hidden-cursor reach landed, so aftereffects can fade within the 8-reach aftereffect block, and the baseline is not entirely feedback-free.
3. **Short protocol.** 22 rotated reaches are teaching defaults, not an optimized research design. Individual students may show partial adaptation, or little or no measurable adaptation or aftereffect.
4. **Strategy and implicit learning are not separated.** The reflection questions give a hint, but the task contains no aiming reports or other measure of explicit strategy.
5. **Small, device-dependent movements.** Reaches are about 240 pixels of pointer travel, often under a centimetre of hand movement, through the operating system's normal pointer speed and acceleration. Amplitude therefore differs between computers; direction, which every metric is based on, does not.
6. **No speed requirement.** Apart from a 4-second limit, reaches can be slow, which lets a participant correct continuously instead of committing to an aim. The initial-direction measure is taken early to limit this, but it cannot remove it.
7. **Fixed 400 ms hold.** A constant delay before each target lets participants anticipate the go cue, so reaction times are not clean measurements.
8. **Desktop Chrome and Edge only.** Firefox and Safari are untested. Touch devices are not supported. Trackpads work but give noisy data.
9. **Results live only in the open tab.** Closing or reloading the page loses them unless they were downloaded, and a downloaded file cannot be opened in the app again.
10. **One participant at a time.** There is no class view, no comparison between people and no instructor access to student data other than files the students hand in.
11. **Accessibility.** The task needs vision and fine mouse control; there is no alternative way to take part.
12. **The Quick Demo is illustrative only.** Sixteen reaches to four targets are too few to interpret.

## What to do next (in order)

**First, before using it with a class**

- Pilot with two or three people using ordinary mice and laptops, then tune `timing` (hold, pause, timeout) and, if the dot feels too fast or slow, `inputGain` in a **new preset version**.
- Check the time taken reported on the results page against the 5–10 minute target.

**Useful additions that fit the current design**

- **Open a saved session file** on the results page, so students can revisit a download and instructors can view a submitted file. The results page already reads only the saved record, so this is mostly a file picker plus validation.
- **Keep results across a reload** (browser session storage) so an accidental refresh is not fatal.
- **Restricted return feedback** as a new preset version (for example, show the cursor only near the center on the way back) to keep hidden-cursor reaches free of endpoint information and preserve aftereffects.
- **Continuous integration** (run `npm run verify` on every push).
- **Firefox and Safari validation.**
- **Print-friendly results** for lab reports.

**Larger items for a later phase (not started, by design)**

- Class-level summaries. A first step needs no server: an instructor page that reads many downloaded session files in the browser and plots them together. Storing data across users (Cloudflare Workers + D1 on the same platform) should come only with a data-handling policy.
- Instructor accounts, class management and a protocol builder.
- A dedicated washout block, longer protocols, other rotation sizes, and other perturbation families (gain changes, mirror reversal). The preset, schedule and transformation code are separated so these can be added as new presets and feedback modes.
- Measures of explicit strategy (aiming reports) to separate strategy from implicit recalibration.

Roadmap items were deliberately left out of this release so that the core experience could be finished and validated first.
