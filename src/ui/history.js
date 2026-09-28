import fs from 'node:fs';
import path from 'node:path';
import { readCsvObjects } from '../csv.js';
import { countResults } from '../batch.js';

/**
 * Reads past batch runs back from runs/<id>/ for the web UI's run history.
 *
 * Runs made by this version have a run.json (settings, timing, status) and a
 * run.log; older ones only have report.csv, so every field falls back to
 * what can be worked out from that file.
 */

/** Run folders are named after their start time, e.g. 2026-09-28T17-32-26-123Z. */
const RUN_ID = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/;
const DAY = 24 * 60 * 60 * 1000;

const KINDS = { 'ℹ': 'info', '▶': 'step', '✔': 'ok', '⚠': 'warn', '✖': 'error' };
// <ISO time> [<n>-<email>] <icon> <message> - the format logger.js writes to run.log.
const LOG_LINE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) (?:\[(\d+)-[^\]]*\] )?([ℹ▶✔⚠✖]) (.*)$/u;

export const isRunId = (id) => RUN_ID.test(id);

const idToIso = (id) => id.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z');

/** URL under which the web UI serves a file from runs/. */
export const fileUrl = (runsDir, file) =>
  `/runs/${path.relative(runsDir, file).split(path.sep).map(encodeURIComponent).join('/')}`;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const readCsv = (file) => {
  try {
    return fs.existsSync(file) ? readCsvObjects(file) : null;
  } catch {
    return null;
  }
};

const modified = (file) => {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return null;
  }
};

/** Every past batch run, newest first. `activeId` is the run in progress, if any. */
export function listRuns(runsDir, activeId = null) {
  let names;
  try {
    names = fs.readdirSync(runsDir);
  } catch {
    return [];
  }
  return names
    .filter(isRunId)
    .sort()
    .reverse()
    .map((id) => summarize(runsDir, id, activeId))
    .filter(Boolean);
}

/** One run with its users, their results, findings and screenshots, and the parsed run.log. */
export function loadRun(runsDir, id, activeId = null) {
  if (!isRunId(id)) return null;
  const summary = summarize(runsDir, id, activeId);
  if (!summary) return null;

  const dir = path.join(runsDir, id);
  const meta = readJson(path.join(dir, 'run.json'));
  const rows = readCsv(path.join(dir, 'report.csv')) ?? [];
  const findings = readCsv(path.join(dir, 'verification.csv')) ?? [];
  const shots = screenshots(runsDir, dir);
  const logs = readLog(path.join(dir, 'run.log'));
  const live = summary.status === 'running' || summary.status === 'stopping';
  const people = meta?.users ?? rows.map((r, index) => ({ index, email: r.email, name: r.name }));

  const users = people.map((person) => {
    // report.csv once the run has ended; until then (or if it never does) the copy in run.json.
    const row = rows.find((r) => r.email === person.email) ?? person.row ?? null;
    return {
      index: person.index,
      email: person.email,
      name: person.name,
      status: row?.status ?? pendingStatus(person.status, live),
      step: live && !row && person.status === 'running' ? latestStep(logs, person.index) : '',
      startedAt: person.startedAt ?? null,
      finishedAt: person.finishedAt ?? null,
      row,
      findings: findings.filter((f) => f.email === person.email),
      shots: shots.get(person.index) ?? [],
    };
  });

  return { run: { ...summary, users }, logs };
}

/** A user without a result yet: still to come in a live run; cut short or never started otherwise. */
function pendingStatus(status, live) {
  if (status === 'running') return live ? 'running' : 'unknown';
  return live ? 'queued' : 'not run';
}

/** What a user in progress is doing: their latest step in the log. */
function latestStep(logs, index) {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const entry = logs[i];
    if (entry.user === index && entry.kind === 'step' && !entry.msg.startsWith('=====')) return entry.msg;
  }
  return 'Starting';
}

/** True while process `pid` exists - the one that wrote a run.json, if that run is still going. */
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 only checks that the process exists
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // it exists but belongs to another user
  }
}

function summarize(runsDir, id, activeId) {
  const dir = path.join(runsDir, id);
  const meta = readJson(path.join(dir, 'run.json'));
  const reportFile = path.join(dir, 'report.csv');
  const rows = readCsv(reportFile);
  if (!meta && !rows) return null; // single-user runs only hold screenshots

  const startedAt = meta?.startedAt ?? idToIso(id);
  let status = meta?.status ?? 'done';
  // run.json says "running" until the run ends, possibly in another process
  // (e.g. `npm start` in a terminal). Once that process is gone - say after
  // Ctrl+C - the run was interrupted. The age limit guards against pid reuse.
  const live = status === 'running' || status === 'stopping';
  if (live && id !== activeId && !(isAlive(meta?.pid) && Date.now() - Date.parse(startedAt) < DAY)) {
    status = 'interrupted';
  }

  // Older runs have no run.json, but report.csv is written last, so its time is when the run ended.
  const finishedAt = meta?.finishedAt ?? (rows && !meta ? modified(reportFile) : null);
  const elapsedMs =
    status === 'running' || status === 'stopping'
      ? Date.now() - Date.parse(startedAt)
      : meta?.elapsedMs || (finishedAt ? Date.parse(finishedAt) - Date.parse(startedAt) : null);
  const file = (name) => (fs.existsSync(path.join(dir, name)) ? fileUrl(runsDir, path.join(dir, name)) : null);
  // Without a report (a run still going, or one that never finished) count what run.json has.
  const finishedRows = (meta?.users ?? []).filter((u) => u.row).map((u) => u.row);

  return {
    id,
    source: meta?.source ?? 'cli',
    status,
    startedAt,
    finishedAt,
    elapsedMs,
    csv: meta?.csv ?? null,
    mode: meta?.mode ?? null,
    phases: meta?.phases ?? null,
    parallel: meta?.parallel ?? null,
    total: meta?.users?.length ?? rows?.length ?? 0,
    counts: rows ? countResults(rows) : finishedRows.length ? countResults(finishedRows) : null,
    folder: path.relative(process.cwd(), dir),
    files: { report: file('report.csv'), verification: file('verification.csv'), log: file('run.log') },
  };
}

/** Screenshots per user index, from the <n>-<email>/ folders the batch runner creates. */
function screenshots(runsDir, dir) {
  const byUser = new Map();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return byUser;
  }
  for (const entry of entries) {
    const match = entry.isDirectory() && /^(\d+)-/.exec(entry.name);
    if (!match) continue;
    const folder = path.join(dir, entry.name);
    const files = fs
      .readdirSync(folder)
      .filter((f) => f.endsWith('.png'))
      .sort();
    byUser.set(
      Number(match[1]) - 1,
      files.map((f) => ({
        url: fileUrl(runsDir, path.join(folder, f)),
        label: f.replace(/^\d+-/, '').replace(/\.png$/, ''),
        time: modified(path.join(folder, f)),
      })),
    );
  }
  return byUser;
}

/** Parses run.log into the same entries the live stream sends. Multi-line messages stay together. */
function readLog(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of text.split('\n')) {
    const match = LOG_LINE.exec(line);
    if (match) {
      entries.push({
        seq: entries.length + 1,
        time: match[1],
        kind: KINDS[match[3]],
        msg: match[4],
        user: match[2] ? Number(match[2]) - 1 : null,
      });
    } else if (line && entries.length) {
      entries[entries.length - 1].msg += `\n${line}`;
    }
  }
  return entries;
}
