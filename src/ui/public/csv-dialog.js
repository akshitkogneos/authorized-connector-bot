import { html, nothing } from 'lit';
import { LightElement, ago, csvSwitchedText, fire, getJson, postJson, uploadCsvFile } from './lib.js';

const HINT = 'Needs Email and Password columns. First Name, Last Name and Status are optional.';

/** A file input the buttons below open; kept out of sight. */
function fileInput(onPick) {
  return html`<input
    class="visually-hidden csv-input"
    type="file"
    accept=".csv,text/csv"
    tabindex="-1"
    aria-hidden="true"
    @change=${(e) => {
      const [file] = e.target.files;
      e.target.value = ''; // picking the same file again must fire change again
      if (file) onPick(file);
    }}
  />`;
}

/**
 * "Upload CSV" and "Change file" buttons for the users card headers. An
 * upload switches to the new file straight away; the app reloads and toasts.
 */
export class CsvActions extends LightElement {
  static properties = {
    locked: { type: Boolean },
    busy: { state: true },
  };

  constructor() {
    super();
    this.locked = false;
    this.busy = false;
  }

  render() {
    const why = this.locked ? 'The users file can be changed once the current run has finished' : '';
    return html`${fileInput((file) => this.upload(file))}
      <md-outlined-button
        class="csv-upload"
        ?disabled=${this.locked || this.busy}
        title=${why || `Upload a users CSV. ${HINT}`}
        @click=${() => this.querySelector('.csv-input').click()}
      >
        ${this.busy
          ? html`<md-circular-progress slot="icon" indeterminate aria-hidden="true"></md-circular-progress>`
          : html`<md-icon slot="icon">upload_file</md-icon>`}
        ${this.busy ? 'Uploading…' : 'Upload CSV'}
      </md-outlined-button>
      <md-text-button title=${why || 'Pick an uploaded users file'} @click=${() => fire(this, 'open-csv-dialog')}>
        <md-icon slot="icon">folder_open</md-icon>Change file
      </md-text-button>`;
  }

  async upload(file) {
    this.busy = true;
    try {
      const result = await uploadCsvFile(file);
      fire(this, 'csv-changed', { text: csvSwitchedText(result) });
    } catch (err) {
      fire(this, 'toast', { text: `Could not use ${file.name}: ${err.message}`, action: null });
    } finally {
      this.busy = false;
    }
  }
}

/**
 * Like the console's project picker: the default users file plus every CSV
 * uploaded so far, a drop zone to upload another, and delete for uploads.
 */
export class CsvDialog extends LightElement {
  static properties = {
    open: { type: Boolean },
    locked: { type: Boolean },
    files: { state: true },
    choice: { state: true },
    loading: { state: true },
    busy: { state: true },
    error: { state: true },
    dragging: { state: true },
    confirmDelete: { state: true },
  };

  constructor() {
    super();
    this.open = false;
    this.locked = false;
    this.files = [];
    this.choice = null;
    this.loading = false;
    this.busy = false;
    this.error = '';
    this.dragging = false;
    this.confirmDelete = null;
  }

  willUpdate(changed) {
    if (changed.has('open') && this.open) {
      this.error = '';
      this.confirmDelete = null;
      this.dragging = false;
      this.load();
    }
  }

  async load() {
    this.loading = true;
    try {
      const { files } = await getJson('/api/csv');
      this.files = files;
      this.choice = files.find((f) => f.current)?.id ?? 'default';
    } catch (err) {
      this.error = `Could not list the users files: ${err.message}`;
    } finally {
      this.loading = false;
    }
  }

  close() {
    fire(this, 'close-csv-dialog');
  }

  render() {
    const current = this.files.find((f) => f.current);
    const chosen = this.files.find((f) => f.id === this.choice);
    const canUse = !this.locked && !this.busy && chosen && !chosen.current && !chosen.error;

    return html`<div class="dialog-layer"><md-dialog class="csv-dialog" .open=${this.open} @closed=${this.close}>
      <div slot="headline" class="csv-headline">
        <span>Select a users file</span>
        ${fileInput((file) => this.upload(file))}
        <md-text-button ?disabled=${this.locked || this.busy} @click=${() => this.querySelector('.csv-input').click()}>
          <md-icon slot="icon">upload_file</md-icon>Upload CSV
        </md-text-button>
      </div>
      <div slot="content" class="dialog-content csv-content">
        ${this.locked
          ? html`<div class="banner warning"><md-icon>lock</md-icon><span>A run is in progress. The users file can be changed once it has finished.</span></div>`
          : this.renderDropzone()}
        ${this.error ? html`<div class="banner error" role="alert"><md-icon>error</md-icon><span>${this.error}</span></div>` : nothing}
        ${this.loading && !this.files.length
          ? html`<div class="csv-loading"><md-circular-progress indeterminate></md-circular-progress></div>`
          : this.renderTable()}
      </div>
      <div slot="actions">
        <span class="csv-current dim">${current ? html`In use: <strong>${current.name}</strong>` : nothing}</span>
        <md-text-button @click=${this.close}>Cancel</md-text-button>
        <md-filled-button ?disabled=${!canUse} @click=${() => this.select(this.choice)}>Use this file</md-filled-button>
      </div>
    </md-dialog></div>`;
  }

  renderDropzone() {
    const over = (e) => {
      if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.dragging = true;
    };
    return html`<div
      class="dropzone ${this.dragging ? 'dragging' : ''} ${this.busy ? 'busy' : ''}"
      @dragenter=${over}
      @dragover=${over}
      @dragleave=${(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) this.dragging = false;
      }}
      @drop=${(e) => {
        e.preventDefault();
        this.dragging = false;
        const [file] = e.dataTransfer?.files ?? [];
        if (file) this.upload(file);
      }}
    >
      ${this.busy
        ? html`<md-circular-progress indeterminate aria-hidden="true"></md-circular-progress>`
        : html`<md-icon aria-hidden="true">cloud_upload</md-icon>`}
      <div>
        <div class="dropzone-title">
          ${this.busy
            ? 'Uploading…'
            : html`Drag a CSV file here or
                <button type="button" class="link-button" @click=${() => this.querySelector('.csv-input').click()}>browse</button>`}
        </div>
        <div class="dropzone-sub">${HINT} Uploads are kept in <code>data/uploads/</code>.</div>
      </div>
    </div>`;
  }

  renderTable() {
    if (!this.files.length) return nothing;
    return html`<div class="table-wrap csv-table">
      <table class="data compact">
        <thead>
          <tr>
            <th class="col-radio"><span class="visually-hidden">Selected</span></th>
            <th>Name</th>
            <th class="num">Users</th>
            <th class="num">Active</th>
            <th>Modified</th>
            <th class="col-actions"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${this.files.map((f) => (this.confirmDelete === f.id ? this.renderConfirmRow(f) : this.renderRow(f)))}
        </tbody>
      </table>
    </div>`;
  }

  renderRow(f) {
    const picked = this.choice === f.id;
    const pick = () => {
      if (!this.locked && !f.error) this.choice = f.id;
    };
    return html`<tr
      class="${picked ? 'selected' : ''} ${f.error || this.locked ? 'static' : ''}"
      @click=${pick}
      @dblclick=${() => {
        pick();
        if (!this.locked && !f.error && !f.current) this.select(f.id);
      }}
    >
      <td class="col-radio">
        <md-radio
          name="csv-file"
          aria-label=${f.name}
          .checked=${picked}
          ?disabled=${this.locked || Boolean(f.error)}
          @change=${pick}
        ></md-radio>
      </td>
      <td>
        <div class="csv-name">
          <md-icon aria-hidden="true">${f.isDefault ? 'home_storage' : 'description'}</md-icon>
          <span>${f.name}</span>
          ${f.isDefault ? html`<span class="chip-label">Default</span>` : nothing}
          ${f.current ? html`<span class="chip-label in-use">In use</span>` : nothing}
        </div>
        <div class="csv-path dim">${f.error ? html`<span class="text-error">${f.error}</span> · ` : nothing}${f.file}</div>
      </td>
      <td class="num">${f.error ? '—' : f.users}</td>
      <td class="num">${f.error ? '—' : f.active}</td>
      <td class="dim" title=${f.modifiedAt ? new Date(f.modifiedAt).toLocaleString() : ''}>${f.modifiedAt ? ago(f.modifiedAt) : '—'}</td>
      <td class="col-actions">
        ${f.isDefault
          ? nothing
          : html`<md-icon-button
              aria-label="Delete ${f.name}"
              title="Delete this upload"
              ?disabled=${this.locked || this.busy}
              @click=${(e) => {
                e.stopPropagation();
                this.confirmDelete = f.id;
              }}
              ><md-icon>delete</md-icon></md-icon-button
            >`}
      </td>
    </tr>`;
  }

  renderConfirmRow(f) {
    return html`<tr class="static confirm-row">
      <td colspan="6">
        <div class="confirm-inline">
          <md-icon>delete</md-icon>
          <span class="confirm-text"
            >Delete <strong>${f.name}</strong> from <code>data/uploads/</code>?${f.current
              ? ' The default users file will be used again.'
              : ''}</span
          >
          <span class="confirm-actions">
            <md-text-button @click=${() => (this.confirmDelete = null)}>Cancel</md-text-button>
            <md-filled-button class="danger-fill" ?disabled=${this.busy} @click=${() => this.remove(f.id)}>Delete</md-filled-button>
          </span>
        </div>
      </td>
    </tr>`;
  }

  /** Runs one change against the server, then refreshes the list. */
  async change(work) {
    this.busy = true;
    this.error = '';
    try {
      return await work();
    } catch (err) {
      this.error = err.message;
      return null;
    } finally {
      this.busy = false;
    }
  }

  async upload(file) {
    const result = await this.change(() => uploadCsvFile(file));
    if (!result) {
      this.error = `Could not use ${file.name}: ${this.error}`;
      return;
    }
    fire(this, 'csv-changed', { text: csvSwitchedText(result) });
    this.close();
  }

  async select(id) {
    const result = await this.change(() => postJson('/api/csv/select', { id }));
    if (!result) return;
    fire(this, 'csv-changed', { text: csvSwitchedText(result) });
    this.close();
  }

  async remove(id) {
    const gone = this.files.find((f) => f.id === id);
    const result = await this.change(() => postJson('/api/csv/delete', { id }));
    this.confirmDelete = null;
    if (!result) return;
    fire(this, 'csv-changed', {
      text: `Deleted ${gone?.name ?? 'the upload'}${gone?.current ? ` · now using ${result.file.name}` : ''}`,
    });
    await this.load();
  }
}

customElements.define('eg-csv-actions', CsvActions);
customElements.define('eg-csv-dialog', CsvDialog);
