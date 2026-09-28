import { html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { LightElement, clock, fire } from './lib.js';

// Log lines use the icon font directly rather than <md-icon>: a run can have
// thousands of lines and a custom element per line would be needlessly heavy.
const ICONS = { info: 'info', step: 'play_circle', ok: 'check_circle', warn: 'warning', error: 'error' };

/**
 * A Logs Explorer-style list: time, (optionally) the user, severity icon,
 * message. Sticks to the bottom while new lines arrive unless scrolled up.
 */
export class LogList extends LightElement {
  static properties = {
    entries: { attribute: false },
    /** The run's users; when set, each line is labelled with its user. */
    users: { attribute: false },
    empty: {},
  };

  constructor() {
    super();
    this.entries = [];
    this.users = null;
    this.empty = 'No activity yet.';
    this.stick = true;
  }

  render() {
    if (!this.entries.length) return html`<div class="log-empty">${this.empty}</div>`;
    return html`<div class="log-scroll" role="log" @scroll=${this.onScroll}>
      ${repeat(
        this.entries,
        (e) => e.seq,
        (e) => this.line(e),
      )}
    </div>`;
  }

  line(entry) {
    const user = this.users && entry.user !== null ? this.users[entry.user] : null;
    return html`<div class="log-line kind-${entry.kind}">
      <span class="log-time">${clock(entry.time)}</span>
      ${this.users
        ? html`<span class="log-user"
            >${user
              ? html`<button title=${user.email} @click=${() => fire(this, 'open-user', { email: user.email })}>
                  ${user.email.split('@')[0]}
                </button>`
              : html`<span class="log-run">run</span>`}</span
          >`
        : nothing}
      <span class="material-symbols-outlined log-icon" aria-label=${entry.kind}>${ICONS[entry.kind] ?? 'info'}</span>
      <span class="log-msg">${entry.msg}</span>
    </div>`;
  }

  onScroll(event) {
    const el = event.currentTarget;
    this.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  }

  updated() {
    const el = this.querySelector('.log-scroll');
    if (el && this.stick) el.scrollTop = el.scrollHeight;
  }
}

customElements.define('eg-log-list', LogList);
