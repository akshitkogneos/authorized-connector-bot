import { resolvePhases } from '../config.js';
import { runBatch } from '../batch.js';
import { log, onLogEvent } from '../logger.js';
import { fileUrl } from './history.js';

/** The run modes the UI offers, as the command-line flags they stand for. */
export const MODES = {
  full: [],
  connectors: ['--connectors-only'],
  skills: ['--skills-only'],
  verify: ['--verify-only'],
};

/** What each mode will actually do with the current .env (DO_* settings apply to a full run). */
export const modePhases = () =>
  Object.fromEntries(Object.entries(MODES).map(([mode, flags]) => [mode, resolvePhases(flags)]));

const MAX_LOGS = 20_000; // log lines of the current run kept in memory
const SNAPSHOT_LOGS = 5_000; // of which a newly opened tab receives the latest
const FINISHED = new Set(['ok', 'partial', 'failed', 'stopped', 'not run']);

/** An error that carries the HTTP status the server should answer with. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Starts batch runs for the web UI and keeps their live state: one run at a
 * time, each user's progress, the log and the screenshots. Every change is
 * passed to `broadcast(type, data)`, which the server streams to open tabs:
 *
 *   snapshot  { run, logs }  a run started (or a tab connected)
 *   run       run            run-level change: stopping, finished
 *   user      user           one user's status / current step / result
 *   log       entry          one log line
 *   shot      { user, shot } one screenshot
 */
export function createRunner({ runsDir, broadcast }) {
  let run = null; // the latest run; live while `controller` is set
  let logs = [];
  let seq = 0;
  let controller = null;
  let settled = Promise.resolve();

  onLogEvent((event) => {
    if (!run || event.root !== run.dir) return;
    const index = Number.isInteger(event.meta?.index) ? event.meta.index : null;
    const user = index === null ? null : run.users[index];

    if (event.type === 'log') {
      const entry = { seq: ++seq, time: event.time, kind: event.kind, msg: event.msg, user: index };
      logs.push(entry);
      if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
      broadcast('log', entry);
      // A user's latest step is what the users table shows while it runs.
      if (user?.status === 'running' && event.kind === 'step' && !event.msg.startsWith('=====')) {
        user.step = event.msg;
        broadcast('user', user);
      }
    } else if (event.type === 'screenshot' && user) {
      const shot = { url: fileUrl(runsDir, event.file), label: event.label, time: event.time };
      user.shots.push(shot);
      broadcast('shot', { user: index, shot });
    }
  });

  // Run-level fields of a batch event, without the fields handled separately.
  const fields = ({ type, users, ...rest }) => rest;

  const handle = (event) => {
    switch (event.type) {
      case 'run-start':
        run = {
          ...fields(event),
          users: event.users.map((u) => ({
            ...u,
            status: 'queued',
            step: '',
            startedAt: null,
            finishedAt: null,
            row: null,
            findings: [],
            shots: [],
          })),
        };
        logs = [];
        broadcast('snapshot', snapshot());
        break;
      case 'user-start': {
        const user = run.users[event.index];
        Object.assign(user, { status: 'running', step: 'Starting the browser', startedAt: event.startedAt });
        broadcast('user', user);
        break;
      }
      case 'user-done': {
        const user = run.users[event.index];
        Object.assign(user, {
          status: event.row.status,
          step: '',
          row: event.row,
          findings: event.findings,
          finishedAt: new Date().toISOString(),
        });
        broadcast('user', user);
        break;
      }
      case 'run-done':
        Object.assign(run, fields(event));
        for (const user of run.users) if (!FINISHED.has(user.status)) user.status = 'not run';
        broadcast('run', run);
        break;
      default:
        break;
    }
  };

  /**
   * Starts a run. Resolves with the run once it is under way, or rejects with
   * an HttpError: 409 while another run is active, 400 when runBatch refuses
   * the input (no TARGET_URL, no CSV, no matching users).
   */
  function start({ mode = 'full', parallel, includeInactive = false, emails = null, csvPath }) {
    if (controller) return Promise.reject(new HttpError(409, 'A run is already in progress.'));
    const ctl = new AbortController();
    controller = ctl;

    return new Promise((resolve, reject) => {
      const onEvent = (event) => {
        handle(event);
        if (event.type === 'run-start') resolve(run);
        else if (event.type === 'run-error') reject(new HttpError(400, event.message));
      };

      settled = runBatch({
        csvPath,
        allUsers: includeInactive,
        parallel,
        phases: resolvePhases(MODES[mode] ?? []),
        emails,
        signal: ctl.signal,
        onEvent,
        source: 'ui',
      })
        .catch((err) => {
          log.error(`web UI run crashed: ${err.stack || err.message}`);
          if (run && !run.finishedAt) {
            Object.assign(run, { status: 'error', error: err.message, finishedAt: new Date().toISOString() });
            broadcast('run', run);
          }
          reject(new HttpError(500, err.message));
        })
        .finally(() => {
          if (controller === ctl) controller = null;
          reject(new HttpError(500, 'The run ended before it started.')); // no-op once settled
        });
    });
  }

  /** Stops the active run: users in progress are closed, the rest are skipped, the report is still written. */
  function stop() {
    if (!controller) throw new HttpError(409, 'No run is in progress.');
    if (!controller.signal.aborted) {
      log.warn('stop requested from the web UI');
      controller.abort();
      if (run && !run.finishedAt) {
        run.status = 'stopping';
        broadcast('run', run);
      }
    }
    return run;
  }

  function snapshot() {
    return { run, logs: logs.slice(-SNAPSHOT_LOGS) };
  }

  return {
    start,
    stop,
    snapshot,
    isActive: () => Boolean(controller),
    activeId: () => (controller && run && !run.finishedAt ? run.id : null),
    /** Resolves once the current run (if any) has fully finished, report included. */
    settled: () => settled,
  };
}
