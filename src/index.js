#!/usr/bin/env node
import { assertConfig, config } from './config.js';
import { launchBrowser } from './browser.js';
import { log, runDir, shoot } from './logger.js';
import { firstVisible, sleep } from './utils.js';
import { login } from './steps/login.js';
import { dismissOnboarding } from './steps/onboarding.js';
import { authorizeConnectors } from './steps/connectors.js';
import { installSkills } from './steps/skills.js';

const KEEP_OPEN = process.argv.includes('--keep-open');
const ONLY_SKILLS = process.argv.includes('--skills-only');
const ONLY_CONNECTORS = process.argv.includes('--connectors-only');

const runConnectors = ONLY_SKILLS ? false : ONLY_CONNECTORS || config.doConnectors;
const runSkills = ONLY_CONNECTORS ? false : ONLY_SKILLS || config.doSkills;

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
    await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });
    await sleep(2_000);
    await shoot(page, 'landing');

    await login(page);
    await dismissOnboarding(page);
    await waitForPrompt(page);

    const result = { authorized: 0, failed: [], installed: 0, skillsFailed: [] };

    // Phase 1 - connectors. A failure here must not block the skills phase.
    if (runConnectors) {
      try {
        const { authorized, failed } = await authorizeConnectors(page, context);
        result.authorized = authorized;
        result.failed = failed;
      } catch (err) {
        log.error(`connector phase failed: ${err.message}`);
        result.failed.push('(phase error)');
      }
    } else {
      log.info('skipping the connectors phase');
    }

    // Phase 2 - skills.
    if (runSkills) {
      try {
        const { installed, failed } = await installSkills(page);
        result.installed = installed;
        result.skillsFailed = failed;
      } catch (err) {
        log.error(`skills phase failed: ${err.message}`);
        await shoot(page, 'skills-failure');
        result.skillsFailed.push('(phase error)');
      }
    } else {
      log.info('skipping the skills phase');
    }

    log.step('Summary');
    if (runConnectors) log.ok(`connectors authorized: ${result.authorized}`);
    if (result.failed.length) log.error(`connectors failed: ${result.failed.join(', ')}`);
    if (runSkills) log.ok(`skills installed: ${result.installed}`);
    if (result.skillsFailed.length) log.error(`skills failed: ${result.skillsFailed.join(', ')}`);
    if (config.screenshots) log.info(`screenshots saved in ${runDir}`);

    if (KEEP_OPEN) {
      log.info('--keep-open set: leaving the browser open. Press Ctrl+C to exit.');
      await new Promise(() => {});
    }

    return result.failed.length || result.skillsFailed.length ? 1 : 0;
  } catch (err) {
    log.error(err.message);
    await shoot(page, 'failure');
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

/**
 * Waits until the composer is up. Its three left icons are icon-only buttons
 * whose accessible names are "Add files", "Select tools" and "Sources"
 * (= the connectors menu), so we look for those rather than visible text.
 */
async function waitForPrompt(page) {
  log.step('Waiting for the prompt toolbar');
  const ready = await firstVisible(
    [
      page.locator('[aria-label="Sources"]'),
      page.locator('[aria-label="Add files"]'),
      page.locator('[aria-label="Select tools"]'),
      page.locator('[aria-label*="source" i], [aria-label*="connector" i]'),
      page.getByRole('textbox'),
    ],
    { timeout: config.timeout },
  );
  if (!ready) throw new Error('The prompt UI never appeared - the app may still be loading.');
  log.ok('prompt is ready');
  await shoot(page, 'prompt-ready');
}

process.exitCode = await main();
