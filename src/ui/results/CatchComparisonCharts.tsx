/**
 * CatchComparisonCharts.tsx — signed lateral deviation against movement
 * progress, for each catch trial beside the rotated reaches just before and
 * after it.
 *
 * x: progress along the straight line to the target (u · r), 0–100% of the target distance
 * y: signed distance to the side of that line (u_x·r_y − u_y·r_x), same units, + = counterclockwise
 *
 * All panels share one y range so they can be compared directly. The compared
 * reaches usually went to DIFFERENT targets; each is rotated into its own
 * target-aligned frame, and the caption spells out that limitation.
 *
 * Key export: `CatchComparisonCharts`.
 */

import type { ReactElement } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDeg, formatSignedDeg } from '../presetText';
import { AXIS_TICK, LegendRow, TooltipCard, VIZ, type LegendItem } from './chartTheme';
import type { CatchComparison, PathKind, ProgressSeries } from './model';

/** Spacing of y-axis ticks, in % of the target distance. */
const Y_STEP = 20;

const seriesColor = (s: ProgressSeries) => (s.role === 'catch' ? VIZ.catchTrial : VIZ.move);

const seriesName = (s: ProgressSeries) =>
  s.role === 'catch'
    ? `trial ${s.trialNumber}, catch (rotation off)`
    : `trial ${s.trialNumber}, rotation ${formatSignedDeg(s.rotationDeg)}`;

/** Index of the last row in which a series has a value (where its line ends). */
function lastIndexWithValue(rows: CatchComparison['rows'], dataKey: string): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (typeof rows[i][dataKey] === 'number') return i;
  }
  return -1;
}

function ComparisonPlot({ comparison, yRange, kind }: { comparison: CatchComparison; yRange: [number, number]; kind: PathKind }) {
  const available = comparison.series.filter((s) => s.available);
  const missing = comparison.series.filter((s) => !s.available);
  const catchSeries = comparison.series.find((s) => s.role === 'catch');
  const catchEnd = catchSeries ? lastIndexWithValue(comparison.rows, catchSeries.dataKey) : -1;
  const yTicks: number[] = [];
  for (let v = yRange[0]; v <= yRange[1]; v += Y_STEP) yTicks.push(v);

  /** Direct label at the end of the catch line only; the other lines are named by the legend and tooltip. */
  const catchEndLabel = (props: { x?: number | string; y?: number | string; index?: number }): ReactElement | null => {
    if (props.index !== catchEnd || typeof props.x !== 'number' || typeof props.y !== 'number') return null;
    return (
      <text x={props.x + 8} y={props.y + 4} fontSize={11} fontWeight={600} fill={VIZ.ink2}>
        catch
      </text>
    );
  };

  return (
    <figure className="comparison-plot">
      <figcaption>
        <strong>Catch trial {comparison.catchTrialNumber}</strong>
        <span>
          with rotated trials{' '}
          {comparison.series
            .filter((s) => s.role !== 'catch')
            .map((s) => s.trialNumber)
            .join(' and ')}
        </span>
      </figcaption>
      <div
        className="viz-plot"
        style={{ height: 260 }}
        role="img"
        aria-label={`Signed lateral deviation against progress for catch trial ${comparison.catchTrialNumber} and its neighbours`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={comparison.rows} margin={{ top: 10, right: 44, bottom: 24, left: 6 }}>
            <CartesianGrid vertical={false} stroke={VIZ.grid} />
            <XAxis
              dataKey="progressPct"
              type="number"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: VIZ.axis }}
              label={{ value: 'Progress toward the target', position: 'insideBottom', offset: -14, fill: VIZ.ink2, fontSize: 12 }}
            />
            <YAxis
              domain={yRange}
              ticks={yTicks}
              tickFormatter={(v: number) => `${v}%`}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={58}
              label={{
                value: '← clockwise  ·  counterclockwise →',
                angle: -90,
                position: 'insideLeft',
                offset: 4,
                style: { textAnchor: 'middle', fill: VIZ.ink2, fontSize: 11, whiteSpace: 'pre' },
              }}
            />
            {/* The straight line from start to target. */}
            <ReferenceLine y={0} stroke={VIZ.muted} strokeWidth={1} />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: VIZ.muted, strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0].payload as CatchComparison['rows'][number];
                return (
                  <TooltipCard
                    heading={`${label}% of the way to the target`}
                    rows={available.map((s) => {
                      const v = row[s.dataKey];
                      return {
                        value: typeof v === 'number' ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%` : 'no value',
                        label: seriesName(s),
                        color: seriesColor(s),
                      };
                    })}
                    note={`Sideways distance of the ${kind} from the straight line, as a share of the target distance.`}
                  />
                );
              }}
            />
            {available.map((s) => (
              <Line
                key={s.dataKey}
                dataKey={s.dataKey}
                type="linear"
                stroke={seriesColor(s)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 4, fill: seriesColor(s), stroke: VIZ.surface, strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
                label={s.role === 'catch' ? catchEndLabel : undefined}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="viz-footnote">
        Targets: {comparison.series.map((s) => `trial ${s.trialNumber} at ${formatDeg(s.targetAngleDeg)}`).join(', ')}.
        {missing.length > 0 &&
          ` Not shown: ${missing.map((s) => `trial ${s.trialNumber} (${s.reason})`).join(', ')}.`}
      </p>
    </figure>
  );
}

export function CatchComparisonCharts({ comparisons, kind }: { comparisons: CatchComparison[]; kind: PathKind }) {
  if (comparisons.length === 0) return null;

  // One shared y range for every panel so they can be compared directly:
  // rounded outward to multiples of 20%, always showing at least ±20% around 0.
  let lowest = 0;
  let highest = 0;
  for (const c of comparisons) {
    for (const row of c.rows) {
      for (const s of c.series) {
        const v = row[s.dataKey];
        if (typeof v === 'number') {
          lowest = Math.min(lowest, v);
          highest = Math.max(highest, v);
        }
      }
    }
  }
  const yRange: [number, number] = [
    Math.min(-Y_STEP, Math.floor(lowest / Y_STEP) * Y_STEP),
    Math.max(Y_STEP, Math.ceil(highest / Y_STEP) * Y_STEP),
  ];

  const legend: LegendItem[] = [
    { key: 'line', color: VIZ.catchTrial, label: 'Catch trial (rotation off for this one reach)' },
    { key: 'line', color: VIZ.move, label: 'The rotated reaches just before and just after it' },
  ];
  const differentTargets = comparisons.some((c) => !c.sameTarget);

  return (
    <>
      <LegendRow items={legend} />
      <div className="comparison-grid">
        {comparisons.map((c) => (
          <ComparisonPlot key={c.catchTrialNumber} comparison={c} yRange={yRange} kind={kind} />
        ))}
      </div>
      {differentTargets && (
        <p className="viz-footnote">
          <strong>Limits of this comparison.</strong> The reaches in each panel went to different targets, so each path
          has been rotated to put its own target along the horizontal axis. That removes the target direction, but not
          any direction-specific habits of your arm or mouse, and each line is a single reach. Read large, consistent
          gaps; do not read much into small ones.
        </p>
      )}
    </>
  );
}
