import { log } from './logger.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns the first locator from `candidates` that resolves to a visible
 * element within `timeout`, or null if none show up.
 *
 * Every candidate is polled in parallel-ish rounds so that the order of the
 * array acts as a preference list rather than a sequence of blocking waits.
 */
export async function firstVisible(candidates, { timeout = 15_000, poll = 300 } = {}) {
  const deadline = Date.now() + timeout;
  do {
    for (const locator of candidates) {
      if (!locator) continue;
      try {
        const target = locator.first();
        if (await target.isVisible()) return target;
      } catch {
        /* locator may point at a closed/navigating frame - try the next one */
      }
    }
    await sleep(poll);
  } while (Date.now() < deadline);
  return null;
}

/**
 * Clicks the first visible candidate. Falls back to a DOM-level click when the
 * normal click is intercepted by an overlay/animation.
 */
export async function clickFirst(candidates, label, { timeout = 15_000, optional = false } = {}) {
  const target = await firstVisible(candidates, { timeout });
  if (!target) {
    if (optional) {
      log.warn(`"${label}" not found - skipping (optional)`);
      return false;
    }
    throw new Error(`Could not find "${label}" on the page.`);
  }

  try {
    await target.scrollIntoViewIfNeeded().catch(() => {});
    await target.click({ timeout: 10_000 });
  } catch {
    log.warn(`Normal click on "${label}" failed, retrying with a forced click`);
    await target.click({ force: true, timeout: 10_000 }).catch(async () => {
      await target.evaluate((el) => el.click());
    });
  }
  log.ok(`clicked "${label}"`);
  return true;
}

/** Types `value` into the first visible candidate field. */
export async function typeInto(candidates, value, label, { timeout = 20_000 } = {}) {
  const field = await firstVisible(candidates, { timeout });
  if (!field) throw new Error(`Could not find the "${label}" input.`);
  await field.click({ timeout: 10_000 }).catch(() => {});
  await field.fill('');
  await field.fill(value);
  log.ok(`entered ${label}`);
  return field;
}

/**
 * Scrolls every scrollable container (and the window) all the way down.
 * Google's consent screen hides "Allow" below the fold, sometimes inside a
 * nested scroll container rather than the document itself.
 */
export async function scrollToBottom(page, rounds = 8) {
  for (let i = 0; i < rounds; i += 1) {
    const moved = await page
      .evaluate(() => {
        let scrolled = false;
        const before = window.scrollY;
        window.scrollTo(0, document.body.scrollHeight);
        if (window.scrollY !== before) scrolled = true;

        for (const el of document.querySelectorAll('*')) {
          if (el.scrollHeight - el.clientHeight > 40) {
            const prev = el.scrollTop;
            el.scrollTop = el.scrollHeight;
            if (el.scrollTop !== prev) scrolled = true;
          }
        }
        return scrolled;
      })
      .catch(() => false);

    await page.keyboard.press('End').catch(() => {});
    await sleep(350);
    if (!moved && i > 1) break;
  }
}

/** Waits until `page` is closed (the OAuth popup finishing its job). */
export async function waitForClose(page, timeout) {
  const deadline = Date.now() + timeout;
  while (!page.isClosed() && Date.now() < deadline) await sleep(400);
  return page.isClosed();
}

/** Normalises whitespace so menu labels compare reliably. */
export const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
