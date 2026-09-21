/**
 * Self-test for the CSV layer - no browser, no network.
 *   npm run test:csv
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCsv, readCsvObjects, toUsers, writeCsv } from '../src/csv.js';

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`✔ ${name}`);
  } catch (err) {
    console.error(`✖ ${name}\n   ${err.message}`);
    process.exitCode = 1;
  }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-test-'));
const write = (name, content) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, content);
  return file;
};

check('parses CRLF with no trailing newline', () => {
  const rows = parseCsv('a,b\r\n1,2\r\n3,4');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
  ]);
});

check('strips a UTF-8 BOM from the first header', () => {
  const objs = readCsvObjects(write('bom.csv', '\uFEFFEmail,Password\r\na@b.com,pw\r\n'));
  assert.equal(objs[0].email, 'a@b.com');
});

check('keeps commas and quotes inside quoted fields', () => {
  const objs = readCsvObjects(
    write('quoted.csv', 'Email,Password\r\n"a@b.com","p,w""x"\r\n'),
  );
  assert.equal(objs[0].password, 'p,w"x');
});

check('does not mangle passwords with $ or !', () => {
  const objs = readCsvObjects(write('specials.csv', 'Email,Password\r\na@b.com,ExploreBWG$\r\nc@d.com,AKshitAK!\r\n'));
  assert.equal(objs[0].password, 'ExploreBWG$');
  assert.equal(objs[1].password, 'AKshitAK!');
});

check('skips blank lines', () => {
  assert.equal(parseCsv('a,b\r\n\r\n1,2\r\n').length, 2);
});

check('only Active users by default, all with onlyActive:false', () => {
  const records = readCsvObjects(
    write(
      'status.csv',
      'First Name,Last Name,Email,Password,Status\r\nA,B,a@b.com,pw1,Active\r\nC,D,c@d.com,pw2,Suspended\r\n',
    ),
  );
  assert.deepEqual(toUsers(records).map((u) => u.email), ['a@b.com']);
  assert.equal(toUsers(records, { onlyActive: false }).length, 2);
});

check('drops rows missing an email or password', () => {
  const records = readCsvObjects(
    write('partial.csv', 'Email,Password,Status\r\na@b.com,,Active\r\n,pw,Active\r\ne@f.com,pw,Active\r\n'),
  );
  assert.deepEqual(toUsers(records).map((u) => u.email), ['e@f.com']);
});

check('builds a full name and keeps the source line number', () => {
  const records = readCsvObjects(
    write('names.csv', 'First Name,Last Name,Email,Password,Status\r\nAda,Lovelace,a@b.com,pw,Active\r\n'),
  );
  assert.equal(toUsers(records)[0].name, 'Ada Lovelace');
  assert.equal(toUsers(records)[0].line, 2);
});

check('round-trips through writeCsv, escaping as needed', () => {
  const file = path.join(tmp, 'out.csv');
  writeCsv(file, ['email', 'note'], [{ email: 'a@b.com', note: 'has, comma and "quote"' }]);
  const back = readCsvObjects(file);
  assert.equal(back[0].note, 'has, comma and "quote"');
});

check('reads the real data/users.csv', () => {
  const real = path.resolve('data/users.csv');
  if (!fs.existsSync(real)) {
    console.log('   (skipped - data/users.csv not present)');
    return;
  }
  const users = toUsers(readCsvObjects(real));
  assert.ok(users.length > 0, 'expected at least one active user');
  for (const u of users) {
    assert.match(u.email, /@/, `bad email: ${u.email}`);
    assert.ok(u.password.length > 0, `empty password for ${u.email}`);
  }
  console.log(`   ${users.length} user(s): ${users.map((u) => u.email).join(', ')}`);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} check(s) passed`);
