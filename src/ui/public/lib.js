import { LitElement, html, nothing } from 'lit';

/**
 * Shared helpers for the web UI: a light-DOM Lit base class (so styles.css
 * applies everywhere), API calls, formatting, and the status vocabulary.
 */

/** A Lit element that renders into itself instead of a shadow root. */
export class LightElement extends LitElement {
  createRenderRoot() {
    return this;
  }
}

/** Dispatches a bubbling custom event from `el`. */
export const fire = (el, type, detail = {}) =>
  el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

/** Shows a snackbar message (handled by <eg-app>). */
export const toast = (el, text, action = null) => fire(el, 'toast', { text, action });

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function request(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

export const getJson = (url) => request(url, { headers: { Accept: 'application/json' } });

export const postJson = (url, data = {}) =>
  request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

const MAX_CSV_BYTES = 5 * 1024 * 1024;

/**
 * Sends a users CSV picked or dropped in the browser. The server checks it
 * (Email and Password columns, at least one usable row), saves it under
 * data/uploads/ and switches to it. Resolves with { file, reused, csv }.
 */
export async function uploadCsvFile(file) {
  if (!file) throw new Error('No file selected.');
  if (!/\.csv$/i.test(file.name) && !/csv/i.test(file.type)) throw new Error(`${file.name} is not a .csv file.`);
  if (file.size > MAX_CSV_BYTES) throw new Error(`${file.name} is larger than 5 MB.`);
  return postJson('/api/csv', { name: file.name, content: await file.text() });
}

/** Snackbar text after switching users files. */
export const csvSwitchedText = ({ file, reused }) =>
  `${reused ? 'Using the earlier upload of' : 'Now using'} ${file.name} · ${plural(file.users, 'user')}${
    file.active === file.users ? '' : ` (${file.active} active)`
  }`;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 42s, 3m 07s, 1h 12m. */
export function duration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const two = (n) => String(n).padStart(2, '0');
  if (h) return `${h}h ${two(m)}m`;
  if (m) return `${m}m ${two(sec)}s`;
  return `${sec}s`;
}

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export const clock = (iso) => (iso ? clockFormat.format(new Date(iso)) : '—');
export const dateTime = (iso) => (iso ? dateTimeFormat.format(new Date(iso)) : '—');

export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const seconds = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relativeFormat.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relativeFormat.format(Math.round(seconds / 3600), 'hour');
  return relativeFormat.format(Math.round(seconds / 86_400), 'day');
}

export const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url || '';
  }
};

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** "connectors-dialog" -> "Connectors dialog". */
export const prettyLabel = (label) => {
  const text = String(label || '').replace(/[-_]+/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

const AVATAR_COLORS = ['#1a73e8', '#188038', '#d93025', '#e37400', '#9334e6', '#007b83', '#c5221f', '#1967d2', '#b06000', '#129eaf'];

export function avatar(name, email, size = '') {
  const text = (name || email || '?').trim();
  let hash = 0;
  for (const ch of email || text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return html`<span class="avatar ${size}" style="background:${AVATAR_COLORS[hash % AVATAR_COLORS.length]}" aria-hidden="true"
    >${text.charAt(0).toUpperCase()}</span
  >`;
}

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

export const USER_STATUS = {
  idle: { label: 'Ready', icon: 'radio_button_unchecked', tone: 'neutral' },
  queued: { label: 'Queued', icon: 'schedule', tone: 'neutral' },
  running: { label: 'Running', tone: 'info', spinner: true },
  ok: { label: 'Completed', icon: 'check_circle', tone: 'success' },
  partial: { label: 'Partial', icon: 'warning', tone: 'warning' },
  failed: { label: 'Failed', icon: 'error', tone: 'error' },
  stopped: { label: 'Stopped', icon: 'stop_circle', tone: 'neutral' },
  'not run': { label: 'Not run', icon: 'do_not_disturb_on', tone: 'neutral' },
  unknown: { label: 'Unknown', icon: 'help', tone: 'neutral' },
  outside: { label: 'Not in this run', icon: 'remove', tone: 'neutral' },
};

export const RUN_STATUS = {
  running: { label: 'Running', tone: 'info', spinner: true },
  stopping: { label: 'Stopping', tone: 'warning', spinner: true },
  done: { label: 'Completed', icon: 'check_circle', tone: 'success' },
  stopped: { label: 'Stopped', icon: 'stop_circle', tone: 'neutral' },
  interrupted: { label: 'Interrupted', icon: 'warning', tone: 'warning' },
  error: { label: 'Error', icon: 'error', tone: 'error' },
};

export const VERIFIED = {
  yes: { label: 'Verified', icon: 'verified', tone: 'success' },
  no: { label: 'Not verified', icon: 'cancel', tone: 'error' },
  unknown: { label: 'Unknown', icon: 'help', tone: 'neutral' },
};

export const MODES = {
  full: { label: 'Full setup', icon: 'bolt' },
  connectors: { label: 'Connectors only', icon: 'cable' },
  skills: { label: 'Skills only', icon: 'extension' },
  verify: { label: 'Verify only', icon: 'fact_check' },
  none: { label: 'Nothing', icon: 'block' },
};

/** A GCP-style status: coloured icon (or spinner) plus label. */
export function badge(info, label) {
  if (!info) return html`<span class="status tone-neutral"><span>—</span></span>`;
  return html`<span class="status tone-${info.tone}">
    ${info.spinner
      ? html`<md-circular-progress indeterminate aria-hidden="true"></md-circular-progress>`
      : html`<md-icon aria-hidden="true">${info.icon}</md-icon>`}
    <span>${label ?? info.label}</span>
  </span>`;
}

/** Plain-language summary of what a run with these phases does. */
export function describePhases(phases) {
  if (!phases) return '';
  const { connectors, skills, verify } = phases;
  if (!connectors && !skills) {
    return verify
      ? 'Signs in and checks every connector and skill. Read-only: nothing is changed.'
      : 'Nothing to do - every phase is turned off in .env.';
  }
  const work = [connectors && 'authorizes connectors', skills && 'installs skills'].filter(Boolean).join(' and ');
  return `Signs in, ${work}${verify ? ', then verifies the result' : ''}.`;
}

export const FINISHED = ['ok', 'partial', 'failed', 'stopped', 'not run'];

/** Users worth running again: anything that didn't finish cleanly or didn't verify. */
export const needsRetry = (user) =>
  ['failed', 'partial', 'stopped', 'not run'].includes(user.status) || ['no', 'unknown'].includes(user.row?.verified);

/** Counts a run's users by status. */
export function tally(users = []) {
  const t = { total: users.length, queued: 0, running: 0, ok: 0, partial: 0, failed: 0, stopped: 0, notRun: 0, finished: 0, verified: 0, audited: 0 };
  for (const user of users) {
    if (user.status === 'not run') t.notRun += 1;
    else if (user.status in t) t[user.status] += 1;
    if (FINISHED.includes(user.status)) t.finished += 1;
    const verified = user.row?.verified;
    if (verified && verified !== '-') {
      t.audited += 1;
      if (verified === 'yes') t.verified += 1;
    }
  }
  return t;
}

/** How long a user took, or has been running for. */
export function userDuration(user, now = Date.now()) {
  if (user.status === 'running' && user.startedAt) return duration(now - Date.parse(user.startedAt));
  if (user.row && FINISHED.includes(user.status) && user.status !== 'not run') return duration(Number(user.row.seconds) * 1000);
  return '—';
}

const list = (s) => String(s || '').split(' | ').filter(Boolean);

/** The one-line explanation shown next to a user's status. */
export function detailText(user) {
  const row = user.row;
  switch (user.status) {
    case 'idle':
    case 'outside':
      return '';
    case 'queued':
      return 'Waiting for a free slot';
    case 'running':
      return user.step || 'Starting';
    case 'failed':
      return row?.error || 'Failed';
    case 'stopped':
      return 'Stopped before finishing';
    case 'not run':
      return 'Not started';
    case 'unknown':
      return 'No result - the run was interrupted';
    default:
      break;
  }
  if (!row) return '';
  const problems = [
    list(row.connectors_failed).length && `Connectors failed: ${list(row.connectors_failed).join(', ')}`,
    list(row.skills_failed).length && `Skills failed: ${list(row.skills_failed).join(', ')}`,
    list(row.connectors_pending).length && `Connectors not enabled: ${list(row.connectors_pending).join(', ')}`,
    list(row.skills_missing).length && `Skills not installed: ${list(row.skills_missing).join(', ')}`,
    list(row.expected_missing).length && `Expected but absent: ${list(row.expected_missing).join(', ')}`,
  ].filter(Boolean);
  if (problems.length) return problems.join(' · ');
  if (row.verified === 'yes') return 'All connectors enabled and all skills installed';
  return 'Finished';
}

export { list as splitList, nothing };
