/**
 * Class view aggregation: grouping by protocol (never pooled), the per-trial
 * mean and SD, the per-student summaries, and the chart's columns.
 */
import { describe, expect, it } from 'vitest';
import type { ClassSession, WirePhase, WireTrial } from '../../core/classWire';
import { GRADUAL_45_V2, QUICK_DEMO_45_V2, SUDDEN_45_V2 } from '../../core/presets';
import { MAX_LINES_PER_SERIES, bandOfTrial, buildClassModel, chartRows, meanSd, valueOf } from './model';

/** The standard layout: 8 baseline, 24 rotated (catch at trials 20 and 28), 8 aftereffect. */
const PHASE_OF = (i: number): WirePhase => (i < 8 ? 'baseline' : i < 32 ? 'adaptation' : 'aftereffect');
const IS_CATCH = (i: number) => i === 19 || i === 27;

/**
 * A 40-reach session whose initial direction error on reach i is err(i)
 * (null = not analysed). Its path error is always twice that, so tests can
 * tell which measure a number came from.
 */
function session(presetId: string, err: (i: number) => number | null, trialCount = 40): ClassSession {
  const trials: WireTrial[] = Array.from({ length: trialCount }, (_, i) => {
    const value = err(i);
    return {
      i,
      phase: PHASE_OF(i),
      catch: IS_CATCH(i),
      rot: PHASE_OF(i) === 'adaptation' && !IS_CATCH(i) ? 45 : 0,
      err: value,
      pe: value === null ? null : value * 2,
      valid: value !== null,
    };
  });
  return { presetId, rotationDeg: 45, trialTier: 'standard', consciousAdjustment: null, trials };
}

const constant = (v: number) => () => v;

describe('meanSd', () => {
  it('handles no values, one value and several (sample SD)', () => {
    expect(meanSd([])).toEqual({ n: 0, mean: null, sd: null });
    expect(meanSd([4])).toEqual({ n: 1, mean: 4, sd: null });
    const s = meanSd([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.n).toBe(8);
    expect(s.mean).toBe(5);
    expect(s.sd).toBeCloseTo(Math.sqrt(32 / 7), 10);
  });
});

describe('buildClassModel', () => {
  it('draws the standard 40-reach frame even before anyone has shared', () => {
    const model = buildClassModel([]);
    expect(model.total).toBe(0);
    expect(model.views).toHaveLength(1);
    const [view] = model.views;
    expect(view.standard).toBe(true);
    expect(view.trialCount).toBe(40);
    expect(view.catchTrials).toEqual([20, 28]);
    expect(view.bands.map((b) => [b.phase, b.firstTrial, b.lastTrial])).toEqual([
      ['baseline', 1, 8],
      ['adaptation', 9, 32],
      ['aftereffect', 33, 40],
    ]);
    expect(view.series.map((s) => s.label)).toEqual(['Sudden 45°', 'Gradual 0°→45°']);
    expect(view.series.every((s) => s.perTrial.every((p) => p.mean === null))).toBe(true);
  });

  it('keeps sudden and gradual in separate series, and gives any other protocol its own view', () => {
    const model = buildClassModel([
      session(SUDDEN_45_V2.id, constant(-10)),
      session(GRADUAL_45_V2.id, constant(-20)),
      session(SUDDEN_45_V2.id, constant(-30)),
      session('rotation-sudden-30-custom-v2', constant(-99)),
    ]);
    expect(model.total).toBe(4);
    const [standard, custom] = model.views;
    expect(standard.sessionCount).toBe(3);
    const [sudden, gradual] = standard.series;
    expect(sudden.sessions).toHaveLength(2);
    expect(gradual.sessions).toHaveLength(1);
    // Never pooled: the custom protocol's −99 appears in no standard mean.
    expect(sudden.perTrial[0].mean).toBe(-20);
    expect(gradual.perTrial[0].mean).toBe(-20);
    expect(custom.standard).toBe(false);
    expect(custom.key).toBe('rotation-sudden-30-custom-v2');
    expect(custom.series).toHaveLength(1);
    expect(custom.series[0].perTrial[5].mean).toBe(-99);
  });

  it('averages each reach across students, leaving out reaches that could not be analysed', () => {
    const model = buildClassModel([
      session(SUDDEN_45_V2.id, (i) => (i === 3 ? null : 2)),
      session(SUDDEN_45_V2.id, constant(6)),
      session(SUDDEN_45_V2.id, constant(10)),
    ]);
    const sudden = model.views[0].series[0];
    expect(sudden.perTrial[0]).toEqual({ n: 3, mean: 6, sd: 4 });
    expect(sudden.perTrial[3]).toEqual({ n: 2, mean: 8, sd: Math.sqrt(8) });
  });

  it('summarises each student once: baseline mean, catch-trial mean and first aftereffect reach', () => {
    // Student A: baseline 0, catch trials −30 and −10 (mean −20), first aftereffect −12.
    const a = session(SUDDEN_45_V2.id, (i) => (i < 8 ? 0 : i === 19 ? -30 : i === 27 ? -10 : i === 32 ? -12 : -40));
    // Student B: baseline 4, one catch trial not analysed (only −6 counts), first aftereffect not analysed.
    const b = session(SUDDEN_45_V2.id, (i) => (i < 8 ? 4 : i === 19 ? null : i === 27 ? -6 : i === 32 ? null : -40));
    const sudden = buildClassModel([a, b]).views[0].series[0];
    expect(sudden.baseline).toEqual({ n: 2, mean: 2, sd: Math.sqrt(8) });
    expect(sudden.catchError.n).toBe(2);
    expect(sudden.catchError.mean).toBe(-13);
    expect(sudden.firstAftereffect).toEqual({ n: 1, mean: -12, sd: null });
  });

  it('reads the layout of another protocol from its own sessions', () => {
    const quick = session(QUICK_DEMO_45_V2.id, constant(1), 16);
    const view = buildClassModel([quick]).views[1];
    expect(view.trialCount).toBe(16);
    expect(view.bands.map((b) => b.phase)).toEqual(['baseline', 'adaptation']);
  });
});

describe('the measure shown', () => {
  it('uses the initial direction by default and the path error when asked, everywhere', () => {
    const sessions = [session(SUDDEN_45_V2.id, (i) => (i === 19 ? -10 : i === 32 ? -6 : 1))];
    const byDirection = buildClassModel(sessions).views[0];
    const byPath = buildClassModel(sessions, 'pe').views[0];
    expect(byDirection.metric).toBe('err');
    expect(byPath.metric).toBe('pe');
    expect(byDirection.series[0].perTrial[0].mean).toBe(1);
    expect(byPath.series[0].perTrial[0].mean).toBe(2);
    expect(byPath.series[0].firstAftereffect.mean).toBe(-12);
    expect(byPath.series[0].baseline.mean).toBe(2);
    expect(chartRows(byPath)[0].sudden_0).toBe(2);
  });

  it('treats a reach with no path error as missing, even when its direction is known', () => {
    const s = session(GRADUAL_45_V2.id, constant(4));
    s.trials[2] = { ...s.trials[2], pe: null };
    expect(valueOf(s.trials[2], 'pe')).toBeNull();
    expect(valueOf(s.trials[2], 'err')).toBe(4);
    expect(buildClassModel([s], 'pe').views[0].series[1].perTrial[2].n).toBe(0);
    // An invalid reach has no value in either measure.
    expect(valueOf({ ...s.trials[3], valid: false }, 'pe')).toBeNull();
  });
});

describe('chartRows', () => {
  it('has one row per reach with mean, ±1 SD band, n and one column per student', () => {
    const view = buildClassModel([session(SUDDEN_45_V2.id, constant(-10)), session(SUDDEN_45_V2.id, constant(-20))]).views[0];
    const rows = chartRows(view);
    expect(rows).toHaveLength(40);
    const first = rows[0];
    expect(first.trial).toBe(1);
    expect(first.sudden_mean).toBe(-15);
    expect(first.sudden_n).toBe(2);
    const band = first.sudden_band as number[];
    expect(band[0]).toBeCloseTo(-15 - Math.sqrt(50), 10);
    expect(band[1]).toBeCloseTo(-15 + Math.sqrt(50), 10);
    expect(first.sudden_0).toBe(-10);
    expect(first.sudden_1).toBe(-20);
    // An empty series has no band and no mean.
    expect(first.gradual_mean).toBeNull();
    expect(first.gradual_band).toBeNull();
  });

  it('gives no band with a single student, and gaps where a reach was not analysed', () => {
    const view = buildClassModel([session(GRADUAL_45_V2.id, (i) => (i === 4 ? null : 3))]).views[0];
    const rows = chartRows(view);
    expect(rows[0].gradual_band).toBeNull();
    expect(rows[4].gradual_0).toBeNull();
    expect(rows[4].gradual_mean).toBeNull();
  });

  it('draws at most MAX_LINES_PER_SERIES individual lines, while the mean uses everyone', () => {
    const many = Array.from({ length: MAX_LINES_PER_SERIES + 5 }, (_, k) => session(SUDDEN_45_V2.id, constant(k)));
    const view = buildClassModel(many).views[0];
    const row = chartRows(view)[0];
    expect(row[`sudden_${MAX_LINES_PER_SERIES - 1}`]).toBe(MAX_LINES_PER_SERIES - 1);
    expect(row[`sudden_${MAX_LINES_PER_SERIES}`]).toBeUndefined();
    expect(row.sudden_n).toBe(MAX_LINES_PER_SERIES + 5);
    expect(row.sudden_mean).toBe((MAX_LINES_PER_SERIES + 4) / 2);
  });
});

describe('bandOfTrial', () => {
  it('finds the block of a trial number', () => {
    const view = buildClassModel([]).views[0];
    expect(bandOfTrial(view, 1)?.phase).toBe('baseline');
    expect(bandOfTrial(view, 20)?.phase).toBe('adaptation');
    expect(bandOfTrial(view, 40)?.phase).toBe('aftereffect');
    expect(bandOfTrial(view, 41)).toBeUndefined();
  });
});
