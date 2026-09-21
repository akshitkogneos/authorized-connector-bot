import fs from 'node:fs';
import path from 'node:path';
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

/** Prefix shown on every line, e.g. the current user in a batch run. */
let scope = '';

const write = (kind, icon, msg) =>
  console.log(
    `${COLORS.dim}[${stamp()}]${COLORS.reset}${scope} ${COLORS[kind]}${icon} ${msg}${COLORS.reset}`,
  );

export const log = {
  info: (m) => write('info', 'ℹ', m),
  step: (m) => write('step', '▶', m),
  ok: (m) => write('ok', '✔', m),
  warn: (m) => write('warn', '⚠', m),
  error: (m) => write('error', '✖', m),
};

/** Root directory for this process's screenshots. */
export const baseRunDir = path.join(
  process.cwd(),
  'runs',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

let currentDir = baseRunDir;
let shotIndex = 0;

export const runDir = () => currentDir;

/**
 * Starts a new logical section: screenshots go to their own subfolder and the
 * log gains a prefix. Used by the batch runner to keep users apart.
 */
export function setRunContext(name) {
  currentDir = name ? path.join(baseRunDir, safe(name)) : baseRunDir;
  scope = name ? ` ${COLORS.dim}[${name}]${COLORS.reset}` : '';
  shotIndex = 0;
}

/** Saves a screenshot of `page`, named after the current step. Never throws. */
export async function shoot(page, name) {
  if (!config.screenshots || !page || page.isClosed()) return;
  try {
    fs.mkdirSync(currentDir, { recursive: true });
    const file = path.join(currentDir, `${String(++shotIndex).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    log.info(`screenshot → ${path.relative(process.cwd(), file)}`);
  } catch {
    /* screenshots are best-effort only */
  }
}

const safe = (s) => s.replace(/[^a-z0-9._@-]+/gi, '_').slice(0, 60);
