import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';

const COLORS = {
  info: '\x1b[36m',
  step: '\x1b[35m',
  ok: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  dim: '\x1b[90m',
  reset: '\x1b[0m',
};

const stamp = () => new Date().toISOString().slice(11, 19);

const safe = (s) => s.replace(/[^a-z0-9._@-]+/gi, '_').slice(0, 60);

/** Root directory for this process's screenshots. */
export const baseRunDir = path.join(
  process.cwd(),
  'runs',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

/**
 * A logical section of a run: the prefix shown on every log line (e.g. the
 * current user in a batch run), the folder its screenshots go to, and that
 * folder's screenshot counter.
 */
const section = (name) => ({
  scope: name ? ` ${COLORS.dim}[${name}]${COLORS.reset}` : '',
  dir: name ? path.join(baseRunDir, safe(name)) : baseRunDir,
  shots: 0,
});

/**
 * The active section lives in AsyncLocalStorage instead of a module-level
 * variable: a parallel batch run has several users in flight at once, and
 * each one must keep its own prefix, folder and counter across every await.
 * Code outside withRunContext() - single-user mode, the batch header and
 * summary - uses the root section.
 */
const sections = new AsyncLocalStorage();
const rootSection = section('');
const current = () => sections.getStore() ?? rootSection;

const write = (kind, icon, msg) =>
  console.log(
    `${COLORS.dim}[${stamp()}]${COLORS.reset}${current().scope} ${COLORS[kind]}${icon} ${msg}${COLORS.reset}`,
  );

export const log = {
  info: (m) => write('info', 'ℹ', m),
  step: (m) => write('step', '▶', m),
  ok: (m) => write('ok', '✔', m),
  warn: (m) => write('warn', '⚠', m),
  error: (m) => write('error', '✖', m),
};

export const runDir = () => current().dir;

/**
 * Runs `fn` as a new logical section: screenshots go to their own subfolder
 * and the log gains a prefix. Used by the batch runner to keep users apart -
 * including users running at the same time, because the section follows `fn`
 * through every await rather than being process-wide.
 */
export function withRunContext(name, fn) {
  return sections.run(section(name), fn);
}

/** Saves a screenshot of `page`, named after the current step. Never throws. */
export async function shoot(page, name) {
  if (!config.screenshots || !page || page.isClosed()) return;
  const target = current();
  try {
    fs.mkdirSync(target.dir, { recursive: true });
    const file = path.join(target.dir, `${String(++target.shots).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    log.info(`screenshot → ${path.relative(process.cwd(), file)}`);
  } catch {
    /* screenshots are best-effort only */
  }
}
