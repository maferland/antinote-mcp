import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotesDatabase } from './database.js';

const exec = promisify(execFile);
const maxSnapshotBytes = 64 * 1024 * 1024;
export type SnapshotReader = (binary: string) => Promise<Buffer>;

const readSnapshot: SnapshotReader = async binary => {
  try {
    const { stdout } = await exec(binary, ['snapshot'], {
      encoding: 'buffer', maxBuffer: maxSnapshotBytes, timeout: 15_000,
    });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    // The helper's stderr contains operational errors only. Never forward the
    // child-process error object: its stdout may contain private database bytes.
    const message = stderr ? stderr.toString().trim().slice(0, 2000) : 'Build the native reader and run npm run reader:grant.';
    throw new Error(`Live Antinote reader failed: ${message}`);
  }
};

/** A fresh consistent snapshot for this call only, removed even on query errors. */
export async function withLiveDatabase<T>(binary: string, action: (database: NotesDatabase) => T, read: SnapshotReader = readSnapshot): Promise<T> {
  const bytes = await read(binary);
  if (bytes.length > maxSnapshotBytes || bytes.subarray(0, 16).toString('binary') !== 'SQLite format 3\0') {
    throw new Error('Native reader returned an invalid or oversized SQLite snapshot.');
  }
  const folder = await mkdtemp(join(tmpdir(), 'antinote-mcp-'));
  try {
    const path = join(folder, 'notes.sqlite');
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    return action(new NotesDatabase(path));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
