#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { CSV_PATH, PARALLEL } from '../batch.js';
import { isActive, readCsvObjects, toUsers } from '../csv.js';
import { log } from '../logger.js';
import { MAX_UPLOAD_BYTES, createCsvStore } from './csv-files.js';
import { isRunId, listRuns, loadRun } from './history.js';
import { HttpError, MODES, createRunner, modePhases } from './runner.js';

/**
 * Local web UI for batch runs: `npm run ui`.
 *
 * A zero-dependency node:http server bound to 127.0.0.1 that serves the page
 * (src/ui/public), Material Web from node_modules, the files under runs/, a
 * small JSON API and a server-sent-events stream with live progress.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const NODE_MODULES = path.resolve(HERE, '../../node_modules');
const RUNS_DIR = path.join(process.cwd(), 'runs'); // where logger.js writes runs
const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads'); // CSVs uploaded from the page (git-ignored)

const HOST = '127.0.0.1';
const FIXED_PORT = Number.parseInt(process.env.UI_PORT, 10);
const OPEN_BROWSER = !process.argv.includes('--no-open') && !/^(0|false|no|off)$/i.test(process.env.UI_OPEN ?? '');
const APP_ID = 'authorized-connectors-bot-ui';

/** Packages the page may import from node_modules: Material Web and its dependencies. */
const VENDOR = ['@material/web', '@lit/reactive-element', 'lit-element', 'lit-html', 'lit', 'tslib'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

const clients = new Set();

function broadcast(type, data) {
  const message = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(message);
}

const runner = createRunner({ runsDir: RUNS_DIR, broadcast });

// The users file the UI shows and runs: CSV_PATH until one is uploaded or picked.
const csvFiles = createCsvStore({ defaultPath: CSV_PATH, uploadDir: UPLOAD_DIR });

// Comments keep idle connections from being dropped by the browser.
setInterval(() => {
  for (const res of clients) res.write(': keep-alive\n\n');
}, 15_000).unref();

function events(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  res.write(`event: snapshot\ndata: ${JSON.stringify(runner.snapshot())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Everything the page needs besides the live run: users, modes, settings. */
function state() {
  return {
    app: APP_ID,
    target: config.targetUrl,
    csv: readUsers(),
    modes: modePhases(),
    defaults: { mode: 'full', parallel: PARALLEL },
    settings: settings(),
  };
}

/** All rows of the users file in use, inactive ones flagged. Passwords never leave the server. */
function readUsers() {
  const csvPath = csvFiles.path();
  const file = path.relative(process.cwd(), csvPath) || csvPath;
  const base = { file, name: csvFiles.name(), isDefault: csvFiles.isDefault(), defaultFile: csvFiles.defaultFile() };
  if (!fs.existsSync(csvPath)) {
    return {
      ...base,
      users: [],
      error: `${file} was not found. Upload a CSV, set USERS_CSV in .env or start the UI with csv=path/to/users.csv.`,
    };
  }
  try {
    const users = toUsers(readCsvObjects(csvPath), { onlyActive: false }).map((u) => ({
      email: u.email,
      name: u.name,
      status: u.status,
      line: u.line,
      active: isActive(u),
    }));
    return { ...base, users, error: users.length ? null : `${file} has no usable rows (it needs Email and Password columns).` };
  } catch (err) {
    return { ...base, users: [], error: `Could not read ${file}: ${err.message}` };
  }
}

/** Changing the users file mid-run would make the table disagree with the run. */
function assertIdle() {
  if (runner.isActive()) throw new HttpError(409, 'Wait until the current run has finished before changing the users file.');
}

/** Replies to a users-file change and tells every open tab to reload. */
function csvChanged(res, extra = {}) {
  const csv = readUsers();
  broadcast('csv', { file: csv.file });
  sendJson(res, 200, { ...extra, csv });
}

async function uploadCsv(req, res) {
  assertIdle();
  const body = await readJson(req, MAX_UPLOAD_BYTES * 2); // JSON escaping can double the size
  const { file, reused } = csvFiles.save({ name: body.name, content: body.content });
  log.info(`web UI: ${reused ? 'switched to the earlier upload of' : 'uploaded'} ${file.name} (${file.users} users) -> ${file.file}`);
  csvChanged(res, { file, reused });
}

async function selectCsv(req, res) {
  assertIdle();
  const file = csvFiles.select((await readJson(req)).id);
  log.info(`web UI: now using ${file.file}`);
  csvChanged(res, { file });
}

async function deleteCsv(req, res) {
  assertIdle();
  const { id } = await readJson(req);
  const now = csvFiles.remove(id);
  log.info(`web UI: deleted the upload ${id} - using ${now.file}`);
  csvChanged(res, { file: now });
}

/** The effective settings from .env, for the read-only Configuration page. */
function settings() {
  const ms = (n) => `${n.toLocaleString('en-US')} ms`;
  const list = (items) => (items.length ? items.join(', ') : '');
  return [
    ['Target', 'TARGET_URL', config.targetUrl, 'The web app every user signs in to.'],
    ['Users', 'USERS_CSV', path.relative(process.cwd(), CSV_PATH), 'Default accounts file. Needs Email and Password columns; only rows with Status "Active" run unless inactive users are included. The UI can switch to an uploaded CSV instead.'],
    ['Users', 'PARALLEL', PARALLEL, 'How many users run at the same time by default, each in its own browser.'],
    ['Users', 'BATCH_DELAY', ms(config.batchDelay), 'Minimum gap between two sign-ins. With one user at a time: the pause between users.'],
    ['Phases', 'DO_CONNECTORS', config.doConnectors, 'Authorize connectors during a full run.'],
    ['Phases', 'DO_SKILLS', config.doSkills, 'Install skills during a full run.'],
    ['Phases', 'DO_VERIFY', config.doVerify, 'Re-check every connector and skill after the work is done (read-only).'],
    ['Phases', 'MAX_CONNECTORS', config.maxConnectors, 'Safety cap on connectors authorized per user.'],
    ['Phases', 'MAX_SKILLS', config.maxSkills, 'Safety cap on skills installed per user.'],
    ['Phases', 'SKIP_CONNECTORS', list(config.skipConnectors), 'Connector rows that are never touched.'],
    ['Phases', 'SELECT_ALL_SCOPES', config.selectAllScopes, 'Tick "Select all" on the Google consent screen before clicking Allow.'],
    ['Phases', 'EXPECT_CONNECTORS', list(config.expectConnectors), 'Connectors that must end up enabled for a user to count as verified.'],
    ['Phases', 'EXPECT_SKILLS', list(config.expectSkills), 'Skills that must end up installed for a user to count as verified.'],
    ['Browser', 'HEADLESS', config.headless, 'Hide the browser windows. Google sign-in usually needs them visible.'],
    ['Browser', 'BROWSER_CHANNEL', config.channel || 'bundled Chromium', 'Browser to drive; "chrome" is recommended for Google sign-in.'],
    ['Browser', 'USE_INCOGNITO_WINDOW', config.incognitoWindow, 'Open a real Incognito window (Chrome only).'],
    ['Browser', 'BROWSER_LOCALE', config.locale || 'system default', 'Language the browser asks websites for.'],
    ['Browser', 'SLOW_MO', ms(config.slowMo), 'Delay between browser actions.'],
    ['Browser', 'TIMEOUT', ms(config.timeout), 'How long to wait for page elements.'],
    ['Browser', 'MANUAL_STEP_TIMEOUT', ms(config.manualStepTimeout), 'How long the bot waits for you to finish a 2FA or security check by hand (0 = no wait).'],
    ['Browser', 'SCREENSHOTS', config.screenshots, 'Save a screenshot after every major step.'],
  ].map(([group, key, value, help]) => ({ group, key, value, help }));
}

async function startRun(req, res) {
  const body = await readJson(req);
  const mode = Object.hasOwn(MODES, body.mode) ? body.mode : 'full';
  const parallel = Number.parseInt(body.parallel, 10);
  let emails = null;
  if (Array.isArray(body.emails)) {
    emails = body.emails.filter((e) => typeof e === 'string' && e.trim());
    if (!emails.length) throw new HttpError(400, 'No users selected.');
  }
  const run = await runner.start({
    mode,
    parallel: Number.isFinite(parallel) ? Math.min(Math.max(parallel, 1), 50) : PARALLEL,
    includeInactive: body.includeInactive === true,
    emails,
    csvPath: csvFiles.path(),
  });
  sendJson(res, 202, { id: run.id });
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) log.error(`web UI: ${req.method} ${req.url} failed: ${err.stack || err.message}`);
    if (!res.headersSent) sendJson(res, status, { error: err.message });
    else res.end();
  });
});

async function route(req, res) {
  const { port } = server.address();
  // Only answer to our own address - this blocks DNS-rebinding pages.
  if (req.headers.host !== `${HOST}:${port}` && req.headers.host !== `localhost:${port}`) {
    throw new HttpError(403, 'Unknown host.');
  }
  if (req.method === 'POST') {
    // A cross-site page can't send JSON without a CORS preflight, which is never granted.
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Send JSON.');
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      throw new HttpError(403, 'Cross-origin request refused.');
    }
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  const is = (method, p) => req.method === method && pathname === p;

  if (is('GET', '/api/state')) return sendJson(res, 200, state());
  if (is('GET', '/api/events')) return events(req, res);
  if (is('GET', '/api/history')) return sendJson(res, 200, { runs: listRuns(RUNS_DIR, runner.activeId()) });
  if (req.method === 'GET' && pathname.startsWith('/api/history/')) {
    const id = decode(pathname.slice('/api/history/'.length));
    const detail = isRunId(id) ? loadRun(RUNS_DIR, id, runner.activeId()) : null;
    if (!detail) throw new HttpError(404, 'No such run.');
    return sendJson(res, 200, detail);
  }
  if (is('POST', '/api/runs')) return startRun(req, res);
  if (is('POST', '/api/runs/stop')) return sendJson(res, 202, { status: runner.stop()?.status ?? null });
  if (is('GET', '/api/csv')) return sendJson(res, 200, { files: csvFiles.list() });
  if (is('POST', '/api/csv')) return uploadCsv(req, res);
  if (is('POST', '/api/csv/select')) return selectCsv(req, res);
  if (is('POST', '/api/csv/delete')) return deleteCsv(req, res);
  if (pathname.startsWith('/api/')) throw new HttpError(404, 'Not found.');

  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
  if (pathname.startsWith('/vendor/')) return serveVendor(req, res, pathname.slice('/vendor/'.length));
  if (pathname.startsWith('/runs/')) {
    return serveFile(req, res, RUNS_DIR, pathname.slice('/runs/'.length), { types: ['.png', '.csv', '.log', '.json'] });
  }
  return serveFile(req, res, PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
}

function serveVendor(req, res, rest) {
  const pkg = VENDOR.find((name) => rest.startsWith(`${name}/`));
  if (!pkg) throw new HttpError(404, 'Not found.');
  return serveFile(req, res, path.join(NODE_MODULES, pkg), rest.slice(pkg.length + 1), {
    types: ['.js', '.mjs'],
    cache: 'max-age=3600',
  });
}

/** Streams `rel` from inside `root`. Anything outside it, or of an unexpected type, is a 404. */
async function serveFile(req, res, root, rel, { types = Object.keys(TYPES), cache = 'no-cache' } = {}) {
  const name = decode(rel);
  const file = path.resolve(root, name);
  const ext = path.extname(file).toLowerCase();
  if (name.includes('\0') || !file.startsWith(root + path.sep) || !types.includes(ext)) {
    throw new HttpError(404, 'Not found.');
  }
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new HttpError(404, 'Not found.');

  const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`;
  const headers = { 'Content-Type': TYPES[ext], 'Cache-Control': cache, ETag: etag, 'X-Content-Type-Options': 'nosniff' };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'Bad URL.');
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

// ---------------------------------------------------------------------------
// Start-up and shutdown
// ---------------------------------------------------------------------------

function openBrowser(url) {
  if (!OPEN_BROWSER) return;
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  execFile(cmd, args, () => {}); // opening a tab is a convenience - ignore failures
}

/** True when our own UI already answers on `port` (e.g. `npm run ui` in another terminal). */
async function isOurs(port) {
  try {
    const res = await fetch(`http://${HOST}:${port}/api/state`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()).app === APP_ID;
  } catch {
    return false;
  }
}

function listen(port, attemptsLeft) {
  const onError = async (err) => {
    if (err.code !== 'EADDRINUSE') {
      log.error(`web UI could not start: ${err.message}`);
      process.exit(1);
    }
    if (await isOurs(port)) {
      const url = `http://${HOST}:${port}/`;
      log.ok(`the web UI is already running at ${url} - opening it`);
      openBrowser(url);
      process.exit(0);
    }
    if (Number.isFinite(FIXED_PORT) || attemptsLeft <= 1) {
      log.error(`port ${port} is in use. Set UI_PORT in .env to pick another one.`);
      process.exit(1);
    }
    listen(port + 1, attemptsLeft - 1);
  };
  server.once('error', onError);
  server.listen(port, HOST, () => {
    server.off('error', onError);
    const url = `http://${HOST}:${port}/`;
    log.ok(`web UI running at ${url}`);
    log.info(`users file: ${path.relative(process.cwd(), CSV_PATH)} · target: ${config.targetUrl || '(TARGET_URL not set)'}`);
    log.info('press Ctrl+C to stop it');
    openBrowser(url);
  });
}

let shuttingDown = 0;

/**
 * Ctrl+C: stop the active run first so its browsers close and the partial
 * report is written, then exit. npm forwards the terminal's SIGINT too, so a
 * second signal within a moment is the same keypress; a later one quits at once.
 */
async function shutdown() {
  if (shuttingDown) {
    if (Date.now() - shuttingDown < 1500) return;
    log.warn('quitting without waiting for the run to finish');
    process.exit(130);
  }
  shuttingDown = Date.now();
  if (runner.isActive()) {
    log.warn('stopping the current run first - press Ctrl+C again to quit immediately');
    try {
      runner.stop();
    } catch {
      /* already stopping */
    }
    await Promise.race([runner.settled(), new Promise((resolve) => setTimeout(resolve, 30_000))]);
  }
  for (const res of clients) res.end();
  server.close();
  server.closeAllConnections();
  log.info('web UI stopped');
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, shutdown);

listen(Number.isFinite(FIXED_PORT) ? FIXED_PORT : 5700, 10);
