import { config } from '../config.js';
import { log, shoot } from '../logger.js';
import { clean, clickFirst, firstVisible, sleep } from '../utils.js';
import { completeConsent } from './consent.js';

/**
 * Selector notes (discovered with tools/inspect.js against Gemini Enterprise):
 *
 *  - The whole UI lives in nested shadow roots. Playwright's CSS/text engines
 *    pierce open shadow roots, so plain selectors still work.
 *  - The composer's three left icons are icon-only buttons whose accessible
 *    names are "Add files", "Select tools" and "Sources". "Sources" is the
 *    connectors menu the instructions call the Connectors button.
 *  - Each connector row is a Material Web <md-outlined-button>Enable actions
 *    </md-outlined-button> plus an <md-switch>. The label text lives in the
 *    host's light DOM, so we must target the host element, not the inner
 *    <button> (whose own text is empty because it only renders a <slot>).
 */
const BUTTON_HOSTS = 'md-outlined-button, md-filled-button, md-text-button, md-filled-tonal-button, button, [role="button"]';

const enableButtons = (page) => page.locator(`:is(${BUTTON_HOSTS}):has-text("Enable actions")`);
const disableButtons = (page) => page.locator(`:is(${BUTTON_HOSTS}):has-text("Disable actions")`);

const connectorsButton = (page) => [
  page.locator('[aria-label="Sources"]'),
  page.locator('[aria-label="Connectors"]'),
  page.getByRole('button', { name: /^(sources|connectors)$/i }),
  page.locator('[aria-label*="source" i], [aria-label*="connector" i]'),
];

/**
 * Step 6-10: open the Connectors ("Sources") menu and authorize every
 * connector that is not on the skip list, one at a time.
 *
 * The menu is re-opened for each connector because the OAuth popup tears it
 * down, and because an authorized row swaps its button from "Enable actions"
 * to "Disable actions" - so the list shrinks as we go.
 */
export async function authorizeConnectors(page, context, accountEmail) {
  log.step('Opening the Connectors (Sources) menu');

  const processed = new Set();
  const failed = [];
  let done = 0;

  for (let round = 1; round <= config.maxConnectors + 2; round += 1) {
    if (done >= config.maxConnectors) break;

    await openConnectorsMenu(page);
    if (round === 1) await shoot(page, 'connectors-menu');

    const rows = await collectEnableRows(page);
    if (!rows.length) {
      log.info('no connector is left showing "Enable actions"');
      break;
    }

    const next = rows.find((row) => !isSkipped(row.label) && !processed.has(row.label));
    if (!next) {
      log.info('remaining connectors are all on the skip list');
      break;
    }

    processed.add(next.label);
    log.step(`(${done + 1}/${config.maxConnectors}) Enabling actions for "${next.label}"`);

    try {
      await enableOne(page, context, next, accountEmail);
      done += 1;
      log.ok(`"${next.label}" is now authorized`);
    } catch (err) {
      failed.push(next.label);
      log.error(`"${next.label}" failed: ${err.message}`);
      await recover(page, context);
    }
  }

  await closeMenu(page);
  await shoot(page, 'connectors-final');

  return { authorized: done, failed };
}

/* ------------------------------------------------------------------ */

async function openConnectorsMenu(page) {
  const alreadyOpen = await firstVisible([enableButtons(page), disableButtons(page)], { timeout: 1_200 });
  if (alreadyOpen) return;

  await clickFirst(connectorsButton(page), 'Connectors (Sources)', { timeout: 20_000 });
  await sleep(1_500);
}

async function closeMenu(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(400);
}

/**
 * Reads every visible "Enable actions" button together with its row label.
 *
 * A single Material Web button can match twice (the host element and the
 * inner shadow <button> that renders the slotted text), so rows are
 * de-duplicated by on-screen position.
 */
async function collectEnableRows(page) {
  const source = enableButtons(page);
  const total = await source.count().catch(() => 0);

  const rows = [];
  const seen = new Set();

  for (let i = 0; i < total; i += 1) {
    const button = source.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;

    const box = await button.boundingBox().catch(() => null);
    const key = box ? `${Math.round(box.x)}:${Math.round(box.y)}` : `idx-${i}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({ label: await rowLabel(button, rows.length), button });
  }

  log.info(`connectors awaiting authorization: ${rows.map((r) => `"${r.label}"`).join(', ') || 'none'}`);
  return rows;
}

/**
 * Walks up from the button to the row that holds the connector name.
 * Must hop across shadow boundaries via getRootNode().host, because
 * parentElement stops at the edge of each shadow root.
 */
async function rowLabel(button, fallbackIndex) {
  const raw = await button
    .evaluate((el) => {
      const own = (el.textContent || '').replace(/\s+/g, ' ').trim();
      let node = el;
      for (let i = 0; i < 8; i += 1) {
        const root = node.getRootNode();
        const parent = node.parentElement || (root && root.host) || null;
        if (!parent) break;
        node = parent;
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > own.length + 2) return text;
      }
      return own;
    })
    .catch(() => '');

  const label = clean(raw)
    .replace(/enable actions/gi, '')
    .replace(/disable actions/gi, '')
    .replace(/toggle source/gi, '')
    .trim();

  return label || `connector #${fallbackIndex + 1}`;
}

const isSkipped = (label) =>
  config.skipConnectors.some((skip) => label.toLowerCase().includes(skip.toLowerCase()));

/** Clicks one "Enable actions" button and drives the consent flow it opens. */
async function enableOne(page, context, row, accountEmail) {
  const popupPromise = context.waitForEvent('page', { timeout: 20_000 }).catch(() => null);

  await row.button.scrollIntoViewIfNeeded().catch(() => {});
  await row.button.click({ timeout: 15_000 }).catch(() => row.button.click({ force: true }));
  log.ok('clicked "Enable actions"');

  const popup = await popupPromise;

  if (popup) {
    await completeConsent(popup, row.label, accountEmail);
  } else {
    // Consent rendered in the same tab instead of a separate window.
    log.warn('no popup detected - looking for an in-page consent screen');
    const inline = await firstVisible(
      [
        page.getByText(/choose an account/i),
        page.getByRole('button', { name: /^allow$/i }),
        page.locator('iframe[src*="accounts.google.com"]'),
      ],
      { timeout: 8_000 },
    );
    if (!inline) throw new Error('No consent screen appeared after clicking "Enable actions".');
    await completeConsent(page, row.label, accountEmail);
  }

  await page.bringToFront().catch(() => {});
  await sleep(3_000);
  await verifyDisabledLabel(page, row.label);
}

/** Confirms the row now reads "Disable actions". */
async function verifyDisabledLabel(page, label) {
  await openConnectorsMenu(page);

  const confirmed = await firstVisible([disableButtons(page)], { timeout: 12_000 });
  if (confirmed) log.ok(`"${label}" now shows "Disable actions"`);
  else log.warn(`could not confirm the "Disable actions" state for "${label}" - continuing`);
}

/** Closes stray popups and returns focus to the app after a failure. */
async function recover(page, context) {
  for (const p of context.pages()) {
    if (p !== page && !p.isClosed()) await p.close().catch(() => {});
  }
  await page.bringToFront().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(1_200);
}
