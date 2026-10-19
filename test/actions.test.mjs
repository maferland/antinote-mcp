import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionURL, dispatch } from '../dist/actions.js';
import { ids } from './fixtures.mjs';

test('URL actions round-trip multiline Unicode, reserved characters, plus and spaces', () => {
  const content = "Hello world\nCafé 🍲 & ? # + % = $(echo nope) `quote`";
  const url = actionURL('createNote', content);
  assert.equal(new URL(url).searchParams.get('content'), content);
  assert.ok(url.includes('Hello%20world'));
  assert.ok(url.includes('%2B'));
  assert.equal(new URL(url).pathname, '/createNote');
});

test('invalid/oversized requests never reach the launcher', async () => {
  let called = false;
  const open = async () => { called = true; };
  await assert.rejects(dispatch('promoteAndOpen', '../bad', open), /UUID/);
  await assert.rejects(dispatch('createNote', '  ', open), /blank/);
  await assert.rejects(dispatch('createNote', '🍲'.repeat(4000), open), /URL limit/);
  assert.throws(() => actionURL('overwriteCurrent', 'text'), /Unsupported/);
  assert.equal(called, false);
});

test('write result distinguishes dispatch from persistence', async () => {
  let received;
  const result = await dispatch('appendToCurrent', '\nAppended', async url => { received = url; });
  assert.equal(new URL(received).pathname, '/appendToCurrent');
  assert.equal(result.status, 'dispatched');
  assert.match(result.message, /not confirmed/);
  assert.equal(new URL(actionURL('promoteAndOpen', ids[0])).searchParams.get('noteId'), ids[0]);
});
