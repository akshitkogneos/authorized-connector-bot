#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
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

const CSV_PATH = path.resolve(value('csv', config.usersCsv));
const ONLY_SKILLS = flag('skills-only');
const ONLY_CONNECTORS = flag('connectors-only');
const ALL_USERS = flag('all'); // include rows whose Status isn't Active

const phases = {
  connectors: ONLY_SKILLS ? false : ONLY_CONNECTORS || config.doConnectors,
  skills: ONLY_CONNECTORS ? false : ONLY_SKILLS || config.doSkills,
};

/**
 * Runs the whole journey for every user in the CSV.
 *
 * Each user gets a brand-new browser process, so sessions can never leak
 * between accounts - that matters here because Google keeps the previous
 * account in its chooser otherwise.
 */
async function main() {
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

  log.step(`Batch run: ${users.length} user(s) from ${path.relative(process.cwd(), CSV_PATH)}`);
  users.forEach((u, i) => log.info(`  ${i + 1}. ${u.email}${u.name ? ` (${u.name})` : ''}`));

  const results = [];

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
  report(results);
  return results.some((r) => r.status === 'failed') ? 1 : 0;
}

/** Prints a summary table and writes runs/<timestamp>/report.csv. */
function report(results) {
  log.step('Batch summary');

  const pad = (s, n) => String(s).padEnd(n);
  const width = Math.max(20, ...results.map((r) => r.email.length));

  log.info(`${pad('USER', width)}  ${pad('STATUS', 8)} ${pad('CONN', 5)} ${pad('SKILLS', 6)} TIME`);
  for (const r of results) {
    const line = `${pad(r.email, width)}  ${pad(r.status, 8)} ${pad(r.connectors, 5)} ${pad(r.skills, 6)} ${r.seconds}s`;
    if (r.status === 'ok') log.ok(line);
    else if (r.status === 'partial') log.warn(line);
    else log.error(line);
    if (r.error) log.error(`${pad('', width)}  ${r.error}`);
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  log.info(`${ok}/${results.length} user(s) completed without errors`);

  fs.mkdirSync(baseRunDir, { recursive: true });
  const file = path.join(baseRunDir, 'report.csv');
  writeCsv(
    file,
    ['email', 'name', 'status', 'connectors', 'connectors_failed', 'skills', 'skills_failed', 'error', 'seconds'],
    results,
  );
  log.ok(`report written to ${path.relative(process.cwd(), file)}`);
}

process.exitCode = await main();
