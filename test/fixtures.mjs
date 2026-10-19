import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const ids = Array.from({ length: 8 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);

export function fixture(coreData = true) {
  const folder = mkdtempSync(join(tmpdir(), 'antinote-mcp-test-'));
  const path = join(folder, 'notes.sqlite');
  const db = new DatabaseSync(path);
  if (coreData) {
    db.exec(`CREATE TABLE ZNOTE (
      ZID BLOB, ZCONTENT TEXT, ZCREATED REAL, ZLASTMODIFIED REAL,
      ZISSLOTTED INTEGER, ZISARCHIVED INTEGER, ZISLOCKED INTEGER,
      ZISPRIVATE INTEGER, ZSOFTDELETED INTEGER, ZDELETEDAT REAL
    )`);
    const insert = db.prepare('INSERT INTO ZNOTE VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const contents = ['Project ideas\nLiteral 100%_ quote\' & café 🍲', 'Pinned note', 'Private secret', 'Trashed secret', 'Archive idea', '', 'Deleted by timestamp', 'Locked note'];
    contents.forEach((content, index) => insert.run(
      Buffer.from(ids[index].replaceAll('-', ''), 'hex'), content, 0, 100 + index,
      index === 1 ? 1 : 0, index === 4 ? 1 : 0, index === 7 ? 1 : 0,
      index === 2 ? 1 : 0, index === 3 ? 1 : 0, index === 6 ? 123 : null,
    ));
  } else {
    db.exec('CREATE TABLE notes (id TEXT, content TEXT, created TEXT, lastModified TEXT)');
    db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?)').run(ids[0].toUpperCase(), 'Legacy note', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
  }
  db.close();
  return { path, cleanup: () => rmSync(folder, { recursive: true, force: true }) };
}
