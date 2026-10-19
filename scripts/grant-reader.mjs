import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';

const binary = fileURLToPath(new URL('../build/AntinoteReader.app/Contents/MacOS/AntinoteReader', import.meta.url));
const folder = join(homedir(), 'Library/Containers/com.chabomakers.Antinote/Data/Library/Application Support');
const result = spawnSync(binary, ['grant', folder], { stdio: 'inherit' });
if (result.error) console.error('Build the reader first with npm run build:reader.');
process.exitCode = result.status ?? 1;
