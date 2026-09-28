import { html, nothing } from 'lit';
import { LightElement, plural } from './lib.js';

/**
 * Read-only view of the effective settings (from .env) and the users file.
 * Changing them means editing .env and restarting `npm run ui`.
 */
export class ConfigView extends LightElement {
  static properties = {
    settings: { attribute: false },
    csv: { attribute: false },
  };

  constructor() {
    super();
    this.settings = [];
    this.csv = null;
  }

  render() {
    const groups = new Map();
    for (const setting of this.settings) {
      if (!groups.has(setting.group)) groups.set(setting.group, []);
      groups.get(setting.group).push(setting);
    }
    const users = this.csv?.users ?? [];
    const active = users.filter((u) => u.active).length;

    return html`
      <div class="page-header"><h1>Configuration</h1></div>
      <div class="page-body">
        <div class="banner info">
          <md-icon>info</md-icon>
          <span>
            These values come from <code>.env</code> and are read when the UI starts. To change one, edit <code>.env</code> and
            restart <code>npm run ui</code>. Mode and users at a time can also be changed for each run on the
            <a href="#/run">Run</a> page.
          </span>
        </div>

        <section class="card">
          <div class="card-header"><h2>Users file</h2></div>
          <dl class="facts overview">
            <div class="fact"><dt>File</dt><dd><code>${this.csv?.file ?? '—'}</code></dd></div>
            <div class="fact"><dt>Users</dt><dd>${plural(users.length, 'row')}</dd></div>
            <div class="fact"><dt>Active</dt><dd>${active}</dd></div>
            <div class="fact"><dt>Other status</dt><dd>${users.length - active}</dd></div>
          </dl>
          ${this.csv?.error
            ? html`<div class="banner error inset"><md-icon>error</md-icon><span>${this.csv.error}</span></div>`
            : nothing}
        </section>

        ${[...groups].map(
          ([group, items]) => html`<section class="card">
            <div class="card-header"><h2>${group}</h2></div>
            <div class="table-wrap">
              <table class="data settings">
                <thead>
                  <tr>
                    <th>Setting</th>
                    <th>Value</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(
                    (s) => html`<tr class="static">
                      <td><code>${s.key}</code></td>
                      <td>${this.value(s.value)}</td>
                      <td class="dim">${s.help}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>
          </section>`,
        )}
      </div>
    `;
  }

  value(value) {
    if (value === true) return html`<span class="status tone-success"><md-icon>check_circle</md-icon><span>On</span></span>`;
    if (value === false) return html`<span class="status tone-neutral"><md-icon>do_not_disturb_on</md-icon><span>Off</span></span>`;
    if (value === '' || value === null || value === undefined) return html`<span class="dim">Not set</span>`;
    return html`<span class="setting-value">${String(value)}</span>`;
  }
}

customElements.define('eg-config-view', ConfigView);
