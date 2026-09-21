import { chromium } from 'playwright';
import { config } from './config.js';
import { log } from './logger.js';

/**
 * Opens a brand-new, cookie-less browser session.
 *
 * Two flavours:
 *  - USE_INCOGNITO_WINDOW=true  -> real Chrome launched with --incognito,
 *    i.e. literally an Incognito window.
 *  - USE_INCOGNITO_WINDOW=false -> Playwright's default context, which is
 *    already isolated (no cookies, no cache, no extensions) and is the more
 *    reliable option if the --incognito flag ever misbehaves.
 */
export async function launchBrowser() {
  const args = [
    '--start-maximized',
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (config.incognitoWindow) args.unshift('--incognito');

  const launchOptions = {
    headless: config.headless,
    slowMo: config.slowMo,
    args,
  };
  if (config.channel) launchOptions.channel = config.channel;

  let browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch (err) {
    log.warn(`Could not launch channel "${config.channel}" (${err.message.split('\n')[0]})`);
    log.warn('Falling back to the bundled Chromium build.');
    delete launchOptions.channel;
    browser = await chromium.launch(launchOptions);
  }

  const context = await browser.newContext({
    viewport: null,
    acceptDownloads: false,
  });
  context.setDefaultTimeout(config.timeout);
  context.setDefaultNavigationTimeout(config.timeout);

  const page = context.pages()[0] || (await context.newPage());
  log.ok(
    `browser ready (${config.channel || 'chromium'}${config.incognitoWindow ? ', incognito' : ''}${
      config.headless ? ', headless' : ''
    })`,
  );

  return { browser, context, page };
}
