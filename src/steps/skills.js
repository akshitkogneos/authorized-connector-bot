import { config } from '../config.js';
import { log, shoot } from '../logger.js';
import { clean, clickFirst, firstVisible, sleep } from '../utils.js';

/**
 * Selector notes (from tools/inspect.js skills):
 *
 *  - Left nav entries are links, not buttons: getByRole('link', 'Skills').
 *  - The Skills page has three Material Web buttons in a row; the middle one
 *    is "Browse Skills". Their text lives in the host's light DOM, so we match
 *    on text (Playwright sees slotted text) with a positional fallback.
 *  - Each marketplace card is a <ucs-skill-marketplace-card> whose install
 *    control is a <ucs-luminous-button> wrapping <button class="luminous-button">
 *    with the text "add_2 Install" ("add_2" is the Material icon ligature).
 *  - The card itself has role="button", so we must NOT match on a generic
 *    [role="button"]:has-text("Install") - that would click the card and open
 *    its detail view instead of installing.
 */
const INSTALL_BUTTONS = 'button.luminous-button, ucs-luminous-button';

/** Material icon ligatures that leak into textContent. */
const ICON_WORDS = /\b(add_2|add_circle|add|check|check_circle|done|downloading|progress_activity|delete|more_vert)\b/g;

const label = (raw) => clean((raw || '').replace(ICON_WORDS, ' '));

const navSkills = (page) => [
  page.getByRole('link', { name: /^skills$/i }),
  page.getByRole('button', { name: /^skills$/i }),
  page.locator('[aria-label="Skills"]'),
  page.getByText(/^skills$/i),
];

/** Clicks "Skills" in the left nav and waits for the panel to settle. */
export async function openSkillsPage(page) {
  log.step('Opening Skills');
  await clickFirst(navSkills(page), 'Skills (left nav)', { timeout: 20_000 });
  await sleep(3_500);
  await shoot(page, 'skills-page');
}

/**
 * Step 11-13: open Skills from the left nav, click "Browse Skills", then press
 * every "+ Install" button in the dialog.
 */
export async function installSkills(page) {
  await openSkillsPage(page);

  await openMarketplace(page);
  await sleep(3_500);
  await shoot(page, 'skills-dialog');

  const failed = [];
  let installed = 0;

  // Progress is measured by how many "Install" buttons are left, because the
  // list re-orders itself after each install - any index or fallback name is
  // only valid for a single scan. `cursor` moves on only when a click fails to
  // reduce that count, so a single stubborn card cannot block the rest.
  let cursor = 0;
  let stuck = 0;

  for (let round = 1; round <= config.maxSkills + 5; round += 1) {
    if (installed >= config.maxSkills) break;

    const rows = await collectInstallable(page);
    if (!rows.length) {
      log.info('no skill is left showing "Install"');
      break;
    }
    if (cursor >= rows.length) {
      log.info('every remaining "Install" button has already been tried');
      break;
    }

    const next = rows[cursor];
    const before = rows.length;
    log.step(`(${installed + 1}) Installing "${next.name}"`);

    try {
      await next.button.scrollIntoViewIfNeeded().catch(() => {});
      await next.button.click({ timeout: 15_000 }).catch(() => next.button.click({ force: true }));
      await sleep(2_500);

      const after = (await collectInstallable(page)).length;
      if (after < before) {
        installed += 1;
        stuck = 0;
        log.ok(`"${next.name}" installed (${after} left)`);
      } else {
        stuck += 1;
        cursor += 1;
        log.warn(`"${next.name}" still shows "Install" - skipping it`);
        failed.push(next.name);
        if (stuck >= 3) {
          log.warn('three clicks in a row changed nothing - stopping');
          break;
        }
      }
    } catch (err) {
      cursor += 1;
      failed.push(next.name);
      log.error(`"${next.name}" failed: ${err.message}`);
    }
  }

  await shoot(page, 'skills-final');
  return { installed, failed };
}

/* ------------------------------------------------------------------ */

/**
 * Opens the skills marketplace dialog.
 *
 * The entry point depends on state, so each strategy is tried and then
 * *verified*:
 *   A. empty state - a row of three buttons, the middle one "Browse Skills"
 *   B. once at least one skill is installed that row is gone, and the only
 *      way in is the "+" icon at the top of the Skills panel
 *   C. positional fallback for A if the label ever changes
 */
export async function openMarketplace(page) {
  const strategies = [
    ['"Browse Skills" button', () => clickBrowseSkills(page)],
    ['"+" in the Skills panel header', () => clickPlusIcon(page)],
    ['middle of the three action buttons', () => clickMiddleButton(page)],
  ];

  for (const [name, attempt] of strategies) {
    const clicked = await attempt().catch(() => false);
    if (!clicked) continue;

    if (await marketplaceOpen(page)) {
      log.ok(`skills marketplace opened via ${name}`);
      return;
    }
    log.warn(`${name} did not open the marketplace - trying the next option`);
  }

  throw new Error('Could not open the skills marketplace.');
}

/** True once the marketplace dialog (filter chips / install cards) is visible. */
async function marketplaceOpen(page) {
  const marker = await firstVisible(
    [
      page.locator('md-filter-chip'),
      page.locator('ucs-skill-marketplace-card'),
      page.locator(INSTALL_BUTTONS),
    ],
    { timeout: 6_000 },
  );
  return Boolean(marker);
}

async function clickBrowseSkills(page) {
  const button = await firstVisible(
    [
      page.locator(':is(md-filled-button, md-filled-tonal-button, md-outlined-button, md-text-button, button):has-text("Browse Skills")'),
      page.getByRole('button', { name: /browse skills/i }),
      page.getByRole('menuitem', { name: /browse skills/i }),
    ],
    { timeout: 8_000 },
  );
  if (!button) return false;
  await button.click({ timeout: 10_000 }).catch(() => button.click({ force: true }));
  return true;
}

/**
 * Clicks the "+" at the top of the Skills panel. If it opens a menu rather
 * than the dialog, follow the "Browse"/"Marketplace" entry.
 */
async function clickPlusIcon(page) {
  const labelled = await firstVisible(
    [
      page.locator('[aria-label*="browse skill" i]'),
      page.locator('[aria-label*="add skill" i], [aria-label*="new skill" i]'),
      page.locator('[aria-label*="install skill" i], [aria-label*="create skill" i]'),
    ],
    { timeout: 4_000 },
  );

  if (labelled) {
    await labelled.click({ timeout: 10_000 }).catch(() => labelled.click({ force: true }));
  } else {
    // Positional: an icon button in the Skills panel header (2nd column, top).
    const icons = page.locator('md-icon-button, button.icon-button');
    const total = await icons.count().catch(() => 0);
    let target = null;

    for (let i = 0; i < total; i += 1) {
      const el = icons.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const box = await el.boundingBox().catch(() => null);
      if (box && box.x > 290 && box.x < 620 && box.y < 80) {
        target = el;
        break;
      }
    }
    if (!target) return false;
    await target.click({ timeout: 10_000 }).catch(() => target.click({ force: true }));
  }

  await sleep(1_500);
  // The "+" may open a small menu first.
  await clickBrowseSkills(page).catch(() => false);
  return true;
}

async function clickMiddleButton(page) {
  const trio = page.locator('md-filled-button, md-filled-tonal-button, md-outlined-button');
  const boxes = [];
  const total = await trio.count().catch(() => 0);

  for (let i = 0; i < total; i += 1) {
    const el = trio.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const box = await el.boundingBox().catch(() => null);
    if (box && box.x > 300) boxes.push({ el, x: box.x });
  }
  boxes.sort((a, b) => a.x - b.x);

  if (boxes.length < 2) return false;
  await boxes[1].el.click({ timeout: 10_000 }).catch(() => boxes[1].el.click({ force: true }));
  return true;
}

/**
 * Lists the cards whose button currently reads exactly "Install".
 * "Installed" / "Open" / "Uninstall" are deliberately excluded.
 */
async function collectInstallable(page) {
  const rows = (await scanCards(page)).filter((r) => r.state === 'install');
  log.info(`skills awaiting install: ${rows.map((r) => `"${r.name}"`).join(', ') || 'none'}`);
  return rows;
}

/**
 * Read-only snapshot of the marketplace: every card that still offers
 * "Install" (missing) and every card that no longer does (installed).
 *
 * The caller must already be on the Skills page; this opens the marketplace
 * but never clicks a card.
 */
export async function readSkillStates(page) {
  await openMarketplace(page);
  await sleep(3_000);

  const cards = await scanCards(page);
  return {
    missing: cards.filter((c) => c.state === 'install').map((c) => c.name),
    installed: cards.filter((c) => c.state === 'installed').map((c) => c.name),
  };
}

/**
 * Every visible marketplace button, de-duplicated by position and tagged with
 * its state: `install` (still offered) or `installed` (Installed / Open /
 * Uninstall / Remove). Anything else is ignored - it is not a card control.
 */
async function scanCards(page) {
  const buttons = page.locator(INSTALL_BUTTONS);
  const total = await buttons.count().catch(() => 0);

  const rows = [];
  const seen = new Set();

  for (let i = 0; i < total; i += 1) {
    const button = buttons.nth(i);
    if (!(await button.isVisible().catch(() => false))) continue;

    const text = label(await button.textContent().catch(() => ''));
    const state = cardState(text);
    if (!state) continue;

    const box = await button.boundingBox().catch(() => null);
    const key = box ? `${Math.round(box.x)}:${Math.round(box.y)}` : `idx-${i}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({ name: await skillName(button, rows.length), state, button });
  }

  return rows;
}

const cardState = (text) => {
  if (/^install$/i.test(text)) return 'install';
  if (/^(installed|uninstall|open|remove|added)$/i.test(text)) return 'installed';
  return null;
};

/**
 * Finds the skill name for an install button by climbing its ancestors
 * (crossing shadow-root boundaries) until one of them contains a "/slug",
 * which is how every marketplace card titles itself.
 */
async function skillName(button, fallbackIndex) {
  const raw = await button
    .evaluate((el) => {
      let node = el;
      for (let i = 0; i < 12; i += 1) {
        const root = node.getRootNode();
        const parent = node.parentElement || (root && root.host) || null;
        if (!parent) break;
        node = parent;
        const text = node.innerText || node.textContent || '';
        if (/\/[a-z0-9][a-z0-9-_]{2,}/i.test(text)) return text;
      }
      return '';
    })
    .catch(() => '');

  const text = label(raw);
  const slash = text.match(/\/[a-z0-9][a-z0-9-_]{2,}/i);
  if (slash) return slash[0];

  // Fall back to a position-based id: an index would change between scans.
  const box = await button.boundingBox().catch(() => null);
  return box ? `skill @${Math.round(box.x)},${Math.round(box.y)}` : `skill #${fallbackIndex + 1}`;
}
