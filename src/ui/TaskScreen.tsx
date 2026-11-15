/**
 * TaskScreen.tsx — the practice + experiment workspace.
 *
 * This component is glue. All task rules live in `core/engine.ts`; here we
 *   1. feed the engine mouse deltas (via Pointer Lock) and frame ticks,
 *   2. draw what the engine's neutral `EngineView` describes, and
 *   3. show recovery instructions when the mouse is released.
 *
 * RENDERING. The cursor moves every frame, so it is drawn by writing SVG
 * attributes directly from a requestAnimationFrame loop rather than through
 * React state. React only re-renders for rare events (a new instruction, a
 * pause, a stage change).
 *
 * The SVG uses a y-flipped group (`scale(1,-1)`), so every coordinate inside
 * it is in the core's y-up workspace units and no other code converts axes.
 *
 * CONCEALMENT. Nothing here reads a trial's phase, rotation or catch flag.
 * The screen shows a target, a dot and a plain progress bar — nothing else.
 *
 * Key export: `TaskScreen`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { TrialEngine, type EngineConfig, type EngineTrial, type EngineView } from '../core/engine';
import { targetPosition, type Vec2 } from '../core/geometry';
import { buildPracticeTrials } from '../core/practice';
import type { PresetConfig } from '../core/presets';
import type { TrialSpec } from '../core/schedule';
import type { TaskResult } from '../core/session';
import { getPointerInput, toWorkspaceDelta } from '../input/pointerLock';

type Stage = 'practice' | 'ready' | 'experiment';
type LockState = 'pending' | 'locked' | 'unlocked';

/** On-screen wording. Neutral by design: it never describes what will change or why. */
export const TASK_MESSAGES = {
  '': '',
  'center-first': 'Move the white dot into the ring at the center and hold it still.',
  'reach-first': 'A target lit up. Slice the dot straight through it in one quick movement. Don’t stop on it.',
  center: 'Bring the dot back to the center ring.',
  reach: 'Slice through the lit target.',
  'hidden-intro':
    'Next, the dot will disappear while you reach. That is expected: reach through the target anyway. The dot comes back afterwards.',
  'hidden-reach': 'The dot is hidden. Reach through the lit target anyway.',
  timeout: 'Time ran out on that reach. Move all the way through the lit target in one quick movement.',
} as const;
type MessageKey = keyof typeof TASK_MESSAGES;

/** The engine operations this screen uses, common to the practice and experiment engines. */
type RunningEngine = Pick<TrialEngine, 'handleMove' | 'tick' | 'interrupt' | 'resume' | 'getView'>;

/** Where the dot first appears, away from the centre so the first action is to bring it in. */
const INITIAL_CURSOR: Vec2 = { x: -96, y: -72 };

/** How long to wait for the browser to grant the lock before offering a manual button (ms). */
const LOCK_GRACE_MS = 400;

interface TaskScreenProps {
  preset: PresetConfig;
  schedule: readonly TrialSpec[];
  /** Skip the warm-up (used when the participant runs a second condition in the same visit). */
  skipPractice?: boolean;
  onComplete: (result: TaskResult) => void;
  onQuit: () => void;
}

export function TaskScreen({ preset, schedule, skipPractice = false, onComplete, onQuit }: TaskScreenProps) {
  const input = getPointerInput();
  const g = preset.geometry;
  const practiceTrials = useMemo(
    () => buildPracticeTrials(preset.structure.targetAnglesDeg),
    [preset.structure.targetAnglesDeg],
  );

  const [stage, setStage] = useState<Stage>(skipPractice ? 'ready' : 'practice');
  const [lockState, setLockState] = useState<LockState>(() => (input.isLocked() ? 'locked' : 'pending'));
  const [everLocked, setEverLocked] = useState(() => input.isLocked());
  const [lockError, setLockError] = useState<string | null>(null);
  const [messageKey, setMessageKey] = useState<MessageKey>('');
  const [practiceDone, setPracticeDone] = useState(0);
  /** True while the engine is paused (mouse released, or the window lost focus). */
  const [enginePaused, setEnginePaused] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cursorRef = useRef<SVGCircleElement>(null);
  const startRef = useRef<SVGCircleElement>(null);
  const targetRefs = useRef<Array<SVGCircleElement | null>>([]);
  const progressRef = useRef<HTMLDivElement>(null);

  // Keep the latest callback without restarting the task loop when the parent re-renders.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const config: EngineConfig = { geometry: preset.geometry, timing: preset.timing, criteria: preset.criteria };
    const gain = preset.geometry.inputGain;
    const taskStartedMs = performance.now();

    let stageNow: Stage = skipPractice ? 'ready' : 'practice';
    let practiceEngine: TrialEngine<EngineTrial> | null = skipPractice
      ? null
      : new TrialEngine(practiceTrials, { ...config, repeatOnTimeout: true }, {
          startTimeMs: taskStartedMs,
          initialCursor: INITIAL_CURSOR,
        });
    let experimentEngine: TrialEngine<TrialSpec> | null = null;
    let active: RunningEngine | null = practiceEngine;

    let lastCursor: Vec2 = INITIAL_CURSOR;
    let practiceEndedMs: number | null = null;
    let experimentStartedMs = 0;
    // Input counters at the start of the recorded part (the input object outlives this screen).
    let eventsAtStart = 0;
    let samplesAtStart = 0;
    let practiceAttempts = 0;
    let completed = false;
    let disposed = false;
    let raf = 0;

    // --- drawing state, to avoid redundant DOM writes ---
    let shownMessage: MessageKey = '';
    let shownTarget: number | null = null;
    let shownPhase = '';
    let shownProgress = -1;
    let shownPracticeDone = -1;
    let shownPaused = false;

    // --- display refresh estimate ---
    const frameGaps: number[] = [];
    let lastFrameMs = 0;

    const showMessage = (key: MessageKey) => {
      if (key === shownMessage) return;
      shownMessage = key;
      setMessageKey(key);
    };

    /** Which instruction fits the practice engine's current state. */
    const practiceMessage = (view: EngineView): MessageKey => {
      if (view.phase === 'feedback') return shownMessage; // leave the current line up during the pause
      if (view.notice === 'timeout' && view.phase !== 'reach') return 'timeout';
      const index = view.trialsCompleted;
      const hidden = practiceTrials[index]?.feedback === 'hidden';
      if (view.phase === 'reach') return hidden ? 'hidden-reach' : index === 0 ? 'reach-first' : 'reach';
      if (hidden) return 'hidden-intro';
      return index === 0 ? 'center-first' : 'center';
    };

    const draw = (view: EngineView) => {
      const cursorEl = cursorRef.current;
      if (cursorEl) {
        if (view.cursorVisible) {
          cursorEl.setAttribute('cx', view.cursor.x.toFixed(2));
          cursorEl.setAttribute('cy', view.cursor.y.toFixed(2));
          cursorEl.style.visibility = 'visible';
        } else {
          // Hidden means hidden: the position is not written to the page at all.
          cursorEl.style.visibility = 'hidden';
        }
      }
      if (view.activeTargetIndex !== shownTarget) {
        if (shownTarget !== null) targetRefs.current[shownTarget]?.classList.remove('is-active');
        if (view.activeTargetIndex !== null) targetRefs.current[view.activeTargetIndex]?.classList.add('is-active');
        shownTarget = view.activeTargetIndex;
      }
      if (view.phase !== shownPhase) {
        shownPhase = view.phase;
        // Engine phase only (acquire / hold / reach / …) — used for styling and automated browser tests.
        rootRef.current?.setAttribute('data-engine-phase', view.phase);
        startRef.current?.classList.toggle('is-holding', view.phase === 'hold');
      }
      if (stageNow === 'experiment' && view.trialsCompleted !== shownProgress) {
        shownProgress = view.trialsCompleted;
        if (progressRef.current) {
          progressRef.current.style.width = `${(100 * view.trialsCompleted) / Math.max(1, view.trialsTotal)}%`;
        }
      }
    };

    const beginExperiment = () => {
      const now = performance.now();
      experimentStartedMs = now;
      eventsAtStart = input.eventCount;
      samplesAtStart = input.sampleCount;
      experimentEngine = new TrialEngine<TrialSpec>(schedule, config, { startTimeMs: now, initialCursor: lastCursor });
      active = experimentEngine;
      stageNow = 'experiment';
      shownProgress = -1;
      setStage('experiment');
      showMessage('');
    };

    const finishExperiment = (now: number) => {
      if (completed || !experimentEngine) return;
      completed = true;
      const sorted = frameGaps.slice().sort((a, b) => a - b);
      const svgWidth = svgRef.current?.getBoundingClientRect().width ?? 0;
      const result: TaskResult = {
        records: experimentEngine.getRecords(),
        interruptions: experimentEngine.getInterruptions(),
        practice: {
          included: !skipPractice,
          reachesCompleted: skipPractice ? 0 : practiceTrials.length,
          attempts: practiceAttempts,
        },
        timing: { taskStartedMs, practiceEndedMs, experimentStartedMs, experimentEndedMs: now },
        environment: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          screen: { width: window.screen.width, height: window.screen.height },
          devicePixelRatio: window.devicePixelRatio,
          displayScale: svgWidth > 0 ? svgWidth / (2 * preset.geometry.boundsHalfExtent) : 1,
          moveEventSource: input.source,
          moveEvents: input.eventCount - eventsAtStart,
          moveSamples: input.sampleCount - samplesAtStart,
          frameIntervalMs: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null,
        },
      };
      input.release();
      onCompleteRef.current(result);
    };

    const frame = () => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      if (lastFrameMs > 0 && frameGaps.length < 900) frameGaps.push(now - lastFrameMs);
      lastFrameMs = now;

      if (!active) return;
      active.tick(now);
      const view = active.getView();
      lastCursor = view.cursor;
      draw(view);

      // Keep React informed of a pause so a recovery prompt is always on screen
      // while the engine is not running (see the overlays below).
      const pausedNow = view.phase === 'paused';
      if (pausedNow !== shownPaused) {
        shownPaused = pausedNow;
        setEnginePaused(pausedNow);
      }

      if (stageNow === 'practice') {
        showMessage(practiceMessage(view));
        if (view.trialsCompleted !== shownPracticeDone) {
          shownPracticeDone = view.trialsCompleted;
          setPracticeDone(view.trialsCompleted);
        }
        if (view.phase === 'finished') {
          practiceEndedMs = now;
          practiceAttempts = practiceEngine?.getRecords().length ?? 0;
          practiceEngine = null;
          active = null;
          stageNow = 'ready';
          setStage('ready');
          showMessage('');
        }
      } else if (stageNow === 'experiment') {
        // The only text ever shown during the recorded part is this recovery hint.
        showMessage(view.notice === 'timeout' && view.phase !== 'reach' ? 'timeout' : '');
        if (view.phase === 'finished') finishExperiment(now);
      }
    };

    input.setListener({
      onMove(movementX, movementY, tMs) {
        if (!active) return;
        const d = toWorkspaceDelta(movementX, movementY, gain);
        active.handleMove(d.dx, d.dy, tMs);
      },
      onLockChange(locked) {
        setLockState(locked ? 'locked' : 'unlocked');
        if (locked) {
          setEverLocked(true);
          setLockError(null);
          active?.resume(performance.now());
          shownPaused = false;
          setEnginePaused(false);
        }
      },
      onLockError(message) {
        setLockError(message);
        setLockState('unlocked');
      },
      onInterruption(reason, tMs) {
        // Pause rather than lose data: the engine saves any reach in progress and will repeat it.
        active?.interrupt(reason, tMs);
      },
      onButtonDown() {
        if (stageNow === 'ready') {
          beginExperiment();
        } else if (active && active.getView().phase === 'paused') {
          // Paused while the mouse is still captured (the window lost focus but
          // kept the lock). No on-screen button can be clicked in that state,
          // so any mouse click resumes.
          active.resume(performance.now());
        }
      },
    });

    // The lock was requested by the Start click and is usually granted within
    // a few milliseconds. Until it is, keep the engine paused so nothing runs
    // without input; if it has not arrived after a short grace period, show a
    // button so the participant can grant it with another click.
    if (input.isLocked()) {
      // Granted between the first render and this effect: bring React state up to date.
      setLockState('locked');
      setEverLocked(true);
    } else {
      active?.interrupt('pointer-lock-lost', taskStartedMs);
    }
    const graceTimer = window.setTimeout(() => {
      if (!input.isLocked()) setLockState('unlocked');
    }, LOCK_GRACE_MS);

    const blockContextMenu = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', blockContextMenu);

    raf = requestAnimationFrame(frame);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(graceTimer);
      document.removeEventListener('contextmenu', blockContextMenu);
      input.clearListener();
    };
  }, [input, preset, schedule, skipPractice, practiceTrials]);

  const half = g.boundsHalfExtent;
  const showLockPrompt = lockState === 'unlocked';
  const practiceTotal = practiceTrials.length;

  return (
    <div className="task" ref={rootRef} data-stage={stage}>
      <div className="task-top">
        {stage === 'experiment' ? (
          <div className="progress" role="progressbar" aria-label="Progress through the activity">
            <div className="progress-fill" ref={progressRef} />
          </div>
        ) : (
          <div className="task-label">
            {stage === 'practice'
              ? `Practice · reach ${Math.min(practiceDone + 1, practiceTotal)} of ${practiceTotal}`
              : 'Practice complete'}
          </div>
        )}
        <p className="task-message" aria-live="polite">
          {TASK_MESSAGES[messageKey]}
        </p>
      </div>

      <div className="task-stage">
        <svg
          ref={svgRef}
          className="workspace"
          viewBox={`${-half} ${-half} ${2 * half} ${2 * half}`}
          role="img"
          aria-label="Reaching workspace"
        >
          {/* Flip y once so everything inside uses the core's y-up coordinates. */}
          <g transform="scale(1,-1)">
            {preset.structure.targetAnglesDeg.map((angle, i) => {
              const p = targetPosition(angle, g.targetDistance);
              return (
                <circle
                  key={angle}
                  ref={(el) => {
                    targetRefs.current[i] = el;
                  }}
                  className="target"
                  data-angle={angle}
                  cx={p.x}
                  cy={p.y}
                  r={g.targetRadius}
                />
              );
            })}
            <circle ref={startRef} className="start-ring" cx={0} cy={0} r={g.startRadius} />
            <circle
              ref={cursorRef}
              className="cursor-dot"
              cx={INITIAL_CURSOR.x}
              cy={INITIAL_CURSOR.y}
              r={g.cursorRadius}
            />
          </g>
        </svg>

        {stage === 'ready' && !showLockPrompt && (
          <div className="task-overlay">
            <div className="task-card">
              <h2>{skipPractice ? 'Ready?' : 'Practice complete'}</h2>
              <p>
                The next part is recorded: a series of reaches lasting a few minutes. Keep slicing through each lit
                target as accurately as you can. The dot may behave differently or disappear at times; that is part of
                the activity, so just keep going.
              </p>
              <p className="task-card-action">Click the mouse button to begin.</p>
            </div>
          </div>
        )}

        {/* Paused while the mouse is still captured: no button can be clicked, so a plain click resumes. */}
        {lockState === 'locked' && enginePaused && (
          <div className="task-overlay">
            <div className="task-card">
              <h2>Paused</h2>
              <p>
                This window lost focus for a moment, so the activity paused. Nothing has been lost; a reach that was
                cut off will simply be repeated.
              </p>
              <p className="task-card-action">Click the mouse button to continue.</p>
            </div>
          </div>
        )}

        {showLockPrompt && (
          <div className="task-overlay">
            <div className="task-card">
              <h2>{everLocked ? 'Paused' : 'One more click'}</h2>
              {everLocked ? (
                <p>
                  Your mouse was released (Esc was pressed, or this window lost focus). Nothing has been lost. Click
                  Resume to continue; a reach that was cut off will simply be repeated.
                </p>
              ) : (
                <p>
                  This activity needs to capture your mouse so the dot can follow it. Click the button to continue. You
                  can press Esc at any time to get your normal pointer back.
                </p>
              )}
              {lockError && <p className="task-card-error">{lockError}</p>}
              <div className="task-card-buttons">
                <button type="button" className="button primary" onClick={() => input.request()}>
                  {everLocked ? 'Resume' : 'Capture mouse and continue'}
                </button>
                <button type="button" className="button quiet" onClick={onQuit}>
                  Quit to start page
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="task-bottom">Press Esc to pause</div>
    </div>
  );
}
