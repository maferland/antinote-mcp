import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const app = join(process.cwd(), 'build/AntinoteReader.app');
const binary = join(app, 'Contents/MacOS/AntinoteReader');

test('signed native helper has only sandbox, read-only selection, and bookmark entitlements', () => {
  const entitlements = execFileSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', app], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(entitlements, /com.apple.security.app-sandbox/);
  assert.match(entitlements, /com.apple.security.files.user-selected.read-only/);
  assert.match(entitlements, /com.apple.security.files.bookmarks.app-scope/);
  assert.ok(!entitlements.includes('read-write'));
  assert.ok(!entitlements.includes('network'));
  assert.ok(!entitlements.includes('temporary-exception'));
});

test('sandboxed helper returns a consistent standalone snapshot with committed WAL data', t => {
  const folder = mkdtempSync(join(tmpdir(), 'antinote-native-test-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  // The native self-test also verifies that a write through its read-only
  // database connection is rejected. It only touches synthetic temporary data.
  const bytes = execFileSync(binary, ['self-test']);
  const path = join(folder, 'snapshot.sqlite');
  writeFileSync(path, bytes, { mode: 0o600 });
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.deepEqual(db.prepare('SELECT value FROM probe').all().map(row => row.value), ['committed WAL row']);
  } finally { db.close(); }
});

test('native permission status is available without reading note contents', () => {
  const status = JSON.parse(execFileSync(binary, ['status'], { encoding: 'utf8' }));
  assert.equal(status.readOnly, true);
  assert.equal(typeof status.authorized, 'boolean');
});
