import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import {
  LightElement,
  MODES,
  RUN_STATUS,
  badge,
  clock,
  describePhases,
  duration,
  hostOf,
  needsRetry,
  plural,
  postJson,
  tally,
  toast,
} from './lib.js';
import './log-list.js';
import './user-panel.js';
import './users-table.js';

const isLive = (run) => Boolean(run) && (run.status === 'running' || run.status === 'stopping');

/**
 * The Run page: settings for the next run, the live status of the current
 * one, the users table and the activity log. The table always shows every
 * user in the CSV with their result from the latest run.
 */
export class RunView extends LightElement {
  static properties = {
    csv: { attribute: false },
    modes: { attribute: false },
    defaults: { attribute: false },
    target: {},
    run: { attribute: false },
    logs: { attribute: false },
    logVersion: { type: Number },
    search: {},
    mode: { state: true },
    parallel: { state: true },
    includeInactive: { state: true },
    selected: { state: true },
    openKey: { state: true },
    logFilter: { state: true },
    confirm: { state: true },
    now: { state: true },
  };

  constructor() {
    super();
    this.csv = null;
    this.modes = null;
    this.defaults = null;
    this.target = '';
    this.run = null;
    this.logs = [];
    this.logVersion = 0;
    this.search = '';
    this.mode = 'full';
    this.parallel = 5;
    this.includeInactive = false;
    this.selected = new Set();
    this.openKey = null;
    this.logFilter = 'all';
    this.confirm = null;
    this.now = Date.now();
    this.timer = null;
    this.touched = false;
  }

  willUpdate(changed) {
    if (changed.has('defaults') && this.defaults && !this.touched) {
      this.mode = this.defaults.mode;
      this.parallel = this.defaults.parallel;
    }
    // Another users file: the ticked users and the open panel belonged to the old one.
    const before = changed.get('csv');
    if (changed.has('csv') && before && before.file !== this.csv?.file) {
      this.selected = new Set();
      this.openKey = null;
      this.includeInactive = false;
    }
    // Tick once a second while a run is live, for elapsed times.
    if (isLive(this.run) && !this.timer) {
      this.timer = setInterval(() => (this.now = Date.now()), 1000);
    } else if (!isLive(this.run) && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  disconnectedCallback() {
    clearInterval(this.timer);
    this.timer = null;
    super.disconnectedCallback();
  }

  /** True when the latest run used the users file shown now (switching files starts a clean table). */
  runMatchesCsv() {
    return Boolean(this.run) && (!this.run.csv || !this.csv || this.run.csv === this.csv.file || isLive(this.run));
  }

  /** Every CSV user (inactive ones only when included) with their result in the latest run. */
  buildRows() {
    const run = this.runMatchesCsv() ? this.run : null;
    const inRun = new Map((run?.users ?? []).map((u) => [u.email.toLowerCase(), u]));
    const rows = [];
    const seen = new Set();
    for (const u of this.csv?.users ?? []) {
      const key = u.email.toLowerCase();
      const user = inRun.get(key);
      if (!u.active && !this.includeInactive && !user) continue;
      seen.add(key);
      rows.push({
        key,
        email: u.email,
        name: u.name,
        csvStatus: u.status,
        active: u.active,
        user: user ?? { status: run ? 'outside' : 'idle', shots: [], findings: [] },
      });
    }
    // Users of the latest run that are no longer in the CSV.
    for (const [key, user] of inRun) {
      if (!seen.has(key)) rows.push({ key, email: user.email, name: user.name, csvStatus: '', active: true, user });
    }
    return rows;
  }

  render() {
    const run = this.run;
    const live_ = isLive(run);
    const rows = this.buildRows();
    const chosen = rows.filter((r) => this.selected.has(r.key)).map((r) => r.email);
    const retry = run && !live_ && this.runMatchesCsv() ? run.users.filter(needsRetry).map((u) => u.email) : [];
    const runnable = (this.csv?.users ?? []).filter((u) => u.active || this.includeInactive).length;
    const openRow = rows.find((r) => r.key === this.openKey) ?? null;
    const openIndex = openRow?.user.index;
    const userLogs = openRow && Number.isInteger(openIndex) ? this.logs.filter((e) => e.user === openIndex) : [];

    return html`
      <div class="page-header">
        <h1>Run</h1>
        <div class="header-actions">
          <md-filled-button ?disabled=${live_ || !runnable || !this.target} @click=${() => this.askStart(null)}>
            <md-icon slot="icon">play_arrow</md-icon>Run all users
          </md-filled-button>
          <md-outlined-button ?disabled=${live_ || !chosen.length || !this.target} @click=${() => this.askStart(chosen)}>
            <md-icon slot="icon">checklist</md-icon>Run selected${chosen.length ? ` (${chosen.length})` : ''}
          </md-outlined-button>
          <md-text-button ?disabled=${live_ || !retry.length || !this.target} @click=${() => this.askStart(retry, true)}>
            <md-icon slot="icon">replay</md-icon>Retry failed${retry.length ? ` (${retry.length})` : ''}
          </md-text-button>
          ${live_
            ? html`<md-outlined-button class="danger" ?disabled=${run.status === 'stopping'} @click=${this.askStop}>
                <md-icon slot="icon">stop_circle</md-icon>${run.status === 'stopping' ? 'Stopping…' : 'Stop run'}
              </md-outlined-button>`
            : nothing}
        </div>
      </div>

      <div class="page-body">
        ${this.csv?.error ? html`<div class="banner error"><md-icon>error</md-icon><span>${this.csv.error}</span></div>` : nothing}
        ${this.csv && !this.target
          ? html`<div class="banner error">
              <md-icon>error</md-icon><span>TARGET_URL is not set. Add it to <code>.env</code> and restart <code>npm run ui</code>.</span>
            </div>`
          : nothing}
        ${this.renderSettings(live_)} ${this.renderStatus(run, live_)}

        <section class="card">
          <div class="card-header">
            <h2>Users</h2>
            <span class="card-sub">${this.csv?.file ?? ''}</span>
            ${this.csv && !this.csv.isDefault ? html`<span class="chip-label">Uploaded</span>` : nothing}
            <span class="toolbar-spacer"></span>
            <eg-csv-actions ?locked=${live_}></eg-csv-actions>
          </div>
          <eg-users-table
            .rows=${rows}
            selectable
            ?locked=${live_}
            .selected=${this.selected}
            .openKey=${this.openKey}
            .search=${this.search}
            .now=${this.now}
            @open-user=${this.onOpenUser}
            @select-user=${(e) => this.select([e.detail.key], e.detail.checked)}
            @select-all=${(e) => this.select(e.detail.keys, e.detail.checked)}
          ></eg-users-table>
        </section>

        ${this.renderActivity(run)}
      </div>

      <eg-user-panel
        .row=${openRow}
        .logs=${userLogs}
        .logUrl=${run && openRow?.user.index !== undefined ? `/runs/${run.id}/run.log` : ''}
        .now=${this.now}
        @close-panel=${() => (this.openKey = null)}
      ></eg-user-panel>
      ${this.renderConfirm()}
    `;
  }

  renderSettings(locked) {
    const inactive = (this.csv?.users ?? []).filter((u) => !u.active).length;
    const options = [...new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, this.defaults?.parallel ?? 5])].sort((a, b) => a - b);
    const phases = this.modes?.[this.mode];
    const change = (apply) => (e) => {
      this.touched = true;
      apply(e.target);
    };

    return html`<section class="card">
      <div class="card-header">
        <h2>Run settings</h2>
        <span class="card-sub">${locked ? 'Locked while a run is in progress' : 'Used by the next run'}</span>
      </div>
      <div class="settings-grid">
        <md-outlined-select
          class="mode-select"
          label="Mode"
          ?disabled=${locked}
          @change=${change((t) => (this.mode = t.value))}
        >
          ${Object.keys(this.modes ?? { full: null }).map(
            (m) => html`<md-select-option value=${m} ?selected=${m === this.mode}>
              <md-icon slot="start">${MODES[m]?.icon ?? 'bolt'}</md-icon>
              <div slot="headline">${MODES[m]?.label ?? m}</div>
              <div slot="supporting-text">${describePhases(this.modes?.[m])}</div>
            </md-select-option>`,
          )}
        </md-outlined-select>
        <md-outlined-select
          label="Users at a time"
          ?disabled=${locked}
          @change=${change((t) => (this.parallel = Number(t.value)))}
        >
          ${options.map(
            (n) => html`<md-select-option value=${String(n)} ?selected=${n === this.parallel}>
              <div slot="headline">${n === 1 ? '1 (one after another)' : String(n)}</div>
            </md-select-option>`,
          )}
        </md-outlined-select>
        <label class="switch-field ${!inactive || locked ? 'is-disabled' : ''}">
          <md-switch
            ?selected=${this.includeInactive}
            ?disabled=${locked || !inactive}
            @change=${change((t) => (this.includeInactive = t.selected))}
          ></md-switch>
          <span>
            <span class="switch-label">Include inactive users</span>
            <span class="switch-sub"
              >${inactive ? `${plural(inactive, 'CSV row')} with a Status other than Active` : 'Every user in the CSV is Active'}</span
            >
          </span>
        </label>
      </div>
      <div class="settings-note">
        <md-icon>info</md-icon>
        <span>
          ${describePhases(phases)}
          ${this.parallel > 1
            ? `Up to ${this.parallel} browser windows at once; sign-ins start a few seconds apart.`
            : 'One browser window at a time.'}
        </span>
      </div>
    </section>`;
  }

  renderStatus(run, isRunning) {
    if (!run) {
      return html`<section class="card">
        <div class="empty-state">
          <md-icon>rocket_launch</md-icon>
          <div>
            <h3>No run in this session yet</h3>
            <p>
              Choose a mode, then <strong>Run all users</strong> or tick users in the table and
              <strong>Run selected</strong>. Earlier runs are in <a href="#/history">Run history</a>.
            </p>
          </div>
        </div>
      </section>`;
    }

    const t = tally(run.users);
    const elapsed = isRunning ? this.now - Date.parse(run.startedAt) : run.elapsedMs;
    const cards = [
      isRunning && ['Running', `${t.running}`, 'autorenew', 'info'],
      isRunning && t.queued && ['Queued', `${t.queued}`, 'schedule', 'neutral'],
      ['Completed', `${t.ok}`, 'check_circle', 'success'],
      ['Partial', `${t.partial}`, 'warning', 'warning'],
      ['Failed', `${t.failed}`, 'error', 'error'],
      (t.stopped || t.notRun) && ['Stopped / not run', `${t.stopped + t.notRun}`, 'stop_circle', 'neutral'],
      ['Verified', t.audited ? `${t.verified} / ${t.total}` : '—', 'verified', 'success'],
    ].filter(Boolean);

    return html`<section class="card status-card">
      <div class="status-head">
        ${badge(RUN_STATUS[run.status] ?? RUN_STATUS.done)}
        <span class="status-meta">
          ${MODES[run.mode]?.label ?? run.mode} · ${plural(run.parallel, 'user')} at a time · started ${clock(run.startedAt)}
        </span>
        <span class="toolbar-spacer"></span>
        <span class="status-elapsed" title="Elapsed"><md-icon>timer</md-icon>${duration(elapsed)}</span>
        ${isRunning
          ? nothing
          : html`<md-text-button href="#/history/${run.id}"><md-icon slot="icon">history</md-icon>Open in history</md-text-button>`}
      </div>
      <md-linear-progress
        .value=${t.total ? t.finished / t.total : 0}
        ?indeterminate=${isRunning && !t.finished}
        aria-label="Run progress"
      ></md-linear-progress>
      <div class="progress-label">
        ${t.finished} of ${plural(t.total, 'user')} finished${t.running ? ` · ${t.running} running` : ''}${t.queued ? ` · ${t.queued} queued` : ''}
      </div>
      <div class="scorecards">
        ${cards.map(
          ([label, value, icon, tone]) => html`<div class="scorecard tone-${tone}">
            <div class="scorecard-label"><md-icon>${icon}</md-icon>${label}</div>
            <div class="scorecard-value">${value}</div>
          </div>`,
        )}
      </div>
    </section>`;
  }

  renderActivity(run) {
    const problemsOnly = this.logFilter === 'problems';
    const matching = problemsOnly ? this.logs.filter((e) => e.kind === 'warn' || e.kind === 'error') : this.logs;
    const entries = matching.slice(-400);
    return html`<section class="card">
      <div class="card-header">
        <h2>Activity</h2>
        <span class="card-sub">${entries.length < matching.length ? `Latest ${entries.length} of ${matching.length} lines` : ''}</span>
        <span class="toolbar-spacer"></span>
        <md-chip-set aria-label="Filter activity">
          <md-filter-chip label="All" .selected=${live(!problemsOnly)} @click=${() => (this.logFilter = 'all')}></md-filter-chip>
          <md-filter-chip
            label="Warnings and errors"
            .selected=${live(problemsOnly)}
            @click=${() => (this.logFilter = 'problems')}
          ></md-filter-chip>
        </md-chip-set>
        ${run
          ? html`<md-text-button href="/runs/${run.id}/run.log" target="_blank">
              <md-icon slot="icon">description</md-icon>run.log
            </md-text-button>`
          : nothing}
      </div>
      <eg-log-list
        class="activity-log"
        .entries=${entries}
        .users=${run?.users ?? []}
        empty=${run ? 'Waiting for the first log line…' : 'Start a run to see its activity here.'}
        @open-user=${this.onOpenUser}
      ></eg-log-list>
    </section>`;
  }

  renderConfirm() {
    // The last question stays rendered while the dialog animates closed.
    if (this.confirm) this.shownConfirm = this.confirm;
    const c = this.shownConfirm;
    return html`<div class="dialog-layer"><md-dialog class="confirm-dialog" .open=${Boolean(this.confirm)} @closed=${() => (this.confirm = null)}>
      <div slot="headline">${c?.title ?? ''}</div>
      <div slot="content" class="dialog-content">${c?.body ?? nothing}</div>
      <div slot="actions">
        <md-text-button @click=${() => this.answer(false)}>${c?.cancel ?? 'Cancel'}</md-text-button>
        <md-filled-button class=${c?.danger ? 'danger-fill' : ''} @click=${() => this.answer(true)}>${c?.ok ?? 'OK'}</md-filled-button>
      </div>
    </md-dialog></div>`;
  }

  onOpenUser(e) {
    this.openKey = e.detail.key ?? e.detail.email?.toLowerCase() ?? null;
  }

  select(keys, checked) {
    const next = new Set(this.selected);
    for (const key of keys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    this.selected = next;
  }

  answer(ok) {
    const action = ok ? this.confirm?.action : null;
    this.confirm = null;
    action?.();
  }

  /** Confirms, then starts a run: every user (emails = null), a selection, or a retry. */
  askStart(emails, retry = false) {
    // A retry repeats the last run's mode; anything else uses the settings card.
    const mode = retry && this.modes?.[this.run?.mode] ? this.run.mode : this.mode;
    const phases = this.modes?.[mode];
    const count = emails ? emails.length : (this.csv?.users ?? []).filter((u) => u.active || this.includeInactive).length;
    const lanes = Math.min(this.parallel, count);
    const readOnly = phases && !phases.connectors && !phases.skills;

    this.confirm = {
      title: retry ? `Retry ${plural(count, 'user')}?` : `Run ${plural(count, 'user')}?`,
      body: html`
        <p><strong>${MODES[mode]?.label ?? mode}.</strong> ${describePhases(phases)}</p>
        <p>
          Each user signs in to <strong>${hostOf(this.target)}</strong> in a new browser window,
          ${lanes > 1 ? `${lanes} at a time` : 'one at a time'}.
        </p>
        ${readOnly
          ? nothing
          : html`<p class="dialog-note"><md-icon>info</md-icon>This changes the accounts: it authorizes connectors and installs skills.</p>`}
      `,
      ok: 'Start run',
      action: () => this.start(emails, mode),
    };
  }

  async start(emails, mode) {
    try {
      await postJson('/api/runs', {
        mode,
        parallel: this.parallel,
        // Users picked explicitly run even if their Status isn't Active.
        includeInactive: emails ? true : this.includeInactive,
        emails,
      });
      this.selected = new Set();
    } catch (err) {
      toast(this, `Could not start the run: ${err.message}`);
    }
  }

  askStop() {
    this.confirm = {
      title: 'Stop this run?',
      body: html`<p>Users in progress are stopped and their browser windows closed. Users that haven't started are skipped.</p>
        <p>A report is still saved with everything that finished.</p>`,
      ok: 'Stop run',
      cancel: 'Keep running',
      danger: true,
      action: async () => {
        try {
          await postJson('/api/runs/stop');
        } catch (err) {
          toast(this, `Could not stop the run: ${err.message}`);
        }
      },
    };
  }
}

customElements.define('eg-run-view', RunView);
