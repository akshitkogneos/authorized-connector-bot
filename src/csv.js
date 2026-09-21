import fs from 'node:fs';

/**
 * Minimal RFC-4180 CSV reader/writer. No dependency needed for files this
 * small, but it still has to cope with the real-world details: a UTF-8 BOM,
 * CRLF line endings, a missing trailing newline, and quoted fields that
 * contain commas, quotes or newlines (passwords often do).
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  const clean = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];

    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  // Flush the last field/row when the file has no trailing newline.
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Reads a CSV into objects keyed by its header row (keys are lower-cased). */
export function readCsvObjects(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((key, i) => {
      obj[key] = (cells[i] ?? '').trim();
    });
    return obj;
  });
}

const escapeCell = (value) => {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Writes an array of objects as CSV using `headers` for column order. */
export function writeCsv(file, headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => escapeCell(row[h])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * Turns CSV rows into users. Accepts a few common header spellings so the
 * file can come straight out of a console export.
 */
export function toUsers(records, { onlyActive = true } = {}) {
  return records
    .map((r, i) => ({
      email: r.email || r['email address'] || r.username || '',
      password: r.password || r.pass || '',
      name: [r['first name'], r['last name']].filter(Boolean).join(' ') || r.name || '',
      status: r.status || '',
      line: i + 2, // +1 for the header, +1 for 1-based numbering
    }))
    .filter((u) => u.email && u.password)
    .filter((u) => !onlyActive || !u.status || /^active$/i.test(u.status));
}
