/**
 * class/model.ts — turns the anonymous sessions of one class into the numbers
 * the class view draws. Pure and DOM-free, so the aggregation is unit-tested
 * (model.test.ts) rather than trusted by eye.
 *
 * POOLING RULE. Sessions are grouped by EXACT preset id and never mixed:
 *   - the standard view shows the two canonical presets side by side;
 *   - any other preset in the class (a custom protocol, the Quick Demo) gets a
 *     view of its own.
 * Different rotation sizes, trial counts or feedback settings change the
 * outcome, so averaging across them would produce a curve that describes
 * nobody.
 *
 * STATISTICS. Everything here is descriptive: a mean and a sample standard
 * deviation over whoever chose to share. Nothing is tested or compared.
 *
 * Key exports: `buildClassModel`, `chartRows`, `meanSd`, and their types.
 */

import type { ClassSession, WirePhase } from '../../core/classWire';
import { GRADUAL_45_V2, SUDDEN_45_V2 } from '../../core/presets';

/** Most individual lines drawn per series; the mean and band always use every session. */
export const MAX_LINES_PER_SERIES = 60;

export interface MeanSd {
  /** Values that went into the mean. */
  n: number;
  mean: number | null;
  /** Sample standard deviation (n − 1); null with fewer than two values. */
  sd: number | null;
}

export function meanSd(values: readonly number[]): MeanSd {
  const n = values.length;
  if (n === 0) return { n: 0, mean: null, sd: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, sd: null };
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
  return { n, mean, sd: Math.sqrt(variance) };
}

/** One group of sessions that ran the same protocol, as one series on the chart. */
export interface ClassSeries {
  /** Stable key, also used to build chart column names. */
  key: string;
  presetId: string;
  /** Short name for the legend and direct label. */
  label: string;
  /** Position in the fixed colour order (0 = first series colour). */
  colorIndex: number;
  sessions: ClassSession[];
  /** One entry per trial (index 0 = trial 1): mean ± SD of the initial direction error across sessions. */
  perTrial: MeanSd[];
  /** Across sessions: each session's mean error over its valid catch trials. */
  catchError: MeanSd;
  /** Across sessions: the error on the first aftereffect reach. */
  firstAftereffect: MeanSd;
  /** Across sessions: each session's mean error over its valid baseline reaches. */
  baseline: MeanSd;
}

export interface ClassBand {
  phase: WirePhase;
  label: string;
  firstTrial: number;
  lastTrial: number;
}

/** A selectable view: a set of series that share one protocol structure and may be drawn together. */
export interface ClassViewModel {
  key: string;
  label: string;
  /** True for the standard sudden-versus-gradual view. */
  standard: boolean;
  series: ClassSeries[];
  /** Number of trials on the x axis. */
  trialCount: number;
  /** 1-based trial numbers of the catch trials. */
  catchTrials: number[];
  bands: ClassBand[];
  /** Sessions in this view. */
  sessionCount: number;
}

export interface ClassModel {
  /** All sessions returned for the class, across every protocol. */
  total: number;
  /** The standard view first (always present, possibly empty), then one view per other protocol. */
  views: ClassViewModel[];
}

const PHASE_LABELS: Record<WirePhase, string> = {
  baseline: 'Baseline',
  adaptation: 'Rotation block',
  aftereffect: 'Aftereffect block',
};

const validErrors = (session: ClassSession, keep: (t: ClassSession['trials'][number]) => boolean): number[] =>
  session.trials.filter((t) => keep(t) && t.valid && t.err !== null).map((t) => t.err as number);

const meanOf = (values: number[]): number | null => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null);

function buildSeries(key: string, presetId: string, label: string, colorIndex: number, sessions: ClassSession[], trialCount: number): ClassSeries {
  const perTrial: MeanSd[] = [];
  for (let i = 0; i < trialCount; i++) {
    const values: number[] = [];
    for (const s of sessions) {
      const t = s.trials.find((x) => x.i === i);
      if (t && t.valid && t.err !== null) values.push(t.err);
    }
    perTrial.push(meanSd(values));
  }

  // One value per session, so a session with two catch trials does not count twice.
  const perSession = (pick: (s: ClassSession) => number | null) =>
    meanSd(sessions.map(pick).filter((v): v is number => v !== null));

  return {
    key,
    presetId,
    label,
    colorIndex,
    sessions,
    perTrial,
    catchError: perSession((s) => meanOf(validErrors(s, (t) => t.catch))),
    firstAftereffect: perSession((s) => {
      const first = s.trials.find((t) => t.phase === 'aftereffect');
      return first && first.valid && first.err !== null ? first.err : null;
    }),
    baseline: perSession((s) => meanOf(validErrors(s, (t) => t.phase === 'baseline'))),
  };
}

/** The layout of a protocol (blocks and catch positions), read from one of its sessions. */
function layoutOf(sessions: ClassSession[]): { trialCount: number; catchTrials: number[]; bands: ClassBand[] } {
  const trialCount = sessions.reduce((max, s) => Math.max(max, ...s.trials.map((t) => t.i + 1)), 0);
  // The longest session is the best witness of the protocol's layout.
  const reference = sessions.slice().sort((a, b) => b.trials.length - a.trials.length)[0];
  if (!reference) return { trialCount: 0, catchTrials: [], bands: [] };
  const bands: ClassBand[] = [];
  for (const phase of ['baseline', 'adaptation', 'aftereffect'] as const) {
    const numbers = reference.trials.filter((t) => t.phase === phase).map((t) => t.i + 1);
    if (numbers.length > 0) {
      bands.push({ phase, label: PHASE_LABELS[phase], firstTrial: Math.min(...numbers), lastTrial: Math.max(...numbers) });
    }
  }
  return { trialCount, catchTrials: reference.trials.filter((t) => t.catch).map((t) => t.i + 1), bands };
}

/** Group a class's sessions into views. Pure. */
export function buildClassModel(sessions: readonly ClassSession[]): ClassModel {
  const byPreset = new Map<string, ClassSession[]>();
  for (const s of sessions) {
    const list = byPreset.get(s.presetId) ?? [];
    list.push(s);
    byPreset.set(s.presetId, list);
  }

  const sudden = byPreset.get(SUDDEN_45_V2.id) ?? [];
  const gradual = byPreset.get(GRADUAL_45_V2.id) ?? [];
  const standardLayout = layoutOf([...sudden, ...gradual]);
  // With nobody in yet, still draw the standard 40-trial frame so the projector shows an empty chart, not nothing.
  const standardTrials = standardLayout.trialCount || 40;
  const standard: ClassViewModel = {
    key: 'standard',
    label: 'Standard versions: sudden and gradual',
    standard: true,
    series: [
      buildSeries('sudden', SUDDEN_45_V2.id, 'Sudden 45°', 0, sudden, standardTrials),
      buildSeries('gradual', GRADUAL_45_V2.id, 'Gradual 0°→45°', 1, gradual, standardTrials),
    ],
    trialCount: standardTrials,
    catchTrials: standardLayout.trialCount > 0 ? standardLayout.catchTrials : [20, 28],
    bands:
      standardLayout.bands.length > 0
        ? standardLayout.bands
        : [
            { phase: 'baseline', label: PHASE_LABELS.baseline, firstTrial: 1, lastTrial: 8 },
            { phase: 'adaptation', label: PHASE_LABELS.adaptation, firstTrial: 9, lastTrial: 32 },
            { phase: 'aftereffect', label: PHASE_LABELS.aftereffect, firstTrial: 33, lastTrial: 40 },
          ],
    sessionCount: sudden.length + gradual.length,
  };

  const others: ClassViewModel[] = [...byPreset.entries()]
    .filter(([presetId]) => presetId !== SUDDEN_45_V2.id && presetId !== GRADUAL_45_V2.id)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([presetId, list]) => {
      const layout = layoutOf(list);
      return {
        key: presetId,
        label: presetId,
        standard: false,
        // Always the first series colour: there is only one series in such a view.
        series: [buildSeries('only', presetId, presetId, 0, list, layout.trialCount)],
        trialCount: layout.trialCount,
        catchTrials: layout.catchTrials,
        bands: layout.bands,
        sessionCount: list.length,
      };
    });

  return { total: sessions.length, views: [standard, ...others] };
}

/**
 * Rows for the chart, one per trial. Column names:
 *   <series>_mean          the mean
 *   <series>_band          [mean − SD, mean + SD], or null with fewer than two values
 *   <series>_n             how many sessions contributed
 *   <series>_<k>           the k-th individual session's value (first MAX_LINES_PER_SERIES only)
 */
export function chartRows(view: ClassViewModel): Array<Record<string, number | number[] | null>> {
  const rows: Array<Record<string, number | number[] | null>> = [];
  for (let i = 0; i < view.trialCount; i++) {
    const row: Record<string, number | number[] | null> = { trial: i + 1 };
    for (const series of view.series) {
      const stats = series.perTrial[i];
      row[`${series.key}_mean`] = stats.mean;
      row[`${series.key}_n`] = stats.n;
      row[`${series.key}_band`] =
        stats.mean !== null && stats.sd !== null ? [stats.mean - stats.sd, stats.mean + stats.sd] : null;
      series.sessions.slice(0, MAX_LINES_PER_SERIES).forEach((session, k) => {
        const t = session.trials.find((x) => x.i === i);
        row[`${series.key}_${k}`] = t && t.valid && t.err !== null ? t.err : null;
      });
    }
    rows.push(row);
  }
  return rows;
}

/** Which block a trial number falls in, for tooltips. */
export function bandOfTrial(view: ClassViewModel, trial: number): ClassBand | undefined {
  return view.bands.find((b) => trial >= b.firstTrial && trial <= b.lastTrial);
}
