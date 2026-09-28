import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import {
  LightElement,
  MODES,
  RUN_STATUS,
  ago,
  badge,
  dateTime,
  duration,
  getJson,
  plural,
  tally,
} from './lib.js';
import './log-list.js';
import './user-panel.js';
import './users-table.js';

const isLive = (run) => Boolean(run) && (run.status === 'running' || run.status === 'stopping');

/**
 * Run history: every batch run saved under runs/ (from this UI or the
 * command line), and the full detail of one run - users, results,
 * screenshots, findings and log - read back from its folder.
 */
export class HistoryView extends LightElement {
  static properties = {
    runId: {},
    activeRunId: {},
    search: {},
    runs: { state: true },
    detail: { state: true },
    loading: { state: true },
    error: { state: true },
    openKey: { state: true },
    logFilter: { state: true },
  };

  constructor() {
    super();
    this.runId = '';
    this.activeRunId = null;
    this.search = '';
    this.runs = null;
    this.detail = null;
    this.loading = false;
    this.error = '';
    this.openKey = null;
    this.logFilter = 'all';
  }

  willUpdate(changed) {
    if (changed.has('runId')) {
      this.openKey = null;
      this.error = '';
      if (this.runId) this.loadDetail(this.runId);
      else this.loadList();
    } else if (changed.has('activeRunId') && changed.get('activeRunId')) {
      // The live run just finished: refresh what is on screen.
      if (this.runId) this.loadDetail(this.runId);
      else this.loadList();
    }
  }

  updated() {
    // A run still going in another process (e.g. `npm start` in a terminal)
    // is only on disk, so re-read it every few seconds while it is shown.
    clearTimeout(this.pollTimer);
    const elsewhere = (run) => isLive(run) && run.id !== this.activeRunId;
    const poll = this.runId ? elsewhere(this.detail?.run) : this.runs?.some(elsewhere);
    if (poll) this.pollTimer = setTimeout(() => (this.runId ? this.loadDetail(this.runId) : this.loadList()), 5000);
  }

  disconnectedCallback() {
    clearTimeout(this.pollTimer);
    super.disconnectedCallback();
  }

  async loadList() {
    this.loading = true;
    try {
      this.runs = (await getJson('/api/history')).runs;
    } catch (err) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  async loadDetail(id) {
    this.loading = true;
    if (this.detail?.run.id !== id) this.detail = null;
    try {
      const detail = await getJson(`/api/history/${encodeURIComponent(id)}`);
      if (id === this.runId) this.detail = detail;
    } catch (err) {
      if (id === this.runId) this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  render() {
    return this.runId ? this.renderDetail() : this.renderList();
  }

  renderList() {
    const runs = this.runs ?? [];
    return html`
      <div class="page-header">
        <h1>Run history</h1>
        <div class="header-actions">
          <md-text-button @click=${() => this.loadList()}><md-icon slot="icon">refresh</md-icon>Refresh</md-text-button>
        </div>
      </div>
      <div class="page-body">
        ${this.error ? html`<div class="banner error"><md-icon>error</md-icon><span>${this.error}</span></div>` : nothing}
        <section class="card">
          <div class="card-header">
            <h2>Runs</h2>
            <span class="card-sub">Every batch run saved under runs/ - from this UI and from the command line</span>
          </div>
          ${this.loading && !this.runs ? html`<md-linear-progress indeterminate></md-linear-progress>` : nothing}
          ${this.runs && !runs.length
            ? html`<div class="empty-state">
                <md-icon>history</md-icon>
                <div>
                  <h3>No runs yet</h3>
                  <p>Runs appear here as soon as they start.</p>
                </div>
              </div>`
            : nothing}
          ${runs.length
            ? html`<div class="table-wrap">
                <table class="data runs">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Status</th>
                      <th>Mode</th>
                      <th class="num">Users</th>
                      <th>Results</th>
                      <th>Verified</th>
                      <th class="num">Duration</th>
                      <th>Started from</th>
                      <th class="col-open"><span class="visually-hidden">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${runs.map((run) => this.renderRunRow(run))}
                  </tbody>
                </table>
              </div>`
            : nothing}
        </section>
      </div>
    `;
  }

  renderRunRow(run) {
    const c = run.counts;
    const open = () => (location.hash = run.id === this.activeRunId ? '#/run' : `#/history/${run.id}`);
    return html`<tr @click=${open}>
      <td>
        <div class="cell-main">${dateTime(run.startedAt)}</div>
        <div class="cell-sub">${ago(run.startedAt)}</div>
      </td>
      <td>${badge(RUN_STATUS[run.status] ?? RUN_STATUS.done)}</td>
      <td>${run.mode ? MODES[run.mode]?.label ?? run.mode : html`<span class="dim">—</span>`}</td>
      <td class="num">
        ${run.total}${run.parallel && run.parallel > 1 ? html`<div class="cell-sub">${run.parallel} at a time</div>` : nothing}
      </td>
      <td>
        ${c ? this.renderCounts(c) : html`<span class="dim">${isLive(run) ? 'In progress' : 'No report'}</span>`}
      </td>
      <td>
        ${c?.audited
          ? badge(
              c.verified === run.total
                ? { tone: 'success', icon: 'verified' }
                : run.status === 'done'
                  ? { tone: 'error', icon: 'cancel' }
                  : { tone: 'neutral', icon: 'verified' }, // live, stopped or interrupted: not everyone got to the check
              `${c.verified} / ${run.total}`,
            )
          : html`<span class="dim">—</span>`}
      </td>
      <td class="num">${duration(run.elapsedMs)}</td>
      <td>
        <span class="source"
          ><md-icon>${run.source === 'ui' ? 'web' : 'terminal'}</md-icon>${run.source === 'ui' ? 'Web UI' : 'Command line'}</span
        >
      </td>
      <td class="col-open"><md-icon aria-hidden="true">chevron_right</md-icon></td>
    </tr>`;
  }

  renderCounts(c) {
    const items = [
      [c.ok, 'check_circle', 'success', 'completed'],
      [c.partial, 'warning', 'warning', 'partial'],
      [c.failed, 'error', 'error', 'failed'],
      [c.stopped + c.notRun, 'stop_circle', 'neutral', 'stopped or not run'],
    ].filter(([n]) => n > 0);
    return html`<span class="counts">
      ${items.map(([n, icon, tone, label]) => html`<span class="count tone-${tone}" title="${n} ${label}"><md-icon>${icon}</md-icon>${n}</span>`)}
    </span>`;
  }

  renderDetail() {
    const d = this.detail;
    const run = d?.run;
    const header = html`<div class="page-header">
      <md-icon-button href="#/history" aria-label="Back to run history"><md-icon>arrow_back</md-icon></md-icon-button>
      <h1>Run details</h1>
      ${run ? html`<span class="header-sub">${dateTime(run.startedAt)}</span>` : nothing}
      <div class="header-actions">
        ${run?.files.report
          ? html`<md-text-button href=${run.files.report} download="report-${run.id}.csv"
              ><md-icon slot="icon">download</md-icon>report.csv</md-text-button
            >`
          : nothing}
        ${run?.files.verification
          ? html`<md-text-button href=${run.files.verification} download="verification-${run.id}.csv"
              ><md-icon slot="icon">download</md-icon>verification.csv</md-text-button
            >`
          : nothing}
        ${run?.files.log
          ? html`<md-text-button href=${run.files.log} target="_blank"><md-icon slot="icon">description</md-icon>run.log</md-text-button>`
          : nothing}
      </div>
    </div>`;

    if (!run) {
      return html`${header}
        <div class="page-body">
          ${this.error
            ? html`<div class="banner error"><md-icon>error</md-icon><span>${this.error}</span></div>`
            : html`<section class="card"><md-linear-progress indeterminate></md-linear-progress></section>`}
        </div>`;
    }

    const t = tally(run.users);
    const rows = run.users.map((u) => ({
      key: u.email.toLowerCase(),
      email: u.email,
      name: u.name,
      csvStatus: '',
      active: true,
      user: u,
    }));
    const openRow = rows.find((r) => r.key === this.openKey) ?? null;
    const userLogs = openRow ? d.logs.filter((e) => e.user === openRow.user.index) : [];
    const problemsOnly = this.logFilter === 'problems';
    const matching = problemsOnly ? d.logs.filter((e) => e.kind === 'warn' || e.kind === 'error') : d.logs;
    const entries = matching.slice(-1000);
    const fact = (term, value) => html`<div class="fact"><dt>${term}</dt><dd>${value}</dd></div>`;

    return html`${header}
      <div class="page-body">
        ${run.id === this.activeRunId
          ? html`<div class="banner info">
              <md-icon>info</md-icon><span>This run is still in progress. <a href="#/run">Watch it live on the Run page.</a></span>
            </div>`
          : isLive(run)
            ? html`<div class="banner info">
                <md-icon>info</md-icon>
                <span
                  >This run is still in progress in another process (${run.source === 'ui' ? 'another web UI' : 'the command line'}). This
                  page refreshes every few seconds.</span
                >
              </div>`
            : nothing}
        ${run.status === 'interrupted'
          ? html`<div class="banner warning">
              <md-icon>warning</md-icon>
              <span
                >This run ended before it finished (for example Ctrl+C on the command line), so it has no report.csv. Users it
                finished show their results below; the log and screenshots show how far the others got.</span
              >
            </div>`
          : nothing}

        <section class="card">
          <div class="card-header"><h2>Overview</h2></div>
          <dl class="facts overview">
            ${fact('Status', badge(RUN_STATUS[run.status] ?? RUN_STATUS.done))}
            ${fact('Mode', run.mode ? MODES[run.mode]?.label ?? run.mode : 'Not recorded')}
            ${fact('Users', String(run.total))}
            ${fact('Users at a time', run.parallel ? String(run.parallel) : 'Not recorded')}
            ${fact('Started', dateTime(run.startedAt))}
            ${fact(isLive(run) ? 'Running for' : 'Duration', duration(run.elapsedMs))}
            ${fact('Started from', run.source === 'ui' ? 'Web UI' : 'Command line')}
            ${fact('Folder', html`<code>${run.folder}</code>`)}
          </dl>
          <div class="scorecards">
            ${[
              isLive(run) && ['Running', t.running, 'autorenew', 'info'],
              isLive(run) && t.queued && ['Queued', t.queued, 'schedule', 'neutral'],
              ['Completed', t.ok, 'check_circle', 'success'],
              ['Partial', t.partial, 'warning', 'warning'],
              ['Failed', t.failed, 'error', 'error'],
              (!isLive(run) || t.stopped + t.notRun) && ['Stopped / not run', t.stopped + t.notRun, 'stop_circle', 'neutral'],
              ['Verified', t.audited ? `${t.verified} / ${t.total}` : '—', 'verified', 'success'],
            ]
              .filter(Boolean)
              .map(
                ([label, value, icon, tone]) => html`<div class="scorecard tone-${tone}">
                  <div class="scorecard-label"><md-icon>${icon}</md-icon>${label}</div>
                  <div class="scorecard-value">${value}</div>
                </div>`,
              )}
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2>Users</h2>
            <span class="card-sub">${plural(run.users.length, 'user')}</span>
          </div>
          <eg-users-table
            .rows=${rows}
            .openKey=${this.openKey}
            .search=${this.search}
            .now=${Date.now()}
            @open-user=${(e) => (this.openKey = e.detail.key ?? e.detail.email?.toLowerCase())}
          ></eg-users-table>
        </section>

        <section class="card">
          <div class="card-header">
            <h2>Activity</h2>
            <span class="card-sub"
              >${entries.length < matching.length ? `Latest ${entries.length} of ${matching.length} lines` : ''}${d.logs.length
                ? ''
                : 'No run.log for this run (runs from before the web UI existed only have report.csv)'}</span
            >
            <span class="toolbar-spacer"></span>
            ${d.logs.length
              ? html`<md-chip-set aria-label="Filter activity">
                  <md-filter-chip label="All" .selected=${live(!problemsOnly)} @click=${() => (this.logFilter = 'all')}></md-filter-chip>
                  <md-filter-chip
                    label="Warnings and errors"
                    .selected=${live(problemsOnly)}
                    @click=${() => (this.logFilter = 'problems')}
                  ></md-filter-chip>
                </md-chip-set>`
              : nothing}
          </div>
          <eg-log-list
            class="activity-log"
            .entries=${entries}
            .users=${run.users}
            empty="Nothing logged."
            @open-user=${(e) => (this.openKey = e.detail.key ?? e.detail.email?.toLowerCase())}
          ></eg-log-list>
        </section>
      </div>

      <eg-user-panel
        .row=${openRow}
        .logs=${userLogs}
        .logUrl=${run.files.log ?? ''}
        .now=${Date.now()}
        @close-panel=${() => (this.openKey = null)}
      ></eg-user-panel>`;
  }
}

customElements.define('eg-history-view', HistoryView);
