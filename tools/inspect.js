/**
 * DOM inspector - run this once against the real app to discover the actual
 * selectors (the toolbar buttons are icon-only, so text matching is useless).
 *
 *   node tools/inspect.js
 *
 * It signs in, clears onboarding, dumps every button around the prompt, then
 * clicks the 3rd left-hand icon (expected: Connectors) and dumps the menu.
 * Everything lands in runs/inspect-<timestamp>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { assertConfig, config } from '../src/config.js';
import { launchBrowser } from '../src/browser.js';
import { log } from '../src/logger.js';
import { firstVisible, sleep } from '../src/utils.js';
import { login } from '../src/steps/login.js';
import { dismissOnboarding } from '../src/steps/onboarding.js';

const OUT = path.join(process.cwd(), 'runs', `inspect-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

/**
 * The whole app lives inside nested shadow roots, so a plain
 * document.querySelectorAll sees nothing. This walker pierces them.
 */
const WALKER = `
function __deepAll(sel) {
  const out = [];
  const visit = (root) => {
    let els;
    try { els = root.querySelectorAll('*'); } catch { return; }
    for (const el of els) {
      if (el.matches && el.matches(sel)) out.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(document);
  return out;
}
function __visible(el) {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
}
function __describe(el) {
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
    ariaLabel: el.getAttribute('aria-label'),
    title: el.getAttribute('title'),
    tooltip: el.getAttribute('mattooltip') || el.getAttribute('data-tooltip'),
    role: el.getAttribute('role'),
    id: el.id || null,
    cls: (el.getAttribute('class') || '').slice(0, 140),
    testId: el.getAttribute('data-test-id') || el.getAttribute('data-testid'),
    host: el.getRootNode().host ? el.getRootNode().host.tagName.toLowerCase() : 'document',
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
  };
}
`;

/** page.evaluate() takes a single expression, so each dump is an IIFE. */
const wrap = (expr) => `(() => { ${WALKER}\nreturn ${expr}; })()`;

const DUMP_BUTTONS = wrap(`__deepAll('button, [role="button"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"]')
  .filter(__visible).map(__describe)`);

const DUMP_PROMPT = wrap(`({
  textish: __deepAll('textarea, [contenteditable="true"], [role="textbox"], input[type="text"]')
    .filter(__visible)
    .filter((el) => el.getBoundingClientRect().width > 150)
    .map((el) => Object.assign(__describe(el), {
      placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder'),
    })),
  iframes: [...document.querySelectorAll('iframe')].map((f) => f.src).slice(0, 10),
  customElements: [...new Set(__deepAll('*').filter((e) => e.shadowRoot).map((e) => e.tagName.toLowerCase()))].slice(0, 40),
})`);

const DUMP_OVERLAY = wrap(`__deepAll('[role="menu"], [role="dialog"], [role="listbox"], .cdk-overlay-pane, .mat-mdc-menu-panel')
  .filter(__visible)
  .map((p) => ({
    role: p.getAttribute('role'),
    cls: (p.getAttribute('class') || '').slice(0, 140),
    host: p.getRootNode().host ? p.getRootNode().host.tagName.toLowerCase() : 'document',
    text: (p.innerText || '').replace(/\\n{2,}/g, '\\n').trim().slice(0, 2000),
    controls: [...p.querySelectorAll('*')]
      .filter((e) => __visible(e) && (e.tagName === 'BUTTON' || ['button','switch','checkbox','menuitem','option'].includes(e.getAttribute('role'))))
      .map(__describe)
      .slice(0, 60),
  }))`);

const MODE = (process.argv[2] || 'composer').replace(/^--/, '');

const show = (b, i) =>
  log.info(
    `  [${i}] x=${b.x} y=${b.y} tag=${b.tag} label="${b.ariaLabel || ''}" text="${b.text}" host=${b.host} cls="${b.cls}"`,
  );

/** Mode "composer": dumps the prompt toolbar and the Sources menu. */
async function inspectComposer(page, report) {
  report.prompt = await page.evaluate(DUMP_PROMPT);
  report.buttons = await page.evaluate(DUMP_BUTTONS);
  await page.screenshot({ path: OUT.replace('.json', '-page.png') }).catch(() => {});

  const promptY = report.prompt.textish[0]?.y ?? 0;
  const near = report.buttons
    .filter((b) => Math.abs(b.y - promptY) < 200 && b.w < 90 && b.h < 90)
    .sort((a, b) => a.x - b.x);
  report.composerButtons = near;

  log.step('Composer-area icon buttons (left to right):');
  near.forEach(show);

  const third = near[2];
  if (!third) return;

  log.step(`Clicking composer button [2] (aria-label="${third.ariaLabel}")`);
  await page.mouse.click(third.x + third.w / 2, third.y + third.h / 2);
  await sleep(2_500);
  report.overlayAfterThirdClick = await page.evaluate(DUMP_OVERLAY);
  report.buttonsAfterThirdClick = await page.evaluate(DUMP_BUTTONS);
  await page.screenshot({ path: OUT.replace('.json', '-menu.png') }).catch(() => {});
}

/**
 * Mode "skills": left nav "Skills" -> the 3 buttons on that page ->
 * "Browse Skills" -> the install dialog.
 */
async function inspectSkills(page, report) {
  log.step('Clicking "Skills" in the left nav');
  const nav = await firstVisible(
    [
      page.getByRole('link', { name: /^skills$/i }),
      page.getByRole('button', { name: /^skills$/i }),
      page.locator('[aria-label="Skills"]'),
      page.getByText(/^skills$/i),
    ],
    { timeout: 20_000 },
  );
  if (!nav) throw new Error('Could not find "Skills" in the left nav.');
  await nav.click();
  await sleep(4_000);

  report.skillsPageButtons = await page.evaluate(DUMP_BUTTONS);
  report.skillsPageText = await page.evaluate(
    `document.body.innerText.replace(/\\n{2,}/g, '\\n').slice(0, 2000)`,
  );
  await page.screenshot({ path: OUT.replace('.json', '-skills-page.png') }).catch(() => {});

  log.step('Buttons on the Skills page:');
  report.skillsPageButtons.sort((a, b) => a.y - b.y || a.x - b.x).forEach(show);

  log.step('Clicking "Browse Skills"');
  const browse = await firstVisible(
    [
      page.locator(':is(md-outlined-button, md-filled-button, md-text-button, button, [role="button"]):has-text("Browse Skills")'),
      page.getByRole('button', { name: /browse skills/i }),
      page.locator('[aria-label*="browse" i]'),
    ],
    { timeout: 15_000 },
  );
  if (browse) await browse.click().catch(() => browse.click({ force: true }));
  else log.warn('"Browse Skills" not found by text - check the dump above');
  await sleep(4_000);

  report.skillsDialog = await page.evaluate(DUMP_OVERLAY);
  report.skillsDialogButtons = await page.evaluate(DUMP_BUTTONS);
  await page.screenshot({ path: OUT.replace('.json', '-skills-dialog.png') }).catch(() => {});

  log.step('Buttons after opening Browse Skills:');
  report.skillsDialogButtons.sort((a, b) => a.y - b.y || a.x - b.x).forEach(show);

  for (const panel of report.skillsDialog || []) {
    log.info(`  panel role=${panel.role} host=${panel.host} cls=${panel.cls}`);
    log.info(`  text:\n${panel.text}`);
  }
}

async function main() {
  assertConfig();
  const { browser, context, page } = await launchBrowser();
  const report = { url: config.targetUrl, mode: MODE, when: new Date().toISOString() };

  try {
    await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });
    await sleep(2_000);
    await login(page);
    await dismissOnboarding(page);
    await sleep(4_000);

    if (MODE === 'skills') await inspectSkills(page, report);
    else await inspectComposer(page, report);
  } catch (err) {
    report.error = err.message;
    log.error(err.message);
  } finally {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    log.ok(`report written to ${path.relative(process.cwd(), OUT)}`);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

await main();
