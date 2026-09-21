import { log, shoot } from '../logger.js';
import { clickFirst, sleep } from '../utils.js';

/**
 * Step 4-5: dismiss the post-login onboarding.
 *   - the "I understand" acknowledgement
 *   - the "Get started" button inside the welcome popup
 *
 * Both are treated as optional: on repeat runs the app may not show them.
 */
export async function dismissOnboarding(page) {
  log.step('Clearing onboarding dialogs');

  await clickFirst(
    [
      page.getByRole('button', { name: /^i understand$/i }),
      page.getByRole('button', { name: /i understand/i }),
      page.locator('button:has-text("I understand")'),
      page.getByText(/^i understand$/i),
    ],
    'I understand',
    { timeout: 12_000, optional: true },
  );

  await sleep(1_000);

  const dialog = page.getByRole('dialog');
  await clickFirst(
    [
      dialog.getByRole('button', { name: /get started/i }),
      dialog.locator('button:has-text("Get started")'),
      page.getByRole('button', { name: /^get started$/i }),
      page.getByRole('button', { name: /get started|let.s go|continue/i }),
      page.locator('button:has-text("Get started")'),
    ],
    'Get started',
    { timeout: 12_000, optional: true },
  );

  await sleep(1_500);
  await shoot(page, 'onboarding-done');
}
