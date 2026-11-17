/**
 * Tables.tsx — the numbers behind the charts, as tables.
 *
 * `SummaryTable` is a short descriptive summary of this participant's own
 * reaches. `TrialTable` is the full table-view twin of the per-trial charts,
 * so no value is reachable only by hovering.
 *
 * Nothing here is an inferential statistic and nothing is compared with other
 * people: the app has no data from anyone else.
 *
 * Key exports: `SummaryTable`, `TrialTable`.
 */

import type { GroupMean } from '../../core/analysis';
import type { SessionRecord } from '../../core/record';
import { formatDeg, formatSignedDeg } from '../presetText';
import type { PhaseBand, TrialPoint } from './model';

const range = (numbers: number[]): string =>
  numbers.length === 0
    ? '–'
    : numbers.length === 1
      ? String(numbers[0])
      : numbers[numbers.length - 1] - numbers[0] === numbers.length - 1
        ? `${numbers[0]}–${numbers[numbers.length - 1]}`
        : numbers.join(', ');

const signed = (value: number | null, digits = 1): string => (value === null ? 'no valid reach' : formatSignedDeg(value, digits));

interface SummaryRow {
  label: string;
  trials: string;
  rotation: number | null;
  value: number | null;
  count: string;
  isBaseline?: boolean;
}

export function SummaryTable({ session }: { session: SessionRecord }) {
  const s = session.summary;
  const group = (label: string, g: GroupMean, isBaseline = false): SummaryRow => ({
    label,
    trials: range(g.trialNumbers),
    rotation: g.meanRotationDeg,
    value: g.meanDeg,
    count: `${g.n} of ${g.trialNumbers.length}`,
    isBaseline,
  });

  const rows: SummaryRow[] = [
    group('Baseline reaches', s.baseline, true),
    group('First rotated reaches', s.earlyPerturbed),
    group('Last rotated reaches', s.latePerturbed),
    ...s.catchTrials.map(
      (c, i): SummaryRow => ({
        label: s.catchTrials.length > 1 ? `Catch trial ${i + 1}` : 'Catch trial',
        trials: String(c.trialNumber),
        rotation: 0,
        value: c.valueDeg,
        count: c.valueDeg !== null ? '1 of 1' : '0 of 1',
      }),
    ),
    {
      label: 'First aftereffect reach',
      trials: s.firstAftereffect.trialNumber !== null ? String(s.firstAftereffect.trialNumber) : '–',
      rotation: 0,
      value: s.firstAftereffect.valueDeg,
      count: s.firstAftereffect.valueDeg !== null ? '1 of 1' : '0 of 1',
    },
    group('All aftereffect reaches', s.aftereffect),
  ];
  const baseline = s.baseline.meanDeg;

  return (
    <>
      <table className="data-table summary-table">
        <thead>
          <tr>
            <th>Reaches</th>
            <th>Trials</th>
            <th className="num">Cursor rotation (mean)</th>
            <th className="num">Initial hand direction (mean)</th>
            <th className="num">Relative to your baseline</th>
            <th className="num">Reaches with a value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.trials}</td>
              <td className="num">{row.rotation === null ? '–' : formatSignedDeg(row.rotation, 1)}</td>
              <td className="num">{signed(row.value)}</td>
              <td className="num">
                {row.isBaseline || row.value === null || baseline === null ? '–' : formatSignedDeg(row.value - baseline, 1)}
              </td>
              <td className="num">{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="viz-footnote">
        Initial hand direction is measured a quarter of the way to the target; 0° is straight at the target and negative
        is clockwise. These numbers describe your own reaches only. They are not statistical tests, and a mean of four
        reaches (or a single reach) is a rough guide at best.
      </p>
    </>
  );
}

const cell = (value: number | null, digits = 1): string => (value === null ? '' : formatSignedDeg(value, digits));

export function TrialTable({ points, bands, session }: { points: TrialPoint[]; bands: PhaseBand[]; session: SessionRecord }) {
  const timing = new Map(
    session.trials.filter((t) => t.isFinalAttempt).map((t) => [t.trialNumber, t.metrics]),
  );
  const blockOf = (p: TrialPoint) => bands.find((b) => b.phase === p.phase)?.label ?? p.phase;

  return (
    <details className="table-details">
      <summary>Show the value for every reach (table)</summary>
      <div className="table-scroll">
        <table className="data-table trial-table">
          <thead>
            <tr>
              <th className="num">Trial</th>
              <th>Block</th>
              <th className="num">Target</th>
              <th className="num">Cursor rotation</th>
              <th>Cursor</th>
              <th className="num">Initial hand direction</th>
              <th className="num">Hand direction on arrival</th>
              <th className="num">Initial cursor direction</th>
              <th className="num">Reaction time (ms)</th>
              <th className="num">Movement time (ms)</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => {
              const m = timing.get(p.trialNumber);
              return (
                <tr key={p.trialNumber} className={p.isCatch ? 'is-catch' : undefined}>
                  <td className="num">{p.trialNumber}</td>
                  <td>{p.isCatch ? `${blockOf(p)} · catch` : blockOf(p)}</td>
                  <td className="num">{formatDeg(p.targetAngleDeg)}</td>
                  <td className="num">{formatSignedDeg(p.rotationDeg, 2)}</td>
                  <td>{p.cursorShown ? 'visible' : 'hidden'}</td>
                  <td className="num">{cell(p.handInitialDeg)}</td>
                  <td className="num">{cell(p.handEndpointDeg)}</td>
                  <td className="num">{cell(p.cursorInitialDeg)}</td>
                  <td className="num">{m?.reactionTimeMs != null ? Math.round(m.reactionTimeMs) : ''}</td>
                  <td className="num">{m?.movementDurationMs != null ? Math.round(m.movementDurationMs) : ''}</td>
                  <td>{p.valid ? '' : p.invalidReason === 'timeout' ? 'timed out short of the target' : (p.invalidReason ?? '')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
