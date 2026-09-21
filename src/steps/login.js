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
 */
export async function login(page) {
  log.step('Signing in');

  const email = await firstVisible(emailField(page), { timeout: config.timeout });
  if (!email) {
    log.warn('No email field visible - assuming the app is already authenticated.');
    return;
  }

  await typeInto(emailField(page), config.email, 'email address');

  // Single-page form? Fill the password right away, otherwise advance first.
  const inlinePassword = await firstVisible(passwordField(page), { timeout: 1_500 });
  if (!inlinePassword) {
    await clickFirst(nextButton(page), 'Next (after email)', { timeout: 15_000 }).catch(async () => {
      await page.keyboard.press('Enter');
    });
    await sleep(1_500);
  }

  await shoot(page, 'email-entered');

  await typeInto(passwordField(page), config.password, 'password', { timeout: config.timeout });
  await clickFirst(nextButton(page), 'Next (after password)', { timeout: 15_000 }).catch(async () => {
    await page.keyboard.press('Enter');
  });

  await waitForChallenge(page);
  await shoot(page, 'signed-in');
  log.ok('signed in');
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
