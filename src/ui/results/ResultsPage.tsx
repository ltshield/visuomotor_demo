/**
 * ResultsPage.tsx — the reveal and the participant's own results.
 *
 * Order of the page: what version you had → your catch trial, the headline
 * finding → what the software did and what you did, trial by trial → your
 * numbers → your movement paths → any single reach → what it means → download
 * your data.
 *
 * The page reads ONLY the SessionRecord (the same object the JSON download
 * contains) and shows ONLY this participant's data: no class averages, no
 * population curves, no significance claims.
 *
 * One control scopes every movement chart on the page: whether to show the
 * hand (mouse) path or the cursor as it was displayed.
 *
 * Key export: `ResultsPage`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { eventsToCsv, exportFileNames, sessionToJson, trialsToCsv } from '../../core/export';
import { arrivalRadius } from '../../core/presets';
import { finalAttempts, type SessionRecord } from '../../core/record';
import { downloadText } from '../download';
import { describePerturbation } from '../presetText';
import { CatchCallout } from './CatchCallout';
import { CatchComparisonCharts } from './CatchComparisonCharts';
import { ChartCard } from './chartTheme';
import { Debrief } from './Debrief';
import { METRIC_INFO } from './InfoNote';
import {
  catchCallout,
  catchComparisons,
  formatDuration,
  pathPanels,
  phaseBands,
  trialPoints,
  type PathKind,
} from './model';
import { PathPanels } from './PathPanels';
import { SummaryTable, TrialTable } from './Tables';
import { DirectionErrorChart, RotationTimeline } from './TrialCharts';
import { TrialInspector } from './TrialInspector';

const ASSIGNMENT_TEXT: Record<SessionRecord['assignment']['method'], string> = {
  'random-50-50': 'It was chosen at random (a 50/50 coin flip) when you pressed Start.',
  'direct-link': 'It was set by the link you opened.',
  'participant-chose-other-condition': 'You chose it after seeing the results of an earlier run.',
};

function analysedText(session: SessionRecord): string {
  const s = session.summary;
  const problems: string[] = [];
  if (s.trialsTimedOut > 0) problems.push(`${s.trialsTimedOut} timed out before reaching the target distance`);
  if (s.trialsDegenerate > 0) problems.push(`${s.trialsDegenerate} had too few mouse samples`);
  return `${s.trialsValid} of ${s.trialsScheduled}${problems.length > 0 ? ` (${problems.join(', ')})` : ''}`;
}

interface ResultsPageProps {
  session: SessionRecord;
  /** Name of the other standard version, or null when there is none to offer (Quick Demo). */
  otherVersionLabel: string | null;
  /** Starts the other version. Called directly from a click so the mouse can be captured. */
  onTryOther: () => void;
}

export function ResultsPage({ session, otherVersionLabel, onTryOther }: ResultsPageProps) {
  const [kind, setKind] = useState<PathKind>('hand');
  const [selectedTrial, setSelectedTrial] = useState(1);
  const [downloaded, setDownloaded] = useState(false);
  const inspectorRef = useRef<HTMLElement>(null);

  const bands = useMemo(() => phaseBands(session), [session]);
  const points = useMemo(() => trialPoints(session), [session]);
  const panels = useMemo(() => pathPanels(session, kind), [session, kind]);
  const comparisons = useMemo(() => catchComparisons(session, kind), [session, kind]);
  const callout = useMemo(() => catchCallout(session), [session]);

  const { preset } = session;
  const g = preset.geometry;
  const interruptedAttempts = session.trials.filter((t) => t.outcome === 'interrupted').length;
  // Reaches that got to the target distance (so they are analysed) but ran out
  // of time before the hold on the target registered.
  const unregisteredHolds = finalAttempts(session).filter((t) => t.valid && t.holdCompleted === false).length;

  // Results live only in this tab. Until something has been downloaded, ask the
  // browser to confirm before the tab is closed or reloaded.
  useEffect(() => {
    if (downloaded) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [downloaded]);

  const inspect = (trialNumber: number) => {
    setSelectedTrial(Math.min(points.length, Math.max(1, trialNumber)));
    // Optional call: not every environment (e.g. the unit-test DOM) implements scrolling.
    inspectorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const save = (which: 'json' | 'trials' | 'events') => {
    const names = exportFileNames(session);
    if (which === 'json') downloadText(names.json, sessionToJson(session), 'application/json');
    if (which === 'trials') downloadText(names.trialsCsv, trialsToCsv(session), 'text/csv');
    if (which === 'events') downloadText(names.eventsCsv, eventsToCsv(session), 'text/csv');
    setDownloaded(true);
  };

  return (
    <main className="page wide results">
      <h1>Your results</h1>
      {preset.kind === 'demo' && <p className="badge">Quick Demo: a shortened version, not comparable with the standard activity</p>}

      <section className="card reveal" data-testid="reveal">
        <p className="lede">
          You did the <strong data-testid="revealed-condition">{preset.label}</strong> version. {describePerturbation(preset)}
        </p>
        <dl className="facts">
          <div>
            <dt>How this version was chosen</dt>
            <dd>{ASSIGNMENT_TEXT[session.assignment.method]}</dd>
          </div>
          <div>
            <dt>Time taken</dt>
            <dd>
              {formatDuration(session.durations.totalTaskMs)} from pressing Start to your last reach (the recorded
              reaches themselves took {formatDuration(session.durations.experimentMs)})
            </dd>
          </div>
          <div>
            <dt>Reaches analysed</dt>
            <dd>
              {analysedText(session)}
              {unregisteredHolds > 0 &&
                `. On ${unregisteredHolds} of the analysed reaches the time limit arrived before the hold on the target registered; the outward movement is analysed all the same`}
            </dd>
          </div>
          {session.interruptions.length > 0 && (
            <div>
              <dt>Pauses</dt>
              <dd>
                {session.interruptions.length} (mouse released or window lost focus)
                {interruptedAttempts > 0 &&
                  `; ${interruptedAttempts} interrupted ${interruptedAttempts === 1 ? 'reach was' : 'reaches were'} repeated`}
              </dd>
            </div>
          )}
        </dl>
        {session.runNumber > 1 && (
          <p className="notice" style={{ marginBottom: 0 }}>
            This was run {session.runNumber} of this visit. You already knew what the activity involves, so practice
            and carry-over from the earlier run can affect these results.
          </p>
        )}
      </section>

      {/* The first catch trial with a usable value; omitted when there is none. */}
      {callout && <CatchCallout model={callout} />}

      <div className="results-toolbar" role="group" aria-label="Which path the movement charts show">
        <span className="results-toolbar-label">Movement charts show:</span>
        <div className="segmented">
          <button type="button" className={kind === 'hand' ? 'is-on' : ''} aria-pressed={kind === 'hand'} onClick={() => setKind('hand')}>
            Your hand (mouse)
          </button>
          <button type="button" className={kind === 'cursor' ? 'is-on' : ''} aria-pressed={kind === 'cursor'} onClick={() => setKind('cursor')}>
            The cursor as displayed
          </button>
        </div>
        <span className="muted small">
          {kind === 'hand'
            ? 'What your hand really did, including while the cursor was hidden.'
            : 'What you saw. Not available for reaches made with the cursor hidden.'}
        </span>
      </div>

      <h2>1. What was changed, and what you did</h2>
      <RotationTimeline points={points} bands={bands} />
      <DirectionErrorChart points={points} bands={bands} kind={kind} onSelectTrial={inspect} />

      <h2>2. Your numbers</h2>
      <section className="card">
        <SummaryTable session={session} />
        <TrialTable points={points} bands={bands} session={session} />
      </section>

      <h2>3. Your movement paths</h2>
      <ChartCard
        title="Paths laid over one another"
        info={[METRIC_INFO.lateLooksLikeBaseline]}
        intro={
          <>
            Each path is one outward reach, turned so that its target is straight up. All panels use the same axes. A
            path that leans right went clockwise of its target; one that leans left went counterclockwise. Each path
            stops on the faint arc, where the hand first got as far out as the target; any steering onto the target
            after that is left out here (section 4 shows it). Point at a path for its details, or click it to open
            that reach in section 4.
          </>
        }
      >
        <PathPanels
          panels={panels}
          kind={kind}
          targetRadius={g.targetRadius / g.targetDistance}
          startRadius={g.startRadius / g.targetDistance}
          arrivalRadius={arrivalRadius(g, preset.timing) / g.targetDistance}
          onSelectTrial={inspect}
        />
      </ChartCard>

      {comparisons.length > 0 && (
        <ChartCard
          title="Catch trials up close: sideways deviation as the reach unfolds"
          info={[METRIC_INFO.catchTrial]}
          intro={
            <>
              How far the {kind === 'hand' ? 'hand' : 'cursor'} was to the side of the straight line to the target
              (vertical axis) at each stage of the reach (horizontal axis). A catch trial is compared with the rotated
              reaches immediately before and after it.{' '}
              {kind === 'hand'
                ? 'If the hand paths look alike, your hand treated the catch trial as though the rotation were still on.'
                : 'On the catch trial the rotation was off, so the cursor shows directly where the hand went.'}
            </>
          }
        >
          <CatchComparisonCharts comparisons={comparisons} kind={kind} />
        </ChartCard>
      )}

      <h2>4. Inspect a single reach</h2>
      <section className="card" ref={inspectorRef} id="trial-inspector">
        <p className="viz-intro">
          The real workspace, not turned or aligned. Step through the session, or click a point or path in the charts
          above to jump here.
        </p>
        <TrialInspector session={session} trialNumber={selectedTrial} onChange={(n) => setSelectedTrial(Math.min(points.length, Math.max(1, n)))} />
      </section>

      <h2>5. What it means</h2>
      <Debrief session={session} bands={bands} />

      <h2>6. Keep your data</h2>
      <section className="card">
        <p>
          Your results exist only in this browser tab and disappear when it is closed or reloaded. Nothing has been
          sent anywhere. Download the files, or take screenshots, if you want to keep them.
        </p>
        <div className="button-row">
          <button type="button" className="button primary" onClick={() => save('json')}>
            Download session file (JSON)
          </button>
          <button type="button" className="button" onClick={() => save('trials')}>
            Download one row per reach (CSV)
          </button>
          <button type="button" className="button" onClick={() => save('events')}>
            Download one row per mouse sample (CSV)
          </button>
        </div>
        <p className="viz-footnote">
          The JSON file contains everything: the exact protocol and seed, every mouse sample, and all the values on
          this page. The CSV files open in a spreadsheet. Preset: <code>{preset.id}</code>.
        </p>
      </section>

      {otherVersionLabel && (
        <>
          <h2>Try the other version</h2>
          <section className="card">
            <p>
              The other standard version is <strong>{otherVersionLabel}</strong>. You are welcome to try it now, but
              you already know what the activity involves and have just practised it, so carry-over can change what
              happens. Treat a second run as exploration, not as a fair comparison of the two versions.
            </p>
            <div className="button-row">
              <button type="button" className="button" onClick={onTryOther}>
                Try the other version
              </button>
              <span className="muted small">Your current results will be replaced. Download them first if you want them.</span>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
