/**
 * Welcome.tsx — the single screen a participant sees before starting.
 *
 * CONCEALMENT: this text must stay neutral. It may say that feedback can
 * change or disappear, but never what changes, by how much, which version the
 * participant has, or how the session is structured. `concealment.test.tsx`
 * fails if revealing words appear here.
 *
 * Key export: `Welcome`.
 */

import { useEffect, useState } from 'react';
import type { TrialTier } from '../core/custom';
import { PointerLockInput } from '../input/pointerLock';
import { INSTRUCTOR_PATH } from './route';

/** Smallest window in which the workspace is comfortably usable (CSS px). */
const MIN_WIDTH = 720;
const MIN_HEIGHT = 520;

interface EnvironmentCheck {
  pointerLockSupported: boolean;
  /** No precise pointing device at all: a phone or tablet. */
  touchOnly: boolean;
  windowTooSmall: boolean;
  /** The page is shown inside another page (e.g. embedded in a course site), where mouse capture is often blocked. */
  framed: boolean;
}

function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // reading window.top can be refused across sites, which itself means "framed"
  }
}

function checkEnvironment(): EnvironmentCheck {
  const query = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  return {
    pointerLockSupported: PointerLockInput.isSupported(),
    touchOnly: query('(pointer: coarse)') && !query('(any-pointer: fine)'),
    windowTooSmall: window.innerWidth < MIN_WIDTH || window.innerHeight < MIN_HEIGHT,
    framed: isFramed(),
  };
}

/** Honest total-time ranges for each session length, including practice and reading the results. */
const MINUTES: Record<TrialTier, string> = { quick: '3 to 5', standard: '5 to 10', extended: '8 to 12' };

interface WelcomeProps {
  /** True when the page was opened through the Quick Demo link. */
  quickDemo: boolean;
  /** Length of the session this link runs; only the time estimate depends on it. */
  tier?: TrialTier;
  onStart: () => void;
}

export function Welcome({ quickDemo, tier = quickDemo ? 'quick' : 'standard', onStart }: WelcomeProps) {
  const [env, setEnv] = useState<EnvironmentCheck>(checkEnvironment);

  useEffect(() => {
    const update = () => setEnv(checkEnvironment());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const blocked = !env.pointerLockSupported || env.touchOnly;

  return (
    <main className="page">
      <h1>Motor Learning Lab</h1>
      {quickDemo && (
        <p className="badge" data-testid="quick-demo-badge">
          Quick Demo: a shortened version of the activity
        </p>
      )}
      <p className="lede">
        A short reaching activity. You will make quick movements to targets with your mouse, then explore a recording
        of your own movements. It takes about {MINUTES[tier]} minutes in total.
      </p>

      <section className="card">
        <h2>You will need</h2>
        <ul className="plain-list">
          <li>
            A desktop or laptop computer with a <strong>physical mouse</strong>. A trackpad makes the task much harder,
            and phones and tablets will not work.
          </li>
          <li>A recent version of Chrome or Edge.</li>
          <li>A few minutes without interruptions.</li>
        </ul>

        <h2>What to expect</h2>
        <ul className="plain-list">
          <li>
            A white dot replaces your normal pointer. You move it from a ring in the center out to a target and hold
            it there; it then jumps back to the center for the next one.
          </li>
          <li>
            Make each reach <strong>one quick, smooth movement</strong>, like a flick of the wrist, rather than a slow,
            careful one. You will see “Too slow” after a reach that took too long; just go a little quicker on the
            next one.
          </li>
          <li>
            At times the dot may behave differently, or disappear while you move. That is part of the activity, not a
            malfunction. Just keep going.
          </li>
          <li>
            The page captures your mouse while the activity runs. Press <kbd>Esc</kbd> at any time to get your normal
            pointer back.
          </li>
        </ul>

        <h2>Your data</h2>
        <p>
          Your mouse movements are recorded <strong>only in this browser tab</strong>, so that you can look at them
          afterwards. Nothing is uploaded unless you choose to: at the end you may add an anonymous summary to your
          class’s results if your instructor has asked for one. No name or account is needed, and you can download
          your own data at the end.
        </p>
      </section>

      {!env.pointerLockSupported && (
        <p className="notice" role="alert">
          This browser cannot capture the mouse, which the activity requires. Please open this page in a recent desktop
          version of Chrome or Edge.
        </p>
      )}
      {env.pointerLockSupported && env.touchOnly && (
        <p className="notice" role="alert">
          This looks like a touch-only device. The activity needs a mouse, so please open this page on a desktop or
          laptop computer.
        </p>
      )}
      {!blocked && env.framed && (
        <p className="notice" data-testid="framed-notice">
          This page is being shown inside another page. Capturing the mouse is often blocked there, so{' '}
          <a href={window.location.href} target="_blank" rel="noopener noreferrer">
            open the activity in its own tab
          </a>{' '}
          before you start.
        </p>
      )}
      {!blocked && env.windowTooSmall && (
        <p className="notice">
          This window is quite small. For the best experience, make the browser window larger (or maximize it) before
          you start.
        </p>
      )}

      <div className="button-row">
        <button type="button" className="button primary large" onClick={onStart} disabled={blocked}>
          Start
        </button>
        <span className="muted small">Starts with a short practice.</span>
      </div>

      <p className="footer-links">
        <a href={INSTRUCTOR_PATH}>For instructors</a>
      </p>
    </main>
  );
}
