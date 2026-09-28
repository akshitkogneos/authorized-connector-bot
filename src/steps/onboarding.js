import { log, shoot } from '../logger.js';
import { clickFirst, sleep } from '../utils.js';
import { re } from '../i18n.js';

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
      page.getByRole('button', { name: re('understand') }),
      page.getByRole('button', { name: re('understand', { exact: false }) }),
      page.locator('button').filter({ hasText: re('understand', { exact: false }) }),
      page.getByText(re('understand')),
    ],
    'I understand',
    { timeout: 12_000, optional: true },
  );

  await sleep(1_000);

  const dialog = page.getByRole('dialog');
  await clickFirst(
    [
      dialog.getByRole('button', { name: re('getStarted', { exact: false }) }),
      dialog.locator('button').filter({ hasText: re('getStarted', { exact: false }) }),
      page.getByRole('button', { name: re('getStarted') }),
      page.locator('button').filter({ hasText: re('getStarted') }),
    ],
    'Get started',
    { timeout: 12_000, optional: true },
  );

  await sleep(1_500);
  await shoot(page, 'onboarding-done');
}
