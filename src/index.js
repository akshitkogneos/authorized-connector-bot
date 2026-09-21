#!/usr/bin/env node
import path from 'node:path';
import { assertConfig, config } from './config.js';
import { launchBrowser } from './browser.js';
import { log, runDir } from './logger.js';
import { runUserFlow } from './flow.js';
import { csvUsers, runBatch, CSV_PATH } from './batch.js';

const KEEP_OPEN = process.argv.includes('--keep-open');
const ONLY_SKILLS = process.argv.includes('--skills-only');
const ONLY_CONNECTORS = process.argv.includes('--connectors-only');
const FORCE_SINGLE = process.argv.includes('--single');

export const phasesFromArgs = () => ({
  connectors: ONLY_SKILLS ? false : ONLY_CONNECTORS || config.doConnectors,
  skills: ONLY_CONNECTORS ? false : ONLY_SKILLS || config.doSkills,
});

/**
 * Picks the mode.
 *
 * If a users CSV exists with at least one usable row we run every account in
 * it - that is almost always the intent once the file is there. `--single`
 * (or deleting/renaming the CSV) forces the .env single-user path.
 */
async function main() {
  const users = FORCE_SINGLE ? [] : csvUsers();

  if (users.length) {
    log.info(
      `found ${users.length} user(s) in ${path.relative(process.cwd(), CSV_PATH)} - running batch mode`,
    );
    log.info('use "npm start -- --single" to sign in with LOGIN_EMAIL from .env instead');
    return runBatch();
  }

  return runSingle();
}

async function runSingle() {
  try {
    assertConfig();
  } catch (err) {
    log.error(err.message);
    return 1;
  }

  log.step(`Opening ${config.targetUrl} in a fresh incognito session`);

  let browser;
  let context;
  let page;
  try {
    ({ browser, context, page } = await launchBrowser());
  } catch (err) {
    log.error(`Could not start a browser: ${err.message}`);
    log.info('Try: npx playwright install chromium (and set BROWSER_CHANNEL= in .env)');
    return 1;
  }

  try {
    const result = await runUserFlow({
      page,
      context,
      user: { email: config.email, password: config.password },
      phases: phasesFromArgs(),
    });

    log.step('Summary');
    log.ok(`connectors authorized: ${result.authorized}`);
    if (result.connectorsFailed.length) log.error(`connectors failed: ${result.connectorsFailed.join(', ')}`);
    log.ok(`skills installed: ${result.installed}`);
    if (result.skillsFailed.length) log.error(`skills failed: ${result.skillsFailed.join(', ')}`);
    if (config.screenshots) log.info(`screenshots saved in ${runDir()}`);

    if (KEEP_OPEN) {
      log.info('--keep-open set: leaving the browser open. Press Ctrl+C to exit.');
      await new Promise(() => {});
    }

    return result.connectorsFailed.length || result.skillsFailed.length ? 1 : 0;
  } catch (err) {
    log.error(err.message);
    if (KEEP_OPEN) {
      log.info('--keep-open set: browser left open for inspection. Press Ctrl+C to exit.');
      await new Promise(() => {});
    }
    return 1;
  } finally {
    if (!KEEP_OPEN) {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }
}

process.exitCode = await main();
