#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { config, resolvePhases } from './config.js';
import { launchBrowser } from './browser.js';
import { log, mute, newRunDir, withRunContext, withRunRoot } from './logger.js';
import { readCsvObjects, toUsers, writeCsv } from './csv.js';
import { runUserFlow } from './flow.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
// Options are written --name=value or just name=value. The dash-less form is
// the one npm forwards to the script as-is (`npm start parallel=3`); npm
// rejects unknown --flags unless they come after a `--` separator.
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`) || a.startsWith(`${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

export const CSV_PATH = path.resolve(value('csv', config.usersCsv));
const ALL_USERS = flag('all'); // include rows whose Status isn't Active
// Users processed at the same time, each in its own browser: `parallel=N` on
// the command line, else PARALLEL from .env (default 5).
const parallelArg = Number.parseInt(value('parallel', ''), 10);
export const PARALLEL = Math.max(1, Number.isFinite(parallelArg) ? parallelArg : config.parallel);

const cliPhases = resolvePhases(args);

/** report.csv columns, in order. */
const COLUMNS = [
  'email',
  'name',
  'status',
  'connectors',
  'connectors_failed',
  'skills',
  'skills_failed',
  'verified',
  'connectors_pending',
  'skills_missing',
  'expected_missing',
  'error',
  'seconds',
];

/**
 * Users available in the configured CSV, or [] if there is no usable file.
 * Used by src/index.js to decide between single-user and batch mode.
 */
export function csvUsers() {
  try {
    if (!fs.existsSync(CSV_PATH)) return [];
    return toUsers(readCsvObjects(CSV_PATH), { onlyActive: !ALL_USERS });
  } catch {
    return [];
  }
}

/**
 * Runs the whole journey for every user in the CSV.
 *
 * Each user gets a brand-new browser process, so sessions can never leak
 * between accounts - that matters here because Google keeps the previous
 * account in its chooser otherwise.
 *
 * That isolation is also what makes `--parallel=N` safe: users share nothing,
 * so N of them can be in flight at once. Every lane pulls the next user from
 * one shared queue, so a slow or failing account never holds up the rest.
 *
 * The command line calls it without options. The web UI (src/ui) passes them
 * to pick users and settings, follow progress and stop the run.
 *
 * Every run gets its own folder under runs/ holding report.csv,
 * verification.csv, run.log, run.json and one screenshot folder per user.
 *
 * @param {object} [options]
 * @param {string} [options.csvPath] users file (default: csv=... or USERS_CSV)
 * @param {boolean} [options.allUsers] include rows whose Status isn't Active
 * @param {number} [options.parallel] users processed at the same time
 * @param {{connectors: boolean, skills: boolean, verify: boolean}} [options.phases]
 * @param {string[]} [options.emails] only run these users
 * @param {AbortSignal} [options.signal] stops the run: users in progress are
 *   closed and marked `stopped`, users not started yet are marked `not run`
 * @param {(event: object) => void} [options.onEvent] progress callback:
 *   run-error, run-start, user-start, user-done, run-done
 * @param {string} [options.source] who started the run, recorded in run.json
 * @returns {Promise<number>} exit code - 0 when every user finished and verified
 */
export async function runBatch({
  csvPath = CSV_PATH,
  allUsers = ALL_USERS,
  parallel = PARALLEL,
  phases = cliPhases,
  emails = null,
  signal = null,
  onEvent = () => {},
  source = 'cli',
} = {}) {
  const emit = (event) => {
    try {
      onEvent(event);
    } catch {
      /* a progress listener must never break the run */
    }
  };
  const fail = (message, hint) => {
    log.error(message);
    if (hint) log.info(hint);
    emit({ type: 'run-error', message });
    return 1;
  };

  if (!config.targetUrl) return fail('TARGET_URL is missing. Set it in .env.');
  if (!fs.existsSync(csvPath)) {
    return fail(`No such file: ${csvPath}`, 'Pass a path with --csv=path/to/users.csv or set USERS_CSV in .env');
  }

  let users;
  try {
    users = toUsers(readCsvObjects(csvPath), { onlyActive: !allUsers });
  } catch (err) {
    return fail(`Could not read ${csvPath}: ${err.message}`);
  }
  if (!users.length) return fail(`No usable rows in ${csvPath} (need Email + Password columns).`);

  if (emails) {
    const wanted = new Set(emails.map((e) => String(e).trim().toLowerCase()));
    users = users.filter((u) => wanted.has(u.email.toLowerCase()));
    if (!users.length) return fail('None of the selected users are in the CSV (or their Status is not Active).');
  }

  const root = newRunDir();
  return withRunRoot(root, () => execute({ users, root, csvPath, parallel, phases, signal, emit, source }));
}

/** The body of runBatch(), once the input is known to be good. Runs inside the run's folder. */
async function execute({ users, root, csvPath, parallel, phases, signal, emit, source }) {
  const lanes = Math.max(1, Math.min(parallel, users.length));
  const started = Date.now();
  const run = {
    id: path.basename(root),
    source,
    // Lets the web UI tell a run still going in another process (e.g. the
    // command line) from one whose process died before it could finish.
    pid: process.pid,
    status: 'running',
    startedAt: new Date(started).toISOString(),
    finishedAt: null,
    elapsedMs: 0,
    csv: path.relative(process.cwd(), csvPath),
    mode: modeOf(phases),
    phases,
    parallel: lanes,
    // Kept up to date as users start and finish, so run.json shows the
    // progress of a run in flight and what finished if it never completes.
    users: users.map((u, index) => ({ index, email: u.email, name: u.name, status: 'queued' })),
    counts: null,
    exitCode: null,
  };
  writeRunJson(root, run);
  emit({ type: 'run-start', dir: root, ...run });

  const auditOnly = !phases.connectors && !phases.skills;
  log.step(`Batch run: ${users.length} user(s) from ${run.csv}`);
  if (auditOnly) log.info('audit only - nothing will be changed');
  if (lanes > 1) {
    log.info(
      `running ${lanes} users at a time, each in its own browser (sign-ins start at least ${
        config.batchDelay / 1000
      }s apart)`,
    );
  } else {
    log.info('running one user at a time');
  }
  users.forEach((u, i) => log.info(`  ${i + 1}. ${u.email}${u.name ? ` (${u.name})` : ''}`));

  // Indexed by CSV position so the report keeps the CSV's order, whichever
  // user happens to finish first.
  const results = new Array(users.length);
  const findings = new Array(users.length);

  const pace = startPacer(lanes > 1 ? config.batchDelay : 0, signal);
  let next = 0;
  let finished = 0;

  const lane = async () => {
    while (next < users.length && !signal?.aborted) {
      const index = next++;
      const user = users[index];
      await pace();
      if (signal?.aborted) break; // stopped while waiting for a sign-in slot

      const startedAt = new Date().toISOString();
      Object.assign(run.users[index], { status: 'running', startedAt });
      writeRunJson(root, run);
      emit({ type: 'user-start', index, email: user.email, startedAt });
      const outcome = await withRunContext(
        `${index + 1}-${user.email}`,
        () => runUser(user, index, users.length, phases, signal),
        { index, email: user.email },
      );
      results[index] = outcome.row;
      findings[index] = outcome.findings;
      finished += 1;
      Object.assign(run.users[index], { status: outcome.row.status, finishedAt: new Date().toISOString(), row: outcome.row });
      writeRunJson(root, run);
      emit({ type: 'user-done', index, email: user.email, row: outcome.row, findings: outcome.findings });

      if (lanes > 1) {
        log.info(`${finished}/${users.length} finished (${user.email}: ${outcome.row.status})`);
      } else if (next < users.length && config.batchDelay > 0 && !signal?.aborted) {
        log.info(`waiting ${config.batchDelay / 1000}s before the next user`);
        await pause(config.batchDelay, signal);
      }
    }
  };

  await Promise.all(Array.from({ length: lanes }, lane));

  // A stopped run still lists every user, so the report always covers the CSV.
  users.forEach((user, index) => {
    if (results[index]) return;
    results[index] = { ...emptyRow(user, phases), status: 'not run', verified: '-' };
    findings[index] = [];
    Object.assign(run.users[index], { status: 'not run', row: results[index] });
  });

  const stopped = Boolean(signal?.aborted);
  const counts = countResults(results);
  if (stopped) {
    log.warn(`run stopped: ${counts.stopped} user(s) interrupted, ${counts.notRun} not started`);
  }

  const elapsed = Date.now() - started;
  report(root, results, findings.flat(), elapsed);

  const anyFailed = results.some((r) => ['failed', 'stopped', 'not run'].includes(r.status));
  const anyUnverified = results.some((r) => r.verified === 'no' || r.verified === 'unknown');
  const exitCode = anyFailed || anyUnverified ? 1 : 0;

  Object.assign(run, {
    status: stopped ? 'stopped' : 'done',
    finishedAt: new Date().toISOString(),
    elapsedMs: elapsed,
    counts,
    exitCode,
  });
  writeRunJson(root, run);
  emit({ type: 'run-done', dir: root, ...run });
  return exitCode;
}

/** Rejection used when a run is stopped while a user is in progress. */
const STOPPED = new Error('run stopped');

/**
 * One user's complete journey in a brand-new browser process.
 *
 * Never throws: any failure becomes a `failed` row, so one user's failure
 * never stops the rest.
 */
async function runUser(user, index, total, phases, signal) {
  log.step(`===== User ${index + 1}/${total}: ${user.email} =====`);

  const started = Date.now();
  const row = emptyRow(user, phases);
  const findings = [];

  let browser;
  let context;
  try {
    // A caller that can stop the run (the web UI) also owns Ctrl+C: it stops
    // the run so the partial report still gets written, so Playwright must
    // not kill the browsers underneath it.
    ({ browser, context } = await launchBrowser({ handleSignals: !signal }));
    const page = context.pages()[0] || (await context.newPage());

    const outcome = await untilStopped(runUserFlow({ page, context, user, phases }), signal);

    row.connectors = outcome.authorized;
    row.connectors_failed = outcome.connectorsFailed.join(' | ');
    row.skills = outcome.installed;
    row.skills_failed = outcome.skillsFailed.join(' | ');
    if (outcome.connectorsFailed.length || outcome.skillsFailed.length) row.status = 'partial';

    if (outcome.verify) {
      row.verified = outcome.verify.ok ? 'yes' : 'no';
      row.connectors_pending = outcome.verify.connectorsPending.join(' | ');
      row.skills_missing = outcome.verify.skillsMissing.join(' | ');
      row.expected_missing = outcome.verify.missingExpected.join(' | ');
      // In audit-only mode the bot attempted nothing, so a failed verdict is
      // not a run error - it lives in the `verified` column instead.
      const didWork = phases.connectors || phases.skills;
      if (!outcome.verify.ok && didWork && row.status === 'ok') row.status = 'partial';
      findings.push(...toFindings(user, outcome.verify));
    }

    log.ok(`done: ${outcome.authorized} connector(s), ${outcome.installed} skill(s)`);
  } catch (err) {
    if (err === STOPPED) {
      row.status = 'stopped';
      row.error = 'the run was stopped before this user finished';
      log.warn('stopped - closing the browser');
      mute(); // the abandoned flow winds down against the closed browser; keep it quiet
    } else {
      row.status = 'failed';
      row.error = err.message;
      log.error(`user failed: ${err.message}`);
    }
  } finally {
    row.seconds = Math.round((Date.now() - started) / 1000);
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  return { row, findings };
}

/**
 * Settles like `work`, or rejects with STOPPED as soon as `signal` aborts.
 * Stopping doesn't wait for the flow to notice: its waits can run for minutes
 * against a closed browser. runUser() closes the browser right after, which
 * makes the abandoned flow fail fast and quietly.
 */
function untilStopped(work, signal) {
  if (!signal) return work;
  work.catch(() => {}); // it may still reject after we stop waiting for it
  if (signal.aborted) return Promise.reject(STOPPED);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(STOPPED);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** A report row before anything has happened. */
const emptyRow = (user, phases) => ({
  email: user.email,
  name: user.name,
  status: 'ok',
  connectors: 0,
  connectors_failed: '',
  skills: 0,
  skills_failed: '',
  verified: phases.verify ? 'unknown' : '-',
  connectors_pending: '',
  skills_missing: '',
  expected_missing: '',
  error: '',
  seconds: 0,
});

/** Waits `ms`, or less if the run is stopped meanwhile. */
const pause = (ms, signal) => delay(ms, undefined, signal ? { signal } : {}).catch(() => {});

/**
 * Returns a function that resolves once at least `gap` ms have passed since
 * the previous caller was let through. Callers queue up in order, so parallel
 * lanes open their browsers one after another rather than sending Google a
 * burst of simultaneous sign-ins from one IP.
 */
function startPacer(gap, signal) {
  let queue = Promise.resolve();
  let last = 0;
  return () => {
    queue = queue.then(async () => {
      const wait = last + gap - Date.now();
      if (wait > 0) await pause(wait, signal);
      last = Date.now();
    });
    return queue;
  };
}

/** Which phases a run covers, as one word (recorded in run.json, shown by the UI). */
function modeOf({ connectors, skills, verify }) {
  if (connectors && skills) return 'full';
  if (connectors) return 'connectors';
  if (skills) return 'skills';
  return verify ? 'verify' : 'none';
}

/** Tallies report rows by outcome. Also used by the web UI's run history. */
export function countResults(rows) {
  const count = (test) => rows.filter(test).length;
  return {
    total: rows.length,
    ok: count((r) => r.status === 'ok'),
    partial: count((r) => r.status === 'partial'),
    failed: count((r) => r.status === 'failed'),
    stopped: count((r) => r.status === 'stopped'),
    notRun: count((r) => r.status === 'not run'),
    verified: count((r) => r.verified === 'yes'),
    unverified: count((r) => r.verified === 'no' || r.verified === 'unknown'),
    audited: count((r) => r.verified && r.verified !== '-'),
  };
}

/** Writes run.json: what the run was asked to do and, once finished, how it went. */
function writeRunJson(root, run) {
  try {
    fs.writeFileSync(path.join(root, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
  } catch {
    /* best-effort - report.csv remains the source of truth */
  }
}

/** Flattens one user's audit into per-item rows for verification.csv. */
function toFindings(user, verify) {
  const rows = [];
  const add = (type, name, state) => rows.push({ email: user.email, name: user.name, type, item: name, state });

  verify.connectorsEnabled.forEach((c) => add('connector', c, 'enabled'));
  verify.connectorsPending.forEach((c) => add('connector', c, 'NOT ENABLED'));
  verify.connectorsSkipped.forEach((c) => add('connector', c, 'skipped'));
  verify.skillsInstalled.forEach((s) => add('skill', s, 'installed'));
  verify.skillsMissing.forEach((s) => add('skill', s, 'NOT INSTALLED'));
  verify.missingExpected.forEach((e) => add(e.split(':')[0], e.split(':').slice(1).join(':'), 'EXPECTED BUT ABSENT'));
  verify.errors.forEach((e) => add('check', e, 'ERROR'));

  return rows;
}

/** Prints a summary table and writes <run folder>/report.csv. */
function report(root, results, findings = [], elapsed = 0) {
  log.step('Batch summary');

  const pad = (s, n) => String(s).padEnd(n);
  const width = Math.max(20, ...results.map((r) => r.email.length));
  const audited = results.some((r) => r.verified !== '-');

  log.info(
    `${pad('USER', width)}  ${pad('STATUS', 8)} ${pad('CONN', 5)} ${pad('SKILLS', 6)} ${audited ? `${pad('VERIFIED', 9)}` : ''}TIME`,
  );
  for (const r of results) {
    const line = `${pad(r.email, width)}  ${pad(r.status, 8)} ${pad(r.connectors, 5)} ${pad(r.skills, 6)} ${
      audited ? pad(r.verified, 9) : ''
    }${r.seconds}s`;
    if (r.status === 'ok') log.ok(line);
    else if (r.status === 'failed') log.error(line);
    else log.warn(line); // partial, stopped, not run
    if (r.error) (r.status === 'failed' ? log.error : log.warn)(`${pad('', width)}  ${r.error}`);
    if (r.connectors_pending) log.error(`${pad('', width)}  connectors not enabled: ${r.connectors_pending}`);
    if (r.skills_missing) log.error(`${pad('', width)}  skills not installed: ${r.skills_missing}`);
    if (r.expected_missing) log.error(`${pad('', width)}  expected but never found: ${r.expected_missing}`);
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  log.info(`${ok}/${results.length} user(s) completed without errors`);

  if (audited) {
    const verified = results.filter((r) => r.verified === 'yes').length;
    const line = `${verified}/${results.length} user(s) fully set up (all connectors enabled, all skills installed)`;
    if (verified === results.length) log.ok(line);
    else log.error(line);
  }

  log.info(`total time: ${duration(elapsed)}`);

  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'report.csv');
  writeCsv(file, COLUMNS, results);
  log.ok(`report written to ${path.relative(process.cwd(), file)}`);

  if (findings.length) {
    const detail = path.join(root, 'verification.csv');
    writeCsv(detail, ['email', 'name', 'type', 'item', 'state'], findings);
    log.ok(`per-item verification written to ${path.relative(process.cwd(), detail)}`);
  }
}

/** 42s, 3m 07s, 1h 12m 05s. */
function duration(ms) {
  const s = Math.round(ms / 1000);
  const [h, m] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60)];
  const two = (n) => String(n).padStart(2, '0');
  if (h) return `${h}h ${two(m)}m ${two(s % 60)}s`;
  if (m) return `${m}m ${two(s % 60)}s`;
  return `${s}s`;
}

// Only run when invoked directly (node src/batch.js); src/index.js imports it.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runBatch();
}
