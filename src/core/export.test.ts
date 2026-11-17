import { describe, expect, it } from 'vitest';
import { assignPreset } from './assignment';
import { TrialEngine } from './engine';
import {
  EVENTS_CSV_HEADER,
  TRIALS_CSV_HEADER,
  eventsToCsv,
  exportFileNames,
  sessionToJson,
  toPrettyJson,
  trialsToCsv,
} from './export';
import { buildSessionRecord, type SessionRecord } from './record';
import type { TrialSpec } from './schedule';
import { createSessionPlan } from './session';
import { EngineDriver, engineConfigFor, taskResultFrom } from './testUtils';

/** A gradual session containing one interrupted attempt (trial 12) and one timeout with no movement (trial 3). */
function buildSession(sessionId = 'export-test'): SessionRecord {
  const plan = createSessionPlan({
    assignment: assignPreset('p4x9', () => 0),
    seed: 99,
    sessionId,
    previousPresetIds: [],
    now: new Date('2026-11-14T15:30:00.000Z'),
  });
  const config = engineConfigFor(plan.preset);
  const engine = new TrialEngine<TrialSpec>(plan.schedule, config, { startTimeMs: 2000, initialCursor: { x: 40, y: -30 } });
  const driver = new EngineDriver(engine, config, 2000, plan.schedule);
  for (const spec of plan.schedule) {
    if (spec.trialNumber === 3) {
      driver.center();
      driver.wait(plan.preset.timing.reachTimeoutMs + 50);
      driver.finishFeedback();
    } else if (spec.trialNumber === 12) {
      driver.center();
      driver.move(60, 60, 80);
      engine.interrupt('window-blur', driver.t);
      driver.t += 800;
      engine.resume(driver.t);
      driver.trial(spec.targetAngleDeg - spec.rotationDeg);
    } else {
      // Aim so that the cursor goes to the target (hand compensates fully) and hold there.
      // Before trial 20 the hand drifts off the centre and has to come back, as a real one may.
      if (spec.trialNumber === 20) driver.move(25, 10, 40);
      driver.center();
      driver.reach(spec.targetAngleDeg - spec.rotationDeg);
      driver.settle();
      driver.finishFeedback();
    }
  }
  return buildSessionRecord(plan, taskResultFrom(engine, 2000, driver.t), {
    skipped: false,
    noticed: 'The dot, at times, went "sideways".',
    consciousAdjustment: 'somewhat',
    changedAim: null,
    device: 'mouse',
  });
}

const session = buildSession();

/** Minimal CSV reader for unquoted test data. */
function parseCsv(text: string): { header: string[]; rows: Array<Record<string, string>> } {
  const lines = text.trimEnd().split('\n');
  const header = lines[0].split(',');
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
  return { header, rows };
}

describe('session JSON', () => {
  const text = sessionToJson(session);
  const parsed = JSON.parse(text) as SessionRecord;

  it('is valid JSON containing the whole session', () => {
    expect(parsed.schemaVersion).toBe('2.2.0');
    expect(parsed.sessionId).toBe('export-test');
    expect(parsed.preset).toEqual(session.preset);
    expect(parsed.assignment).toEqual(session.assignment);
    expect(parsed.seed).toBe(99);
    expect(parsed.schedule).toEqual(session.schedule);
    expect(parsed.trials).toHaveLength(session.trials.length);
    expect(parsed.interruptions).toEqual(session.interruptions);
    expect(parsed.reflection).toEqual(session.reflection);
    expect(parsed.reflection!.consciousAdjustment).toBe('somewhat');
    expect(parsed.reflection!.changedAim).toBeNull(); // no longer asked; kept in the file as null
    expect(parsed.environment).toEqual(session.environment);
    expect(parsed.conventions).toEqual(session.conventions);
  });

  it('keeps scalar values (angles, metrics, timestamps) at full precision', () => {
    expect(parsed.schedule[9].rotationDeg).toBe(45 / 7);
    parsed.trials.forEach((t, i) => {
      expect(t.metrics).toEqual(session.trials[i].metrics);
      expect(t.times).toEqual(session.trials[i].times);
      expect(t.appliedRotationDeg).toBe(session.trials[i].appliedRotationDeg);
    });
    expect(parsed.summary).toEqual(session.summary);
  });

  it('keeps every sample, rounded to 0.001', () => {
    parsed.trials.forEach((t, i) => {
      const original = session.trials[i].samples;
      expect(t.samples.reach.tMs).toHaveLength(original.reach.tMs.length);
      expect(t.samples.preReach.x).toHaveLength(original.preReach.x.length);
      expect(t.samples.postReach.x).toEqual([]); // kept for compatibility, always empty
      for (let k = 0; k < original.reach.handX.length; k++) {
        expect(Math.abs(t.samples.reach.handX[k] - original.reach.handX[k])).toBeLessThanOrEqual(0.0005 + 1e-9);
        expect(Math.abs(t.samples.reach.tMs[k] - original.reach.tMs[k])).toBeLessThanOrEqual(0.0005 + 1e-9);
      }
      expect(t.samples.reach.cursorX === null).toBe(original.reach.cursorX === null);
    });
  });

  it('writes sample arrays on one line each, not one number per line', () => {
    expect(text).not.toMatch(/^\s*-?\d+(\.\d+)?,?\s*$/m);
    expect(text.split('\n').length).toBeLessThan(session.trials.length * 120);
  });

  it('writes missing values as null', () => {
    const timeout = parsed.trials.find((t) => t.outcome === 'timeout')!;
    expect(timeout.crossing).toBeNull();
    expect(timeout.metrics.hand).toBeNull();
    expect(timeout.invalidReason).toBe('timeout');
    const hidden = parsed.trials.find((t) => !t.cursorVisibleDuringReach)!;
    expect(hidden.samples.reach.cursorX).toBeNull();
  });
});

describe('toPrettyJson', () => {
  it('round-trips nested structures', () => {
    const value = { a: 1, b: 'x "quoted"', c: [1, 2, 3], d: [{ e: [true, null] }, { f: {} }], g: [], h: null };
    expect(JSON.parse(toPrettyJson(value))).toEqual(value);
  });

  it('drops undefined properties and writes non-finite numbers as null', () => {
    expect(JSON.parse(toPrettyJson({ a: undefined, b: NaN, c: [Infinity, 1] }))).toEqual({ b: null, c: [null, 1] });
  });

  it('rounds numbers inside plain arrays only', () => {
    const out = JSON.parse(toPrettyJson({ scalar: 1.23456789, list: [1.23456789, 2] }));
    expect(out.scalar).toBe(1.23456789);
    expect(out.list).toEqual([1.235, 2]);
  });
});

describe('trial-level CSV', () => {
  const { header, rows } = parseCsv(trialsToCsv(session));

  it('has the documented header and one row per attempt', () => {
    expect(header).toEqual(TRIALS_CSV_HEADER);
    expect(rows).toHaveLength(session.trials.length);
    expect(rows).toHaveLength(41);
  });

  it('carries the preset id, version and assignment on every row', () => {
    for (const row of rows) {
      expect(row.session_id).toBe('export-test');
      expect(row.preset_id).toBe('rotation-gradual-45-v3');
      expect(row.preset_version).toBe('3');
      expect(row.assignment_method).toBe('direct-link');
      expect(row.condition_concealed).toBe('true');
      expect(row.seed).toBe('99');
    }
  });

  it('matches the session record trial by trial', () => {
    rows.forEach((row, i) => {
      const t = session.trials[i];
      expect(Number(row.trial_number)).toBe(t.trialNumber);
      expect(Number(row.attempt)).toBe(t.attempt);
      expect(row.phase).toBe(t.phase);
      expect(row.is_catch).toBe(String(t.isCatch));
      expect(Number(row.target_angle_deg)).toBe(t.targetAngleDeg);
      expect(Number(row.applied_rotation_deg)).toBeCloseTo(t.appliedRotationDeg, 4);
      expect(row.feedback).toBe(t.feedback);
      expect(row.outcome).toBe(t.outcome);
      expect(row.hold_completed).toBe(String(t.holdCompleted));
      expect(row.valid).toBe(String(t.valid));
      if (t.metrics.hand) {
        expect(Number(row.hand_initial_direction_error_deg)).toBeCloseTo(t.metrics.hand.initialDirectionErrorDeg, 4);
        expect(Number(row.hand_path_length)).toBeCloseTo(t.metrics.hand.pathLength, 3);
      }
    });
  });

  it('shows the gradual ramp in the applied rotation column', () => {
    const perturbed = rows.filter((r) => r.phase === 'adaptation' && r.is_catch === 'false' && r.is_final_attempt === 'true');
    expect(perturbed.slice(0, 8).map((r) => Number(r.applied_rotation_deg))).toEqual([
      0, 6.4286, 12.8571, 19.2857, 25.7143, 32.1429, 38.5714, 45,
    ]);
  });

  it('reports arrival and the registered hold separately', () => {
    const completed = rows.filter((r) => r.outcome === 'completed');
    expect(completed.length).toBe(39); // 41 attempts: one timed out, one was interrupted
    for (const r of completed) {
      expect(r.hold_completed).toBe('true');
      expect(r.arrival_radius).toBe('222');
      // Registered one target hold (400 ms) or more after arriving.
      expect(Number(r.hold_completion_ms)).toBeGreaterThanOrEqual(Number(r.completion_ms) + 400 - 1e-3);
      // Movement time runs to arrival, not to the end of the hold.
      expect(Number(r.movement_duration_ms)).toBeCloseTo(Number(r.completion_ms) - Number(r.movement_onset_ms), 3);
    }
  });

  it('leaves metric cells empty for invalid attempts and names the reason', () => {
    const timeout = rows.find((r) => r.outcome === 'timeout')!;
    expect(timeout.trial_number).toBe('3');
    expect(timeout.hold_completed).toBe('false');
    expect(timeout.valid).toBe('false');
    expect(timeout.invalid_reason).toBe('timeout');
    expect(timeout.hand_initial_direction_error_deg).toBe('');
    expect(timeout.completion_ms).toBe('');
    expect(timeout.hold_completion_ms).toBe('');
    expect(timeout.crossing_hand_x).toBe('');
    expect(timeout.arrival_radius).toBe('');

    const interrupted = rows.find((r) => r.outcome === 'interrupted')!;
    expect(interrupted.trial_number).toBe('12');
    expect(interrupted.is_final_attempt).toBe('false');
    expect(interrupted.invalid_reason).toBe('interrupted');
    expect(interrupted.hand_path_length).toBe('');
  });

  it('leaves cursor cells empty when the cursor was hidden', () => {
    const hidden = rows.filter((r) => r.feedback === 'hidden' && r.valid === 'true');
    expect(hidden.length).toBeGreaterThan(10);
    for (const r of hidden) {
      expect(r.cursor_initial_direction_error_deg).toBe('');
      expect(r.crossing_cursor_x).toBe('');
      expect(r.hand_initial_direction_error_deg).not.toBe('');
    }
  });

  it('quotes text that contains commas or quotes', () => {
    const tricky = buildSession('id,with "quotes"');
    const firstDataLine = trialsToCsv(tricky).split('\n')[1];
    expect(firstDataLine.startsWith('"id,with ""quotes""",rotation-gradual-45-v3,')).toBe(true);
  });
});

describe('per-sample (event) CSV', () => {
  const { header, rows } = parseCsv(eventsToCsv(session));

  it('has the documented header and one row per recorded sample', () => {
    expect(header).toEqual(EVENTS_CSV_HEADER);
    const expected = session.trials.reduce(
      (n, t) => n + t.samples.preReach.tMs.length + t.samples.reach.tMs.length + t.samples.postReach.tMs.length,
      0,
    );
    expect(rows).toHaveLength(expected);
  });

  it('labels each sample with its segment; nothing is recorded after a reach', () => {
    expect(new Set(rows.map((r) => r.segment))).toEqual(new Set(['pre_reach', 'reach', 'settle']));
  });

  it('splits the reach phase at arrival: "reach" before it, "settle" from it', () => {
    for (const t of session.trials) {
      const mine = rows.filter((r) => r.trial_number === String(t.trialNumber) && r.attempt === String(t.attempt));
      const reach = mine.filter((r) => r.segment === 'reach');
      const settle = mine.filter((r) => r.segment === 'settle');
      expect(reach.length + settle.length).toBe(t.samples.reach.tMs.length);
      if (t.crossing) {
        expect(reach).toHaveLength(t.crossing.sampleIndex);
        // One running index across both segments.
        expect(Number(settle[0].sample_index)).toBe(t.crossing.sampleIndex);
        // Every "reach" sample is inside the arrival radius; the first "settle" sample is at or beyond it.
        for (const r of reach) expect(Math.hypot(Number(r.hand_x), Number(r.hand_y))).toBeLessThan(222);
        expect(Math.hypot(Number(settle[0].hand_x), Number(settle[0].hand_y))).toBeGreaterThanOrEqual(222 - 1e-3);
      } else {
        expect(settle).toHaveLength(0); // never arrived
      }
    }
  });

  it('reach rows reproduce the recorded hand path with target-aligned coordinates', () => {
    const t = session.trials.find((x) => x.trialNumber === 15 && x.isFinalAttempt)!;
    const allRows = rows.filter((r) => r.trial_number === '15' && r.segment !== 'pre_reach');
    const reachRows = allRows.filter((r) => r.segment === 'reach');
    expect(allRows).toHaveLength(t.samples.reach.tMs.length);
    allRows.forEach((r, i) => {
      expect(Number(r.sample_index)).toBe(i);
      expect(Number(r.hand_x)).toBeCloseTo(t.samples.reach.handX[i], 3);
      expect(Number(r.hand_y)).toBeCloseTo(t.samples.reach.handY[i], 3);
      expect(Number(r.cursor_x)).toBeCloseTo(t.samples.reach.cursorX![i], 3);
      expect(Number(r.t_from_go_ms)).toBeCloseTo(t.samples.reach.tMs[i] - t.times.goCueMs!, 3);
      expect(r.cursor_displayed).toBe('true');
    });
    // The hand compensated fully, so the cursor ran straight along the target axis.
    const last = reachRows[reachRows.length - 1];
    expect(Math.abs(Number(last.cursor_lateral))).toBeLessThan(0.01);
    expect(Number(last.hand_lateral)).toBeLessThan(-50); // hand well clockwise of the axis
    expect(Number(last.hand_progress)).toBeGreaterThan(0);
  });

  it('leaves cursor cells empty during hidden-cursor reaches but still records the hand', () => {
    const hiddenReach = rows.filter((r) => r.trial_number === '1' && r.segment === 'reach');
    expect(hiddenReach.length).toBeGreaterThan(10);
    for (const r of hiddenReach) {
      expect(r.cursor_x).toBe('');
      expect(r.cursor_y).toBe('');
      expect(r.cursor_displayed).toBe('false');
      expect(r.hand_x).not.toBe('');
    }
  });

  it('shows the cursor on the hand before the go cue (identity mapping)', () => {
    const pre = rows.filter((r) => r.segment === 'pre_reach');
    // Only two trials have any: the first (cursor brought to the centre) and trial 20 (drifted off it).
    expect(new Set(pre.map((r) => r.trial_number))).toEqual(new Set(['1', '20']));
    expect(pre.length).toBeGreaterThan(20);
    for (const r of pre) {
      expect(r.cursor_x).toBe(r.hand_x);
      expect(r.cursor_y).toBe(r.hand_y);
      expect(r.hand_progress).toBe(''); // aligned coordinates are for the reach only
    }
  });

  it('includes the samples of interrupted attempts', () => {
    const partial = rows.filter((r) => r.trial_number === '12' && r.attempt === '1' && r.segment === 'reach');
    expect(partial.length).toBeGreaterThan(5);
  });
});

describe('export file names', () => {
  it('include the preset id and the session time', () => {
    expect(exportFileNames(session)).toEqual({
      json: 'motor-learning_rotation-gradual-45-v3_20261114-1530_session.json',
      trialsCsv: 'motor-learning_rotation-gradual-45-v3_20261114-1530_trials.csv',
      eventsCsv: 'motor-learning_rotation-gradual-45-v3_20261114-1530_events.csv',
    });
  });
});
