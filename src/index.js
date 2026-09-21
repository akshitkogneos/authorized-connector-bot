#!/usr/bin/env node
import { assertConfig, config } from './config.js';
import { launchBrowser } from './browser.js';
import { log, runDir } from './logger.js';
import { runUserFlow } from './flow.js';

const KEEP_OPEN = process.argv.includes('--keep-open');
const ONLY_SKILLS = process.argv.includes('--skills-only');
const ONLY_CONNECTORS = process.argv.includes('--connectors-only');

export const phasesFromArgs = () => ({
  connectors: ONLY_SKILLS ? false : ONLY_CONNECTORS || config.doConnectors,
  skills: ONLY_CONNECTORS ? false : ONLY_SKILLS || config.doSkills,
});

async function main() {
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
