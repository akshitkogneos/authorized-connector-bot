import { config } from '../config.js';
import { log, shoot } from '../logger.js';
import { clean, clickFirst, firstVisible, sleep } from '../utils.js';
import { completeConsent } from './consent.js';

const ENABLE = /enable actions/i;
const DISABLE = /disable actions/i;

/**
 * Step 6-10: open the Connectors menu and authorize every connector that is
 * not on the skip list, one at a time.
 *
 * The menu is re-opened for each connector because the OAuth popup usually
 * tears it down, and because an authorized row swaps its button from
 * "Enable actions" to "Disable actions" - so the list shrinks as we go.
 */
export async function authorizeConnectors(page, context) {
  log.step('Opening the Connectors menu');

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
      await enableOne(page, context, next);
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
  // Already open?
  const open = await firstVisible([page.getByRole('button', { name: ENABLE }), page.getByRole('button', { name: DISABLE })], {
    timeout: 1_200,
  });
  if (open) return;

  await clickFirst(
    [
      page.getByRole('button', { name: /^connectors$/i }),
      page.locator('button:has-text("Connectors")'),
      page.locator('[aria-label*="Connector" i]'),
      page.getByRole('button', { name: /connector/i }),
      page.getByText(/^connectors$/i),
    ],
    'Connectors',
    { timeout: 20_000 },
  );
  await sleep(1_200);
}

async function closeMenu(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(400);
}

/** Reads every visible "Enable actions" button together with its row label. */
async function collectEnableRows(page) {
  const buttons = page.getByRole('button', { name: ENABLE });
  const fallback = page.locator('button:has-text("Enable actions"), [role="button"]:has-text("Enable actions")');

  const source = (await buttons.count()) > 0 ? buttons : fallback;
  const total = await source.count();

  const rows = [];
  for (let i = 0; i < total; i += 1) {
    const button = source.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;
    rows.push({ index: rows.length, label: await rowLabel(button), button });
  }

  log.info(`connectors awaiting authorization: ${rows.map((r) => `"${r.label}"`).join(', ') || 'none'}`);
  return rows;
}

/** Walks up the DOM from the button to find the human-readable connector name. */
async function rowLabel(button) {
  const raw = await button
    .evaluate((el) => {
      const own = (el.innerText || '').replace(/\s+/g, ' ').trim();
      let node = el;
      for (let i = 0; i < 6 && node.parentElement; i += 1) {
        node = node.parentElement;
        const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
        if (text && text !== own && text.length > own.length) return text;
      }
      return own;
    })
    .catch(() => '');

  const label = clean(raw)
    .replace(/enable actions/gi, '')
    .replace(/disable actions/gi, '')
    .split(/[\n·|]/)[0]
    .trim();

  return label || `connector #${Math.random().toString(36).slice(2, 6)}`;
}

const isSkipped = (label) =>
  config.skipConnectors.some((skip) => label.toLowerCase().includes(skip.toLowerCase()));

/** Clicks one "Enable actions" button and drives the consent flow it opens. */
async function enableOne(page, context, row) {
  const popupPromise = context.waitForEvent('page', { timeout: 20_000 }).catch(() => null);

  await row.button.scrollIntoViewIfNeeded().catch(() => {});
  await row.button.click({ timeout: 15_000 }).catch(() => row.button.click({ force: true }));
  log.ok('clicked "Enable actions"');

  const popup = await popupPromise;

  if (popup) {
    await completeConsent(popup, row.label);
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
    await completeConsent(page, row.label);
  }

  await page.bringToFront().catch(() => {});
  await sleep(2_500);
  await verifyDisabledLabel(page, row.label);
}

/** Confirms the row now reads "Disable actions". */
async function verifyDisabledLabel(page, label) {
  await openConnectorsMenu(page);

  const confirmed = await firstVisible(
    [
      page.getByRole('button', { name: DISABLE }),
      page.locator('button:has-text("Disable actions")'),
    ],
    { timeout: 12_000 },
  );

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
