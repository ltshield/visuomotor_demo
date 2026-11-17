/**
 * App.tsx — top-level flow: Welcome → Practice/Experiment → Reflection → Results,
 * plus two pages that are not part of the student flow: the instructor panel
 * (`/instructor`) and the class view (`/class/<CODE>`). See ui/route.ts.
 *
 * The app keeps a session in memory for the life of the tab: there is no
 * account and no storage between visits. Nothing leaves the browser unless a
 * student chooses, on the results page, to share an anonymous summary.
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
import { decodeSettings, readCustomCode, type TrialTier } from './core/custom';
import { QUICK_DEMO_45_V2, otherCanonicalPreset } from './core/presets';
import { buildSessionRecord, withReflection, type SessionRecord } from './core/record';
import { newSessionId, randomSeed, secureRandom } from './core/rng';
import { createSessionPlan, type SessionPlan } from './core/session';
import { getPointerInput } from './input/pointerLock';
import { ClassView } from './ui/class/ClassView';
import { Instructor } from './ui/Instructor';
import { Reflection } from './ui/Reflection';
import { ResultsPage } from './ui/results/ResultsPage';
import { useRoute } from './ui/route';
import { getSoundCues } from './ui/sound';
import { TaskScreen } from './ui/TaskScreen';
import { Welcome } from './ui/Welcome';

type Screen =
  | { name: 'welcome' }
  | { name: 'task'; plan: SessionPlan; skipPractice: boolean }
  | { name: 'reflection'; session: SessionRecord }
  | { name: 'results'; session: SessionRecord };

/**
 * How long the link's session is, so the start page can give an honest time
 * estimate. This is the one thing about a link the start page reflects; it
 * says nothing about what the session contains.
 */
function tierOfLink(linkCode: string | null, customCode: string | null): TrialTier {
  const custom = customCode !== null ? decodeSettings(customCode) : null;
  if (custom) return custom.tier;
  return linkCode !== null && LINK_CODES[linkCode] === QUICK_DEMO_45_V2.id ? 'quick' : 'standard';
}

export function App() {
  const route = useRoute();
  const [screen, setScreen] = useState<Screen>({ name: 'welcome' });
  /** Presets completed since the page was opened (used to flag possible carry-over). */
  const [completedPresetIds, setCompletedPresetIds] = useState<string[]>([]);

  const linkCode = readLinkCode(window.location.search);
  const customCode = readCustomCode(window.location.search);
  // The demo badge belongs to the shipped Quick Demo link only; a valid custom link takes precedence over `c`.
  const quickDemo =
    linkCode !== null &&
    LINK_CODES[linkCode] === QUICK_DEMO_45_V2.id &&
    (customCode === null || decodeSettings(customCode) === null);

  // Each screen starts at the top of the page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen.name]);

  /** Must be called directly from a click handler: pointer lock and audio both need the user gesture. */
  const startSession = (assignment: Assignment, skipPractice: boolean) => {
    getPointerInput().request();
    getSoundCues().unlock();
    const plan = createSessionPlan({
      assignment,
      seed: readSeedOverride(window.location.search) ?? randomSeed(),
      sessionId: newSessionId(),
      previousPresetIds: completedPresetIds,
      now: new Date(),
    });
    setScreen({ name: 'task', plan, skipPractice });
  };

  // Neither of the two non-student pages is ever shown over a running task.
  if (route.name === 'instructor' && screen.name !== 'task') return <Instructor />;
  if (route.name === 'class' && screen.name !== 'task') return <ClassView code={route.code} />;

  switch (screen.name) {
    case 'welcome':
      return (
        <Welcome
          quickDemo={quickDemo}
          tier={tierOfLink(linkCode, customCode)}
          onStart={() => startSession(assignPreset(linkCode, secureRandom, customCode), false)}
        />
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
