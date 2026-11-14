/**
 * App.tsx — top-level screen switcher.
 *
 * Milestone 1 shell: a Start button, the task screen, and a plain summary of
 * what was recorded. Later milestones replace the start and summary screens.
 */
import { useMemo, useState } from 'react';
import { SUDDEN_45_V1 } from './core/presets';
import { randomSeed } from './core/rng';
import { generateSchedule } from './core/schedule';
import type { TaskResult } from './core/session';
import { getPointerInput } from './input/pointerLock';
import { TaskScreen } from './ui/TaskScreen';

export function App() {
  const [screen, setScreen] = useState<'start' | 'task' | 'done'>('start');
  const [result, setResult] = useState<TaskResult | null>(null);
  const schedule = useMemo(() => generateSchedule(SUDDEN_45_V1, randomSeed()), []);

  if (screen === 'task') {
    return (
      <TaskScreen
        preset={SUDDEN_45_V1}
        schedule={schedule}
        onComplete={(r) => {
          setResult(r);
          setScreen('done');
        }}
        onQuit={() => {
          getPointerInput().release();
          setScreen('start');
        }}
      />
    );
  }

  return (
    <main className="page">
      <h1>Reaching task (engine check)</h1>
      {screen === 'done' && result && (
        <p>
          Recorded {result.records.length} attempts, {result.interruptions.length} interruptions.
        </p>
      )}
      <button
        type="button"
        className="button primary large"
        onClick={() => {
          // Pointer lock must be requested inside the click handler itself.
          getPointerInput().request();
          setScreen('task');
        }}
      >
        Start
      </button>
    </main>
  );
}
