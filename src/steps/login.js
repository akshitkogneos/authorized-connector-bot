import { config } from '../config.js';
import { log, shoot } from '../logger.js';
import { clickFirst, firstVisible, sleep, typeInto } from '../utils.js';

const emailField = (page) => [
  page.locator('input[type="email"]:visible'),
  page.locator('#identifierId'),
  page.locator('input[name="identifier"]'),
  page.locator('input[name="email"]'),
  page.locator('input[name="username"]'),
  page.getByLabel(/email|e-mail|user\s*name/i),
  page.getByPlaceholder(/email|e-mail|user\s*name/i),
];

const passwordField = (page) => [
  page.locator('input[type="password"]:visible'),
  page.locator('input[name="Passwd"]'),
  page.locator('input[name="password"]'),
  page.getByLabel(/password/i),
  page.getByPlaceholder(/password/i),
];

const nextButton = (page) => [
  page.locator('#identifierNext button, #passwordNext button'),
  page.getByRole('button', { name: /^(next|continue|sign in|log in|submit)$/i }),
  page.locator('button[type="submit"]:visible'),
  page.getByRole('button', { name: /next|continue|sign\s*in|log\s*in/i }),
];

/**
 * Step 1-3: enter the email address, then the password.
 *
 * Handles both the two-page Google style flow (email -> Next -> password) and
 * single-page forms where both fields are visible at once.
 *
 * `creds` lets the batch runner sign in as an arbitrary user; it falls back to
 * the single-user values from .env.
 */
export async function login(page, creds = {}) {
  const email = creds.email || config.email;
  const password = creds.password || config.password;

  log.step(`Signing in as ${email}`);

  const emailVisible = await firstVisible(emailField(page), { timeout: config.timeout });
  if (!emailVisible) {
    log.warn('No email field visible - assuming the app is already authenticated.');
    return;
  }

  await typeInto(emailField(page), email, 'email address');

  // Single-page form? Fill the password right away, otherwise advance first.
  const inlinePassword = await firstVisible(passwordField(page), { timeout: 1_500 });
  if (!inlinePassword) {
    await clickFirst(nextButton(page), 'Next (after email)', { timeout: 15_000 }).catch(async () => {
      await page.keyboard.press('Enter');
    });
    await sleep(1_500);
  }

  await shoot(page, 'email-entered');

  await typeInto(passwordField(page), password, 'password', { timeout: config.timeout });
  await clickFirst(nextButton(page), 'Next (after password)', { timeout: 15_000 }).catch(async () => {
    await page.keyboard.press('Enter');
  });

  await waitForChallenge(page);
  await assertSignedIn(page, email);
  await shoot(page, 'signed-in');
  log.ok('signed in');
}

/**
 * Confirms we actually got past the login form.
 *
 * Without this a wrong password fails silently: the bot carries on and only
 * trips much later with a misleading "could not find Connectors", which in a
 * batch run hides the real cause. We wait for the password field to disappear
 * and look for an explicit rejection message.
 */
async function assertSignedIn(page, email) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const rejected = await firstVisible(
      [
        page.getByText(/wrong password|incorrect password|couldn.t sign you in/i),
        page.getByText(/couldn.t find your Google Account|enter a valid email/i),
      ],
      { timeout: 500 },
    );
    if (rejected) {
      const reason = (await rejected.textContent().catch(() => '')) || 'credentials rejected';
      throw new Error(`Sign-in failed for ${email}: ${reason.trim().slice(0, 120)}`);
    }

    const stillOnForm = await firstVisible(passwordField(page), { timeout: 500 });
    if (!stillOnForm) return;

    await sleep(1_000);
  }

  throw new Error(`Sign-in failed for ${email}: still on the password screen (wrong password?)`);
}

/**
 * If Google throws a 2FA prompt / device verification at us there is nothing
 * to automate - we simply pause and let the human finish, then carry on.
 */
async function waitForChallenge(page) {
  await sleep(2_500);
  const challenge = await firstVisible(
    [
      page.getByText(/2-step verification|verify it.s you|check your (phone|device)/i),
      page.getByText(/enter the code|passkey|authenticator/i),
      page.locator('input[name="totpPin"], input[type="tel"]:visible'),
    ],
    { timeout: 2_000 },
  );

  if (!challenge || config.manualStepTimeout <= 0) return;

  log.warn('─'.repeat(64));
  log.warn('A verification challenge appeared (2FA / device check).');
  log.warn(`Please complete it in the browser window. Waiting up to ${Math.round(config.manualStepTimeout / 1000)}s...`);
  log.warn('─'.repeat(64));

  const deadline = Date.now() + config.manualStepTimeout;
  while (Date.now() < deadline) {
    const stillThere = await firstVisible(
      [page.getByText(/2-step verification|verify it.s you|check your (phone|device)/i)],
      { timeout: 1_000 },
    );
    if (!stillThere) {
      log.ok('challenge cleared - continuing');
      return;
    }
    await sleep(2_000);
  }
  log.warn('Timed out waiting for the challenge, attempting to continue anyway.');
}
