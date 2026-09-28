#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, resolvePhases } from './config.js';
import { launchBrowser } from './browser.js';
import { baseRunDir, log, withRunContext } from './logger.js';
import { readCsvObjects, toUsers, writeCsv } from './csv.js';
import { runUserFlow } from './flow.js';
import { sleep } from './utils.js';

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
const PARALLEL = Math.max(1, Number.isFinite(parallelArg) ? parallelArg : config.parallel);

const phases = resolvePhases(args);

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
 */
export async function runBatch() {
  if (!config.targetUrl) {
    log.error('TARGET_URL is missing. Set it in .env.');
    return 1;
  }
  if (!fs.existsSync(CSV_PATH)) {
    log.error(`No such file: ${CSV_PATH}`);
    log.info('Pass a path with --csv=path/to/users.csv or set USERS_CSV in .env');
    return 1;
  }

  const users = toUsers(readCsvObjects(CSV_PATH), { onlyActive: !ALL_USERS });
  if (!users.length) {
    log.error(`No usable rows in ${CSV_PATH} (need Email + Password columns).`);
    return 1;
  }

  const lanes = Math.min(PARALLEL, users.length);
  const mode = !phases.connectors && !phases.skills ? 'audit only - nothing will be changed' : null;
  log.step(`Batch run: ${users.length} user(s) from ${path.relative(process.cwd(), CSV_PATH)}`);
  if (mode) log.info(mode);
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

  const started = Date.now();
  // Indexed by CSV position so the report keeps the CSV's order, whichever
  // user happens to finish first.
  const results = new Array(users.length);
  const findings = new Array(users.length);

  const pace = startPacer(lanes > 1 ? config.batchDelay : 0);
  let next = 0;
  let finished = 0;

  const lane = async () => {
    while (next < users.length) {
      const index = next++;
      const user = users[index];
      await pace();

      const outcome = await withRunContext(`${index + 1}-${user.email}`, () =>
        runUser(user, index, users.length),
      );
      results[index] = outcome.row;
      findings[index] = outcome.findings;
      finished += 1;

      if (lanes > 1) {
        log.info(`${finished}/${users.length} finished (${user.email}: ${outcome.row.status})`);
      } else if (next < users.length && config.batchDelay > 0) {
        log.info(`waiting ${config.batchDelay / 1000}s before the next user`);
        await sleep(config.batchDelay);
      }
    }
  };

  await Promise.all(Array.from({ length: lanes }, lane));

  report(results, findings.flat(), Date.now() - started);

  const anyFailed = results.some((r) => r.status === 'failed');
  const anyUnverified = results.some((r) => r.verified === 'no' || r.verified === 'unknown');
  return anyFailed || anyUnverified ? 1 : 0;
}

/**
 * One user's complete journey in a brand-new browser process.
 *
 * Never throws: any failure becomes a `failed` row, so one user's failure
 * never stops the rest.
 */
async function runUser(user, index, total) {
  log.step(`===== User ${index + 1}/${total}: ${user.email} =====`);

  const started = Date.now();
  const row = {
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
  };
  const findings = [];

  let browser;
  let context;
  try {
    ({ browser, context } = await launchBrowser());
    const page = context.pages()[0] || (await context.newPage());

    const outcome = await runUserFlow({ page, context, user, phases });

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
    row.status = 'failed';
    row.error = err.message;
    log.error(`user failed: ${err.message}`);
  } finally {
    row.seconds = Math.round((Date.now() - started) / 1000);
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  return { row, findings };
}

/**
 * Returns a function that resolves once at least `gap` ms have passed since
 * the previous caller was let through. Callers queue up in order, so parallel
 * lanes open their browsers one after another rather than sending Google a
 * burst of simultaneous sign-ins from one IP.
 */
function startPacer(gap) {
  let queue = Promise.resolve();
  let last = 0;
  return () => {
    queue = queue.then(async () => {
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    return queue;
  };
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

/** Prints a summary table and writes runs/<timestamp>/report.csv. */
function report(results, findings = [], elapsed = 0) {
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
    else if (r.status === 'partial') log.warn(line);
    else log.error(line);
    if (r.error) log.error(`${pad('', width)}  ${r.error}`);
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

  fs.mkdirSync(baseRunDir, { recursive: true });
  const file = path.join(baseRunDir, 'report.csv');
  writeCsv(
    file,
    [
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
    ],
    results,
  );
  log.ok(`report written to ${path.relative(process.cwd(), file)}`);

  if (findings.length) {
    const detail = path.join(baseRunDir, 'verification.csv');
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
