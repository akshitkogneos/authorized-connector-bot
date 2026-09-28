import { html, nothing } from 'lit';
import {
  LightElement,
  USER_STATUS,
  VERIFIED,
  avatar,
  badge,
  clock,
  detailText,
  fire,
  prettyLabel,
  splitList,
  userDuration,
} from './lib.js';
import './log-list.js';

const TABS = ['Summary', 'Activity', 'Screenshots', 'Verification'];

const STATE_TONES = {
  enabled: 'success',
  installed: 'success',
  skipped: 'neutral',
  'NOT ENABLED': 'error',
  'NOT INSTALLED': 'error',
  'EXPECTED BUT ABSENT': 'error',
  ERROR: 'error',
};
const STATE_ICONS = { success: 'check_circle', error: 'error', neutral: 'remove_circle' };

/**
 * The details side panel for one user (like the GCP info panel): summary,
 * that user's activity log, screenshots and verification findings.
 * Fires `close-panel`.
 */
export class UserPanel extends LightElement {
  static properties = {
    row: { attribute: false },
    logs: { attribute: false },
    logUrl: {},
    now: { attribute: false },
    tab: { state: true },
    shot: { state: true },
  };

  constructor() {
    super();
    this.row = null;
    this.logs = [];
    this.logUrl = '';
    this.now = Date.now();
    this.tab = 0;
    this.shot = -1;
    this.onKey = (e) => {
      // Escape closes an open dialog first (help, confirm, screenshot viewer), not the panel behind it.
      if (e.key === 'Escape' && this.row && this.shot < 0 && !document.querySelector('md-dialog[open]')) {
        fire(this, 'close-panel');
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this.onKey);
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this.onKey);
    super.disconnectedCallback();
  }

  willUpdate(changed) {
    // Keep the last user rendered while the panel slides out.
    if (changed.has('row') && this.row) this.shown = this.row;
    if (changed.has('row') && changed.get('row')?.key !== this.row?.key) {
      this.shot = -1;
      this.shownShot = -1;
    }
  }

  render() {
    const r = this.row ?? this.shown;
    return html`
      <aside class="side-panel ${this.row ? 'open' : ''}" aria-label="User details" ?inert=${!this.row}>
        ${r ? this.renderPanel(r) : nothing}
      </aside>
      ${r ? this.renderViewer(r.user.shots ?? []) : nothing}
    `;
  }

  renderPanel(r) {
    const user = r.user;
    const shots = user.shots ?? [];
    const findings = user.findings ?? [];
    const labels = [TABS[0], `${TABS[1]} · ${this.logs.length}`, `${TABS[2]} · ${shots.length}`, `${TABS[3]} · ${findings.length}`];
    const bodies = [() => this.renderSummary(r), () => this.renderActivity(), () => this.renderShots(shots), () => this.renderFindings(findings)];

    return html`
      <header class="panel-header">
        ${avatar(r.name, r.email)}
        <div class="panel-title">
          <h2>${r.name || r.email}</h2>
          ${r.name ? html`<div class="panel-sub">${r.email}</div>` : nothing}
        </div>
        <md-icon-button aria-label="Close details" @click=${() => fire(this, 'close-panel')}>
          <md-icon>close</md-icon>
        </md-icon-button>
      </header>
      <div class="panel-status">
        ${badge(USER_STATUS[user.status] ?? USER_STATUS.unknown)}
        ${user.startedAt ? html`<span class="dim">Started ${clock(user.startedAt)} · ${userDuration(user, this.now)}</span>` : nothing}
      </div>
      <md-tabs .activeTabIndex=${this.tab} @change=${(e) => (this.tab = e.target.activeTabIndex)} aria-label="User details">
        ${labels.map((label) => html`<md-secondary-tab>${label}</md-secondary-tab>`)}
      </md-tabs>
      <div class="panel-body">${bodies[this.tab]?.() ?? nothing}</div>
    `;
  }

  renderSummary(r) {
    const user = r.user;
    // A user who never started only has a placeholder report row (all zeros).
    const row = user.status === 'not run' ? null : user.row;
    const items = (value) => {
      const entries = splitList(value);
      return entries.length ? html`<ul class="plain-list">${entries.map((e) => html`<li>${e}</li>`)}</ul>` : null;
    };
    const facts = [
      ['Status', badge(USER_STATUS[user.status] ?? USER_STATUS.unknown)],
      [user.status === 'running' ? 'Current step' : 'Details', detailText(user) || null],
      ['Connectors authorized', row ? String(row.connectors) : null],
      ['Connectors that failed', items(row?.connectors_failed)],
      ['Skills installed', row ? String(row.skills) : null],
      ['Skills that failed', items(row?.skills_failed)],
      ['Verified', row && row.verified !== '-' ? badge(VERIFIED[row.verified] ?? VERIFIED.unknown) : null],
      ['Connectors not enabled', items(row?.connectors_pending)],
      ['Skills not installed', items(row?.skills_missing)],
      ['Expected but absent', items(row?.expected_missing)],
      ['Started', user.startedAt ? clock(user.startedAt) : null],
      ['Finished', user.finishedAt ? clock(user.finishedAt) : null],
      ['Duration', userDuration(user, this.now) === '—' ? null : userDuration(user, this.now)],
      ['Status in CSV', r.csvStatus || null],
    ].filter(([, value]) => value !== null && value !== '');

    return html`<dl class="facts">
      ${facts.map(([term, value]) => html`<div class="fact"><dt>${term}</dt><dd>${value}</dd></div>`)}
    </dl>`;
  }

  renderActivity() {
    return html`
      <eg-log-list class="panel-log" .entries=${this.logs} empty="No activity for this user yet."></eg-log-list>
      ${this.logUrl
        ? html`<div class="panel-foot">
            <md-text-button href=${this.logUrl} target="_blank">
              <md-icon slot="icon">open_in_new</md-icon>Open the full run log
            </md-text-button>
          </div>`
        : nothing}
    `;
  }

  renderShots(shots) {
    if (!shots.length) {
      return html`<div class="empty-state small">
        <md-icon>photo_library</md-icon>
        <p>No screenshots${this.row?.user.status === 'running' ? ' yet' : ''}.</p>
      </div>`;
    }
    return html`<div class="shot-grid">
      ${shots.map(
        (s, i) => html`<button class="shot-card" @click=${() => (this.shot = i)} title="Open ${prettyLabel(s.label)}">
          <img src=${s.url} alt=${prettyLabel(s.label)} loading="lazy" />
          <span class="shot-caption">
            <span>${i + 1}. ${prettyLabel(s.label)}</span>
            <span class="dim">${s.time ? clock(s.time) : ''}</span>
          </span>
          <md-ripple></md-ripple>
        </button>`,
      )}
    </div>`;
  }

  renderFindings(findings) {
    if (!findings.length) {
      return html`<div class="empty-state small">
        <md-icon>fact_check</md-icon>
        <p>No verification results. They appear once the verify phase has run for this user.</p>
      </div>`;
    }
    const sorted = [...findings].sort((a, b) => a.type.localeCompare(b.type));
    return html`<table class="data compact">
      <thead>
        <tr>
          <th>Type</th>
          <th>Item</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map((f) => {
          const tone = STATE_TONES[f.state] ?? 'neutral';
          return html`<tr class="static">
            <td class="dim">${prettyLabel(f.type)}</td>
            <td>${f.item}</td>
            <td>${badge({ tone, icon: STATE_ICONS[tone] }, prettyLabel(f.state.toLowerCase()))}</td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  renderViewer(shots) {
    // The last screenshot stays rendered while the dialog animates closed.
    const open = this.shot >= 0 && this.shot < shots.length;
    if (open) this.shownShot = this.shot;
    const index = open ? this.shot : (this.shownShot ?? -1);
    const shot = shots[index];
    const go = (step) => {
      const next = this.shot + step;
      if (next >= 0 && next < shots.length) this.shot = next;
    };
    return html`<div class="dialog-layer"><md-dialog
      class="shot-dialog"
      .open=${open}
      @closed=${() => (this.shot = -1)}
      @keydown=${(e) => {
        if (e.key === 'ArrowRight') go(1);
        if (e.key === 'ArrowLeft') go(-1);
      }}
    >
      <div slot="headline" class="shot-headline">
        <span>${shot ? prettyLabel(shot.label) : ''}</span>
        <span class="dim">${shot ? `${index + 1} of ${shots.length}` : ''}</span>
      </div>
      <div slot="content" class="shot-content">${shot ? html`<img src=${shot.url} alt=${prettyLabel(shot.label)} />` : nothing}</div>
      <div slot="actions">
        <md-text-button href=${shot?.url ?? ''} target="_blank">Open image</md-text-button>
        <span class="toolbar-spacer"></span>
        <md-outlined-button ?disabled=${index <= 0} @click=${() => go(-1)}>
          <md-icon slot="icon">chevron_left</md-icon>Previous
        </md-outlined-button>
        <md-outlined-button ?disabled=${index >= shots.length - 1} @click=${() => go(1)} trailing-icon>
          <md-icon slot="icon">chevron_right</md-icon>Next
        </md-outlined-button>
        <md-filled-button @click=${() => (this.shot = -1)}>Close</md-filled-button>
      </div>
    </md-dialog></div>`;
  }
}

customElements.define('eg-user-panel', UserPanel);
