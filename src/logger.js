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

const ICONS = { info: 'ℹ', step: '▶', ok: '✔', warn: '⚠', error: '✖' };

const safe = (s) => s.replace(/[^a-z0-9._@-]+/gi, '_').slice(0, 60);

/** A fresh folder path under runs/, named after the current time. Created on first write. */
export const newRunDir = () =>
  path.join(process.cwd(), 'runs', new Date().toISOString().replace(/[:.]/g, '-'));

/** Root directory for this process's screenshots (single-user mode). */
export const baseRunDir = newRunDir();

/**
 * A logical section of a run: the prefix shown on every log line (e.g. the
 * current user in a batch run), the folder its screenshots go to, and that
 * folder's screenshot counter. `root` is the run's folder, `file` its
 * run.log stream (batch runs only) and `meta` whatever the caller attached
 * (the batch runner passes the user's index and email for the web UI).
 */
const makeSection = ({ name = '', meta = {}, root, file = null }) => ({
  name,
  meta,
  root,
  file,
  scope: name ? ` ${COLORS.dim}[${name}]${COLORS.reset}` : '',
  dir: name ? path.join(root, safe(name)) : root,
  shots: 0,
  muted: false,
});

/**
 * The active section lives in AsyncLocalStorage instead of a module-level
 * variable: a parallel batch run has several users in flight at once, and
 * each one must keep its own prefix, folder and counter across every await.
 * Code outside withRunRoot()/withRunContext() - single-user mode - uses the
 * process-wide section.
 */
const sections = new AsyncLocalStorage();
const processSection = makeSection({ root: baseRunDir });
const current = () => sections.getStore() ?? processSection;

const listeners = new Set();

/**
 * Subscribes to every log line and screenshot, e.g. to stream them to the web
 * UI. Events carry the section's name, meta and run folder (`root`) so a
 * listener can tell runs and users apart. Returns an unsubscribe function.
 */
export function onLogEvent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const emit = (event) => {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* a listener must never break logging */
    }
  }
};

const write = (kind, msg) => {
  const target = current();
  if (target.muted) return;
  const time = new Date().toISOString();
  console.log(
    `${COLORS.dim}[${time.slice(11, 19)}]${COLORS.reset}${target.scope} ${COLORS[kind]}${ICONS[kind]} ${msg}${COLORS.reset}`,
  );
  target.file?.write(`${time} ${target.name ? `[${target.name}] ` : ''}${ICONS[kind]} ${msg}\n`);
  emit({ type: 'log', time, kind, msg: String(msg), section: target.name, meta: target.meta, root: target.root });
};

export const log = {
  info: (m) => write('info', m),
  step: (m) => write('step', m),
  ok: (m) => write('ok', m),
  warn: (m) => write('warn', m),
  error: (m) => write('error', m),
};

export const runDir = () => current().dir;

/**
 * Runs `fn` as one batch run whose files all live in `root`: sections opened
 * inside it put their screenshots under `root`, and every log line is also
 * appended to `root`/run.log so the run can be reviewed later (the web UI's
 * run history reads it).
 */
export async function withRunRoot(root, fn) {
  fs.mkdirSync(root, { recursive: true });
  const file = fs.createWriteStream(path.join(root, 'run.log'), { flags: 'a' });
  file.on('error', () => {}); // best-effort, like screenshots
  try {
    return await sections.run(makeSection({ root, file }), fn);
  } finally {
    if (!file.closed) {
      await new Promise((resolve) => {
        file.once('close', resolve);
        file.end();
      });
    }
  }
}

/**
 * Runs `fn` as a new logical section: screenshots go to their own subfolder
 * and the log gains a prefix. Used by the batch runner to keep users apart -
 * including users running at the same time, because the section follows `fn`
 * through every await rather than being process-wide.
 */
export function withRunContext(name, fn, meta = {}) {
  const parent = current();
  return sections.run(makeSection({ name, meta, root: parent.root, file: parent.file }), fn);
}

/**
 * Drops all further output (log lines and screenshots) of the current section.
 * A stopped user's flow is abandoned rather than awaited: it winds down in the
 * background against its closed browser and would otherwise keep printing
 * errors after the run has ended.
 */
export function mute() {
  const target = current();
  if (target.name) target.muted = true;
}

/** Saves a screenshot of `page`, named after the current step. Never throws. */
export async function shoot(page, name) {
  const target = current();
  if (!config.screenshots || target.muted || !page || page.isClosed()) return;
  try {
    fs.mkdirSync(target.dir, { recursive: true });
    const file = path.join(target.dir, `${String(++target.shots).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    log.info(`screenshot → ${path.relative(process.cwd(), file)}`);
    if (!target.muted) {
      emit({
        type: 'screenshot',
        time: new Date().toISOString(),
        file,
        label: name,
        section: target.name,
        meta: target.meta,
        root: target.root,
      });
    }
  } catch {
    /* screenshots are best-effort only */
  }
}
