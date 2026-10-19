import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;
export type Note = {
  id: string; content: string; created: string | null; lastModified: string | null;
  slotted: boolean; archived: boolean; locked: boolean;
};
export type NoteQuery = { query?: string; limit?: number; offset?: number; includeArchived?: boolean };

function date(value: unknown, coreData: boolean): string | null {
  if (value == null) return null;
  if (!coreData) return String(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid Core Data date.');
  return new Date((value + 978307200) * 1000).toISOString();
}

function noteId(value: unknown, coreData: boolean): string {
  if (coreData) {
    if (!(value instanceof Uint8Array) || value.length !== 16) throw new Error('Unsupported Antinote UUID encoding.');
    const hex = Buffer.from(value).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Unsupported Antinote note ID.');
  return value.toLowerCase();
}

/** Open a fresh read-only connection per call so replacing a snapshot takes effect. */
export class NotesDatabase {
  constructor(readonly path: string) {}

  private connect() {
    try {
      return new DatabaseSync(resolve(this.path), { readOnly: true, enableForeignKeyConstraints: false });
    } catch {
      throw new Error('Cannot open the Antinote database copy. Set ANTINOTE_DB_PATH to an accessible SQLite backup. The server will not create a missing database.');
    }
  }

  private schema(db: DatabaseSync) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    const coreData = tables.some(row => row.name === 'ZNOTE');
    const table = coreData ? 'ZNOTE' : 'notes';
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name)));
    const id = coreData ? 'ZID' : 'id';
    const content = coreData ? 'ZCONTENT' : 'content';
    const created = coreData ? 'ZCREATED' : 'created';
    const modified = coreData ? 'ZLASTMODIFIED' : 'lastModified';
    if (![id, content, created, modified].every(column => columns.has(column))) {
      throw new Error('Unsupported Antinote database schema. Expected a Core Data ZNOTE table or a legacy notes table.');
    }
    if (coreData && !['ZISPRIVATE', 'ZISARCHIVED', 'ZSOFTDELETED', 'ZDELETEDAT'].every(column => columns.has(column))) {
      throw new Error('Unsupported Core Data schema: privacy, archive, or deletion flags are missing. Use a backup from a current Antinote release.');
    }
    const field = (modern: string, legacy: string) => columns.has(coreData ? modern : legacy) ? (coreData ? modern : legacy) : undefined;
    const slotted = field('ZISSLOTTED', 'isSlotted');
    const archived = field('ZISARCHIVED', 'isArchived');
    const locked = field('ZISLOCKED', 'isLocked');
    const privateFlag = field('ZISPRIVATE', 'isPrivate');
    const deleted = field('ZSOFTDELETED', 'softDeleted');
    const deletedAt = field('ZDELETEDAT', 'deletedAt');
    const filters = [`${content} IS NOT NULL`, `${content} != ''`];
    if (privateFlag) filters.push(`COALESCE(${privateFlag}, 0) = 0`);
    if (deleted) filters.push(`COALESCE(${deleted}, 0) = 0`);
    if (deletedAt) filters.push(`${deletedAt} IS NULL`);
    const select = `${id} AS id, ${content} AS content, ${created} AS created, ${modified} AS lastModified, ${slotted ?? '0'} AS slotted, ${archived ?? '0'} AS archived, ${locked ?? '0'} AS locked`;
    return { coreData, table, id, content, modified, archived, filters, select };
  }

  private normalize(row: Row, coreData: boolean): Note {
    if (typeof row.content !== 'string') throw new Error('Unsupported Antinote content encoding.');
    return {
      id: noteId(row.id, coreData), content: row.content,
      created: date(row.created, coreData), lastModified: date(row.lastModified, coreData),
      slotted: Boolean(row.slotted), archived: Boolean(row.archived), locked: Boolean(row.locked),
    };
  }

  status() {
    const db = this.connect();
    try {
      const { coreData, table } = this.schema(db);
      return { readable: true, schema: coreData ? 'core_data' : 'legacy', storedRows: Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get()?.total) };
    } finally { db.close(); }
  }

  list({ query = '', limit = 20, offset = 0, includeArchived = false }: NoteQuery = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('limit must be 1–100 and offset must be a nonnegative safe integer.');
    }
    const db = this.connect();
    try {
      const schema = this.schema(db);
      const { coreData, table, content, modified, archived, filters } = schema;
      if (!includeArchived && archived) filters.push(`COALESCE(${archived}, 0) = 0`);
      // instr treats quotes, percent signs and underscores as literal search text.
      filters.push(`instr(lower(${content}), lower(?)) > 0`);
      const where = filters.join(' AND ');
      const total = Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).get(query)?.total);
      // Only retrieve previews here; full text is available through read_note.
      const previewSelect = schema.select.replace(`${content} AS content`, `substr(${content}, 1, 300) AS content`);
      const rows = db.prepare(`SELECT ${previewSelect}, length(${content}) AS length FROM ${table} WHERE ${where} ORDER BY ${modified} DESC, ${schema.id} ASC LIMIT ? OFFSET ?`).all(query, limit, offset);
      return {
        notes: rows.map(row => {
          const { content: preview, ...note } = this.normalize(row, coreData);
          return { ...note, title: preview.split('\n')[0], preview, length: Number(row.length) };
        }),
        total, offset, nextOffset: offset + rows.length < total ? offset + rows.length : null,
        source: 'database_snapshot',
      };
    } finally { db.close(); }
  }

  read(id: string, includeArchived = false): Note {
    if (!UUID.test(id)) throw new Error('Invalid note ID: expected a UUID.');
    const db = this.connect();
    try {
      const { coreData, table, id: column, archived, filters, select } = this.schema(db);
      if (!includeArchived && archived) filters.push(`COALESCE(${archived}, 0) = 0`);
      filters.push(coreData ? `hex(${column}) = ?` : `lower(${column}) = ?`);
      const value = coreData ? id.replaceAll('-', '').toUpperCase() : id.toLowerCase();
      const row = db.prepare(`SELECT ${select} FROM ${table} WHERE ${filters.join(' AND ')}`).get(value);
      if (!row) throw new Error('Note not found in this snapshot, or excluded because it is private, deleted, empty, or archived.');
      const note = this.normalize(row, coreData);
      if (Buffer.byteLength(note.content, 'utf8') > 2_000_000) throw new Error('Note exceeds the 2 MB response limit. Export this note from Antinote instead.');
      return note;
    } finally { db.close(); }
  }
}
