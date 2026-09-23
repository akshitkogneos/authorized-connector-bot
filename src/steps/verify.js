import { config } from '../config.js';
import { log, shoot } from '../logger.js';
import { firstVisible, sleep } from '../utils.js';
import { closeMenu, readConnectorStates } from './connectors.js';
import { openSkillsPage, readSkillStates } from './skills.js';

/**
 * Phase 3 - verification.
 *
 * A read-only audit that answers one question per user: *is every connector
 * enabled and every skill installed?* Nothing is ever clicked except the
 * navigation needed to see the two lists, so it is safe to run on its own
 * (`--verify-only`) against accounts the bot has never touched.
 *
 * Two independent definitions of "all" are applied:
 *
 *  1. **Nothing left to do** - no row still offers "Enable actions" (ignoring
 *     SKIP_CONNECTORS) and no card still offers "Install". This is the default
 *     and needs no configuration.
 *  2. **Expected names present** - if EXPECT_CONNECTORS / EXPECT_SKILLS are
 *     set, each of those names must actually appear in the enabled/installed
 *     list. This catches the opposite failure: a connector that is missing
 *     from the account altogether, so the UI never offers it and check 1
 *     passes vacuously.
 */
export async function verifyUser(page, scope = { connectors: true, skills: true }) {
  log.step('Verifying the account state');

  const report = {
    connectorsEnabled: [],
    connectorsPending: [],
    connectorsSkipped: [],
    skillsInstalled: [],
    skillsMissing: [],
    missingExpected: [],
    errors: [],
    ok: false,
  };

  if (scope.connectors) await checkConnectors(page, report);
  if (scope.skills) await checkSkills(page, report);

  report.ok =
    !report.errors.length &&
    !report.connectorsPending.length &&
    !report.skillsMissing.length &&
    !report.missingExpected.length;

  summarize(report, scope);
  return report;
}

/* ------------------------------------------------------------------ */

async function checkConnectors(page, report) {
  try {
    await returnToComposer(page);

    const { enabled, pending, skipped } = await readConnectorStates(page);
    report.connectorsEnabled = enabled;
    report.connectorsPending = pending;
    report.connectorsSkipped = skipped;

    report.missingExpected.push(
      ...missing(config.expectConnectors, enabled).map((name) => `connector:${name}`),
    );

    await shoot(page, 'verify-connectors');
  } catch (err) {
    log.error(`connector verification failed: ${err.message}`);
    report.errors.push(`connectors: ${err.message}`);
    await shoot(page, 'verify-connectors-failure');
  } finally {
    await closeMenu(page).catch(() => {});
  }
}

/**
 * Makes sure the composer (and therefore the Sources menu) is on screen.
 *
 * When verification runs after the skills phase the app is still on the Skills
 * page, where no connectors button exists. Three escalating ways back, because
 * only the last one is guaranteed and it costs a full page load:
 * a Chat/Home nav entry, the browser's back button, then a reload.
 */
async function returnToComposer(page) {
  if (await composerVisible(page, 2_000)) return;

  log.info('not on the composer - navigating back to it');

  const home = await firstVisible(
    [
      page.getByRole('link', { name: /^(chat|home|new chat)$/i }),
      page.getByRole('button', { name: /^(chat|home|new chat)$/i }),
      page.locator('[aria-label*="new chat" i], [aria-label="Home"], [aria-label="Chat"]'),
    ],
    { timeout: 4_000 },
  );

  if (home) {
    await home.click({ timeout: 8_000 }).catch(() => {});
    if (await composerVisible(page, 6_000)) return;
  }

  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  if (await composerVisible(page, 5_000)) return;

  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(3_000);
  if (!(await composerVisible(page, config.timeout))) {
    throw new Error('Could not get back to the composer to read the Sources menu.');
  }
}

const composerVisible = async (page, timeout) =>
  Boolean(
    await firstVisible(
      [
        page.locator('[aria-label="Sources"]'),
        page.locator('[aria-label*="source" i], [aria-label*="connector" i]'),
        page.getByRole('button', { name: /^(sources|connectors)$/i }),
      ],
      { timeout },
    ),
  );

async function checkSkills(page, report) {
  try {
    await openSkillsPage(page);
    const { installed, missing: notInstalled } = await readSkillStates(page);
    report.skillsInstalled = installed;
    report.skillsMissing = notInstalled;

    report.missingExpected.push(...missing(config.expectSkills, installed).map((n) => `skill:${n}`));

    await shoot(page, 'verify-skills');
  } catch (err) {
    log.error(`skills verification failed: ${err.message}`);
    report.errors.push(`skills: ${err.message}`);
    await shoot(page, 'verify-skills-failure');
  }
}

/**
 * Expected names that are absent from `present`.
 *
 * Matching is a case-insensitive substring both ways, because the UI label
 * ("Gmail ") and the configured name ("gmail") rarely match exactly, and skill
 * names are read as "/slug".
 */
function missing(expected, present) {
  const have = present.map((p) => p.toLowerCase());
  return expected.filter((want) => {
    const needle = want.toLowerCase();
    return !have.some((got) => got.includes(needle) || needle.includes(got));
  });
}

function summarize(report, scope) {
  if (scope.connectors) {
    log.info(`connectors enabled: ${list(report.connectorsEnabled)}`);
    if (report.connectorsSkipped.length) {
      log.info(`connectors ignored via SKIP_CONNECTORS: ${list(report.connectorsSkipped)}`);
    }
    if (report.connectorsPending.length) {
      log.error(`connectors NOT enabled: ${list(report.connectorsPending)}`);
    } else if (!report.errors.some((e) => e.startsWith('connectors:'))) {
      log.ok('every connector is enabled');
    }
  }

  if (scope.skills) {
    log.info(`skills installed: ${report.skillsInstalled.length}`);
    if (report.skillsMissing.length) {
      log.error(`skills NOT installed: ${list(report.skillsMissing)}`);
    } else if (!report.errors.some((e) => e.startsWith('skills:'))) {
      log.ok('every skill is installed');
    }
  }

  if (report.missingExpected.length) {
    log.error(`expected but never found: ${list(report.missingExpected)}`);
  }

  if (report.ok) log.ok('VERIFIED - account is fully set up');
  else log.warn('NOT VERIFIED - see the items above');
}

const list = (items) => items.map((i) => `"${i}"`).join(', ') || 'none';
