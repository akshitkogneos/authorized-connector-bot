import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/checkbox/checkbox.js';
import '@material/web/chips/chip-set.js';
import '@material/web/chips/filter-chip.js';
import '@material/web/dialog/dialog.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/progress/circular-progress.js';
import '@material/web/progress/linear-progress.js';
import '@material/web/radio/radio.js';
import '@material/web/ripple/ripple.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import '@material/web/switch/switch.js';
import '@material/web/tabs/secondary-tab.js';
import '@material/web/tabs/tabs.js';

import { html, nothing } from 'lit';
import { LightElement, getJson, plural, tally } from './lib.js';
import './config-view.js';
import './csv-dialog.js';
import './history-view.js';
import './run-view.js';

const NAV = [
  { view: 'run', href: '#/run', icon: 'play_circle', label: 'Run' },
  { view: 'history', href: '#/history', icon: 'history', label: 'Run history' },
  { view: 'config', href: '#/config', icon: 'settings', label: 'Configuration' },
];

const MAX_LOGS = 50_000;

/** #/history/<id> -> { view: 'history', id }. */
function parseRoute() {
  const [, view = 'run', id = ''] = location.hash.split('/');
  return { view: NAV.some((n) => n.view === view) ? view : 'run', id: decodeURIComponent(id) };
}

/**
 * The console shell - top app bar, navigation, snackbar - and the single
 * owner of live state. It follows the server's event stream and hands the
 * current run and its log down to the pages.
 */
class App extends LightElement {
  static properties = {
    route: { state: true },
    navCollapsed: { state: true },
    connected: { state: true },
    info: { state: true },
    run: { state: true },
    logVersion: { state: true },
    search: { state: true },
    snack: { state: true },
    helpOpen: { state: true },
    csvOpen: { state: true },
  };

  constructor() {
    super();
    this.route = parseRoute();
    this.navCollapsed = window.matchMedia('(max-width: 960px)').matches;
    this.connected = true;
    this.info = null;
    this.run = null;
    this.logs = []; // appended in place; logVersion tells the pages it changed
    this.logVersion = 0;
    this.pendingLogs = [];
    this.search = '';
    this.snack = null;
    this.helpOpen = false;
    this.csvOpen = false;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('hashchange', () => {
      this.route = parseRoute();
      window.scrollTo(0, 0);
    });
    this.addEventListener('toast', (e) => this.showToast(e.detail.text, e.detail.action));
    this.addEventListener('open-csv-dialog', () => (this.csvOpen = true));
    this.addEventListener('close-csv-dialog', () => (this.csvOpen = false));
    this.addEventListener('csv-changed', (e) => {
      this.loadInfo();
      this.showToast(e.detail.text);
    });
    // A file dropped outside the upload area would otherwise replace the page.
    for (const type of ['dragover', 'drop']) {
      window.addEventListener(type, (e) => {
        if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
      });
    }
    this.loadInfo();
    this.connect();
  }

  async loadInfo() {
    try {
      this.info = await getJson('/api/state');
    } catch (err) {
      this.showToast(`Could not load users and settings: ${err.message}`);
    }
  }

  /** Follows the server's event stream. EventSource reconnects by itself; the server re-sends a snapshot. */
  connect() {
    const source = new EventSource('/api/events');
    const on = (type, handler) => source.addEventListener(type, (e) => handler(JSON.parse(e.data)));

    source.addEventListener('open', () => {
      if (!this.connected) this.loadInfo();
      this.connected = true;
    });
    source.addEventListener('error', () => {
      this.connected = false;
    });

    on('snapshot', ({ run, logs }) => {
      this.pendingLogs = [];
      this.logs = logs;
      this.logVersion += 1;
      this.setRun(run);
    });
    on('run', (run) => this.setRun(run));
    on('csv', () => this.loadInfo()); // the users file was switched, maybe from another tab
    on('user', (user) => this.patchUser(user.index, () => user));
    on('shot', ({ user, shot }) => this.patchUser(user, (u) => ({ ...u, shots: [...u.shots, shot] })));
    on('log', (entry) => {
      // Log lines can arrive dozens per second; render them in small batches.
      this.pendingLogs.push(entry);
      this.flushTimer ??= setTimeout(() => this.flushLogs(), 150);
    });
  }

  flushLogs() {
    this.flushTimer = null;
    if (!this.pendingLogs.length) return;
    for (const entry of this.pendingLogs) this.logs.push(entry);
    this.pendingLogs = [];
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
    this.logVersion += 1;
  }

  patchUser(index, update) {
    const user = this.run?.users[index];
    if (!user) return;
    const users = this.run.users.slice();
    users[index] = update(user);
    this.run = { ...this.run, users };
  }

  setRun(run) {
    const before = this.run;
    this.run = run;
    const wasLive = before && (before.status === 'running' || before.status === 'stopping');
    if (wasLive && run && before.id === run.id && ['done', 'stopped', 'error'].includes(run.status)) {
      const t = tally(run.users);
      const verified = t.audited ? ` · ${t.verified}/${t.total} verified` : '';
      this.showToast(
        `Run ${run.status === 'done' ? 'finished' : run.status}: ${t.ok} completed, ${t.partial} partial, ${t.failed} failed${verified}`,
        { label: 'View', href: `#/history/${run.id}` },
      );
    }
  }

  showToast(text, action = null) {
    clearTimeout(this.snackTimer);
    this.snack = { text, action };
    this.snackTimer = setTimeout(() => (this.snack = null), action ? 10_000 : 6_000);
  }

  onSearch(e) {
    this.search = e.target.value;
    // Searching from another page jumps to the users table (a run's detail page filters its own users).
    if (this.search && !(this.route.view === 'run' || (this.route.view === 'history' && this.route.id))) {
      location.hash = '#/run';
    }
  }

  render() {
    const csv = this.info?.csv;
    const active = (csv?.users ?? []).filter((u) => u.active).length;
    const live = this.run && (this.run.status === 'running' || this.run.status === 'stopping');
    const t = live ? tally(this.run.users) : null;

    return html`
      <header class="topbar">
        <md-icon-button
          class="topbar-icon"
          aria-label=${this.navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          @click=${() => (this.navCollapsed = !this.navCollapsed)}
          ><md-icon>menu</md-icon></md-icon-button
        >
        <a class="brand" href="#/run" aria-label="Explore Genie connectors bot - home">
          <img src="/logo.png" alt="Explore Genie" width="178" height="24" />
        </a>
        <button
          type="button"
          class="project-picker"
          title="Users file: ${csv?.file ?? '—'} - click to upload or switch"
          aria-haspopup="dialog"
          @click=${() => (this.csvOpen = true)}
        >
          <md-icon>group</md-icon>
          <span class="project-name">${csv?.name ?? 'Users file'}</span>
          ${csv ? html`<span class="project-count">${plural(active, 'user')}</span>` : nothing}
          <md-icon>arrow_drop_down</md-icon>
          <md-ripple></md-ripple>
        </button>
        <label class="search">
          <md-icon>search</md-icon>
          <input
            type="search"
            placeholder="Search users by name or email"
            aria-label="Search users"
            .value=${this.search}
            @input=${this.onSearch}
            @keydown=${(e) => {
              if (e.key === 'Escape') this.search = '';
            }}
          />
        </label>
        <span class="topbar-spacer"></span>
        ${live
          ? html`<a class="run-pill" href="#/run" title="A run is in progress">
              <md-circular-progress indeterminate></md-circular-progress>
              <span>${this.run.status === 'stopping' ? 'Stopping' : 'Running'} · ${t.finished}/${t.total}</span>
            </a>`
          : nothing}
        <md-icon-button class="topbar-icon" aria-label="Reload users and settings" title="Reload users and settings" @click=${this.reload}
          ><md-icon>refresh</md-icon></md-icon-button
        >
        <md-icon-button class="topbar-icon" aria-label="Help" title="Help" @click=${() => (this.helpOpen = true)}
          ><md-icon>help</md-icon></md-icon-button
        >
      </header>

      <nav class="sidenav ${this.navCollapsed ? 'collapsed' : ''}" aria-label="Main">
        <div class="sidenav-product"><md-icon>hub</md-icon><span>Connectors bot</span></div>
        ${NAV.map(
          (item) => html`<a
            class="nav-item ${this.route.view === item.view ? 'active' : ''}"
            href=${item.href}
            title=${item.label}
            aria-current=${this.route.view === item.view ? 'page' : 'false'}
          >
            <md-icon>${item.icon}</md-icon><span>${item.label}</span>
            <md-ripple></md-ripple>
          </a>`,
        )}
      </nav>

      <main class="main ${this.navCollapsed ? 'nav-collapsed' : ''}">
        ${this.connected
          ? nothing
          : html`<div class="banner warning connection">
              <md-icon>cloud_off</md-icon>
              <span>Lost the connection to the bot - reconnecting… If you stopped <code>npm run ui</code>, start it again.</span>
            </div>`}
        ${this.renderPage()}
      </main>

      ${this.renderHelp()}
      <eg-csv-dialog .open=${this.csvOpen} ?locked=${Boolean(live)}></eg-csv-dialog>
      <div class="snackbar ${this.snack ? 'show' : ''}" role="status" aria-live="polite">
        <span class="snackbar-text">${this.snack?.text ?? ''}</span>
        ${this.snack?.action
          ? html`<a class="snackbar-action" href=${this.snack.action.href} @click=${() => (this.snack = null)}>${this.snack.action.label}</a>`
          : nothing}
        <button class="snackbar-close" aria-label="Dismiss" @click=${() => (this.snack = null)}>
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `;
  }

  renderPage() {
    const info = this.info;
    const liveId = this.run && (this.run.status === 'running' || this.run.status === 'stopping') ? this.run.id : null;
    switch (this.route.view) {
      case 'history':
        return html`<eg-history-view .runId=${this.route.id} .activeRunId=${liveId} .search=${this.search}></eg-history-view>`;
      case 'config':
        return html`<eg-config-view .settings=${info?.settings ?? []} .csv=${info?.csv ?? null} ?locked=${Boolean(liveId)}></eg-config-view>`;
      default:
        return html`<eg-run-view
          .csv=${info?.csv ?? null}
          .modes=${info?.modes ?? null}
          .defaults=${info?.defaults ?? null}
          .target=${info?.target ?? ''}
          .run=${this.run}
          .logs=${this.logs}
          .logVersion=${this.logVersion}
          .search=${this.search}
        ></eg-run-view>`;
    }
  }

  renderHelp() {
    return html`<div class="dialog-layer"><md-dialog class="help-dialog" .open=${this.helpOpen} @closed=${() => (this.helpOpen = false)}>
      <div slot="headline">How this console works</div>
      <div slot="content" class="dialog-content">
        <p>
          Every user in <code>${this.info?.csv.file ?? 'data/users.csv'}</code> is processed in a fresh browser window of its own:
          sign in, authorize connectors, install skills, then verify the result.
        </p>
        <ul>
          <li>
            <strong>Users file</strong> - click the file name in the top bar (or <strong>Upload CSV</strong> above the users table) to
            upload another CSV or switch back to <code>${this.info?.csv.defaultFile ?? 'data/users.csv'}</code>. Uploads are kept in
            <code>data/uploads/</code>.
          </li>
          <li><strong>Mode</strong> - Full setup does everything; Connectors only and Skills only do one phase plus its check; Verify only is a read-only check.</li>
          <li><strong>Users at a time</strong> - how many browser windows work in parallel. Sign-ins start a few seconds apart.</li>
          <li><strong>2FA or a security check?</strong> Browsers are hidden unless <code>HEADLESS=false</code> is set in <code>.env</code>; with them visible, complete it in that user's window - the bot waits for you.</li>
          <li><strong>Stop run</strong> closes the windows still working and skips users not started yet. A partial report is still saved.</li>
          <li>Every run is saved under <code>runs/&lt;time&gt;/</code>: report.csv, verification.csv, run.log and screenshots per user.</li>
        </ul>
        <p>Command-line equivalents: <code>npm start parallel=5</code>, <code>npm run verify</code>, <code>npm run batch -- --connectors-only</code>.</p>
      </div>
      <div slot="actions"><md-filled-button @click=${() => (this.helpOpen = false)}>Got it</md-filled-button></div>
    </md-dialog></div>`;
  }

  async reload() {
    await this.loadInfo();
    this.showToast('Reloaded the users file and settings');
  }
}

customElements.define('eg-app', App);
