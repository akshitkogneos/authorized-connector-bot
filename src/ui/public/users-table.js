import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
import { LightElement, USER_STATUS, VERIFIED, avatar, badge, detailText, fire, needsRetry, splitList, userDuration } from './lib.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'In progress', test: (u) => u.status === 'running' || u.status === 'queued' },
  { id: 'attention', label: 'Needs attention', test: needsRetry },
  { id: 'ok', label: 'Completed', test: (u) => u.status === 'ok' },
];

/** Shows an empty value ('—') greyed out, like the other empty cells. */
const dimDash = (value) => (value === '—' ? html`<span class="dim">—</span>` : value);

/**
 * The users table: one row per user with status, current step or outcome,
 * counts, verification and duration. Rows are
 * `{ key, email, name, csvStatus, active, user }` where `user` is the run's
 * user object (or a stub `{ status: 'idle' }` for users outside the run).
 *
 * Events: open-user { key }, select-user { key, checked }, select-all { keys, checked }.
 */
export class UsersTable extends LightElement {
  static properties = {
    rows: { attribute: false },
    selectable: { type: Boolean },
    selected: { attribute: false },
    openKey: { attribute: false },
    search: {},
    now: { attribute: false },
    locked: { type: Boolean },
    filter: { state: true },
  };

  constructor() {
    super();
    this.rows = [];
    this.selectable = false;
    this.selected = new Set();
    this.openKey = null;
    this.search = '';
    this.now = Date.now();
    this.locked = false;
    this.filter = 'all';
  }

  render() {
    const query = (this.search || '').trim().toLowerCase();
    const matching = query
      ? this.rows.filter((r) => r.email.toLowerCase().includes(query) || r.name.toLowerCase().includes(query))
      : this.rows;
    const counts = Object.fromEntries(
      FILTERS.map((f) => [f.id, f.test ? matching.filter((r) => f.test(r.user)).length : matching.length]),
    );
    const active = FILTERS.find((f) => f.id === this.filter) ?? FILTERS[0];
    const visible = active.test ? matching.filter((r) => active.test(r.user)) : matching;
    const picked = visible.filter((r) => this.selected.has(r.key)).length;

    return html`
      <div class="table-toolbar">
        <md-icon class="toolbar-icon" aria-hidden="true">filter_list</md-icon>
        <md-chip-set aria-label="Filter users">
          ${FILTERS.map(
            (f) => html`<md-filter-chip
              label="${f.label} · ${counts[f.id]}"
              .selected=${live(this.filter === f.id)}
              @click=${() => {
                this.filter = f.id;
              }}
            ></md-filter-chip>`,
          )}
        </md-chip-set>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-note">
          ${query ? html`Matching “${this.search.trim()}” · ` : nothing}${visible.length} of ${this.rows.length}
          ${this.selectable && this.selected.size ? html` · <strong>${this.selected.size} selected</strong>` : nothing}
        </span>
      </div>
      <div class="table-wrap">
        <table class="data users">
          <thead>
            <tr>
              ${this.selectable
                ? html`<th class="col-check">
                    <md-checkbox
                      aria-label="Select all visible users"
                      ?disabled=${this.locked || !visible.length}
                      .checked=${live(visible.length > 0 && picked === visible.length)}
                      .indeterminate=${live(picked > 0 && picked < visible.length)}
                      @change=${(e) => fire(this, 'select-all', { keys: visible.map((r) => r.key), checked: e.target.checked })}
                    ></md-checkbox>
                  </th>`
                : nothing}
              <th>User</th>
              <th>Status</th>
              <th class="col-detail">Details</th>
              <th class="num">Connectors</th>
              <th class="num">Skills</th>
              <th>Verified</th>
              <th class="num">Duration</th>
              <th class="col-open"><span class="visually-hidden">Open</span></th>
            </tr>
          </thead>
          <tbody>
            ${repeat(
              visible,
              (r) => r.key,
              (r) => this.renderRow(r),
            )}
          </tbody>
        </table>
        ${visible.length
          ? nothing
          : html`<div class="table-empty">
              <md-icon aria-hidden="true">person_search</md-icon>
              <span>${this.rows.length ? 'No users match this filter.' : 'No users to show.'}</span>
            </div>`}
      </div>
    `;
  }

  renderRow(r) {
    const user = r.user;
    const row = user.row;
    const selected = this.selected.has(r.key);
    const detail = detailText(user);
    const failedConnectors = splitList(row?.connectors_failed).length;
    const failedSkills = splitList(row?.skills_failed).length;
    const count = (n, failed) =>
      row && user.status !== 'not run'
        ? html`${n}${failed ? html` <span class="text-error">(${failed} failed)</span>` : nothing}`
        : html`<span class="dim">—</span>`;

    return html`<tr
      class="${selected ? 'selected' : ''} ${this.openKey === r.key ? 'open' : ''}"
      @click=${() => fire(this, 'open-user', { key: r.key })}
    >
      ${this.selectable
        ? html`<td class="col-check" @click=${(e) => e.stopPropagation()}>
            <md-checkbox
              aria-label="Select ${r.email}"
              ?disabled=${this.locked}
              .checked=${live(selected)}
              @change=${(e) => fire(this, 'select-user', { key: r.key, checked: e.target.checked })}
            ></md-checkbox>
          </td>`
        : nothing}
      <td class="col-user">
        <div class="user-cell">
          ${avatar(r.name, r.email, 'small')}
          <div class="user-text">
            <div class="user-name">
              ${r.name || r.email}
              ${r.active ? nothing : html`<span class="tag" title="Status in the CSV">${r.csvStatus || 'Inactive'}</span>`}
            </div>
            ${r.name ? html`<div class="user-email">${r.email}</div>` : nothing}
          </div>
        </div>
      </td>
      <td>${badge(USER_STATUS[user.status] ?? USER_STATUS.unknown)}</td>
      <td class="col-detail">
        <span class="detail-text ${user.status === 'failed' ? 'text-error' : ''}" title=${detail}>${detail || '—'}</span>
      </td>
      <td class="num">${count(row?.connectors, failedConnectors)}</td>
      <td class="num">${count(row?.skills, failedSkills)}</td>
      <td>${row && row.verified !== '-' ? badge(VERIFIED[row.verified] ?? VERIFIED.unknown) : html`<span class="dim">—</span>`}</td>
      <td class="num">${dimDash(userDuration(user, this.now))}</td>
      <td class="col-open"><md-icon aria-hidden="true">chevron_right</md-icon></td>
    </tr>`;
  }
}

customElements.define('eg-users-table', UsersTable);
