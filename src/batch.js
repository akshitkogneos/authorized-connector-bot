#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, resolvePhases } from './config.js';
import { launchBrowser } from './browser.js';
import { baseRunDir, log, setRunContext } from './logger.js';
import { readCsvObjects, toUsers, writeCsv } from './csv.js';
import { runUserFlow } from './flow.js';
import { sleep } from './utils.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

export const CSV_PATH = path.resolve(value('csv', config.usersCsv));
const ALL_USERS = flag('all'); // include rows whose Status isn't Active

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

  const mode = !phases.connectors && !phases.skills ? 'audit only - nothing will be changed' : null;
  log.step(`Batch run: ${users.length} user(s) from ${path.relative(process.cwd(), CSV_PATH)}`);
  if (mode) log.info(mode);
  users.forEach((u, i) => log.info(`  ${i + 1}. ${u.email}${u.name ? ` (${u.name})` : ''}`));

  const results = [];
  const findings = [];

  for (const [index, user] of users.entries()) {
    setRunContext(`${index + 1}-${user.email}`);
    log.step(`===== User ${index + 1}/${users.length}: ${user.email} =====`);

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
      results.push(row);
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }

    if (index < users.length - 1 && config.batchDelay > 0) {
      log.info(`waiting ${config.batchDelay / 1000}s before the next user`);
      await sleep(config.batchDelay);
    }
  }

  setRunContext('');
  report(results, findings);

  const anyFailed = results.some((r) => r.status === 'failed');
  const anyUnverified = results.some((r) => r.verified === 'no' || r.verified === 'unknown');
  return anyFailed || anyUnverified ? 1 : 0;
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
function report(results, findings = []) {
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

// Only run when invoked directly (node src/batch.js); src/index.js imports it.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runBatch();
}
