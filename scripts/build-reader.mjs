import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

if (process.platform !== 'darwin') throw new Error('The native reader requires macOS and Xcode Command Line Tools.');
const root = fileURLToPath(new URL('../', import.meta.url));
const app = join(root, 'build/AntinoteReader.app');
mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
copyFileSync(join(root, 'native/Info.plist'), join(app, 'Contents/Info.plist'));
execFileSync('/usr/bin/xcrun', ['swiftc', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.0`, '-O', join(root, 'native/Reader.swift'), '-o', join(app, 'Contents/MacOS/AntinoteReader')], { stdio: 'inherit' });
// Finder metadata inherited from a parent directory can prevent signing.
// Only clear it from this generated app bundle.
execFileSync('/usr/bin/xattr', ['-cr', app], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--entitlements', join(root, 'native/entitlements.plist'), app], { stdio: 'inherit' });
console.log(`Built sandboxed reader: ${app}`);
