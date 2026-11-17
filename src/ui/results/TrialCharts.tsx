/**
 * TrialCharts.tsx — the two per-trial charts, which share one x axis (trial
 * number) and the same shaded blocks so they can be read one above the other:
 *
 *   RotationTimeline     what the software did: cursor rotation on every trial
 *   DirectionErrorChart  what the participant did: initial direction on every trial
 *
 * Both are single-axis charts (never two y-scales in one plot). Catch trials
 * are marked three ways — colour, a diamond, and the word "catch" — so they
 * stand out without relying on colour alone. Trials without a valid value are
 * left as gaps rather than interpolated.
 *
 * Key exports: `RotationTimeline`, `DirectionErrorChart`.
 */

import { useMemo, type Key, type ReactElement } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDeg, formatSignedDeg } from '../presetText';
import { AXIS_TICK, ChartCard, SeriesDot, TooltipCard, VIZ, type LegendItem } from './chartTheme';
import { METRIC_INFO } from './InfoNote';
import { describeDirection, initialErrorFor, type PathKind, type PhaseBand, type TrialPoint } from './model';

/** Hovering one chart moves the crosshair on the other. */
const SYNC_ID = 'per-trial';

const PLOT_MARGIN = { top: 42, right: 18, bottom: 22, left: 6 };
const Y_AXIS_WIDTH = 58;

function trialTicks(trialCount: number): number[] {
  const step = trialCount <= 20 ? 4 : 5;
  const ticks = [1];
  for (let t = step; t <= trialCount; t += step) ticks.push(t);
  return ticks;
}

/** Block name and cursor visibility, written in the margin above each shaded block. */
function bandLabel(band: PhaseBand) {
  return ({ viewBox }: { viewBox?: { x?: number; y?: number; width?: number } }): ReactElement => {
    const x = (viewBox?.x ?? 0) + (viewBox?.width ?? 0) / 2;
    const y = viewBox?.y ?? 0;
    return (
      <g>
        <text x={x} y={y - 22} textAnchor="middle" fontSize={12} fontWeight={600} fill={VIZ.ink2}>
          {band.label}
        </text>
        <text x={x} y={y - 8} textAnchor="middle" fontSize={11} fill={VIZ.muted}>
          {band.note}
        </text>
      </g>
    );
  };
}

/** Shaded/labelled blocks and the hairlines between them. Returned as an array so Recharts sees its own components. */
function renderBands(bands: PhaseBand[]): ReactElement[] {
  const items: ReactElement[] = [];
  bands.forEach((band, i) => {
    items.push(
      <ReferenceArea
        key={`band-${band.phase}`}
        x1={band.firstTrial - 0.5}
        x2={band.lastTrial + 0.5}
        fill={band.phase === 'adaptation' ? VIZ.band : VIZ.surface}
        fillOpacity={band.phase === 'adaptation' ? 1 : 0}
        stroke="none"
        label={bandLabel(band)}
      />,
    );
    if (i > 0) {
      items.push(<ReferenceLine key={`edge-${band.phase}`} x={band.firstTrial - 0.5} stroke={VIZ.axis} strokeWidth={1} />);
    }
  });
  return items;
}

interface DotProps {
  key?: Key | null;
  cx?: number | null;
  cy?: number | null;
  payload?: { isCatch: boolean };
}

/** Marker renderer. `labelSide` places the word "catch" above or below a catch-trial diamond. */
function makeDot(active: boolean, labelSide: (payload: { isCatch: boolean }) => 'above' | 'below') {
  return (props: DotProps): ReactElement => {
    const { key, cx, cy, payload } = props;
    if (typeof cx !== 'number' || typeof cy !== 'number' || Number.isNaN(cy) || !payload) return <g key={key} />;
    const above = labelSide(payload) === 'above';
    return (
      <g key={key}>
        <SeriesDot cx={cx} cy={cy} isCatch={payload.isCatch} active={active} />
        {payload.isCatch && !active && (
          // The halo (a stroke in the block's background colour, painted first)
          // keeps the word readable where lines pass behind it.
          <text
            x={cx}
            y={above ? cy - 12 : cy + 21}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill={VIZ.ink2}
            stroke={VIZ.band}
            strokeWidth={4}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            catch
          </text>
        )}
      </g>
    );
  };
}

/** "33.4° clockwise of the target at 180°", or "Straight at the target at 180°". */
function relativeToTarget(errorDeg: number, targetAngleDeg: number): string {
  const words = describeDirection(errorDeg);
  return `${words === '0°' ? 'Straight at' : `${words} of`} the target at ${formatDeg(targetAngleDeg)}`;
}

function blockName(point: TrialPoint, bands: PhaseBand[]): string {
  if (point.isCatch) return 'catch trial (rotation switched off)';
  return bands.find((b) => b.phase === point.phase)?.label.toLowerCase() ?? point.phase;
}

// ---------------------------------------------------------------------------
// Reveal timeline
// ---------------------------------------------------------------------------

interface TimelineProps {
  points: TrialPoint[];
  bands: PhaseBand[];
}

export function RotationTimeline({ points, bands }: TimelineProps) {
  const rows = useMemo(
    () => points.map((p) => ({ trial: p.trialNumber, rotation: p.rotationDeg, isCatch: p.isCatch, point: p })),
    [points],
  );
  const maxRotation = Math.max(15, ...points.map((p) => p.rotationDeg));
  const yMax = Math.ceil(maxRotation / 15) * 15;
  const yTicks = Array.from({ length: yMax / 15 + 1 }, (_, i) => i * 15);
  const hasCatch = points.some((p) => p.isCatch);

  const legend: LegendItem[] = [{ key: 'dot', color: VIZ.move, label: 'One reach: the rotation applied to the cursor' }];
  if (hasCatch) {
    legend.push({ key: 'diamond', color: VIZ.catchTrial, label: 'Catch trial: rotation switched off for a single reach' });
  }

  return (
    <ChartCard
      title="What the software did: cursor rotation on every reach"
      intro="Each point is one outward reach. Its height is how far the cursor’s motion was rotated counterclockwise from your hand’s motion on that reach. Nothing on screen announced any of these changes."
      legend={legend}
    >
      <div className="viz-plot" style={{ height: 230 }} role="img" aria-label="Cursor rotation applied on each trial">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={PLOT_MARGIN} syncId={SYNC_ID}>
            {renderBands(bands)}
            <CartesianGrid vertical={false} stroke={VIZ.grid} />
            <XAxis
              dataKey="trial"
              type="number"
              domain={[0.5, points.length + 0.5]}
              ticks={trialTicks(points.length)}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: VIZ.axis }}
              label={{ value: 'Trial', position: 'insideBottom', offset: -12, fill: VIZ.ink2, fontSize: 12 }}
            />
            <YAxis
              domain={[0, yMax]}
              ticks={yTicks}
              tickFormatter={(v: number) => `${v}°`}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={Y_AXIS_WIDTH}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: VIZ.muted, strokeWidth: 1 }}
              content={({ active, payload }) => {
                const point: TrialPoint | undefined = active ? payload?.[0]?.payload?.point : undefined;
                if (!point) return null;
                return (
                  <TooltipCard
                    heading={`Trial ${point.trialNumber} · ${blockName(point, bands)}`}
                    rows={[
                      {
                        value: formatSignedDeg(point.rotationDeg, 2),
                        label: 'cursor rotation',
                        color: point.isCatch ? VIZ.catchTrial : VIZ.move,
                      },
                    ]}
                    note={point.cursorShown ? 'Cursor visible during the reach' : 'Cursor hidden during the reach'}
                  />
                );
              }}
            />
            {/* A step line: the rotation is a setting that holds for a whole reach, not a quantity that slides between reaches. */}
            <Line
              dataKey="rotation"
              type="step"
              stroke={VIZ.move}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              isAnimationActive={false}
              dot={makeDot(false, () => 'above')}
              activeDot={makeDot(true, () => 'above')}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Initial direction error by trial
// ---------------------------------------------------------------------------

interface DirectionErrorProps {
  points: TrialPoint[];
  bands: PhaseBand[];
  kind: PathKind;
  onSelectTrial: (trialNumber: number) => void;
}

export function DirectionErrorChart({ points, bands, kind, onSelectTrial }: DirectionErrorProps) {
  const rows = useMemo(
    () =>
      points.map((p) => ({
        trial: p.trialNumber,
        value: initialErrorFor(p, kind),
        // Only the hand has a "compensation" reference; for the cursor the goal is simply 0°.
        reference: kind === 'hand' ? p.compensationDeg : null,
        isCatch: p.isCatch,
        point: p,
      })),
    [points, kind],
  );

  // Round the y range outward to multiples of 15°, always including 0 and the
  // reference, with a little headroom so no line runs along the plot's edge.
  const plotted = rows.flatMap((r) => [r.value, r.reference]).filter((v): v is number => v !== null);
  const yMin = Math.max(-180, Math.floor((Math.min(0, ...plotted) - 6) / 15) * 15);
  const yMax = Math.min(180, Math.ceil((Math.max(0, ...plotted) + 6) / 15) * 15);
  const yStep = yMax - yMin > 150 ? 30 : 15;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) yTicks.push(v);

  const invalid = points.filter((p) => !p.valid);
  const subject = kind === 'hand' ? 'hand' : 'cursor';

  const legend: LegendItem[] = [
    { key: 'dot', color: VIZ.move, label: `Your ${subject}’s initial direction on one reach` },
  ];
  if (points.some((p) => p.isCatch)) {
    legend.push({ key: 'diamond', color: VIZ.catchTrial, label: 'Catch trial (rotation off)' });
  }
  if (kind === 'hand') {
    legend.push({
      key: 'line',
      color: VIZ.context,
      label: 'Hand direction that would have sent the cursor straight to the target',
    });
  }

  return (
    <ChartCard
      id="direction-error-chart"
      title={`What you did: initial ${subject} direction on every reach`}
      intro={
        kind === 'hand' ? (
          <>
            The direction your hand set off in, measured a quarter of the way to the target, before you could correct
            much. <strong>0° means straight at the target</strong>; negative values are clockwise of it. The gray line
            is where your hand would have had to aim for the cursor to go straight to the target. Click a point to
            inspect that reach.
          </>
        ) : (
          <>
            The direction the <em>displayed cursor</em> set off in, a quarter of the way to the target.{' '}
            <strong>0° means straight at the target.</strong> There is nothing to plot where the cursor was hidden.
            Click a point to inspect that reach.
          </>
        )
      }
      info={points.some((p) => p.isCatch) ? [METRIC_INFO.initialDirection, METRIC_INFO.catchTrial] : [METRIC_INFO.initialDirection]}
      legend={legend}
      footnote={
        invalid.length > 0
          ? `No value is plotted for ${invalid
              .map((p) => `trial ${p.trialNumber} (${p.invalidReason === 'timeout' ? 'timed out' : p.invalidReason})`)
              .join(', ')}.`
          : undefined
      }
    >
      <div
        className="viz-plot is-clickable"
        style={{ height: 360 }}
        role="img"
        aria-label={`Initial ${subject} direction error on each trial`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={PLOT_MARGIN}
            syncId={SYNC_ID}
            onClick={(state) => {
              const index = Number(state?.activeTooltipIndex);
              if (Number.isInteger(index) && rows[index]) onSelectTrial(rows[index].trial);
            }}
          >
            {renderBands(bands)}
            <CartesianGrid vertical={false} stroke={VIZ.grid} />
            <XAxis
              dataKey="trial"
              type="number"
              domain={[0.5, points.length + 0.5]}
              ticks={trialTicks(points.length)}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: VIZ.axis }}
              label={{ value: 'Trial', position: 'insideBottom', offset: -12, fill: VIZ.ink2, fontSize: 12 }}
            />
            <YAxis
              domain={[yMin, yMax]}
              ticks={yTicks}
              tickFormatter={(v: number) => `${v}°`}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={Y_AXIS_WIDTH}
              label={{
                value: '← clockwise   ·   counterclockwise →',
                angle: -90,
                position: 'insideLeft',
                offset: 4,
                style: { textAnchor: 'middle', fill: VIZ.ink2, fontSize: 12, whiteSpace: 'pre' },
              }}
            />
            {/* The target direction: the line everything is measured from. */}
            <ReferenceLine y={0} stroke={VIZ.muted} strokeWidth={1} />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: VIZ.muted, strokeWidth: 1 }}
              content={({ active, payload }) => {
                const point: TrialPoint | undefined = active ? payload?.[0]?.payload?.point : undefined;
                if (!point) return null;
                const value = initialErrorFor(point, kind);
                const tooltipRows = [];
                if (value !== null) {
                  tooltipRows.push({
                    value: formatSignedDeg(value),
                    label: `initial ${subject} direction`,
                    color: point.isCatch ? VIZ.catchTrial : VIZ.move,
                  });
                }
                tooltipRows.push({ value: formatSignedDeg(point.rotationDeg, 2), label: 'cursor rotation on this reach' });
                if (kind === 'hand') {
                  tooltipRows.push({
                    value: formatSignedDeg(point.compensationDeg, 2),
                    label: 'hand direction for a straight cursor',
                    color: VIZ.context,
                  });
                }
                const note =
                  value !== null
                    ? relativeToTarget(value, point.targetAngleDeg)
                    : !point.valid
                      ? `No value: this reach ${point.invalidReason === 'timeout' ? 'timed out' : `was not analysed (${point.invalidReason})`}.`
                      : 'No value: the cursor was hidden on this reach.';
                return (
                  <TooltipCard heading={`Trial ${point.trialNumber} · ${blockName(point, bands)}`} rows={tooltipRows} note={note} />
                );
              }}
            />
            {kind === 'hand' && (
              <Line
                dataKey="reference"
                type="step"
                stroke={VIZ.context}
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              dataKey="value"
              type="linear"
              stroke={VIZ.move}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              connectNulls={false}
              isAnimationActive={false}
              dot={makeDot(false, (p) => ((p as { value?: number | null }).value ?? 0) < 0 ? 'below' : 'above')}
              activeDot={makeDot(true, () => 'above')}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
