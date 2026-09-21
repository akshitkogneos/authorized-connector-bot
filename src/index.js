#!/usr/bin/env node
import { assertConfig, config } from './config.js';
import { launchBrowser } from './browser.js';
import { log, runDir, shoot } from './logger.js';
import { firstVisible, sleep } from './utils.js';
import { login } from './steps/login.js';
import { dismissOnboarding } from './steps/onboarding.js';
import { authorizeConnectors } from './steps/connectors.js';

const KEEP_OPEN = process.argv.includes('--keep-open');

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

    const { authorized, failed } = await authorizeConnectors(page, context);

    log.step('Summary');
    log.ok(`connectors authorized: ${authorized}`);
    if (failed.length) log.error(`connectors failed: ${failed.join(', ')}`);
    if (config.screenshots) log.info(`screenshots saved in ${runDir}`);

    if (KEEP_OPEN) {
      log.info('--keep-open set: leaving the browser open. Press Ctrl+C to exit.');
      await new Promise(() => {});
    }

    return failed.length ? 1 : 0;
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

/** Waits until the chat prompt with its toolbar (+ / Tools / Connectors) is up. */
async function waitForPrompt(page) {
  log.step('Waiting for the prompt toolbar');
  const ready = await firstVisible(
    [
      page.getByRole('button', { name: /^connectors$/i }),
      page.locator('button:has-text("Connectors")'),
      page.getByRole('button', { name: /connector/i }),
      page.getByRole('textbox'),
    ],
    { timeout: config.timeout },
  );
  if (!ready) throw new Error('The prompt UI never appeared - the app may still be loading.');
  log.ok('prompt is ready');
  await shoot(page, 'prompt-ready');
}

process.exitCode = await main();
