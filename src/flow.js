import { config } from './config.js';
import { log, shoot } from './logger.js';
import { firstVisible, sleep } from './utils.js';
import { login } from './steps/login.js';
import { dismissOnboarding } from './steps/onboarding.js';
import { authorizeConnectors } from './steps/connectors.js';
import { installSkills } from './steps/skills.js';
import { verifyUser } from './steps/verify.js';

/**
 * The complete per-user journey: sign in, clear onboarding, authorize
 * connectors, install skills, then verify the end state.
 *
 * Shared by the single-user entry point (src/index.js) and the batch runner
 * (src/batch.js) so both always behave identically.
 *
 * Each phase is wrapped individually: one failing phase is recorded and the
 * other still runs.
 */
export async function runUserFlow({ page, context, user, phases }) {
  const result = {
    email: user.email,
    authorized: 0,
    connectorsFailed: [],
    installed: 0,
    skillsFailed: [],
    verify: null,
  };

  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });
  await sleep(2_000);
  await shoot(page, 'landing');

  await login(page, user);
  await dismissOnboarding(page);
  await waitForPrompt(page);

  if (phases.connectors) {
    try {
      const { authorized, failed } = await authorizeConnectors(page, context, user.email);
      result.authorized = authorized;
      result.connectorsFailed = failed;
    } catch (err) {
      log.error(`connector phase failed: ${err.message}`);
      await shoot(page, 'connectors-failure');
      result.connectorsFailed.push(`(phase error: ${err.message})`);
    }
  } else {
    log.info('skipping the connectors phase');
  }

  if (phases.skills) {
    try {
      const { installed, failed } = await installSkills(page);
      result.installed = installed;
      result.skillsFailed = failed;
    } catch (err) {
      log.error(`skills phase failed: ${err.message}`);
      await shoot(page, 'skills-failure');
      result.skillsFailed.push(`(phase error: ${err.message})`);
    }
  } else {
    log.info('skipping the skills phase');
  }

  if (phases.verify) {
    try {
      result.verify = await verifyUser(page, verifyScope(phases));
    } catch (err) {
      log.error(`verification phase failed: ${err.message}`);
      await shoot(page, 'verify-failure');
      result.verify = failedVerification(err.message);
    }
  }

  return result;
}

/**
 * What the audit should look at.
 *
 * When a single work phase was requested we only verify that phase - reporting
 * "10 skills missing" after an explicit `--connectors-only` run would be noise.
 * With no work phase at all (`--verify-only`) everything is checked.
 */
function verifyScope({ connectors, skills }) {
  if (!connectors && !skills) return { connectors: true, skills: true };
  return { connectors, skills };
}

const failedVerification = (message) => ({
  connectorsEnabled: [],
  connectorsPending: [],
  connectorsSkipped: [],
  skillsInstalled: [],
  skillsMissing: [],
  missingExpected: [],
  errors: [`phase error: ${message}`],
  ok: false,
});

/**
 * Waits until the composer is up. Its three left icons are icon-only buttons
 * whose accessible names are "Add files", "Select tools" and "Sources"
 * (= the connectors menu), so we look for those rather than visible text.
 */
export async function waitForPrompt(page) {
  log.step('Waiting for the prompt toolbar');
  const ready = await firstVisible(
    [
      page.locator('[aria-label="Sources"]'),
      page.locator('[aria-label="Add files"]'),
      page.locator('[aria-label="Select tools"]'),
      page.locator('[aria-label*="source" i], [aria-label*="connector" i]'),
      page.getByRole('textbox'),
    ],
    { timeout: config.timeout },
  );
  if (!ready) throw new Error('The prompt UI never appeared - the app may still be loading.');
  log.ok('prompt is ready');
  await shoot(page, 'prompt-ready');
}
