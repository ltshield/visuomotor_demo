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
import { PointerLockInput } from '../input/pointerLock';

/** Smallest window in which the workspace is comfortably usable (CSS px). */
const MIN_WIDTH = 720;
const MIN_HEIGHT = 520;

interface EnvironmentCheck {
  pointerLockSupported: boolean;
  /** No precise pointing device at all: a phone or tablet. */
  touchOnly: boolean;
  windowTooSmall: boolean;
}

function checkEnvironment(): EnvironmentCheck {
  const query = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  return {
    pointerLockSupported: PointerLockInput.isSupported(),
    touchOnly: query('(pointer: coarse)') && !query('(any-pointer: fine)'),
    windowTooSmall: window.innerWidth < MIN_WIDTH || window.innerHeight < MIN_HEIGHT,
  };
}

interface WelcomeProps {
  /** True when the page was opened through the Quick Demo link. */
  quickDemo: boolean;
  onStart: () => void;
}

export function Welcome({ quickDemo, onStart }: WelcomeProps) {
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
        of your own movements. It takes about {quickDemo ? '3 to 5' : '5 to 10'} minutes in total.
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
          <li>A white dot replaces your normal pointer. You move it from a ring in the center out through targets.</li>
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
          afterwards. Nothing is uploaded or shared, and no name or account is needed. You can download your own data
          at the end.
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
        <a href="#/instructors">For instructors</a>
      </p>
    </main>
  );
}
