import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from '../dist/server.js';
import { fixture, ids } from './fixtures.mjs';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

test('MCP initialization, discovery, read/write calls, and validation work together', async t => {
  const f = fixture(); t.after(f.cleanup);
  const launched = [];
  const server = createServer({ databasePath: f.path, open: async url => { launched.push(url); } });
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 7);
  assert.equal(tools.find(tool => tool.name === 'read_note').annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === 'create_note').annotations.idempotentHint, false);
  const read = await client.callTool({ name: 'read_note', arguments: { id: ids[0] } });
  assert.equal(JSON.parse(read.content[0].text).id, ids[0]);
  const search = await client.callTool({ name: 'search_notes', arguments: { query: 'Project' } });
  assert.equal(JSON.parse(search.content[0].text).total, 1);
  const create = await client.callTool({ name: 'create_note', arguments: { content: 'Synthetic test note' } });
  assert.equal(JSON.parse(create.content[0].text).status, 'dispatched');
  assert.equal(launched.length, 1);
  const invalid = await client.callTool({ name: 'read_note', arguments: { id: 'bad' } });
  assert.equal(invalid.isError, true);
  const hidden = await client.callTool({ name: 'read_note', arguments: { id: ids[2] } });
  assert.equal(hidden.isError, true);
  assert.ok(!hidden.content[0].text.includes('Private secret'));
});

test('actual stdio executable starts without a database and reports actionable errors', async t => {
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env: {}, stderr: 'pipe' });
  await client.connect(transport);
  t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 7);
  const status = await client.callTool({ name: 'antinote_status', arguments: {} });
  assert.equal(JSON.parse(status.content[0].text).databaseConfigured, false);
  const notes = await client.callTool({ name: 'list_notes', arguments: {} });
  assert.equal(notes.isError, true);
  assert.match(notes.content[0].text, /ANTINOTE_DB_PATH/);
});

test('live mode uses the native source, returns full current text, and never falls back to stale data', async t => {
  const f = fixture(); t.after(f.cleanup);
  let calls = 0, fail = false;
  const server = createServer({
    readerPath: '/reader', databasePath: '/must-not-be-used.sqlite',
    snapshotReader: async () => { calls++; if (fail) throw new Error('Permission unavailable'); return readFileSync(f.path); },
  });
  const client = new Client({ name: 'live-integration-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const first = await client.callTool({ name: 'read_note', arguments: { id: ids[0] } });
  assert.equal(JSON.parse(first.content[0].text).source, 'live_database');
  const writer = new DatabaseSync(f.path);
  const content = 'Current content\n' + 'Long full note. '.repeat(100);
  writer.prepare('UPDATE ZNOTE SET ZCONTENT = ? WHERE hex(ZID) = ?').run(content, ids[0].replaceAll('-', '').toUpperCase()); writer.close();
  const second = await client.callTool({ name: 'read_note', arguments: { id: ids[0] } });
  assert.equal(JSON.parse(second.content[0].text).content, content);
  const status = await client.callTool({ name: 'antinote_status', arguments: {} });
  assert.equal(JSON.parse(status.content[0].text).source, 'live_database');
  assert.ok(JSON.parse(status.content[0].text).readAt);
  fail = true;
  const denied = await client.callTool({ name: 'list_notes', arguments: {} });
  assert.equal(denied.isError, true); assert.match(denied.content[0].text, /Permission unavailable/);
  assert.equal(calls, 4);
});
