/**
 * ClassView.tsx — the professor's class view (`/class/<CODE>`), meant for the
 * classroom projector. Not part of the student flow.
 *
 * It shows every anonymous session shared with one class code: each student
 * as a thin line (initial direction error against trial number), with the mean
 * and a ±1 SD band on top, one colour per standard version. It asks the server
 * for news every 15 seconds, so curves appear as students share.
 *
 * WHAT THE PAGE MUST NOT DO
 *   - Identify anyone. It has nothing to identify them with: the API returns
 *     no ids or times, and lines carry no labels.
 *   - Pool different protocols. Sudden and gradual are drawn side by side but
 *     never averaged together; any other protocol gets a view of its own.
 *   - Claim a result. The numbers are descriptive; the page says so.
 *
 * COLOUR. Series colours follow the app-wide roles in results/chartTheme.tsx:
 * the first and third slots of the validated palette (blue, aqua), which were
 * checked together for colour-vision-deficiency separation. Orange stays
 * reserved for catch trials, as on the results page. Because aqua is light on
 * this surface, the two series are also named by a direct label and a legend,
 * and every number is available in the tables below the chart.
 *
 * Key exports: `ClassView`, `POLL_MS`.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Area,
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
import { normalizeClassCode, type ClassResponse } from '../../core/classWire';
import { fetchClass, type FetchLike } from '../classClient';
import { formatSignedDeg } from '../presetText';
import { AXIS_TICK, LegendRow, TooltipCard, VIZ, diamondPoints, type LegendItem } from '../results/chartTheme';
import { INSTRUCTOR_PATH } from '../route';
import {
  MAX_LINES_PER_SERIES,
  bandOfTrial,
  buildClassModel,
  chartRows,
  type ClassSeries,
  type ClassViewModel,
  type MeanSd,
} from './model';

/** How often the page asks the server whether anything has changed (ms). */
export const POLL_MS = 15_000;

/** Fixed colour order for the series of a view (never cycled; a view has at most two). */
const SERIES_COLORS = [VIZ.move, VIZ.cursor] as const;
const colorOf = (series: ClassSeries) => SERIES_COLORS[series.colorIndex] ?? VIZ.move;

const PLOT_MARGIN = { top: 44, right: 120, bottom: 24, left: 6 };
const PLOT_HEIGHT = 440;

const clock = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "−32.4° ± 8.1°", "−32.4°" (one value), or "no data". */
function meanText(stats: MeanSd): string {
  if (stats.mean === null) return 'no data yet';
  const mean = formatSignedDeg(stats.mean);
  return stats.sd === null ? mean : `${mean} ± ${Math.abs(stats.sd).toFixed(1)}°`;
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

function trialTicks(trialCount: number): number[] {
  const step = trialCount <= 20 ? 4 : trialCount <= 48 ? 5 : 8;
  const ticks = [1];
  for (let t = step; t <= trialCount; t += step) ticks.push(t);
  return ticks;
}

function ClassChart({ view }: { view: ClassViewModel }) {
  const rows = useMemo(() => chartRows(view), [view]);
  const shown = view.series.filter((s) => s.sessions.length > 0);

  // y range: every plotted value and band edge, rounded outward to 15°, always including 0.
  const yRange = useMemo(() => {
    let low = -15;
    let high = 15;
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (key === 'trial' || key.endsWith('_n')) continue;
        for (const v of Array.isArray(value) ? value : [value]) {
          if (typeof v === 'number') {
            low = Math.min(low, v);
            high = Math.max(high, v);
          }
        }
      }
    }
    return [Math.max(-180, Math.floor((low - 4) / 15) * 15), Math.min(180, Math.ceil((high + 4) / 15) * 15)] as const;
  }, [rows]);
  const yStep = yRange[1] - yRange[0] > 150 ? 30 : 15;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yRange[0] / yStep) * yStep; v <= yRange[1]; v += yStep) yTicks.push(v);

  // Direct labels at the right-hand end of each mean line. If two lines end
  // close together, push the labels apart so both stay readable.
  const lastMean = (series: ClassSeries): number | null => {
    for (let i = series.perTrial.length - 1; i >= 0; i--) {
      const mean = series.perTrial[i].mean;
      if (mean !== null) return mean;
    }
    return null;
  };
  const lastIndexWithMean = (series: ClassSeries): number => {
    for (let i = series.perTrial.length - 1; i >= 0; i--) if (series.perTrial[i].mean !== null) return i;
    return -1;
  };
  const nudges = new Map<string, number>();
  if (shown.length === 2) {
    const [a, b] = shown.map(lastMean);
    const pixelsPerDegree = (PLOT_HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom - 30) / (yRange[1] - yRange[0]);
    if (a !== null && b !== null && Math.abs(a - b) * pixelsPerDegree < 18) {
      // The series with the higher value sits higher on screen: move its label up, the other down.
      nudges.set(shown[0].key, a >= b ? -9 : 9);
      nudges.set(shown[1].key, a >= b ? 9 : -9);
    }
  }
  const endLabel = (series: ClassSeries) => {
    const end = lastIndexWithMean(series);
    return (props: { x?: number | string; y?: number | string; index?: number }): ReactElement | null => {
      if (props.index !== end || typeof props.x !== 'number' || typeof props.y !== 'number') return null;
      const y = props.y + (nudges.get(series.key) ?? 0);
      return (
        <g>
          <circle cx={props.x + 9} cy={y} r={4} fill={colorOf(series)} />
          <text x={props.x + 17} y={y + 4} fontSize={12} fontWeight={600} fill={VIZ.ink}>
            {series.label}
          </text>
        </g>
      );
    };
  };

  const catchLabel = ({ viewBox }: { viewBox?: { x?: number; y?: number } }): ReactElement => {
    const x = viewBox?.x ?? 0;
    const y = (viewBox?.y ?? 0) - 6;
    return (
      <g>
        <polygon points={diamondPoints(x, y - 12, 5)} fill={VIZ.catchTrial} />
        <text x={x} y={y + 2} textAnchor="middle" fontSize={11} fontWeight={600} fill={VIZ.ink2}>
          catch
        </text>
      </g>
    );
  };

  return (
    <div className="viz-plot" style={{ height: PLOT_HEIGHT }} role="img" aria-label="Initial direction error on each trial, one line per shared session, with the mean and one standard deviation for each version">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={PLOT_MARGIN}>
          {view.bands.map((band) => (
            <ReferenceArea
              key={`band-${band.phase}`}
              x1={band.firstTrial - 0.5}
              x2={band.lastTrial + 0.5}
              fill={VIZ.band}
              fillOpacity={band.phase === 'adaptation' ? 1 : 0}
              stroke="none"
              label={({ viewBox }: { viewBox?: { x?: number; y?: number; width?: number } }) => (
                <text
                  x={(viewBox?.x ?? 0) + (viewBox?.width ?? 0) / 2}
                  y={(viewBox?.y ?? 0) - 26}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={600}
                  fill={VIZ.ink2}
                >
                  {band.label}
                </text>
              )}
            />
          ))}
          <CartesianGrid vertical={false} stroke={VIZ.grid} />
          <XAxis
            dataKey="trial"
            type="number"
            domain={[0.5, view.trialCount + 0.5]}
            ticks={trialTicks(view.trialCount)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: VIZ.axis }}
            label={{ value: 'Trial', position: 'insideBottom', offset: -14, fill: VIZ.ink2, fontSize: 12 }}
          />
          <YAxis
            domain={[yRange[0], yRange[1]]}
            ticks={yTicks}
            tickFormatter={(v: number) => `${v}°`}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={58}
            label={{
              value: '← clockwise   ·   counterclockwise →',
              angle: -90,
              position: 'insideLeft',
              offset: 4,
              style: { textAnchor: 'middle', fill: VIZ.ink2, fontSize: 12, whiteSpace: 'pre' },
            }}
          />
          {/* Straight at the target: the line everything is measured from. */}
          <ReferenceLine y={0} stroke={VIZ.muted} strokeWidth={1} />
          {/* Catch trial positions: the rotation was off for that one reach. */}
          {view.catchTrials.map((trial) => (
            <ReferenceLine key={`catch-${trial}`} x={trial} stroke={VIZ.ink2} strokeWidth={1} strokeDasharray="4 4" label={catchLabel} />
          ))}

          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: VIZ.muted, strokeWidth: 1 }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as Record<string, unknown> | undefined) : undefined;
              if (!row) return null;
              const trial = Number(row.trial);
              const band = bandOfTrial(view, trial);
              const isCatch = view.catchTrials.includes(trial);
              return (
                <TooltipCard
                  heading={`Trial ${trial} · ${isCatch ? 'catch trial (rotation off)' : (band?.label.toLowerCase() ?? '')}`}
                  rows={shown.map((series) => {
                    const stats = series.perTrial[trial - 1];
                    return {
                      value: meanText(stats),
                      label: `${series.label}: mean ± SD of ${stats.n}`,
                      color: colorOf(series),
                    };
                  })}
                  note="Initial hand direction; 0° is straight at the target."
                />
              );
            }}
          />

          {/* Individual sessions first, so the bands and means are drawn on top of them. */}
          {shown.flatMap((series) =>
            series.sessions.slice(0, MAX_LINES_PER_SERIES).map((_, k) => (
              <Line
                key={`${series.key}-${k}`}
                dataKey={`${series.key}_${k}`}
                type="linear"
                stroke={colorOf(series)}
                strokeWidth={1}
                strokeOpacity={0.3}
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            )),
          )}
          {shown.map((series) => (
            <Area
              key={`${series.key}-band`}
              dataKey={`${series.key}_band`}
              type="linear"
              stroke="none"
              fill={colorOf(series)}
              fillOpacity={0.14}
              connectNulls={false}
              isAnimationActive={false}
              activeDot={false}
            />
          ))}
          {shown.map((series) => (
            <Line
              key={`${series.key}-mean`}
              dataKey={`${series.key}_mean`}
              type="linear"
              stroke={colorOf(series)}
              strokeWidth={3}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 5, fill: colorOf(series), stroke: VIZ.surface, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
              label={endLabel(series)}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary statistics and the table view
// ---------------------------------------------------------------------------

function SummaryPanel({ view, total }: { view: ClassViewModel; total: number }) {
  const cell = (stats: MeanSd) => (stats.mean === null ? '–' : `${meanText(stats)}  (n = ${stats.n})`);
  return (
    <section className="card" data-testid="class-summary">
      <h2>Summary</h2>
      <dl className="class-counts">
        <div>
          <dt>Submissions</dt>
          <dd data-testid="class-total">{total}</dd>
        </div>
        {view.series.map((series) => (
          <div key={series.key}>
            <dt>
              <span className="class-key" style={{ background: colorOf(series) }} aria-hidden="true" />
              {series.label}
            </dt>
            <dd data-testid={`class-count-${series.key}`}>{series.sessions.length}</dd>
          </div>
        ))}
      </dl>
      <table className="data-table class-stats">
        <thead>
          <tr>
            <th>Mean across students (± SD)</th>
            {view.series.map((series) => (
              <th key={series.key} className="num">
                {series.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Baseline reaches</th>
            {view.series.map((series) => (
              <td key={series.key} className="num">
                {cell(series.baseline)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Catch trial error</th>
            {view.series.map((series) => (
              <td key={series.key} className="num" data-testid={`class-catch-${series.key}`}>
                {cell(series.catchError)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">First aftereffect error</th>
            {view.series.map((series) => (
              <td key={series.key} className="num" data-testid={`class-aftereffect-${series.key}`}>
                {cell(series.firstAftereffect)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="viz-footnote">
        Initial hand direction error in degrees; negative is clockwise of the target. A student with two catch trials
        counts once (their mean). Reaches that could not be analysed are left out, so n can be smaller than the number
        of submissions.
      </p>
      <p className="viz-footnote">
        <strong>Descriptive only.</strong> These are the students who chose to share, in whatever numbers they happened
        to be assigned. Nothing here is a statistical test, and a difference between the two versions on this screen
        is not evidence of a difference in general.
      </p>
    </section>
  );
}

function TrialMeansTable({ view }: { view: ClassViewModel }) {
  return (
    <details className="table-details">
      <summary>Show the mean for every trial (table)</summary>
      <div className="table-scroll">
        <table className="data-table trial-table">
          <thead>
            <tr>
              <th className="num">Trial</th>
              <th>Block</th>
              {view.series.map((series) => (
                <th key={series.key} className="num">
                  {series.label}: mean ± SD (n)
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: view.trialCount }, (_, i) => {
              const trial = i + 1;
              const isCatch = view.catchTrials.includes(trial);
              return (
                <tr key={trial} className={isCatch ? 'is-catch' : undefined}>
                  <td className="num">{trial}</td>
                  <td>{`${bandOfTrial(view, trial)?.label ?? ''}${isCatch ? ' · catch' : ''}`}</td>
                  {view.series.map((series) => {
                    const stats = series.perTrial[i];
                    return (
                      <td key={series.key} className="num">
                        {stats.mean === null ? '' : `${meanText(stats)} (${stats.n})`}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface ClassViewProps {
  /** The class code from the address, as typed. */
  code: string;
  /** Injectable for tests. */
  fetchImpl?: FetchLike;
  pollMs?: number;
}

export function ClassView({ code, fetchImpl, pollMs = POLL_MS }: ClassViewProps) {
  const classCode = normalizeClassCode(code);
  const [data, setData] = useState<ClassResponse | null>(null);
  /** When the server last confirmed the state on screen (fresh data, or "nothing has changed"). */
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [problem, setProblem] = useState<{ message: string; at: Date; fatal: boolean } | null>(null);
  const [viewKey, setViewKey] = useState('standard');
  const [refreshToken, setRefreshToken] = useState(0);
  const etag = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (classCode === null) return;
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      if (inFlight.current) return; // a slow answer must not pile up behind the timer
      inFlight.current = true;
      try {
        const result = await fetchClass(classCode, etag.current, fetchImpl);
        if (cancelled) return;
        if (result.status === 'ok') {
          etag.current = result.etag;
          setData(result.data);
          setLastUpdated(new Date());
          setProblem(null);
        } else if (result.status === 'unchanged') {
          setLastUpdated(new Date());
          setProblem(null);
        } else {
          // Keep whatever is on screen; say what went wrong and keep trying,
          // unless the site simply has no class server to ask. ("Refresh now"
          // still asks again, e.g. once the database has been attached.)
          const fatal = result.code === 'unavailable' || result.code === 'not_configured';
          setProblem({ message: result.message, at: new Date(), fatal });
          if (fatal) window.clearInterval(timer);
        }
      } finally {
        inFlight.current = false;
      }
    };

    timer = window.setInterval(() => void load(), pollMs);
    void load();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [classCode, fetchImpl, pollMs, refreshToken]);

  const model = useMemo(() => buildClassModel(data?.sessions ?? []), [data]);

  if (classCode === null) {
    return (
      <main className="page">
        <h1>Class view</h1>
        <p className="notice" role="alert" data-testid="class-invalid">
          “{code}” is not a class code. A class code is 1 to 20 letters and digits, with no spaces or symbols, for
          example NEURO451.
        </p>
        <p>
          <a href={INSTRUCTOR_PATH}>Set up a class view on the instructor page</a>
        </p>
      </main>
    );
  }

  const view = model.views.find((v) => v.key === viewKey) ?? model.views[0];
  const others = model.views.filter((v) => !v.standard);
  const hidden = view.series.reduce((n, s) => n + Math.max(0, s.sessions.length - MAX_LINES_PER_SERIES), 0);

  const legend: LegendItem[] = [
    ...view.series.map((series) => ({
      key: 'line' as const,
      color: colorOf(series),
      label:
        series.sessions.length === 0
          ? `${series.label}: no submissions yet`
          : `${series.label}: bold line = mean of ${series.sessions.length}; band = ±1 SD; thin lines = one student each`,
    })),
  ];
  if (view.catchTrials.length > 0) {
    legend.push({ key: 'diamond', color: VIZ.catchTrial, label: 'Catch trial: rotation switched off for that one reach (dashed line)' });
  }

  return (
    <main className="page wide class-view">
      <header className="class-header">
        <div>
          <p className="class-eyebrow">Class results</p>
          <h1 data-testid="class-code">{classCode}</h1>
        </div>
        <div className="class-status" aria-live="polite">
          <p data-testid="class-updated">
            {lastUpdated ? `Last updated ${clock(lastUpdated)}` : problem ? 'Not loaded yet' : 'Loading…'}
          </p>
          <p className="small muted">
            {problem?.fatal ? 'Not refreshing' : `Refreshes every ${Math.round(pollMs / 1000)} seconds`} ·{' '}
            <button type="button" className="link-button" onClick={() => setRefreshToken((n) => n + 1)}>
              Refresh now
            </button>
          </p>
        </div>
      </header>

      <p className="class-join">
        Students: finish the activity at <strong>{window.location.host}</strong>, then scroll to “Share your results
        with the class” at the bottom of your results and enter the code <strong>{classCode}</strong>.
      </p>

      {problem && (
        <p className="notice" role="alert" data-testid="class-problem">
          {problem.message}
          {!problem.fatal && lastUpdated && ` Still showing the data from ${clock(lastUpdated)}; trying again automatically.`}
        </p>
      )}

      {others.length > 0 && (
        <div className="class-view-select">
          <label className="field-label" htmlFor="class-view-select">
            Protocol shown
          </label>
          <select id="class-view-select" value={view.key} onChange={(e) => setViewKey(e.target.value)}>
            {model.views.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label} ({v.sessionCount})
              </option>
            ))}
          </select>
          <p className="small muted">
            This class also has submissions from {others.length === 1 ? 'another protocol' : 'other protocols'}. Sessions
            from different protocols are never pooled: each has its own view.
          </p>
        </div>
      )}

      <section className="card viz-card">
        <h2>Initial direction error on every trial</h2>
        <p className="viz-intro">
          The direction each hand set off in, measured a quarter of the way to the target. <strong>0° is straight at
          the target</strong>; negative is clockwise. Every thin line is one student.
        </p>
        <LegendRow items={legend} />
        <ClassChart view={view} />
        {view.sessionCount === 0 && (
          <p className="class-empty" data-testid="class-empty">
            {data ? 'Nobody has shared yet. Curves appear here as students share their results.' : problem ? '' : 'Loading…'}
          </p>
        )}
        {hidden > 0 && (
          <p className="viz-footnote">
            To keep the chart readable, {MAX_LINES_PER_SERIES} individual lines are drawn per version ({hidden} more are
            not drawn). The means, bands and summary use every submission.
          </p>
        )}
        <TrialMeansTable view={view} />
      </section>

      <SummaryPanel view={view} total={model.total} />

      <p className="small muted class-footer">
        Anonymous by design: students share a summary only if they choose to, with no name, account or device details,
        and the server keeps no record of who sent what. A line on this page cannot be traced to a student.
        {data?.truncated && ' This class holds more submissions than can be shown; the earliest by id are displayed.'}
      </p>
    </main>
  );
}
