/**
 * Instructor.tsx — the instructor controls panel (`/instructor`).
 *
 * Workflow: choose a preset → optionally change a setting → read the duration
 * estimate → copy a student link. Nothing here needs code or a server.
 *
 * CANONICAL PROTECTION. The panel never edits a shipped preset. It holds a set
 * of `InstructorSettings`; `core/custom.ts` turns those into a preset. When
 * the settings are exactly a shipped preset's, that preset and its canonical
 * id are used. The moment any setting differs, the selector reads "Custom",
 * the protocol gets its own `...-custom-...` id, and a warning explains that
 * such sessions are not pooled with the standard ones.
 *
 * Because this page gives the design away, its contents sit behind a one-click
 * confirmation so a curious student who wanders in gets a chance to turn back.
 *
 * Key exports: `Instructor`, `CUSTOM_WARNING`.
 */

import { useState } from 'react';
import { buildParticipantLink } from '../core/assignment';
import { CLASS_CODE_MAX, MAX_SESSIONS_PER_CLASS, normalizeClassCode } from '../core/classWire';
import {
  AFTEREFFECT_OPTIONS,
  ANGLE_OPTIONS,
  DEFAULT_SETTINGS,
  NAMED_PRESETS,
  SCHEDULE_OPTIONS,
  TIERS,
  TIER_OPTIONS,
  buildCustomLink,
  estimateDurationMinutes,
  matchNamedPreset,
  resolvePreset,
  tierTrialCount,
  type InstructorSettings,
} from '../core/custom';
import {
  CANONICAL_PRESETS,
  GRADUAL_45_V3,
  QUICK_DEMO_45_V3,
  SUDDEN_45_V3,
  arrivalRadius,
  perturbedReachCount,
  targetHoldMsOf,
  totalTrials,
  type PresetConfig,
} from '../core/presets';
import { catchTrialNumbers, describePerturbation, formatDeg, perturbedAngles } from './presetText';
import { classPath } from './route';

/** The warning shown whenever the settings no longer describe a shipped preset. */
export const CUSTOM_WARNING = 'Custom sessions will not be pooled with canonical preset data in class comparisons.';

function CopyableLink({
  title,
  detail,
  url,
  buttonLabel = 'Copy',
}: {
  title: string;
  detail: string;
  url: string;
  buttonLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the address is in a selectable field as a fallback.
      setCopied(false);
    }
  };

  return (
    <div className="link-row">
      <div className="link-row-text">
        <strong>{title}</strong>
        <span className="muted small">{detail}</span>
      </div>
      <div className="link-row-controls">
        <input type="text" readOnly value={url} aria-label={`${title} address`} onFocus={(e) => e.target.select()} />
        <button type="button" className="button" onClick={copy}>
          {copied ? 'Copied' : buttonLabel}
        </button>
      </div>
    </div>
  );
}

/** One group of radio buttons. `name` must be unique on the page. */
function RadioGroup<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="setting">
      <legend>{legend}</legend>
      <div className="choice-row">
        {options.map((o) => (
          <label key={String(o.value)}>
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const SCHEDULE_LABELS = { sudden: 'Sudden (all at once)', gradual: 'Gradual (ramps up from 0°)' } as const;
const AFTEREFFECT_LABELS = { hidden: 'Hidden cursor', visible: 'Visible cursor' } as const;

/** "8 baseline · 24 rotation block (2 catch trials) · 8 aftereffect". */
function blockSummary(preset: PresetConfig): string {
  const s = preset.structure;
  const catches = s.adaptation.catchSlots.length;
  const catchText = catches === 0 ? 'no catch trials' : `${catches} catch trial${catches === 1 ? '' : 's'}`;
  return `${s.baseline.trials} baseline · ${s.adaptation.trials} rotation block (${catchText}) · ${s.aftereffect.trials} aftereffect`;
}

function SettingsPanel({
  settings,
  onChange,
}: {
  settings: InstructorSettings;
  onChange: (settings: InstructorSettings) => void;
}) {
  const named = matchNamedPreset(settings);
  const preset = resolvePreset(settings);
  const minutes = estimateDurationMinutes(settings);
  const set = <K extends keyof InstructorSettings>(key: K, value: InstructorSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <section className="card">
      <h2>Set up a session</h2>

      <div className="setting">
        <label className="field-label" htmlFor="preset-select">
          Preset
        </label>
        <select
          id="preset-select"
          value={named ? named.key : 'custom'}
          onChange={(e) => {
            const chosen = NAMED_PRESETS.find((n) => n.key === e.target.value);
            if (chosen) onChange({ ...chosen.settings });
          }}
        >
          {NAMED_PRESETS.map((n) => (
            <option key={n.key} value={n.key}>
              {n.name}
            </option>
          ))}
          {/* "Custom" exists only while the settings below differ from every shipped preset. */}
          {!named && <option value="custom">Custom</option>}
        </select>
      </div>

      <RadioGroup
        legend="How the rotation is introduced"
        name="schedule"
        value={settings.schedule}
        onChange={(v) => set('schedule', v)}
        options={SCHEDULE_OPTIONS.map((v) => ({ value: v, label: SCHEDULE_LABELS[v] }))}
      />
      <RadioGroup
        legend="Rotation angle"
        name="angle"
        value={settings.angleDeg}
        onChange={(v) => set('angleDeg', v)}
        options={ANGLE_OPTIONS.map((v) => ({ value: v, label: `${v}°` }))}
      />
      <RadioGroup
        legend="Trial count"
        name="tier"
        value={settings.tier}
        onChange={(v) => set('tier', v)}
        options={TIER_OPTIONS.map((v) => ({ value: v, label: `${TIERS[v].label} (${tierTrialCount(v)} trials)` }))}
      />
      <RadioGroup
        legend="Aftereffect reaches"
        name="aftereffect"
        value={settings.aftereffect}
        onChange={(v) => set('aftereffect', v)}
        options={AFTEREFFECT_OPTIONS.map((v) => ({ value: v, label: AFTEREFFECT_LABELS[v] }))}
      />
      <div className="setting">
        <label className="check-label">
          <input type="checkbox" checked={settings.catchTrials} onChange={(e) => set('catchTrials', e.target.checked)} />
          Catch trials
        </label>
      </div>

      <div className="setting-summary" aria-live="polite">
        <p className="estimate" data-testid="duration-estimate">
          About <strong>{minutes} minutes</strong> for a student to complete
        </p>
        <p className="small muted">
          {totalTrials(preset.structure)} recorded reaches ({blockSummary(preset)}), estimated at 4 seconds each, plus 90
          seconds of practice and 30 seconds for the questions. Fast students finish sooner.
        </p>
        <p className="small">
          Protocol id: <code data-testid="protocol-id">{preset.id}</code>
        </p>
        {preset.kind === 'custom' && (
          <p className="notice" role="status" data-testid="custom-warning">
            <strong>Custom protocol.</strong> {CUSTOM_WARNING} The standard presets themselves are unchanged; this
            combination has its own id, shown above.
          </p>
        )}
        {preset.kind === 'demo' && (
          <p className="small muted">
            The Quick Demo is a labelled short introduction. Its results are not pooled with the standard versions
            either.
          </p>
        )}
      </div>
    </section>
  );
}

function LinksPanel({ settings, base }: { settings: InstructorSettings; base: string }) {
  const preset = resolvePreset(settings);
  return (
    <section className="card">
      <h2>Links to give students</h2>
      <p>
        Students are never told which version they have until the debrief at the end. Every link uses a neutral code,
        so the address bar does not reveal the version either.
      </p>
      <CopyableLink
        title="Random assignment link"
        detail="The default student link. Each student is assigned at random, 50/50, to Sudden 45° or Gradual 0°→45°."
        url={buildParticipantLink(base, null)}
      />
      <CopyableLink
        title="Sudden 45° link"
        detail={`Every student who opens it gets ${SUDDEN_45_V3.id}.`}
        url={buildParticipantLink(base, SUDDEN_45_V3.id)}
      />
      <CopyableLink
        title="Gradual 0°→45° link"
        detail={`Every student who opens it gets ${GRADUAL_45_V3.id}.`}
        url={buildParticipantLink(base, GRADUAL_45_V3.id)}
      />
      {preset.id === QUICK_DEMO_45_V3.id && (
        <CopyableLink
          title="Quick Demo link"
          detail="The 16-reach version selected above. Labelled as a demo for the student; not pooled with the standard versions."
          url={buildParticipantLink(base, QUICK_DEMO_45_V3.id)}
        />
      )}
      {preset.kind === 'custom' && (
        <CopyableLink
          title="Custom link"
          detail={`Runs the custom protocol set up above (${preset.id}). The results page tells the student it was a custom protocol.`}
          url={buildCustomLink(base, settings)}
          buttonLabel="Copy custom link"
        />
      )}
      <ul className="plain-list small" style={{ marginTop: 14 }}>
        <li>
          To compare versions in class, give everyone the random assignment link and let chance split the room, or
          give half the class each direct link.
        </li>
        <li>
          Full results exist only in the student’s browser tab. Ask students to download their data or take
          screenshots before closing the tab. (The class view below keeps only an anonymous summary.)
        </li>
        <li>Students need a desktop or laptop with a physical mouse and a recent Chrome or Edge.</li>
      </ul>
    </section>
  );
}

/**
 * Class view set-up: the professor picks any code, tells the class, and opens
 * the class page on the projector. There is nothing to register: a code comes
 * into existence when the first student shares with it.
 */
function ClassPanel({ origin }: { origin: string }) {
  const [typed, setTyped] = useState('');
  const code = normalizeClassCode(typed);
  const url = code ? `${origin}${classPath(code)}` : '';

  return (
    <section className="card">
      <h2>See the whole class on the projector</h2>
      <p>
        Students can add an anonymous summary of their results to a class view, which you open on the projector. Their
        curves appear as they share.
      </p>
      <ol className="plain-list">
        <li>
          <strong>Choose a class code.</strong> Any letters and digits, up to {CLASS_CODE_MAX}, such as NEURO451. Use
          a new code for each class or section; there is nothing to register.
        </li>
        <li>
          <strong>Open the class view</strong> below and put it on the projector.
        </li>
        <li>
          <strong>Tell students the code.</strong> When they reach their results they scroll to “Share your results
          with the class”, type the code and press Share anonymously. Sharing is optional and is never automatic.
        </li>
      </ol>
      <div className="setting">
        <label className="field-label" htmlFor="class-code-setup">
          Class code
        </label>
        <input
          id="class-code-setup"
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          maxLength={CLASS_CODE_MAX + 4}
          autoComplete="off"
          spellCheck={false}
          placeholder="for example NEURO451"
          style={{ maxWidth: 280 }}
        />
        {typed.trim() !== '' && code === null && (
          <p className="share-error" role="alert" data-testid="class-code-invalid">
            A class code is letters and digits only, up to {CLASS_CODE_MAX} characters, with no spaces or symbols.
          </p>
        )}
      </div>
      {code && (
        <>
          <CopyableLink title="Class view" detail={`Shows every session shared with the code ${code}. It refreshes itself every 15 seconds.`} url={url} />
          <p style={{ marginTop: 12 }}>
            <a className="button primary" href={classPath(code)} target="_blank" rel="noopener noreferrer" data-testid="open-class-view">
              Open the class view for {code}
            </a>
          </p>
        </>
      )}
      <ul className="plain-list small" style={{ marginTop: 14 }}>
        <li>
          Only the two standard versions are drawn together. Sessions from a custom protocol or the Quick Demo appear
          in a separate view and are never averaged in.
        </li>
        <li>
          A class code is not a password: anyone who knows it can share to it or open its view. The data is anonymous
          and holds nothing sensitive, but do not treat the code as private. A code holds up to{' '}
          {MAX_SESSIONS_PER_CLASS} sessions.
        </li>
      </ul>
    </section>
  );
}

function PresetDefinition({ preset }: { preset: PresetConfig }) {
  const s = preset.structure;
  const angles = perturbedAngles(preset);
  const catchSlots = s.adaptation.catchSlots;
  const catchTrials = catchTrialNumbers(preset);

  return (
    <section className="card">
      <h3>{preset.label}</h3>
      <p className="small">
        Preset id <code>{preset.id}</code> · {totalTrials(s)} recorded reaches · {s.targetAnglesDeg.length} targets
      </p>
      <p>{preset.description}</p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Block (unannounced)</th>
            <th>Reaches</th>
            <th>Cursor during reach</th>
            <th>Cursor rotation</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Baseline</td>
            <td>{s.baseline.trials}</td>
            <td>{s.baseline.feedback}</td>
            <td>0°</td>
          </tr>
          <tr>
            <td>Adaptation</td>
            <td>
              {s.adaptation.trials} slots ({perturbedReachCount(s)} rotated)
            </td>
            <td>{s.adaptation.feedback}</td>
            <td>{describePerturbation(preset, 'present')}</td>
          </tr>
          <tr>
            <td>Catch trials</td>
            <td>
              {catchSlots.length === 0
                ? 'none'
                : `${catchSlots.length} (adaptation slot${catchSlots.length === 1 ? '' : 's'} ${catchSlots.join(', ')}; session trial${catchTrials.length === 1 ? '' : 's'} ${catchTrials.join(', ')})`}
            </td>
            <td>{catchSlots.length === 0 ? '–' : s.adaptation.feedback}</td>
            <td>{catchSlots.length === 0 ? '–' : '0°; they do not advance a gradual ramp'}</td>
          </tr>
          <tr>
            <td>Aftereffect</td>
            <td>{s.aftereffect.trials}</td>
            <td>{s.aftereffect.feedback}</td>
            <td>0°</td>
          </tr>
        </tbody>
      </table>
      <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
        Rotation on each rotated reach, in order: {angles.map((a) => formatDeg(a)).join(', ')}.
      </p>
    </section>
  );
}

export function Instructor() {
  const [revealed, setRevealed] = useState(false);
  const [settings, setSettings] = useState<InstructorSettings>({ ...DEFAULT_SETTINGS });
  const origin = window.location.origin;
  const base = `${origin}/`;
  const g = SUDDEN_45_V3.geometry;
  const t = SUDDEN_45_V3.timing;
  const holdMs = targetHoldMsOf(t);
  const arrival = arrivalRadius(g, t);
  const selected = resolvePreset(settings);

  if (!revealed) {
    return (
      <main className="page">
        <h1>For instructors</h1>
        <div className="card">
          <p className="lede">This page explains exactly how the activity is designed.</p>
          <p>
            If you are a student who has not done the activity yet, please go back and do it first. It works best when
            you do not know what is coming, and everything here is explained to you at the end anyway.
          </p>
          <div className="button-row">
            <a className="button primary" href="/">
              Back to the activity
            </a>
            <button type="button" className="button" onClick={() => setRevealed(true)}>
              I am an instructor: show the details
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page wide">
      <p className="small">
        <a href="/">← Back to the activity</a>
      </p>
      <h1>For instructors</h1>
      <p className="lede">
        A 5 to 10 minute activity in which students experience a changed relationship between hand movement and cursor
        movement, discover what happens when it is removed, and then inspect their own trajectories and errors. There
        are two standard versions that differ only in how the change is introduced.
      </p>

      <SettingsPanel settings={settings} onChange={setSettings} />
      <LinksPanel settings={settings} base={base} />
      <ClassPanel origin={origin} />

      <details className="reference">
        <summary>Protocol definitions and reference details</summary>

        {selected.kind !== 'canonical' && (
          <>
            <h2>The protocol selected above</h2>
            <PresetDefinition preset={selected} />
          </>
        )}

        <h2>Standard versions</h2>
        {CANONICAL_PRESETS.map((p) => (
          <PresetDefinition key={p.id} preset={p} />
        ))}

        {selected.id !== QUICK_DEMO_45_V3.id && (
          <>
            <h2>Optional short version</h2>
            <PresetDefinition preset={QUICK_DEMO_45_V3} />
          </>
        )}

        <section className="card">
          <h2>Details that are the same for every version</h2>
          <ul className="plain-list">
            <li>
              <strong>Sign convention.</strong> Positive angles are counterclockwise on screen. A +45° rotation turns
              the cursor’s path 45° counterclockwise from the hand’s path, so fully compensating means moving the hand
              45° clockwise of the target (a hand direction error of −45°).
            </li>
            <li>
              <strong>Transformation.</strong> During each outward reach,{' '}
              <code>cursor = start + R(θ) · (hand − start)</code>. Hand and cursor are re-anchored to the center at
              the start of every reach.
            </li>
            <li>
              <strong>A reach registers</strong> when the student holds on the target for {holdMs} ms, or it times out
              after {t.reachTimeoutMs / 1000} s. With the cursor visible, the cursor must stay inside the target circle
              (radius {g.targetRadius} units); leaving it restarts the count. With the cursor hidden, the unseen hand
              only has to stay at the target’s distance ({arrival} units or more from the center) in <em>any</em>{' '}
              direction, because direction is exactly what those reaches measure: a student with a large aftereffect
              still completes every reach and is never told they missed.
            </li>
            <li>
              <strong>No return movement.</strong> When a reach registers the target pulses for {t.feedbackHoldMs} ms,
              then the cursor jumps straight back to the center. Students never steer back, and after a hidden-cursor
              reach they never see where it ended.
            </li>
            {t.maxMovementMs !== undefined && (
              <li data-testid="speed-rule">
                <strong>Quick reaches.</strong> Students are asked for one quick, smooth movement per reach. If the
                movement from its start to arriving at the target takes longer than {t.maxMovementMs} ms, “Too slow”
                appears until the next target lights. The reach still counts and is analysed. Slow reaches leave time
                to steer the cursor back mid-reach, which hides changes in aim and makes catch trials look unchanged.
              </li>
            )}
            <li>
              <strong>What is measured.</strong> Every reach metric runs from the moment the target lights to the
              hand’s first arrival at {arrival} units from the center (the near edge of the target). Settling onto the
              target and the hold are recorded but are not part of any metric.
            </li>
            <li>
              <strong>Pacing.</strong> A {t.holdMs} ms hold in the center ring starts each reach. Two quiet sounds
              mark the start of that hold and a registered reach; students can switch them off with the M key.
            </li>
            <li>
              <strong>Practice.</strong> Six unrecorded reaches with the normal mapping (four with the cursor visible,
              two with it hidden) come first.
            </li>
            <li>
              <strong>Target order.</strong> Balanced and reproducible: every direction appears equally often in each
              block, in a shuffled order whose seed is saved with the data.
            </li>
            <li>
              <strong>Custom settings.</strong> Angle: {ANGLE_OPTIONS.map((a) => `${a}°`).join(', ')}. Trial count:
              Quick uses four targets; Standard and Extended use eight. A gradual rotation ramps over the first{' '}
              {TIERS.standard.rampReaches} rotated reaches ({TIERS.quick.rampReaches} in Quick) and then holds.
            </li>
            <li>
              <strong>Versioning.</strong> A preset id is never reused for different behaviour. Any change to a
              protocol gets a new id, and the id is saved in every data file.
            </li>
          </ul>
        </section>

        <section className="card">
          <h2>Data and privacy</h2>
          <ul className="plain-list">
            <li>
              Nothing is uploaded automatically. There are no accounts, and no names or identifiers are requested.
            </li>
            <li>
              Each student can download a complete session file (JSON), a one-row-per-reach table (CSV) and a
              one-row-per-mouse-sample table (CSV). Those files, with the movement traces, never leave the student’s
              computer unless the student hands them in.
            </li>
            <li>
              <strong>Class sharing is opt-in.</strong> A student who types a class code and presses Share
              anonymously sends a compact summary: for each reach its block, catch flag, the rotation applied and two
              numbers (the initial direction error and the path error of the cursor), plus which version they did and
              their answer to the question about adjusting their aim. No name, no movement traces, no free-text answers and no browser or device details
              are sent, and the class view cannot show which line belongs to whom.
            </li>
            <li>
              The summaries are stored in a small database attached to this site. Delete a class’s data when you no
              longer need it; the deployment guide gives the one-line command.
            </li>
            <li>
              The student’s own results page shows only that student’s data. Class data appears only on the class
              view.
            </li>
            <li>
              This is set up for classroom teaching. If you intend to use the data for research or publication, check
              what your institution requires first.
            </li>
          </ul>
        </section>

        <section className="card">
          <h2>Please keep in mind</h2>
          <ul className="plain-list">
            <li>
              These are teaching defaults, not optimized research protocols. With only{' '}
              {perturbedReachCount(SUDDEN_45_V3.structure)} rotated reaches, an individual student may show little or
              no measurable learning or aftereffect.
            </li>
            <li>One student’s data cannot establish a difference between the sudden and gradual versions.</li>
            <li>
              Reaches end with a hold on the target, so students can correct with the cursor in view during the
              rotation block. The initial-direction measure is taken early in the movement to capture the aim before
              those corrections.
            </li>
          </ul>
        </section>
      </details>
    </main>
  );
}
