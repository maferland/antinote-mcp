# Antinote MCP

A local [Model Context Protocol](https://modelcontextprotocol.io/) server for
[Antinote](https://antinote.io/) on macOS. Read full, current saved notes through
a sandboxed helper with access to one user-selected folder. Create and append
notes through Antinote's supported URL actions.

No screen control, Accessibility permission, API key, or Full Disk Access is
required. A copied database remains available as an optional offline mode.

This is an independent project, unaffiliated with Antinote.

## What it does

| Tool | Behavior |
| --- | --- |
| `antinote_status` | Check the selected data source, schema, and row count; returns no note text. |
| `list_notes` | List saved note previews, newest first, with pagination. |
| `search_notes` | Search saved note text; ASCII case-insensitive. |
| `read_note` | Read full saved text by UUID. |
| `create_note` | Ask the live Antinote app to create a new note. |
| `append_to_current_note` | Ask Antinote to append text to its currently selected note. |
| `open_note` | Ask Antinote to promote and open a note by UUID. |

**Live mode reads Antinote's saved database again on every request.** The helper
uses SQLite's backup API to capture a consistent read, including committed WAL
(journal) changes. It sends that read over a pipe to the MCP process. A private,
short-lived SQLite file is queried read-only and removed after the request.
There is no manually refreshed copy in live mode and no silent fallback to old
snapshots when permission or database access fails.

Writes affect the live app. A successful write result means macOS accepted the
URL for dispatch, not that Antinote confirmed saving it. Once Antinote saves, a
subsequent live read can see the change. Retrying creates or appends text again.
Offline snapshot mode only sees changes when you replace its copied database.

Private, deleted, and empty notes are excluded from reads. Archived notes are
excluded unless `includeArchived: true` is passed. Locked and slotted notes remain
readable. `read_note` returns stored plain text, not attachment bytes or separate
checklist/link metadata, and does not see unsaved edits.

## Install

Requires Node.js **22.13+** (Node 24 LTS recommended). Live reads and URL actions
require macOS with Antinote installed. Building the optional live reader requires
Apple's Xcode Command Line Tools (`xcode-select --install`). Reads use Node's
built-in SQLite support; no native npm database module or Python runtime is needed.

```sh
git clone https://github.com/maferland/antinote-mcp.git
cd antinote-mcp
npm ci
npm run build
mkdir -p data
```

There is no npm release yet; use the local build above.

## Enable live reads (recommended)

```sh
npm run build:reader
npm run reader:grant
```

A native folder chooser asks you to select the directory containing Antinote's
live database, normally:

```text
~/Library/Containers/com.chabomakers.Antinote/Data/Library/Application Support
```

Select the **folder**, not `cd-v1-notes.sqlite` itself: SQLite also needs to read
its `-wal` and `-shm` sidecars. For an older installation, select the folder
containing `notes.sqlite3`. The Setapp edition uses its own app container; choose
that installation's database folder. Antinote's Settings → Notes → Backups →
Open Folder can help locate it.

The helper has exactly three entitlements: App Sandbox, user-selected **read-only**
file access, and app-scoped bookmarks. It stores a read-only security-scoped
bookmark so later requests can reopen the selected folder. It has no network
entitlements, Full Disk Access requirement, or read/write folder entitlement.
SQLite connections to Antinote's database are also explicitly read-only.

Configure `ANTINOTE_READER_PATH` with the absolute executable path:

```json
{
  "mcpServers": {
    "antinote": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/antinote-mcp/dist/index.js"],
      "env": {
        "ANTINOTE_READER_PATH": "/absolute/path/to/antinote-mcp/build/AntinoteReader.app/Contents/MacOS/AntinoteReader"
      }
    }
  }
}
```

The live reader takes precedence if both reader and snapshot paths are set.
Call `antinote_status` to verify that `source` is `live_database`, then search and
read a note. Reads include full saved text, including text beyond search previews.
Unsaved edits remain invisible until Antinote commits them.

The helper is compiled and ad-hoc signed locally. Rebuilding, moving, or updating
it may require running `npm run reader:grant` again. To revoke its folder grant,
remove the native helper's saved bookmark (a reset command is not yet provided)
or stop using the helper by removing `ANTINOTE_READER_PATH` from your MCP config.
The latter disables this integration; it does not erase the bookmark.

A database that needs journal recovery or inaccessible/missing WAL sidecars can
fail to open under read-only access. Let Antinote finish saving and retry; the
reader will report an error instead of requesting write access or treating a
changing database as immutable. The snapshot output limit is 64 MiB; the helper
may temporarily allocate more memory while making and serializing that read.
Normal request completion removes the MCP process's temporary file; a force-kill
or system crash can leave a private temporary directory behind.

## Provide an offline database copy

1. In Antinote, open **Settings → Notes → Backups → Open Folder**.
2. Copy a completed SQLite **backup** into this checkout's `data/` folder, or
   another folder your MCP host can read. Keep the original in place.
3. Set `ANTINOTE_DB_PATH` to the **absolute path to that copied file**.

The filename can be anything. Do not rename or edit files in Antinote's own data
folder. Prefer a completed backup over copying the live database: a live SQLite
database may have committed changes in its `-wal` sidecar, and a Finder copy made
during writes may be inconsistent. Use Antinote's backup mechanism to obtain a
consistent snapshot.

Offline mode never discovers or opens app data automatically. Every database
connection is read-only; a missing file produces an error instead of creating a
new database. Each request reopens the file, so replacing the snapshot between
requests takes effect without restarting the server. Finish copying before
making another request.

`data/`, SQLite files, and SQLite WAL/SHM sidecars are gitignored. Keep copies out
of commits and issue attachments. The npm package allowlist contains built server code, native helper source/build
scripts, documentation, license, and package metadata. Generated app bundles and
bookmarks are excluded.

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

## Connect with an offline snapshot

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
- `open_note` changes the current note and note order. An ID from an earlier read may
  refer to a note that has since been deleted.
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
npm run test:native # macOS only; compiles and tests the sandboxed helper
npm pack --dry-run
```

Tests use synthetic SQLite fixtures, never your real notes. They cover modern
and legacy schemas, privacy/trash/archive exclusions, UUID/date decoding, literal
searches, read-only behavior, snapshot refresh, WAL reads, URL encoding, MCP
discovery/calls, actual stdio startup, per-request live refresh, private temporary
file cleanup, and no fallback to stale data on failure. Native tests check signed
entitlements, read-only SQL enforcement, and a consistent snapshot containing
committed WAL changes. URL launches are stubbed; automated tests do not create
real notes. CI runs on macOS and Linux with Node 22/24, with native tests on macOS.

The schema adapter was checked against Antinote 2.1.3's bundled data model and
an actual copied database. The live route was then verified against that installed
app after one-time folder selection: separate helper launches reused the saved
bookmark, read the live database, and returned full multiline/Unicode text beyond
the URL callback's preview limit. No Full Disk Access was granted. A dispatched
write URL alone still does not establish app-side saving.

Antinote's search URL callback was also tested: it returns current IDs and
flattened previews of roughly 200 characters, not full note text. Its JavaScript
extension API can access the current note when a user invokes a command, but has
no documented automatic full-library API. The native reader avoids those limits.

Sources: [Antinote storage](https://antinote.io/user-manual/notes-management),
[URL actions](https://antinote.io/user-manual/url-schemes), and
[official Raycast integration](https://github.com/raycast/extensions/tree/main/extensions/antinote).

## License

MIT. Antinote and its name belong to their respective owner.
