/**
 * App.tsx — top-level flow: Welcome → Practice/Experiment → Reflection → Results,
 * plus the small instructor page at `#/instructors`.
 *
 * The app keeps everything in memory for the life of the tab: there is no
 * account, no server and no storage between visits.
 */
import { useEffect, useState } from 'react';
import {
  LINK_CODES,
  assignOtherCondition,
  assignPreset,
  readLinkCode,
  readSeedOverride,
  type Assignment,
} from './core/assignment';
import { QUICK_DEMO_45_V1 } from './core/presets';
import { newSessionId, randomSeed, secureRandom } from './core/rng';
import { createSessionPlan, type ReflectionAnswers, type SessionPlan, type TaskResult } from './core/session';
import { getPointerInput } from './input/pointerLock';
import { Instructor } from './ui/Instructor';
import { Reflection } from './ui/Reflection';
import { TaskScreen } from './ui/TaskScreen';
import { Welcome } from './ui/Welcome';

type Screen =
  | { name: 'welcome' }
  | { name: 'task'; plan: SessionPlan; skipPractice: boolean }
  | { name: 'reflection'; plan: SessionPlan; result: TaskResult }
  | { name: 'results'; plan: SessionPlan; result: TaskResult; reflection: ReflectionAnswers };

/** True while the address ends in `#/instructors`. */
function useInstructorRoute(): boolean {
  const read = () => window.location.hash.replace(/^#\/?/, '') === 'instructors';
  const [active, setActive] = useState(read);
  useEffect(() => {
    const onChange = () => setActive(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return active;
}

export function App() {
  const instructorRoute = useInstructorRoute();
  const [screen, setScreen] = useState<Screen>({ name: 'welcome' });
  /** Presets completed since the page was opened (used to flag possible carry-over). */
  const [completedPresetIds, setCompletedPresetIds] = useState<string[]>([]);

  const linkCode = readLinkCode(window.location.search);
  const quickDemo = linkCode !== null && LINK_CODES[linkCode] === QUICK_DEMO_45_V1.id;

  /** Must be called directly from a click handler: pointer lock needs the user gesture. */
  const startSession = (assignment: Assignment, skipPractice: boolean) => {
    getPointerInput().request();
    const plan = createSessionPlan({
      assignment,
      seed: readSeedOverride(window.location.search) ?? randomSeed(),
      sessionId: newSessionId(),
      previousPresetIds: completedPresetIds,
      now: new Date(),
    });
    setScreen({ name: 'task', plan, skipPractice });
  };

  if (instructorRoute && screen.name !== 'task') return <Instructor />;

  switch (screen.name) {
    case 'welcome':
      return (
        <Welcome quickDemo={quickDemo} onStart={() => startSession(assignPreset(linkCode, secureRandom), false)} />
      );

    case 'task':
      return (
        <TaskScreen
          key={screen.plan.sessionId}
          preset={screen.plan.preset}
          schedule={screen.plan.schedule}
          skipPractice={screen.skipPractice}
          onComplete={(result) => {
            setCompletedPresetIds((ids) => [...ids, screen.plan.preset.id]);
            setScreen({ name: 'reflection', plan: screen.plan, result });
          }}
          onQuit={() => {
            getPointerInput().release();
            setScreen({ name: 'welcome' });
          }}
        />
      );

    case 'reflection':
      return (
        <Reflection
          onDone={(reflection) =>
            setScreen({ name: 'results', plan: screen.plan, result: screen.result, reflection })
          }
        />
      );

    case 'results': {
      // Placeholder reveal; the full results page arrives with milestone 3.
      const other = assignOtherCondition(screen.plan.preset.id);
      return (
        <main className="page">
          <h1>Your session</h1>
          <p className="lede">
            You completed <strong>{screen.plan.preset.label}</strong> ({screen.result.records.length} recorded
            attempts).
          </p>
          {other && (
            <button type="button" className="button" onClick={() => startSession(other, true)}>
              Try the other condition
            </button>
          )}
        </main>
      );
    }
  }
}
