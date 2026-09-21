import { config } from '../config.js';
import { log, shoot } from '../logger.js';
import { clickFirst, firstVisible, scrollToBottom, sleep, waitForClose } from '../utils.js';

/**
 * Drives the Google OAuth consent window that opens after "Enable actions":
 *   1. "Choose an account"  -> pick the account we logged in with
 *   2. optional "Continue" / scope selection
 *   3. scroll all the way down
 *   4. click "Allow"
 *
 * Works whether the flow renders in a popup window or in the current tab.
 */
export async function completeConsent(popup, connectorLabel) {
  log.step(`Authorizing "${connectorLabel}" in the consent window`);

  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(1_200);

  await chooseAccount(popup);
  await shoot(popup, `consent-account-${slug(connectorLabel)}`);

  // Some tenants insert an extra "Continue"/"Sign in" interstitial.
  await clickFirst(
    [
      popup.getByRole('button', { name: /^continue$/i }),
      popup.locator('button:has-text("Continue")'),
    ],
    'Continue (interstitial)',
    { timeout: 4_000, optional: true },
  );

  await maybeSelectAllScopes(popup);

  log.info('scrolling the consent screen to the bottom');
  await scrollToBottom(popup);
  await shoot(popup, `consent-bottom-${slug(connectorLabel)}`);

  await clickAllow(popup);

  const closed = await waitForClose(popup, 30_000);
  log.ok(closed ? 'consent window closed' : 'consent finished (window still open)');
  if (!closed) await popup.close().catch(() => {});
}

/** Picks the configured email on the "Choose an account" screen. */
async function chooseAccount(popup) {
  const email = config.email;
  const picker = await firstVisible(
    [
      popup.locator(`[data-identifier="${email}"]`),
      popup.locator(`[data-email="${email}"]`),
      popup.getByRole('link', { name: new RegExp(escape(email), 'i') }),
      popup.locator(`li:has-text("${email}")`),
      popup.locator(`div[role="link"]:has-text("${email}")`),
      popup.getByText(email, { exact: false }),
      popup.getByText(/choose an account/i).locator('xpath=following::*[self::li or @role="link"][1]'),
    ],
    { timeout: 20_000 },
  );

  if (picker) {
    await picker.click({ timeout: 10_000 }).catch(async () => picker.click({ force: true }));
    log.ok(`selected account ${email}`);
    await sleep(1_800);
    return;
  }

  // No chooser: the popup may go straight to consent, or ask to type the email.
  const emailInput = await firstVisible(
    [popup.locator('input[type="email"]:visible'), popup.locator('#identifierId')],
    { timeout: 3_000 },
  );
  if (emailInput) {
    await emailInput.fill(email);
    await popup.keyboard.press('Enter');
    log.ok(`typed account ${email}`);
    await sleep(2_000);
    return;
  }

  log.info('no account chooser shown - already scoped to one account');
}

/** Ticks the "Select all" checkbox on granular-permission consent screens. */
async function maybeSelectAllScopes(popup) {
  if (!config.selectAllScopes) return;

  const selectAll = await firstVisible(
    [
      popup.getByRole('checkbox', { name: /select all/i }),
      popup.locator('input[type="checkbox"][aria-label*="Select all" i]'),
      popup.getByText(/^select all$/i),
    ],
    { timeout: 3_000 },
  );
  if (!selectAll) return;

  const alreadyChecked = await selectAll.isChecked().catch(() => false);
  if (alreadyChecked) {
    log.info('all permissions already selected');
    return;
  }
  await selectAll.click({ timeout: 8_000 }).catch(() => selectAll.click({ force: true }));
  log.ok('ticked "Select all" permissions');
  await sleep(600);
}

/**
 * Clicks Allow. Google occasionally keeps the button disabled until the page
 * has actually been scrolled, so we retry with another scroll in between.
 */
async function clickAllow(popup) {
  const candidates = () => [
    popup.getByRole('button', { name: /^allow$/i }),
    popup.locator('button:has-text("Allow")'),
    popup.locator('#submit_approve_access button'),
    popup.getByRole('button', { name: /allow|approve|authorize|accept/i }),
  ];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const allow = await firstVisible(candidates(), { timeout: 10_000 });
    if (allow) {
      const disabled = await allow.isDisabled().catch(() => false);
      if (!disabled) {
        await allow.click({ timeout: 10_000 }).catch(() => allow.click({ force: true }));
        log.ok('clicked "Allow"');
        return;
      }
      log.warn('"Allow" is still disabled - scrolling further');
    }
    await scrollToBottom(popup, 4);
    await sleep(800);
    if (attempt === 3) throw new Error('Could not click "Allow" on the consent screen.');
  }
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
