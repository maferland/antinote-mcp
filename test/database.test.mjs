import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { NotesDatabase } from '../dist/database.js';
import { fixture, ids } from './fixtures.mjs';

test('Core Data read converts UUID/date, preserves text and never changes the snapshot', t => {
  const f = fixture(); t.after(f.cleanup);
  const before = readFileSync(f.path);
  const notes = new NotesDatabase(f.path);
  const note = notes.read(ids[0]);
  assert.equal(note.id, ids[0]);
  assert.equal(note.created, '2001-01-01T00:00:00.000Z');
  assert.equal(note.content, "Project ideas\nLiteral 100%_ quote' & café 🍲");
  assert.deepEqual(notes.status(), { readable: true, schema: 'core_data', storedRows: 8 });
  assert.deepEqual(readFileSync(f.path), before);
});

test('list/read hide private, deleted, empty and archived notes, including direct IDs', t => {
  const f = fixture(); t.after(f.cleanup);
  const notes = new NotesDatabase(f.path);
  assert.deepEqual(notes.list().notes.map(n => n.id), [ids[7], ids[1], ids[0]]);
  for (const index of [2, 3, 4, 5, 6]) assert.throws(() => notes.read(ids[index]), /not found/);
  assert.equal(notes.list({ includeArchived: true }).total, 4);
  assert.equal(notes.read(ids[4], true).archived, true);
  for (const index of [2, 3, 6]) assert.throws(() => notes.read(ids[index], true), /not found/);
  assert.equal(notes.read(ids[1]).slotted, true);
  assert.equal(notes.read(ids[7]).locked, true);
});

test('search binds literal text; pagination and previews are bounded', t => {
  const f = fixture(); t.after(f.cleanup);
  const notes = new NotesDatabase(f.path);
  assert.equal(notes.list({ query: "100%_ quote'" }).total, 1);
  assert.equal(notes.list({ query: "' OR 1=1 --" }).total, 0);
  assert.equal(notes.list({ query: 'PROJECT' }).total, 1);
  const page = notes.list({ limit: 2 });
  assert.equal(page.total, 3); assert.equal(page.nextOffset, 2);
  assert.equal(notes.list({ limit: 2, offset: 2 }).nextOffset, null);
  assert.equal(notes.list({ offset: 99 }).notes.length, 0);
  assert.ok(!('content' in page.notes[0]));
  for (const args of [{ limit: 101 }, { limit: 0 }, { offset: -1 }, { offset: 0.5 }]) {
    assert.throws(() => notes.list(args), /limit must/);
  }
});

test('legacy snapshots preserve native timestamps', t => {
  const f = fixture(false); t.after(f.cleanup);
  const notes = new NotesDatabase(f.path);
  assert.equal(notes.read(ids[0]).content, 'Legacy note');
  assert.equal(notes.read(ids[0]).created, '2025-01-01T00:00:00Z');
  assert.equal(notes.list().total, 1);
});

test('missing database is not created; malformed schemas and IDs fail clearly', t => {
  const f = fixture(); t.after(f.cleanup);
  const missing = `${f.path}.missing`;
  assert.throws(() => new NotesDatabase(missing).list(), /Cannot open/);
  assert.equal(existsSync(missing), false);
  assert.throws(() => new NotesDatabase(f.path).read("' OR 1=1 --"), /Invalid note ID/);
  const db = new DatabaseSync(f.path);
  db.exec('ALTER TABLE ZNOTE RENAME COLUMN ZISPRIVATE TO UNKNOWNFLAG'); db.close();
  assert.throws(() => new NotesDatabase(f.path).list(), /privacy, archive, or deletion/);
});

test('each request sees a refreshed snapshot and WAL-backed rows', t => {
  const f = fixture(); t.after(f.cleanup);
  const notes = new NotesDatabase(f.path);
  assert.equal(notes.list().total, 3);
  const writer = new DatabaseSync(f.path);
  writer.exec('PRAGMA journal_mode=WAL');
  writer.prepare('UPDATE ZNOTE SET ZCONTENT = ? WHERE hex(ZID) = ?').run('Refreshed content', ids[0].replaceAll('-', '').toUpperCase());
  assert.equal(notes.read(ids[0]).content, 'Refreshed content');
  writer.close();
});
