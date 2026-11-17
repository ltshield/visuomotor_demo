/**
 * full-session.mjs — complete end-to-end run of the activity in a real browser.
 *
 *   npm run build && npm run e2e                 (headless Chrome, sudden link)
 *   node e2e/full-session.mjs --link gradual --channel msedge
 *
 * What it does, using trusted DevTools mouse input through real Pointer Lock:
 *   1. checks the welcome screen reveals nothing and starts the activity;
 *   2. completes the practice and every recorded trial with a simulated
 *      learner that sees only what a participant sees: it reaches out, steers
 *      the dot onto the target by eye, and holds until the reach registers;
 *   3. releases the mouse mid-reach once and resumes (pause / repeat path),
 *      and switches the sound off and on with the M key;
 *   4. checks nothing revealing is on screen during the task;
 *   5. answers the reflection questions, checks the reveal, exercises the
 *      results page, and downloads the JSON and both CSV files;
 *   6. compares the downloaded metrics with the directions the simulated
 *      participant actually aimed in.
 *
 * Options:
 *   --link general|sudden|gradual|demo|custom
 *                                        which participant link to open (default sudden). "custom" first
 *                                        sets up a custom protocol on the instructor panel (sudden 30°,
 *                                        Quick length, visible-cursor aftereffect, no catch trials),
 *                                        copies the link the panel generates, and runs that.
 *   --channel chrome|msedge              installed browser to drive (default chrome)
 *   --url http://localhost:4173/         where the built app is served (default: starts `vite preview`)
 *   --headed                             show the browser window (it will capture your real mouse while focused)
 *   --width 1366 --height 768            viewport size
 *   --out e2e/output                     where screenshots, downloads and the report go
 *
 * IMPORTANT: this is synthesized input. It validates the software end to end;
 * it does NOT replace a person trying the activity with a physical mouse.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { Participant, SimpleLearner, sleep, wrapDeg } from './lib/participant.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const LINKS = {
  general: { query: '', presetIds: ['rotation-sudden-45-v2', 'rotation-gradual-45-v2'], method: 'random-50-50' },
  sudden: { query: '?c=k7m2', presetIds: ['rotation-sudden-45-v2'], method: 'direct-link' },
  gradual: { query: '?c=p4x9', presetIds: ['rotation-gradual-45-v2'], method: 'direct-link' },
  demo: { query: '?c=demo', presetIds: ['rotation-quickdemo-45-v2'], method: 'direct-link' },
  // The query for this one is read from the instructor panel at run time.
  custom: { query: null, presetIds: ['rotation-sudden-30-custom-quick-aevisible-nocatch-v2'], method: 'custom-link' },
};

const linkName = option('link', 'sudden');
const link = LINKS[linkName];
if (!link) throw new Error(`Unknown --link "${linkName}". Use one of: ${Object.keys(LINKS).join(', ')}`);
const channel = option('channel', 'chrome');
const viewport = { width: Number(option('width', 1366)), height: Number(option('height', 768)) };
const outDir = path.resolve(ROOT, option('out', 'e2e/output'), `${linkName}-${channel}`);
mkdirSync(outDir, { recursive: true });

/** Words that must not appear anywhere on screen before the debrief. */
const REVEALING =
  /rotat|\b45\b|sudden|gradual|abrupt|catch|after-?effect|adaptation|baseline|perturb|washout|condition|preset|ramp/i;

// ---------------------------------------------------------------------------
// Tiny assertion helper: collect every check so the report shows all of them
// ---------------------------------------------------------------------------

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

// ---------------------------------------------------------------------------
// Serve the production build if no URL was given
// ---------------------------------------------------------------------------

async function isUp(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  const given = option('url', null);
  if (given) return { url: given, stop: () => {} };
  const url = 'http://localhost:4173/';
  if (await isUp(url)) return { url, stop: () => {} };
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('No production build found. Run `npm run build` first.');
  }
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', '4173', '--strictPort'],
    { cwd: ROOT, stdio: 'ignore' },
  );
  for (let i = 0; i < 100; i++) {
    if (await isUp(url)) return { url, stop: () => child.kill() };
    await sleep(100);
  }
  child.kill();
  throw new Error('The preview server did not start.');
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const server = await ensureServer();
const browser = await chromium.launch({ channel, headless: !flag('headed') });
const context = await browser.newContext({ viewport, acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`);
});

const startedAt = Date.now();
console.log(`\nFull-session run: link "${linkName}", ${channel}, ${viewport.width}x${viewport.height}`);
console.log(`Browser: ${browser.version()}\n`);

/** Open the instructor panel in a new tab and pass the "I am an instructor" gate. */
async function openInstructorPanel(address) {
  const tab = await context.newPage();
  await tab.goto(address);
  const gateText = await tab.locator('body').innerText();
  await tab.getByRole('button', { name: /I am an instructor/ }).click();
  return { tab, gateText };
}
const linkValue = (tab, title) => tab.getByLabel(`${title} address`).inputValue();

try {
  // ---- 0. Custom link, generated by the instructor panel --------------------
  if (linkName === 'custom') {
    console.log('Setting up a custom protocol on the instructor panel');
    const { tab } = await openInstructorPanel(server.url + 'instructor');
    await tab.getByLabel('30°', { exact: true }).check();
    await tab.getByLabel('Quick (16 trials)', { exact: true }).check();
    await tab.getByLabel('Visible cursor', { exact: true }).check();
    await tab.getByLabel('Catch trials', { exact: true }).uncheck();
    const customUrl = await linkValue(tab, 'Custom link');
    check('the panel generates a custom link for the changed settings', /\?x=[0-9a-z]{4}$/.test(customUrl), customUrl);
    link.query = customUrl.slice(customUrl.indexOf('?'));
    await tab.close();
  }

  // ---- 1. Welcome -----------------------------------------------------------
  console.log('Welcome screen');
  await page.goto(server.url + link.query);
  const welcomeText = await page.locator('body').innerText();
  check('welcome text reveals nothing about the design', !REVEALING.test(welcomeText));
  check('welcome explains the mouse requirement', /physical mouse/i.test(welcomeText));
  check('welcome says recording is local', /only in this browser tab/i.test(welcomeText));
  check('address bar does not name the condition', !/sudden|gradual|rotation|visible|catch|angle/i.test(page.url()), page.url());
  await page.screenshot({ path: path.join(outDir, '01-welcome.png'), fullPage: true });

  await page.getByRole('button', { name: 'Start' }).click();
  const participant = new Participant(page);
  await participant.waitFor((s) => s.locked, 'pointer lock');
  check('pointer lock is active after Start', true);
  await participant.settle();

  // ---- 2. Practice ----------------------------------------------------------
  console.log('\nPractice');
  let practiceReaches = 0;
  let hiddenPractice = 0;
  let practiceHoldSeen = false;
  let practiceConfirmations = 0;
  for (;;) {
    const seen = await participant.look();
    if (!seen || seen.stage !== 'practice') break;
    if (seen.phase === 'finished') {
      await sleep(20);
      continue;
    }
    const go = await participant.centerAndWaitForGo();
    if (!go.cursor.visible) hiddenPractice += 1;
    await participant.reach(go.targetAngle);
    if (practiceReaches === 0) {
      // Arriving on the target is not enough: it has to be held.
      const arrived = await participant.waitFor((s) => s.targetHolding || s.phase !== 'reach', 'the dot to be on the target');
      practiceHoldSeen = arrived.phase === 'reach' && arrived.targetHolding;
    }
    const done = await participant.settleOnTarget(go.targetAngle);
    if (done && done.phase === 'feedback' && done.targetConfirmed) practiceConfirmations += 1;
    practiceReaches += 1;
    await participant.waitFor((s) => s.phase !== 'reach' && s.phase !== 'feedback', 'end of practice reach');
  }
  check('practice consists of 6 reaches', practiceReaches === 6, `${practiceReaches} reaches`);
  check('practice includes no-feedback reaches', hiddenPractice === 2, `${hiddenPractice} with the dot hidden`);
  check('a reach does not register on arrival: the target shows it is being held first', practiceHoldSeen);
  check('the target pulses when a practice reach registers', practiceConfirmations >= 5, `${practiceConfirmations} of 6 seen`);
  await page.screenshot({ path: path.join(outDir, '02-practice-complete.png') });

  await participant.click();
  await participant.waitFor((s) => s.stage === 'experiment', 'the recorded part to begin');

  // ---- 3. Recorded trials ---------------------------------------------------
  console.log('\nRecorded trials');
  const learner = new SimpleLearner();
  /** One entry per completed trial, in order: what the participant saw and did. */
  const log = [];
  let revealedDuringTask = false;
  let interruptionDone = false;
  let sawProgressBar = false;
  let jumpsHome = 0;
  let hiddenDotShownAfterReach = false;
  let soundToggleOk = null;
  const interruptAtTrial = linkName === 'demo' || linkName === 'custom' ? 7 : 15;

  for (;;) {
    let seen = await participant.look();
    if (!seen) break; // the task screen has gone: session finished
    if (seen.phase === 'finished') {
      await sleep(20);
      continue;
    }

    const go = await participant.centerAndWaitForGo();
    const trialNumber = log.length + 1;
    participant.pos = { x: Math.round(participant.pos.x), y: Math.round(participant.pos.y) };

    // Concealment: scan everything a participant could read at the go cue.
    const taskText = await page.locator('.task').innerText();
    const taskMarkup = await page.locator('.task').evaluate((el) => el.outerHTML);
    if (REVEALING.test(taskText) || /sudden|gradual|baseline|adaptation|aftereffect|catch|rotat/i.test(taskMarkup)) {
      revealedDuringTask = true;
    }
    if ((await page.locator('.progress').count()) > 0) sawProgressBar = true;

    // Once, release the mouse in the middle of a reach (same path as pressing Esc).
    if (!interruptionDone && trialNumber === interruptAtTrial) {
      await participant.reach(go.targetAngle + learner.aim, { distance: participant.targetDistance * 0.4, steps: 10 });
      await page.evaluate(() => document.exitPointerLock());
      const paused = await participant.waitFor((s) => s.phase === 'paused' && s.overlay, 'the pause overlay');
      check('releasing the mouse mid-reach pauses the task', paused.phase === 'paused');
      check('pause overlay gives a recovery instruction', /Resume/.test(await page.locator('.task-card').innerText()));
      await page.screenshot({ path: path.join(outDir, '03-paused.png') });
      await sleep(1300); // Chrome briefly refuses to re-capture straight after a release
      await page.getByRole('button', { name: 'Resume' }).click();
      await participant.waitFor((s) => s.locked && s.phase !== 'paused', 'the task to resume');
      await participant.settle();
      interruptionDone = true;
      continue; // the interrupted trial is presented again
    }

    // Once, switch the sound off and on again with the M key (the only control that works while captured).
    if (soundToggleOk === null && trialNumber === 2) {
      const pressed = () => page.locator('.sound-toggle').getAttribute('aria-pressed');
      const before = await pressed();
      await page.keyboard.press('m');
      const muted = await pressed();
      await page.keyboard.press('m');
      soundToggleOk = before === 'true' && muted === 'false' && (await pressed()) === 'true';
    }

    // 1. The outward movement, straight along the participant's current aim.
    const aimDeg = learner.aim;
    await participant.reach(go.targetAngle + aimDeg);
    seen = await participant.look();

    // What the participant could see of the outcome: where the dot ended up relative to the target.
    let cursorErrorDeg = null;
    if (go.cursor.visible && seen && seen.cursor.visible) {
      const cursorAngle = (Math.atan2(seen.cursor.y, seen.cursor.x) * 180) / Math.PI;
      cursorErrorDeg = wrapDeg(cursorAngle - go.targetAngle);
    }

    // 2. Steer the dot onto the target (if it can be seen) and hold until the reach registers.
    seen = await participant.settleOnTarget(go.targetAngle, aimDeg);
    if (!go.cursor.visible && seen && seen.cursor.visible) hiddenDotShownAfterReach = true;
    log.push({ trialNumber, targetAngle: go.targetAngle, cursorVisible: go.cursor.visible, aimDeg, cursorErrorDeg, registered: !!seen && seen.phase === 'feedback' && seen.targetConfirmed });
    learner.update(cursorErrorDeg);

    if (trialNumber === 3 || trialNumber === 12) {
      await page.screenshot({ path: path.join(outDir, `04-trial-${trialNumber}.png`) });
    }

    // Wait for this trial's pause to end (or for the whole task screen to disappear).
    for (;;) {
      const s = await participant.look();
      if (!s) break;
      if (s.phase !== 'feedback' && s.phase !== 'reach') {
        // No return movement: the dot is simply back on the centre, visible, with no hand movement made.
        if (s.cursor.visible && s.cursor.x === 0 && s.cursor.y === 0) jumpsHome += 1;
        break;
      }
      await sleep(15);
    }
  }
  console.log(`  completed ${log.length} trials`);
  check('nothing revealing was shown during the task', !revealedDuringTask);
  check('a neutral progress bar was shown', sawProgressBar);
  check('one mid-reach interruption was exercised', interruptionDone);
  check('every reach registered with a visible confirmation', log.every((t) => t.registered), `${log.filter((t) => t.registered).length} of ${log.length}`);
  check('after every reach but the last the dot was back on the centre with no return movement', jumpsHome === log.length - 1, `${jumpsHome} of ${log.length - 1}`);
  check('a hidden dot never reappeared where its reach ended', !hiddenDotShownAfterReach);
  check('the M key switches the sound off and on while the mouse is captured', soundToggleOk === true);

  // ---- 4. Reflection --------------------------------------------------------
  console.log('\nReflection');
  await page.waitForSelector('text=Before you see your results');
  check('mouse is released when the task ends', await page.evaluate(() => document.pointerLockElement === null));
  const reflectionText = await page.locator('body').innerText();
  check('reflection screen reveals nothing', !REVEALING.test(reflectionText));
  await page.getByLabel(/Did anything seem to change/).fill('The dot started going off to one side.');
  check('reflection asks the strategy-awareness question', /Did you consciously try to adjust where you aimed during the task\?/.test(reflectionText));
  await page.getByLabel('Somewhat', { exact: true }).check();
  await page.getByLabel('Mouse', { exact: true }).check();
  await page.screenshot({ path: path.join(outDir, '05-reflection.png'), fullPage: true });
  await page.getByRole('button', { name: 'Show my results' }).click();

  // ---- 5. Results -----------------------------------------------------------
  console.log('\nResults');
  await page.waitForSelector('[data-testid="revealed-condition"]');
  const revealed = (await page.getByTestId('revealed-condition').innerText()).trim();
  console.log(`  revealed condition: ${revealed}`);
  await page.waitForFunction(() => document.querySelectorAll('svg.recharts-surface').length >= 2);
  await sleep(400);
  check('per-trial charts are drawn', (await page.locator('svg.recharts-surface').count()) >= 2);
  check('movement overlay panels are drawn', (await page.locator('.path-panel svg').count()) >= 4);
  check('overlay panels contain recorded paths', (await page.locator('.path-panel polyline.path-hit').count()) >= 10);
  const resultsText = await page.locator('body').innerText();
  check('debrief explains adaptation and aftereffects', /visuomotor adaptation/i.test(resultsText) && /aftereffects/i.test(resultsText));
  check('debrief warns that short sessions may show little', /little or no measurable/i.test(resultsText));
  check('results show no class or population averages', !/class average|population average|other students scored|percentile/i.test(resultsText));
  await page.screenshot({ path: path.join(outDir, '06-results-hand.png'), fullPage: true });

  // Catch-trial callout, metric explanations and the participant's own strategy answer.
  const hasCallout = (await page.getByTestId('catch-callout').count()) > 0;
  const calloutText = hasCallout ? await page.getByTestId('catch-callout').innerText() : '';
  if (linkName === 'custom') {
    // This custom protocol has no catch trials, so there is nothing for a callout to report.
    check('no catch-trial callout when catch trials are switched off', !hasCallout);
    check('the results page labels the session as a custom protocol', /Custom protocol: set up by your instructor/.test(resultsText) && /^Custom: /.test(revealed));
  } else {
    check('the catch-trial callout names the trial and says the rotation was removed', /On trial \d+, the rotation was secretly removed without warning\./.test(calloutText));
    check('the callout gives the value with its direction in words', /Your hand deviated (0°|[+−]\d+(\.\d)?° \((clockwise|counterclockwise)\))/.test(calloutText), calloutText.split('\n')[1] ?? '');
    check('a standard session carries no custom label', !/Custom protocol/.test(resultsText));
  }
  const notes = page.locator('.info-button');
  check('metric explanations are offered and start collapsed', (await notes.count()) >= 4 && (await page.locator('.info-text').count()) === 0, `${await notes.count()} notes`);
  await page.getByRole('button', { name: 'Path efficiency' }).click();
  check('an explanation opens on click', /1\.0 = a perfectly straight line/.test(await page.locator('.info-text').first().innerText()));
  await page.getByRole('button', { name: 'Path efficiency' }).click();
  check('and closes again', (await page.locator('.info-text').count()) === 0);
  const answerText = await page.getByTestId('strategy-answer').innerText();
  check('the debrief shows the strategy answer and the note', /You answered: Somewhat\./.test(answerText) && /both can produce aftereffects/.test(answerText));
  if (hasCallout) await page.getByTestId('catch-callout').screenshot({ path: path.join(outDir, '06b-callout.png') });

  // Hover layer and inspection.
  const plot = page.locator('#direction-error-chart .viz-plot');
  await plot.scrollIntoViewIfNeeded();
  await sleep(250);
  const box = await plot.boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await sleep(200);
  check('hovering the chart shows a tooltip', (await page.locator('.viz-tooltip').count()) > 0);
  await page.screenshot({ path: path.join(outDir, '07-results-tooltip.png') });
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await sleep(700);
  const inspectedAfterClick = await page.locator('.inspector-slider strong').innerText();
  check('clicking a chart point opens that reach in the inspector', Number(inspectedAfterClick) > 1, `trial ${inspectedAfterClick}`);
  await page.getByRole('button', { name: 'Next →' }).click();
  check(
    'the inspector steps to the next reach',
    Number(await page.locator('.inspector-slider strong').innerText()) === Number(inspectedAfterClick) + 1,
  );
  await page.locator('#trial-inspector').screenshot({ path: path.join(outDir, '08-inspector.png') });

  await page.getByRole('button', { name: 'The cursor as displayed' }).click();
  await sleep(500);
  check('cursor view explains hidden-cursor reaches', /cursor was hidden on these reaches/i.test(await page.locator('.path-panel-grid').innerText()));
  await page.screenshot({ path: path.join(outDir, '09-results-cursor.png'), fullPage: true });
  await page.getByRole('button', { name: 'Your hand (mouse)' }).click();

  // Table view.
  await page.locator('summary', { hasText: 'Show the value for every reach' }).click();
  const tableRows = await page.locator('.trial-table tbody tr').count();
  check('table view lists every reach', tableRows === log.length, `${tableRows} rows`);

  // ---- 6. Downloads ---------------------------------------------------------
  console.log('\nDownloads');
  async function download(buttonName) {
    const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: buttonName }).click()]);
    const target = path.join(outDir, file.suggestedFilename());
    await file.saveAs(target);
    return { name: file.suggestedFilename(), text: readFileSync(target, 'utf8') };
  }
  const jsonFile = await download('Download session file (JSON)');
  const trialsFile = await download('Download one row per reach (CSV)');
  const eventsFile = await download('Download one row per mouse sample (CSV)');
  check('JSON download has a descriptive name', /^motor-learning_rotation-.*_session\.json$/.test(jsonFile.name), jsonFile.name);

  const session = JSON.parse(jsonFile.text);
  const finals = session.trials.filter((t) => t.isFinalAttempt).sort((a, b) => a.trialNumber - b.trialNumber);

  check('session records a known preset for this link', link.presetIds.includes(session.preset.id), session.preset.id);
  check('revealed condition matches the recorded preset', revealed === session.preset.label);
  check('assignment method is recorded', session.assignment.method === link.method, session.assignment.method);
  check('one final attempt per scheduled trial', finals.length === session.schedule.length && finals.length === log.length, `${finals.length}`);
  check('the interrupted attempt is kept and flagged', session.trials.some((t) => t.outcome === 'interrupted' && !t.isFinalAttempt && !t.valid));
  check('the interruption is logged', session.interruptions.length === 1 && session.interruptions[0].reason === 'pointer-lock-lost');
  check('reflection answers are saved', session.reflection && session.reflection.consciousAdjustment === 'somewhat' && session.reflection.changedAim === null && session.reflection.device === 'mouse');
  const structure = session.preset.structure;
  const firstCatch = finals.find((t) => t.isCatch);
  if (structure.adaptation.catchSlots.length > 0) {
    check('the callout value is the first catch trial’s initial hand direction', firstCatch && calloutText.includes(`On trial ${firstCatch.trialNumber},`) && calloutText.includes(`${Math.abs(firstCatch.metrics.hand.initialDirectionErrorDeg).toFixed(1).replace(/\.0$/, '')}°`), firstCatch ? firstCatch.metrics.hand.initialDirectionErrorDeg.toFixed(2) : '');
  } else {
    check('a protocol with catch trials off ran none', !firstCatch);
  }
  if (linkName === 'custom') {
    check('the custom settings travelled in the link and are saved with the data', JSON.stringify(session.assignment.customSettings) === JSON.stringify({ schedule: 'sudden', angleDeg: 30, tier: 'quick', aftereffect: 'visible', catchTrials: false }));
    check('the custom session is marked custom and concealed', session.preset.kind === 'custom' && session.assignment.conditionConcealed === true);
  }
  check('movement came from pointer events', session.environment.moveEventSource === 'pointermove', `${session.environment.moveSamples} samples from ${session.environment.moveEvents} events`);
  check('all final attempts are valid', finals.every((t) => t.valid), `${finals.filter((t) => t.valid).length} of ${finals.length}`);
  check('every final attempt registered by holding', finals.every((t) => t.outcome === 'completed' && t.holdCompleted === true));
  const holdMs = session.preset.timing.targetHoldMs;
  const arrivalRadius = session.preset.geometry.targetDistance - session.preset.geometry.targetRadius;
  check('the preset asks for a 400 ms target hold', holdMs === 400, `${holdMs} ms`);
  check('reaches registered at least one full hold after arriving', finals.every((t) => t.times.holdCompletionMs - t.times.completionMs >= holdMs - 0.001));
  check('arrival is recorded at the near edge of the target', finals.every((t) => t.crossing && t.crossing.radius === arrivalRadius && Math.abs(Math.hypot(t.crossing.handX, t.crossing.handY) - arrivalRadius) < 1e-6), `${arrivalRadius} units`);
  check('visible-cursor reaches ended with the cursor inside the target', finals.filter((t) => t.cursorVisibleDuringReach).every((t) => {
    const n = t.samples.reach.tMs.length - 1;
    return Math.hypot(t.samples.reach.cursorX[n] - t.targetX, t.samples.reach.cursorY[n] - t.targetY) <= session.preset.geometry.targetRadius;
  }));
  check('no movement is recorded after a reach (the dot jumps home)', session.trials.every((t) => t.samples.postReach.tMs.length === 0));
  check('schema and app are version 2', session.schemaVersion === '2.0.0' && session.app.version === '2.0.0');

  // Protocol as executed.
  const phases = (name) => finals.filter((t) => t.phase === name);
  const rotated = finals.filter((t) => t.phase === 'adaptation' && !t.isCatch);
  const aftereffectHidden = structure.aftereffect.feedback === 'hidden';
  check('baseline reaches had 0° rotation and a hidden cursor', phases('baseline').every((t) => t.appliedRotationDeg === 0 && !t.cursorVisibleDuringReach));
  check(`aftereffect reaches had 0° rotation and a ${aftereffectHidden ? 'hidden' : 'visible'} cursor, as the protocol says`, phases('aftereffect').every((t) => t.appliedRotationDeg === 0 && t.cursorVisibleDuringReach === !aftereffectHidden));
  check('adaptation reaches had a visible cursor', phases('adaptation').every((t) => t.cursorVisibleDuringReach));
  check('catch trials had 0° rotation and there are as many as the protocol says', finals.filter((t) => t.isCatch).every((t) => t.appliedRotationDeg === 0) && finals.filter((t) => t.isCatch).length === structure.adaptation.catchSlots.length, `${structure.adaptation.catchSlots.length} catch trials`);
  check('applied rotation equals configured rotation on every reach', finals.every((t) => t.appliedRotationDeg === t.configuredRotationDeg));
  const perturbation = session.preset.perturbation;
  if (perturbation.kind === 'sudden') {
    const expectedAngle = linkName === 'custom' ? 30 : 45;
    check(`sudden: every rotated reach applied exactly ${expectedAngle}°`, perturbation.angleDeg === expectedAngle && rotated.every((t) => t.appliedRotationDeg === expectedAngle), `${rotated.length} rotated reaches`);
  } else {
    const angles = rotated.map((t) => t.appliedRotationDeg);
    check('gradual: first rotated reach is 0°, eighth is exactly 45°', angles[0] === 0 && angles[7] === 45, angles.slice(0, 8).map((a) => a.toFixed(2)).join(', '));
    check('gradual: holds 45° afterwards', angles.slice(8).every((a) => a === 45), `${angles.length - 8} reaches`);
  }

  // What the participant saw must match what was recorded.
  check('recorded targets match the targets that lit up', finals.every((t, i) => t.targetAngleDeg === log[i].targetAngle));
  check('recorded cursor visibility matches what was on screen', finals.every((t, i) => t.cursorVisibleDuringReach === log[i].cursorVisible));

  // The recorded metrics must reproduce the directions actually aimed in.
  let worstInitial = 0;
  let worstEndpoint = 0;
  let worstCursor = 0;
  finals.forEach((t, i) => {
    const aim = log[i].aimDeg;
    worstInitial = Math.max(worstInitial, Math.abs(t.metrics.hand.initialDirectionErrorDeg - aim));
    worstEndpoint = Math.max(worstEndpoint, Math.abs(t.metrics.hand.endpointDirectionErrorDeg - aim));
    if (t.metrics.cursor) {
      worstCursor = Math.max(worstCursor, Math.abs(t.metrics.cursor.endpointDirectionErrorDeg - (aim + t.appliedRotationDeg)));
    }
  });
  check('hand initial direction matches the aimed direction on every reach', worstInitial < 1.5, `worst difference ${worstInitial.toFixed(2)}°`);
  check('hand direction on arrival matches the aimed direction on every reach', worstEndpoint < 0.75, `worst difference ${worstEndpoint.toFixed(2)}°`);
  check('cursor direction equals hand direction plus the applied rotation', worstCursor < 0.75, `worst difference ${worstCursor.toFixed(2)}°`);
  check('the dot seen after the outward movement matched the recorded cursor direction on arrival', finals.every((t, i) => log[i].cursorErrorDeg === null || Math.abs(log[i].cursorErrorDeg - t.metrics.cursor.endpointDirectionErrorDeg) < 0.6));
  // Steering onto the target afterwards must not leak into the metrics: path length stops at arrival.
  check('path metrics stop at arrival, before the steering and the hold', finals.every((t) => t.metrics.hand.pathLength < arrivalRadius * 1.02 && t.crossing.sampleIndex < t.samples.reach.tMs.length));

  // CSV files.
  const trialLines = trialsFile.text.trimEnd().split('\n');
  check('trial CSV has one row per attempt', trialLines.length - 1 === session.trials.length, `${trialLines.length - 1} rows`);
  const totalSamples = session.trials.reduce((n, t) => n + t.samples.preReach.tMs.length + t.samples.reach.tMs.length + t.samples.postReach.tMs.length, 0);
  const eventLines = eventsFile.text.trimEnd().split('\n');
  check('event CSV has one row per recorded sample', eventLines.length - 1 === totalSamples, `${totalSamples} samples`);

  // Summary table on the page agrees with the file.
  const summary = session.summary;
  check('page summary matches the downloaded summary', resultsText.includes(`${summary.trialsValid} of ${summary.trialsScheduled}`));

  // ---- 7. Instructor panel --------------------------------------------------
  console.log('\nInstructor panel');
  // Leaving the results page triggers its "unsaved results" guard only if nothing was downloaded.
  const { tab: instructor, gateText } = await openInstructorPanel(server.url + 'instructor');
  check('instructor details are behind a confirmation', !/k7m2|p4x9|Rotation angle/.test(gateText));
  const canonicalLinks = async () => [await linkValue(instructor, 'Random assignment link'), await linkValue(instructor, 'Sudden 45° link'), await linkValue(instructor, 'Gradual 0°→45° link')];
  const linksBefore = await canonicalLinks();
  check('the panel offers the random, sudden and gradual links', linksBefore[0] === server.url && linksBefore[1] === `${server.url}?c=k7m2` && linksBefore[2] === `${server.url}?c=p4x9`, linksBefore.join('  '));
  const presetValue = () => instructor.getByLabel('Preset', { exact: true }).inputValue();
  const protocolId = () => instructor.getByTestId('protocol-id').innerText();
  const estimate = () => instructor.getByTestId('duration-estimate').innerText();
  check('the panel starts on the canonical sudden preset', (await presetValue()) === 'sudden' && (await protocolId()) === 'rotation-sudden-45-v2');
  check('the duration estimate is shown', /^About 5 minutes/.test(await estimate()), await estimate());
  check('no Custom option before anything is changed', (await instructor.locator('#preset-select option').allInnerTexts()).join('|') === 'Sudden 45°|Gradual 0°→45°|Quick Demo');
  await instructor.screenshot({ path: path.join(outDir, '10-instructor.png'), fullPage: true });

  await instructor.getByLabel('30°', { exact: true }).check();
  check('changing a setting switches the preset to Custom with a new id', (await presetValue()) === 'custom' && (await protocolId()) === 'rotation-sudden-30-custom-v2', await protocolId());
  check('the pooling warning is shown for a custom protocol', /Custom sessions will not be pooled with canonical preset data in class comparisons\./.test(await instructor.getByTestId('custom-warning').innerText()));
  check('a single custom link appears', (await instructor.getByRole('button', { name: 'Copy custom link' }).count()) === 1 && /\?x=[0-9a-z]{4}$/.test(await linkValue(instructor, 'Custom link')), await linkValue(instructor, 'Custom link'));
  await instructor.getByLabel('Extended (64 trials)', { exact: true }).check();
  check('the estimate updates with the trial count', /^About 6 minutes/.test(await estimate()), await estimate());
  check('the canonical links are unaffected by the settings', JSON.stringify(await canonicalLinks()) === JSON.stringify(linksBefore));
  await instructor.screenshot({ path: path.join(outDir, '10b-instructor-custom.png'), fullPage: true });

  await instructor.getByLabel('Preset', { exact: true }).selectOption('gradual');
  check('choosing a preset restores its defaults and its canonical id', (await protocolId()) === 'rotation-gradual-45-v2' && (await instructor.getByTestId('custom-warning').count()) === 0);
  await instructor.close();

  // The address printed for the first release still opens the panel.
  const legacy = await context.newPage();
  await legacy.goto(server.url + '#/instructors');
  check('the old #/instructors address still opens the instructor page', (await legacy.getByRole('button', { name: /I am an instructor/ }).count()) === 1);
  await legacy.close();

  // ---- 8. Offer of the other condition --------------------------------------
  if (session.preset.kind === 'canonical') {
    console.log('\nOther condition');
    await page.getByRole('button', { name: 'Try the other version' }).click();
    const second = await participant.waitFor((s) => s.stage === 'ready' && s.locked, 'the second run to be ready');
    check('second run skips practice and waits for a click', second.stage === 'ready');
  }

  // ---- Report ---------------------------------------------------------------
  const report = {
    link: linkName,
    browser: `${channel} ${browser.version()}`,
    viewport,
    presetId: session.preset.id,
    trials: finals.length,
    attempts: session.trials.length,
    experimentSeconds: Number((session.durations.experimentMs / 1000).toFixed(1)),
    totalTaskSeconds: Number((session.durations.totalTaskMs / 1000).toFixed(1)),
    samples: totalSamples,
    moveEvents: session.environment.moveEvents,
    moveSamples: session.environment.moveSamples,
    frameIntervalMs: session.environment.frameIntervalMs,
    displayScale: session.environment.displayScale,
    simulatedLearner: {
      lateAdaptationAimDeg: Number((rotated.slice(-4).reduce((a, t) => a + t.metrics.hand.initialDirectionErrorDeg, 0) / 4).toFixed(1)),
      firstAftereffectDeg: summary.firstAftereffect.valueDeg === null ? null : Number(summary.firstAftereffect.valueDeg.toFixed(1)),
    },
    pageErrors,
    checks,
  };
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  check('no JavaScript errors were reported by the page', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  check('run completed without an exception', false, err instanceof Error ? err.message : String(err));
  await page.screenshot({ path: path.join(outDir, 'failure.png') }).catch(() => {});
} finally {
  await browser.close();
  server.stop();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed in ${((Date.now() - startedAt) / 1000).toFixed(0)} s.`);
console.log(`Screenshots, downloads and report: ${outDir}`);
console.log('Note: input was synthesized. A person with a physical mouse still needs to try the activity.\n');
process.exit(failed.length === 0 ? 0 : 1);
