# Limitations and next steps

## Limitations of this release

1. **The v3 speed instruction has not been tried with a physical mouse.** The v2 protocol was piloted with real participants; v3 adds the "Too slow" note after movements longer than 500 ms. Whether 500 ms is the right threshold for ordinary mice and students, and whether the note is encouraging rather than annoying, still needs a human check ([TESTING.md](TESTING.md)).
2. **Short protocol, noisy individuals.** 22 rotated reaches spread over 8 directions are teaching defaults, not a research design. Mouse reaches vary by about ±15° from reach to reach even without a rotation, partly through direction-specific habits (wrist and elbow arcs). Implicit recalibration is typically 10–20° after a session like this, not 45°. Single students may show little; the class mean is much clearer.
3. **Aiming versus steering.** The initial direction is measured a quarter of the way out to limit online correction, but a slow reach can still be steered from early on. The speed instruction reduces this but does not enforce anything: slow reaches are kept and only flagged (`tooSlow`).
4. **Strategy and implicit learning are not separated.** The strategy question gives a hint, but there are no aiming reports or other measure of explicit strategy.
5. **Small, device-dependent movements.** Reaches are about 240 pixels of pointer travel through the operating system's pointer speed and acceleration, so amplitude and movement time differ between computers. Direction, which the main metrics use, does not.
6. **Fixed 400 ms center hold.** Participants can anticipate the target, so reaction times are not clean measurements (reaction time is not judged by the speed instruction).
7. **Desktop Chrome and Edge only.** Firefox and Safari are untested. Touch devices are not supported. Trackpads work but give noisy data.
8. **Full results live only in the open tab.** Closing or reloading loses them unless downloaded, and a downloaded file cannot be opened in the app again.
9. **Class sharing is deliberately simple.**
   - A class code is not a password: anyone who knows it can share to it or view it, including nonsense submissions (within the validation limits).
   - Deleting a class's data is a command-line or dashboard step ([DEPLOYMENT.md](DEPLOYMENT.md#deleting-a-classs-data)); there is no button.
   - 500 sessions per code. Only a student's first run in a visit can be shared.
   - The class view is descriptive: whoever chose to share, in whatever numbers. It is not a comparison anyone can draw conclusions from.
10. **Hosting.** The site must be served from the root of a domain; class sharing works only on Cloudflare Pages (Options A and B in [DEPLOYMENT.md](DEPLOYMENT.md)).
11. **Accessibility.** The task needs vision and fine mouse control; there is no alternative way to take part.
12. **The Quick Demo is illustrative only.** Sixteen reaches to four targets are too few to interpret.

## Suggested for Session 3

A short list, most important first:

1. **Pilot v3 with a physical mouse** (three to five students). Look at the share of reaches marked "Too slow", movement times, and whether catch trials and the initial-direction curve now show the adaptation. Tune `maxMovementMs` in a new preset version if needed.
2. **Correct each direction for the student's own baseline** (analysis only): subtract each target direction's baseline from later reaches to it. In the pilot this cut aftereffect scatter from about 14° to 9° SD. Pairs well with fewer targets (4) or more baseline reaches, which would be a protocol change.
3. **Open a saved session file** on the results page, so students can revisit a download and instructors can look at a submitted file. The page already reads only the saved record.
4. **Class data for the instructor:** a CSV download of a class's anonymous summaries from the class view, and a protected "delete this class" action instead of the command line.
5. **Keep results across an accidental reload** (session storage).
6. **Continuous integration** (`npm run verify` on every push) and **Firefox/Safari** checks.

**Larger items, not started by design:** instructor accounts and class management; explicit-strategy measures (aiming reports); a washout block and other perturbation families (gain change, mirror reversal). The preset, schedule and transformation code are separated so these can be added as new presets.
