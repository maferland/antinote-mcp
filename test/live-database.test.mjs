import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { withLiveDatabase } from '../dist/live-database.js';
import { fixture, ids } from './fixtures.mjs';

test('live reads request a fresh snapshot each time and delete the private temporary copy', async t => {
  const f = fixture(); t.after(f.cleanup);
  let calls = 0, temporary;
  const read = async binary => { assert.equal(binary, '/reader'); calls++; return readFileSync(f.path); };
  const query = db => {
    temporary = db.path;
    assert.equal(statSync(temporary).mode & 0o777, 0o600);
    return db.read(ids[0]).content;
  };
  assert.match(await withLiveDatabase('/reader', query, read), /Project ideas/);
  assert.equal(existsSync(temporary), false);
  const writer = new DatabaseSync(f.path);
  writer.prepare('UPDATE ZNOTE SET ZCONTENT = ? WHERE hex(ZID) = ?').run('Fresh full text\n' + 'x'.repeat(1000), ids[0].replaceAll('-', '').toUpperCase());
  writer.close();
  assert.equal((await withLiveDatabase('/reader', query, read)).length, 1016);
  assert.equal(calls, 2);
  assert.equal(existsSync(temporary), false);
});

test('temporary database is cleaned after query errors and invalid snapshots are rejected', async t => {
  const f = fixture(); t.after(f.cleanup);
  let temporary;
  await assert.rejects(withLiveDatabase('/reader', db => {
    temporary = db.path;
    throw new Error('query failed');
  }, async () => readFileSync(f.path)), /query failed/);
  assert.equal(existsSync(temporary), false);
  await assert.rejects(withLiveDatabase('/reader', () => assert.fail(), async () => Buffer.from('not sqlite')), /invalid or oversized/);
});
