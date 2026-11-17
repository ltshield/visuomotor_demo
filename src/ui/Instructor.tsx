/**
 * Instructor.tsx — a small information page: the links to hand out and the
 * exact definition of each preset. It is NOT a settings dashboard; protocols
 * are changed by adding a new versioned preset in `core/presets.ts`.
 *
 * Because this page gives the design away, its details sit behind a one-click
 * confirmation so a curious student who wanders in gets a chance to turn back.
 *
 * Key export: `Instructor`.
 */

import { useState } from 'react';
import { buildParticipantLink } from '../core/assignment';
import {
  CANONICAL_PRESETS,
  GRADUAL_45_V2,
  QUICK_DEMO_45_V2,
  SUDDEN_45_V2,
  arrivalRadius,
  perturbedReachCount,
  targetHoldMsOf,
  totalTrials,
  type PresetConfig,
} from '../core/presets';
import { catchTrialNumbers, describePerturbation, formatDeg, perturbedAngles } from './presetText';

function CopyableLink({ title, detail, url }: { title: string; detail: string; url: string }) {
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
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
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
              {catchSlots.length} (adaptation slot{catchSlots.length === 1 ? '' : 's'} {catchSlots.join(' and ')}; session
              trial{catchTrials.length === 1 ? '' : 's'} {catchTrials.join(' and ')})
            </td>
            <td>{s.adaptation.feedback}</td>
            <td>0°; they do not advance a gradual ramp</td>
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
  const base = `${window.location.origin}${window.location.pathname}`;
  const g = SUDDEN_45_V2.geometry;
  const t = SUDDEN_45_V2.timing;
  const holdMs = targetHoldMsOf(t);
  const arrival = arrivalRadius(g, t);

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
            <a className="button primary" href="#/">
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
        <a href="#/">← Back to the activity</a>
      </p>
      <h1>For instructors</h1>
      <p className="lede">
        A 5 to 10 minute activity in which students experience a changed relationship between hand movement and cursor
        movement, discover what happens when it is removed, and then inspect their own trajectories and errors. There
        are two standard versions that differ only in how the change is introduced.
      </p>

      <section className="card">
        <h2>Links to give students</h2>
        <p>
          Students are never told which version they have until the debrief at the end. The direct links use neutral
          codes, so the address bar does not reveal the version either.
        </p>
        <CopyableLink
          title="General link"
          detail="Each student is assigned at random, 50/50, to the sudden or the gradual version."
          url={buildParticipantLink(base, null)}
        />
        <CopyableLink
          title="Direct link: Sudden version"
          detail={`Every student who opens it gets ${SUDDEN_45_V2.id}.`}
          url={buildParticipantLink(base, SUDDEN_45_V2.id)}
        />
        <CopyableLink
          title="Direct link: Gradual version"
          detail={`Every student who opens it gets ${GRADUAL_45_V2.id}.`}
          url={buildParticipantLink(base, GRADUAL_45_V2.id)}
        />
        <CopyableLink
          title="Quick Demo (optional)"
          detail="A 16-reach shortened version for a brief introduction. Labelled as a demo; not comparable with the standard versions."
          url={buildParticipantLink(base, QUICK_DEMO_45_V2.id)}
        />
        <ul className="plain-list small" style={{ marginTop: 14 }}>
          <li>
            To compare versions in class, give half the class each direct link, or give everyone the general link and
            let chance split the room.
          </li>
          <li>
            Results exist only in the student’s browser tab. Ask students to download their data or take screenshots
            before closing the tab.
          </li>
          <li>Students need a desktop or laptop with a physical mouse and a recent Chrome or Edge.</li>
        </ul>
      </section>

      <h2>Standard versions</h2>
      {CANONICAL_PRESETS.map((p) => (
        <PresetDefinition key={p.id} preset={p} />
      ))}

      <h2>Optional short version</h2>
      <PresetDefinition preset={QUICK_DEMO_45_V2} />

      <section className="card">
        <h2>Details that are the same for every version</h2>
        <ul className="plain-list">
          <li>
            <strong>Sign convention.</strong> Positive angles are counterclockwise on screen. A +45° rotation turns the
            cursor’s path 45° counterclockwise from the hand’s path, so fully compensating means moving the hand 45°
            clockwise of the target (a hand direction error of −45°).
          </li>
          <li>
            <strong>Transformation.</strong> During each outward reach,{' '}
            <code>cursor = start + R(θ) · (hand − start)</code>. Hand and cursor are re-anchored to the center at the
            start of every reach.
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
          <li>
            <strong>What is measured.</strong> Every reach metric runs from the moment the target lights to the
            hand’s first arrival at {arrival} units from the center (the near edge of the target). Settling onto the
            target and the hold are recorded but are not part of any metric.
          </li>
          <li>
            <strong>Pacing.</strong> A {t.holdMs} ms hold in the center ring starts each reach. Two quiet sounds mark
            the start of that hold and a registered reach; students can switch them off with the M key.
          </li>
          <li>
            <strong>Practice.</strong> Six unrecorded reaches with the normal mapping (four with the cursor visible, two
            with it hidden) come first.
          </li>
          <li>
            <strong>Target order.</strong> Balanced and reproducible: every direction appears equally often in each
            block, in a shuffled order whose seed is saved with the data.
          </li>
          <li>
            <strong>Versioning.</strong> A preset id is never reused for different behaviour. Any change to a protocol
            gets a new id, and the id is saved in every data file.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Data and privacy</h2>
        <ul className="plain-list">
          <li>Nothing is uploaded. There are no accounts, and no names or identifiers are requested.</li>
          <li>
            Each student can download a complete session file (JSON), a one-row-per-reach table (CSV) and a
            one-row-per-mouse-sample table (CSV).
          </li>
          <li>The results page shows only that student’s own data. It never shows class or population averages.</li>
        </ul>
      </section>

      <section className="card">
        <h2>Please keep in mind</h2>
        <ul className="plain-list">
          <li>
            These are teaching defaults, not optimized research protocols. With only {perturbedReachCount(SUDDEN_45_V2.structure)}{' '}
            rotated reaches, an individual student may show little or no measurable learning or aftereffect.
          </li>
          <li>One student’s data cannot establish a difference between the sudden and gradual versions.</li>
          <li>
            Reaches now end with a hold on the target, so students can correct with the cursor in view during the
            rotation block. The initial-direction measure is taken early in the movement to capture the aim before
            those corrections.
          </li>
        </ul>
      </section>
    </main>
  );
}
