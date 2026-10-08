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
 *
 * `handleSignals: false` stops Playwright from closing the browser and
 * exiting on Ctrl+C / SIGTERM / SIGHUP. The web UI uses it: it stops the run
 * itself on Ctrl+C, so the partial report still gets written.
 */
export async function launchBrowser({ handleSignals = true } = {}) {
  const args = [
    '--start-maximized',
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (config.incognitoWindow) args.unshift('--incognito');
  if (config.locale) args.push(`--lang=${config.locale}`);
  // --start-maximized does nothing without a screen: headless windows open at
  // 800x600, which gives the web apps their narrow layout.
  if (config.headless) args.push('--window-size=1920,1080');

  const launchOptions = {
    headless: config.headless,
    slowMo: config.slowMo,
    args,
    handleSIGINT: handleSignals,
    handleSIGTERM: handleSignals,
    handleSIGHUP: handleSignals,
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
    // Sets both navigator.language and the Accept-Language header.
    ...(config.locale ? { locale: config.locale } : {}),
    ...(config.headless ? { userAgent: await regularUserAgent(browser) } : {}),
  });
  context.setDefaultTimeout(config.timeout);
  context.setDefaultNavigationTimeout(config.timeout);

  const page = context.pages()[0] || (await context.newPage());
  log.ok(
    `browser ready (${config.channel || 'chromium'}${config.incognitoWindow ? ', incognito' : ''}${
      config.headless ? ', headless' : ''
    }${config.locale ? `, locale ${config.locale}` : ''})`,
  );

  return { browser, context, page };
}

/**
 * Headless Chrome reports "HeadlessChrome/<version>" as its user agent, which
 * Google sign-in treats as a bot. Returns the same string without "Headless".
 */
async function regularUserAgent(browser) {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { userAgent } = await cdp.send('Browser.getVersion');
    return userAgent.replace('HeadlessChrome', 'Chrome');
  } finally {
    await cdp.detach().catch(() => {});
  }
}
