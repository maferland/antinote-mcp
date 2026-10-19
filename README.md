# Antinote MCP

A local [Model Context Protocol](https://modelcontextprotocol.io/) server for
[Antinote](https://antinote.io/) on macOS. Read a copied notes database and create
or append notes through Antinote's supported URL actions. No screen control,
Accessibility permission, API key, or Full Disk Access required when using a copy
in an accessible folder.

This is an independent project, unaffiliated with Antinote.

## What it does

| Tool | Behavior |
| --- | --- |
| `antinote_status` | Check the configured database copy, schema, row count, and file timestamp without reading note text. |
| `list_notes` | List note previews from the copy, newest first, with pagination. |
| `search_notes` | Search literal text in the copy; ASCII case-insensitive. |
| `read_note` | Read saved text by UUID from the copy. |
| `create_note` | Ask the live Antinote app to create a new note. |
| `append_to_current_note` | Ask Antinote to append text to its currently selected note. |
| `open_note` | Ask Antinote to promote and open a note by UUID. |

**Reads use your snapshot. Writes affect the live app.** A successful write result
means macOS accepted the URL for dispatch, not that Antinote confirmed saving it.
Refresh your database copy to read newly written content. Retrying creates or
appends text again.

Private, deleted, and empty notes are excluded from reads. Archived notes are
excluded unless `includeArchived: true` is passed. Locked and slotted notes remain
readable. `read_note` returns stored plain text, not attachment bytes or separate
checklist/link metadata, and does not see unsaved edits.

## Install

Requires Node.js **22.13+** (Node 24 LTS recommended). URL actions require macOS
with Antinote installed. Reads use Node's built-in SQLite support; no native npm
database module or Python runtime is needed.

```sh
git clone https://github.com/maferland/antinote-mcp.git
cd antinote-mcp
npm ci
npm run build
mkdir -p data
```

There is no npm release yet; use the local build above.

## Provide a database copy

1. In Antinote, open **Settings → Notes → Backups → Open Folder**.
2. Copy a completed SQLite **backup** into this checkout's `data/` folder, or
   another folder your MCP host can read. Keep the original in place.
3. Set `ANTINOTE_DB_PATH` to the **absolute path to that copied file**.

The filename can be anything. Do not rename or edit files in Antinote's own data
folder. Prefer a completed backup over copying the live database: a live SQLite
database may have committed changes in its `-wal` sidecar, and a Finder copy made
during writes may be inconsistent. Use Antinote's backup mechanism to obtain a
consistent snapshot.

The server never discovers or opens app data automatically. Every database
connection is read-only; a missing file produces an error instead of creating a
new database. Each request reopens the file, so replacing the snapshot between
requests takes effect without restarting the server. Finish copying before
making another request.

`data/`, SQLite files, and SQLite WAL/SHM sidecars are gitignored. Keep copies out
of commits and issue attachments. The npm package allowlist contains only built
code, documentation, license, and package metadata.

Supported database layouts:

- **Core Data:** `ZNOTE`, UUIDs stored as 16-byte blobs, Apple-epoch timestamps,
  and privacy/archive/deletion flags. Mapped against Antinote **2.1.3**'s installed
  data model and the official Raycast integration. Older Core Data snapshots
  without those exclusion flags are rejected rather than guessing visibility.
- **Legacy:** the `notes` table with `id`, `content`, `created`, and
  `lastModified`, as used by Antinote 1.x. Native legacy timestamps are returned
  unchanged. Optional visibility flags are respected if present.

Unknown schemas fail with an error. These are internal app database formats;
future Antinote updates may need an adapter update.

## Connect an MCP client

In a client that supports local stdio MCP servers, add an entry like this,
replacing the example paths with absolute paths on your machine:

```json
{
  "mcpServers": {
    "antinote": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/antinote-mcp/dist/index.js"],
      "env": {
        "ANTINOTE_DB_PATH": "/absolute/path/to/antinote-mcp/data/notes-backup.sqlite"
      }
    }
  }
}
```

Use `command -v node` to locate Node. The working directory is irrelevant.
Restart or reconnect your client after adding the server, then call
`antinote_status`. The write tools can also run without a configured database.
Do not start the stdio server as an HTTP endpoint.

Example requests:

- “Search my Antinote snapshot for vacation ideas.”
- “Read the note with this ID.”
- “Create an Antinote note with this shopping list.”
- “Append this text to the note currently selected in Antinote.”

## Write limitations

Actions use [`antinote://x-callback-url/…`](https://antinote.io/user-manual/url-schemes)
through `/usr/bin/open`, with percent-encoded arguments and no shell execution.
Antinote may open or change focus despite the background-open request.

- Appends target the live app's **current note at dispatch time**, not a snapshot
  ID. Only request an append when that is your intent. The server does not add a
  newline; include one in the content if needed.
- `open_note` changes the current note and note order. A stale snapshot may
  contain IDs that have since been deleted.
- The server does not implement arbitrary updates, overwrites, or deletion.
  Opening a note and then overwriting “current” is not an atomic update API.
- Encoded action URLs are limited to 32 KB. Full-note reads are capped at 2 MB;
  list/search previews are capped at 300 characters and pages at 100 notes.
- No network listener, telemetry, or remote note synchronization is added.
  Your MCP client receives requested note content and handles it according to
  that client's own settings.

## Development and verification

```sh
npm run check
npm test
npm pack --dry-run
```

Tests use synthetic SQLite fixtures, never your real notes. They cover modern
and legacy schemas, privacy/trash/archive exclusions, UUID/date decoding, literal
searches, read-only behavior, snapshot refresh, WAL reads, URL encoding, MCP
discovery/calls, and actual stdio startup. URL launches are stubbed in automated
tests; they do not create real notes. CI runs on macOS and Linux with Node 22/24.

The initial implementation was checked against Antinote 2.1.3's bundled data
model. Live database reads and confirmed app-side writes still require a manual
smoke test with a copied backup. A protocol test or a dispatched URL alone does
not establish app-side completion.

Sources: [Antinote storage](https://antinote.io/user-manual/notes-management),
[URL actions](https://antinote.io/user-manual/url-schemes), and
[official Raycast integration](https://github.com/raycast/extensions/tree/main/extensions/antinote).

## License

MIT. Antinote and its name belong to their respective owner.
