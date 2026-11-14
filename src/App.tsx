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
import { QUICK_DEMO_45_V1, otherCanonicalPreset } from './core/presets';
import { buildSessionRecord, withReflection, type SessionRecord } from './core/record';
import { newSessionId, randomSeed, secureRandom } from './core/rng';
import { createSessionPlan, type SessionPlan } from './core/session';
import { getPointerInput } from './input/pointerLock';
import { Instructor } from './ui/Instructor';
import { Reflection } from './ui/Reflection';
import { ResultsPage } from './ui/results/ResultsPage';
import { TaskScreen } from './ui/TaskScreen';
import { Welcome } from './ui/Welcome';

type Screen =
  | { name: 'welcome' }
  | { name: 'task'; plan: SessionPlan; skipPractice: boolean }
  | { name: 'reflection'; session: SessionRecord }
  | { name: 'results'; session: SessionRecord };

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

  // Each screen starts at the top of the page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen.name]);

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
            setScreen({ name: 'reflection', session: buildSessionRecord(screen.plan, result, null) });
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
          onDone={(reflection) => setScreen({ name: 'results', session: withReflection(screen.session, reflection) })}
        />
      );

    case 'results': {
      const other = otherCanonicalPreset(screen.session.preset.id);
      return (
        <ResultsPage
          key={screen.session.sessionId}
          session={screen.session}
          otherVersionLabel={other ? other.label : null}
          onTryOther={() => {
            const assignment = assignOtherCondition(screen.session.preset.id);
            if (assignment) startSession(assignment, true);
          }}
        />
      );
    }
  }
}
