import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isActive, parseCsv, parseCsvObjects, readCsvObjects, toUsers } from '../csv.js';
import { HttpError } from './runner.js';

/** Header spellings toUsers() understands (lower-cased). */
const EMAIL_COLUMNS = ['email', 'email address', 'username'];
const PASSWORD_COLUMNS = ['password', 'pass'];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const STAMP = /^\d{8}-\d{6}-/; // prefix of a saved upload: 20260929-183310-

/**
 * The users files the web UI can run: the default one (USERS_CSV in .env or
 * csv=... on the command line) plus CSVs uploaded from the page.
 *
 * Uploads are saved under `uploadDir` (data/uploads/, git-ignored - they hold
 * passwords) and the one picked last is used by the UI until it restarts.
 * The default file itself is never modified.
 */
export function createCsvStore({ defaultPath, uploadDir }) {
  let current = defaultPath;
  const rel = (file) => path.relative(process.cwd(), file) || file;

  /** The file the UI shows and runs. Falls back to the default if an upload was deleted by hand. */
  function currentPath() {
    if (current !== defaultPath && !fs.existsSync(current)) current = defaultPath;
    return current;
  }

  function uploads() {
    let names;
    try {
      names = fs.readdirSync(uploadDir);
    } catch {
      return [];
    }
    return names
      .filter((name) => name.toLowerCase().endsWith('.csv'))
      .map((name) => path.join(uploadDir, name))
      .filter((file) => file !== defaultPath && fs.statSync(file, { throwIfNoEntry: false })?.isFile())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  }

  /** One file for the picker: counts only - passwords and emails stay on the server. */
  function describe(file) {
    const isDefault = file === defaultPath;
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    let users = [];
    let error = null;
    if (!stat) {
      error = 'File not found';
    } else {
      try {
        users = toUsers(readCsvObjects(file), { onlyActive: false });
        if (!users.length) error = 'No usable rows';
      } catch (err) {
        error = err.message;
      }
    }
    return {
      id: isDefault ? 'default' : path.basename(file),
      name: isDefault ? path.basename(file) : path.basename(file).replace(STAMP, ''),
      file: rel(file),
      isDefault,
      current: file === currentPath(),
      users: users.length,
      active: users.filter(isActive).length,
      modifiedAt: stat ? stat.mtime.toISOString() : null,
      error,
    };
  }

  /** Default file first, then uploads, newest first. */
  const list = () => [defaultPath, ...uploads()].map(describe);

  /** The file behind a picker id; 404 for anything that isn't the default or a saved upload. */
  function resolve(id) {
    if (id === 'default') return defaultPath;
    if (typeof id !== 'string' || id !== path.basename(id) || !id.toLowerCase().endsWith('.csv')) {
      throw new HttpError(404, 'No such users file.');
    }
    const file = path.join(uploadDir, id);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new HttpError(404, 'No such users file.');
    return file;
  }

  /** Checks an upload the way a run reads it and explains exactly what is wrong. */
  function validate(text) {
    if (!text.trim()) throw new HttpError(400, 'The file is empty.');
    if (text.startsWith('PK')) {
      throw new HttpError(400, 'This looks like an Excel workbook. Save it as CSV (File > Save As > CSV) and upload that.');
    }
    if (text.includes('\0')) throw new HttpError(400, 'This is not a text CSV file.');

    const headers = (parseCsv(text)[0] ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
    const missing = [
      !EMAIL_COLUMNS.some((c) => headers.includes(c)) && 'Email',
      !PASSWORD_COLUMNS.some((c) => headers.includes(c)) && 'Password',
    ].filter(Boolean);
    if (missing.length) {
      const found = headers.length ? ` The first row has: ${headers.slice(0, 8).join(', ')}${headers.length > 8 ? ', …' : ''}.` : '';
      throw new HttpError(400, `Missing ${missing.join(' and ')} column${missing.length > 1 ? 's' : ''}.${found}`);
    }
    const users = toUsers(parseCsvObjects(text), { onlyActive: false });
    if (!users.length) throw new HttpError(400, 'No row has both an email and a password.');
    return users;
  }

  /** A readable, unique file name: 20260929-183310-users_621_to_770.csv. */
  function uploadName(original) {
    const base =
      path
        .basename(String(original || ''))
        .replace(/\.csv$/i, '')
        .replace(/[^\w.-]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 80) || 'users';
    const d = new Date();
    const two = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    let name = `${stamp}-${base}.csv`;
    for (let i = 2; fs.existsSync(path.join(uploadDir, name)); i += 1) name = `${stamp}-${base}-${i}.csv`;
    return name;
  }

  /**
   * Saves an uploaded CSV and switches to it. Uploading the same content
   * again reuses the earlier copy instead of piling up duplicates.
   */
  function save({ name, content }) {
    if (typeof content !== 'string') throw new HttpError(400, 'No file content received.');
    if (Buffer.byteLength(content) > MAX_UPLOAD_BYTES) throw new HttpError(413, 'The file is larger than 5 MB.');
    validate(content);

    const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
    const digest = hash(content);
    let file = uploads().find((f) => hash(fs.readFileSync(f, 'utf8')) === digest);
    const reused = Boolean(file);
    if (file) {
      const now = new Date();
      fs.utimesSync(file, now, now); // back to the top of the list
    } else {
      fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
      file = path.join(uploadDir, uploadName(name));
      fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 });
    }
    current = file;
    return { file: describe(file), reused };
  }

  function select(id) {
    current = resolve(id);
    return describe(current);
  }

  /** Deletes an upload. Deleting the file in use switches back to the default. */
  function remove(id) {
    if (id === 'default') throw new HttpError(400, 'The default users file cannot be deleted from here.');
    const file = resolve(id);
    fs.unlinkSync(file);
    if (current === file) current = defaultPath;
    return describe(currentPath());
  }

  return {
    path: currentPath,
    /** What the page calls the file in use: data/users.csv, or an upload's original name. */
    name: () => (currentPath() === defaultPath ? rel(defaultPath) : path.basename(currentPath()).replace(STAMP, '')),
    isDefault: () => currentPath() === defaultPath,
    defaultFile: () => rel(defaultPath),
    list,
    save,
    select,
    remove,
  };
}
