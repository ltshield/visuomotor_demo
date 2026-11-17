/**
 * TrialInspector.tsx — look at any single reach as it actually happened.
 *
 * Unlike the overlay panels this view is NOT target-aligned: it draws the real
 * workspace (start, all targets, the one that was lit) with the recorded hand
 * path and, when the cursor was shown, the displayed cursor path. On a rotated
 * reach the two visibly fan apart by the rotation angle.
 *
 * Each path has two parts. The solid line is the OUTWARD REACH, up to the
 * marker where the hand first got as far out as the target: that is what every
 * number on the results page describes. The thin dashed line that follows is
 * what happened next (steering onto the target and holding there); it is shown
 * so the picture is complete, but nothing is measured from it.
 *
 * Workspace coordinates are y-up; SVG is y-down, so every point is drawn at
 * (x, −y). That is the only axis flip in this file.
 *
 * Key export: `TrialInspector`.
 */

import { outwardPath, settlePath, type Path } from '../../core/analysis';
import { targetPosition } from '../../core/geometry';
import { finalAttempts, reachDataOf, type SessionRecord, type TrialExport } from '../../core/record';
import { formatDeg, formatSignedDeg } from '../presetText';
import { LegendRow, VIZ, type LegendItem } from './chartTheme';
import { describeDirection } from './model';

const PHASE_NAMES: Record<TrialExport['phase'], string> = {
  baseline: 'Baseline',
  adaptation: 'Rotation block',
  aftereffect: 'Aftereffect block',
};

const pathPoints = (path: Path) => path.x.map((x, i) => `${x.toFixed(1)},${(-path.y[i]).toFixed(1)}`).join(' ');

const endOf = (path: Path) => ({ x: path.x[path.x.length - 1], y: path.y[path.y.length - 1] });

const LABEL_FONT_SIZE = 15;

/**
 * Where to write a label for a path end: a little further out along the same
 * direction, then nudged back inside the frame if the text would be cut off.
 * `half` is the half-width of the drawing; text width is estimated from its length.
 */
function labelPosition(end: { x: number; y: number }, gap: number, text: string, half: number) {
  const r = Math.hypot(end.x, end.y) || 1;
  let x = end.x * (1 + gap / r);
  const y = end.y * (1 + gap / r);
  const anchor: 'start' | 'middle' | 'end' = x > 25 ? 'start' : x < -25 ? 'end' : 'middle';
  const width = text.length * LABEL_FONT_SIZE * 0.58;
  const edge = half - 8;
  if (anchor === 'start') x = Math.min(x, edge - width);
  if (anchor === 'end') x = Math.max(x, -edge + width);
  if (anchor === 'middle') x = Math.min(edge - width / 2, Math.max(-edge + width / 2, x));
  // SVG y is down; keep the baseline inside the frame too.
  const svgY = Math.min(edge, Math.max(-edge + LABEL_FONT_SIZE, -y + 4));
  return { x, y: svgY, anchor };
}

function outcomeText(trial: TrialExport): string {
  if (trial.outcome === 'interrupted') return 'Interrupted (mouse released)';
  if (trial.outcome === 'timeout') {
    return trial.crossing
      ? 'Reached the target distance, but time ran out before the hold registered'
      : 'Timed out before reaching the target distance';
  }
  if (!trial.valid) return 'Registered, but too few mouse samples to analyse';
  // With the cursor hidden only the distance had to be held, so the hand may have been well off the target.
  return trial.cursorVisibleDuringReach ? 'Registered: cursor held on the target' : 'Registered: hand held at the target distance';
}

interface TrialInspectorProps {
  session: SessionRecord;
  trialNumber: number;
  onChange: (trialNumber: number) => void;
}

export function TrialInspector({ session, trialNumber, onChange }: TrialInspectorProps) {
  const finals = finalAttempts(session);
  const count = finals.length;
  const trial = finals[Math.min(count, Math.max(1, trialNumber)) - 1];
  const g = session.preset.geometry;
  const half = g.boundsHalfExtent;

  const hand = outwardPath(reachDataOf(trial), 'hand');
  const cursor = outwardPath(reachDataOf(trial), 'cursor');
  // What followed arrival (not measured). Hidden with the paths of reaches that were not analysed.
  const handAfter = trial.valid ? settlePath(reachDataOf(trial), 'hand') : null;
  const cursorAfter = trial.valid ? settlePath(reachDataOf(trial), 'cursor') : null;
  const target = targetPosition(trial.targetAngleDeg, g.targetDistance);
  const earlierAttempts = session.trials.filter((t) => t.trialNumber === trial.trialNumber && !t.isFinalAttempt).length;

  // Hand and cursor coincide when no rotation was applied; label them together then.
  const identical = cursor !== null && trial.appliedRotationDeg === 0;
  const endsFarApart =
    hand !== null && cursor !== null && Math.hypot(endOf(hand).x - endOf(cursor).x, endOf(hand).y - endOf(cursor).y) > 60;

  const legend: LegendItem[] = [{ key: 'line', color: VIZ.move, label: 'Hand (mouse) path' }];
  if (cursor) legend.push({ key: 'line', color: VIZ.cursor, label: 'Cursor path as displayed' });
  if (handAfter || cursorAfter) {
    legend.push({ key: 'dash', color: VIZ.context, label: 'After arriving: steering onto the target and holding (not measured)' });
  }

  const m = trial.metrics;
  const direction = (deg: number | undefined) => (deg === undefined ? null : `${formatSignedDeg(deg)} (${describeDirection(deg)})`);
  const details: Array<[string, string | null]> = [
    ['Block', `${PHASE_NAMES[trial.phase]}${trial.isCatch ? ' · catch trial' : ''}`],
    ['Target direction', `${formatDeg(trial.targetAngleDeg)} counterclockwise from screen-right`],
    ['Cursor rotation', formatSignedDeg(trial.appliedRotationDeg, 2)],
    ['Cursor during the reach', trial.cursorVisibleDuringReach ? 'Visible' : 'Hidden'],
    ['Outcome', outcomeText(trial)],
    ['Reaction time', m.reactionTimeMs !== null ? `${Math.round(m.reactionTimeMs)} ms` : null],
    ['Movement time', m.movementDurationMs !== null ? `${Math.round(m.movementDurationMs)} ms (start of movement to arrival)` : null],
    [
      'Hold registered',
      trial.times.holdCompletionMs != null && trial.times.goCueMs !== null
        ? `${Math.round(trial.times.holdCompletionMs - trial.times.goCueMs)} ms after the target lit`
        : null,
    ],
    ['Initial hand direction', direction(m.hand?.initialDirectionErrorDeg)],
    ['Hand direction on arrival', direction(m.hand?.endpointDirectionErrorDeg)],
    [
      'Initial cursor direction',
      trial.cursorVisibleDuringReach ? direction(m.cursor?.initialDirectionErrorDeg) : 'Cursor hidden',
    ],
    [
      'Cursor direction on arrival',
      trial.cursorVisibleDuringReach ? direction(m.cursor?.endpointDirectionErrorDeg) : 'Cursor hidden',
    ],
    [
      'Largest sideways deviation of the hand',
      m.hand
        ? `${m.hand.maxAbsLateralDeviation.toFixed(0)} units ${m.hand.signedLateralDeviationAtMax < 0 ? 'clockwise' : 'counterclockwise'} of the straight line`
        : null,
    ],
    ['Hand path straightness', m.hand ? `${m.hand.pathEfficiency.toFixed(3)} (1 = perfectly straight)` : null],
    ['Mouse samples in the outward reach', String(m.reachSampleCount)],
  ];

  return (
    <div className="inspector">
      <div className="inspector-controls">
        <button type="button" className="button" onClick={() => onChange(trial.trialNumber - 1)} disabled={trial.trialNumber <= 1}>
          ← Previous
        </button>
        <label className="inspector-slider">
          <span>
            Trial <strong>{trial.trialNumber}</strong> of {count}
          </span>
          <input
            type="range"
            min={1}
            max={count}
            step={1}
            value={trial.trialNumber}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label="Trial number"
          />
        </label>
        <button type="button" className="button" onClick={() => onChange(trial.trialNumber + 1)} disabled={trial.trialNumber >= count}>
          Next →
        </button>
      </div>

      <div className="inspector-body">
        <div>
          <LegendRow items={legend} />
          <svg
            className="inspector-svg"
            viewBox={`${-half} ${-half} ${2 * half} ${2 * half}`}
            role="img"
            aria-label={`Trial ${trial.trialNumber}: recorded hand${cursor ? ' and cursor' : ''} path in the workspace`}
          >
            <rect x={-half} y={-half} width={2 * half} height={2 * half} fill={VIZ.surface} stroke={VIZ.grid} />
            {session.preset.structure.targetAnglesDeg.map((angle) => {
              const p = targetPosition(angle, g.targetDistance);
              const lit = angle === trial.targetAngleDeg;
              return (
                <circle
                  key={angle}
                  cx={p.x}
                  cy={-p.y}
                  r={g.targetRadius}
                  fill={lit ? VIZ.band : 'none'}
                  stroke={lit ? VIZ.ink2 : VIZ.axis}
                  strokeWidth={lit ? 2.5 : 1.5}
                />
              );
            })}
            {/* The straight line from start to the lit target. */}
            <line x1={0} y1={0} x2={target.x} y2={-target.y} stroke={VIZ.axis} strokeWidth={1.5} />
            <circle cx={0} cy={0} r={g.startRadius} fill={VIZ.surface} stroke={VIZ.muted} strokeWidth={1.5} />

            {/* After arrival: thin and dashed, drawn first so the measured paths sit on top. */}
            {handAfter && (
              <polyline
                className="inspector-after"
                points={pathPoints(handAfter)}
                fill="none"
                stroke={VIZ.move}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.7}
              />
            )}
            {cursorAfter && !identical && (
              <polyline
                className="inspector-after"
                points={pathPoints(cursorAfter)}
                fill="none"
                stroke={VIZ.cursor}
                strokeWidth={1.5}
                strokeDasharray="5 4"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.8}
              />
            )}

            {hand && (
              <>
                {/* When hand and cursor coincide (no rotation), the hand path is drawn
                    wider so it shows as an outline around the cursor path. */}
                <polyline
                  points={pathPoints(hand)}
                  fill="none"
                  stroke={VIZ.move}
                  strokeWidth={identical ? 8 : 3}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={trial.valid ? 1 : 0.55}
                />
                <circle
                  cx={endOf(hand).x}
                  cy={-endOf(hand).y}
                  r={identical ? 9 : 6}
                  fill={VIZ.move}
                  stroke={VIZ.surface}
                  strokeWidth={2.5}
                />
              </>
            )}
            {cursor && (
              <>
                <polyline
                  points={pathPoints(cursor)}
                  fill="none"
                  stroke={VIZ.cursor}
                  strokeWidth={3}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={trial.valid ? 1 : 0.55}
                />
                <circle cx={endOf(cursor).x} cy={-endOf(cursor).y} r={6} fill={VIZ.cursor} stroke={VIZ.surface} strokeWidth={2.5} />
              </>
            )}

            {/* Direct labels, only where they cannot collide; the legend always names both paths. */}
            {hand && identical && (
              <InspectorLabel at={labelPosition(endOf(hand), 30, 'hand = cursor', half)} text="hand = cursor" />
            )}
            {hand && !identical && (cursor === null || endsFarApart) && (
              <InspectorLabel at={labelPosition(endOf(hand), 30, 'hand', half)} text="hand" />
            )}
            {cursor && !identical && endsFarApart && (
              <InspectorLabel at={labelPosition(endOf(cursor), 30, 'cursor', half)} text="cursor" />
            )}
          </svg>
          {identical && (
            <p className="viz-footnote">
              No rotation was applied on this reach, so the cursor followed the hand exactly: the two paths lie on top
              of each other (cursor drawn inside the wider hand line).
            </p>
          )}
          {!trial.cursorVisibleDuringReach && (
            <p className="viz-footnote">The cursor was hidden during this reach, so only the hand path exists.</p>
          )}
          {(handAfter || cursorAfter) && (
            <p className="viz-footnote">
              The round marker is where the hand first got as far out as the target (arrival); the measurements stop
              there. The dashed line shows what followed
              {trial.cursorVisibleDuringReach ? ': bringing the cursor onto the target and holding it.' : ' while the reach was being held.'}
            </p>
          )}
          {!trial.valid && (
            <p className="viz-footnote">
              This reach was not analysed ({outcomeText(trial).toLowerCase()}); the path recorded up to that point is shown faded.
            </p>
          )}
          {earlierAttempts > 0 && (
            <p className="viz-footnote">
              An earlier attempt at this trial was interrupted and repeated. The repeat is shown; the interrupted attempt
              is kept in the downloaded data.
            </p>
          )}
        </div>

        <dl className="inspector-details">
          {details
            .filter((d): d is [string, string] => d[1] !== null)
            .map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
      </div>
    </div>
  );
}

function InspectorLabel({ at, text }: { at: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }; text: string }) {
  return (
    <text
      x={at.x}
      y={at.y}
      textAnchor={at.anchor}
      fontSize={LABEL_FONT_SIZE}
      fontWeight={600}
      fill={VIZ.ink2}
      stroke={VIZ.surface}
      strokeWidth={4}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {text}
    </text>
  );
}
