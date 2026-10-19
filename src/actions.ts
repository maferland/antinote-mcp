import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { UUID } from './database.js';

const exec = promisify(execFile);
export type Action = 'createNote' | 'appendToCurrent' | 'promoteAndOpen';
export type OpenURL = (url: string) => Promise<void>;

export function actionURL(action: Action, value: string): string {
  if (!['createNote', 'appendToCurrent', 'promoteAndOpen'].includes(action)) throw new Error('Unsupported Antinote action.');
  if (action === 'promoteAndOpen' && !UUID.test(value)) throw new Error('Invalid note ID: expected a UUID.');
  if (action !== 'promoteAndOpen' && !value.trim()) throw new Error('Note content must not be blank.');
  const url = new URL(`antinote://x-callback-url/${action}`);
  url.searchParams.set(action === 'promoteAndOpen' ? 'noteId' : 'content', value);
  // URLSearchParams uses + for spaces; native URL handlers can interpret it literally.
  const encoded = url.toString().replaceAll('+', '%20');
  if (encoded.length > 32_000) throw new Error('Content exceeds the 32 KB encoded URL limit. Use a shorter note.');
  return encoded;
}

export const openURL: OpenURL = async (url) => {
  if (process.platform !== 'darwin') throw new Error('Antinote URL actions require macOS.');
  try {
    await exec('/usr/bin/open', ['-g', url], { timeout: 10_000 });
  } catch {
    // Do not forward child-process errors: they contain the full URL and note text.
    throw new Error('macOS could not dispatch the Antinote URL. Check that Antinote is installed and can open antinote:// URLs.');
  }
};

export async function dispatch(action: Action, value: string, open: OpenURL = openURL) {
  await open(actionURL(action, value));
  return {
    status: 'dispatched', action,
    message: 'Sent to Antinote. Completion is not confirmed by the URL interface. Your database snapshot is unchanged; refresh it to read the result.',
  };
}
