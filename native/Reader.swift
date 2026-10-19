import AppKit
import SQLite3

// The helper is separately sandboxed. The user-selected-folder entitlement is
// READ ONLY, and SQLite opens the database READ ONLY as an additional safeguard.
struct ReaderError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

let bookmarkKey = "antinoteDatabaseFolder"
let maxSnapshotBytes = 64 * 1024 * 1024

func fail(_ message: String) -> ReaderError { ReaderError(message: message) }

func emit(_ object: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
}

func databaseURL(in folder: URL) throws -> URL {
    let candidates = ["cd-v1-notes.sqlite", "notes.sqlite3"].map { folder.appendingPathComponent($0) }
    guard let url = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) else {
        throw fail("Choose the folder containing cd-v1-notes.sqlite or notes.sqlite3, not the database file or a parent folder.")
    }
    // Reject symlinks that would escape the selected folder.
    guard url.resolvingSymlinksInPath().deletingLastPathComponent().standardizedFileURL == folder.resolvingSymlinksInPath().standardizedFileURL else {
        throw fail("The database must be inside the selected folder, not a symlink outside it.")
    }
    return url
}

func withFolder<T>(_ operation: (URL) throws -> T) throws -> T {
    guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else {
        throw fail("Folder access is not configured. Run npm run reader:grant and select Antinote's database folder once.")
    }
    var stale = false
    let folder: URL
    do {
        folder = try URL(resolvingBookmarkData: data, options: [.withSecurityScope, .withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale)
    } catch {
        throw fail("Cannot resolve the saved folder permission. Run npm run reader:grant again.")
    }
    guard folder.startAccessingSecurityScopedResource() else {
        throw fail("The saved folder permission is unavailable. Run npm run reader:grant again.")
    }
    defer { folder.stopAccessingSecurityScopedResource() }
    if stale {
        let refreshed = try folder.bookmarkData(options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess], includingResourceValuesForKeys: nil, relativeTo: nil)
        UserDefaults.standard.set(refreshed, forKey: bookmarkKey)
    }
    return try operation(folder)
}

func openReadOnly(_ url: URL) throws -> OpaquePointer {
    var handle: OpaquePointer?
    let result = sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil)
    guard result == SQLITE_OK, let database = handle else {
        if let handle { sqlite3_close(handle) }
        throw fail("Cannot read Antinote's database with the selected-folder permission. Select its containing folder again; both the database and journal files must be readable.")
    }
    guard sqlite3_db_readonly(database, "main") == 1 else {
        sqlite3_close(database)
        throw fail("Refusing a database connection that is not read-only.")
    }
    sqlite3_busy_timeout(database, 3_000)
    return database
}

func snapshot(_ url: URL) throws -> Data {
    let source = try openReadOnly(url)
    defer { sqlite3_close(source) }
    var destination: OpaquePointer?
    guard sqlite3_open(":memory:", &destination) == SQLITE_OK, let memory = destination else {
        if let destination { sqlite3_close(destination) }
        throw fail("Cannot allocate a temporary SQLite snapshot.")
    }
    defer { sqlite3_close(memory) }
    // SQLite's backup API takes a consistent copy, including committed WAL data.
    // Copying database files with FileManager would risk missing those changes.
    guard let backup = sqlite3_backup_init(memory, "main", source, "main") else {
        throw fail("Cannot start a consistent SQLite backup.")
    }
    var result: Int32 = SQLITE_OK
    let deadline = Date().addingTimeInterval(10)
    repeat {
        result = sqlite3_backup_step(backup, 128)
        if result == SQLITE_BUSY || result == SQLITE_LOCKED { sqlite3_sleep(10) }
        if Date() >= deadline { break }
    } while result == SQLITE_OK || result == SQLITE_BUSY || result == SQLITE_LOCKED
    let finished = sqlite3_backup_finish(backup)
    guard result == SQLITE_DONE, finished == SQLITE_OK else {
        throw fail("Antinote's database stayed busy or the snapshot failed. Try again after it finishes saving.")
    }
    var size: sqlite3_int64 = 0
    guard let bytes = sqlite3_serialize(memory, "main", &size, 0) else {
        throw fail("Cannot serialize the SQLite snapshot.")
    }
    defer { sqlite3_free(bytes) }
    guard size > 0, size <= maxSnapshotBytes else { throw fail("Database exceeds the 64 MiB snapshot limit.") }
    return Data(bytes: bytes, count: Int(size))
}

func grant() throws {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let panel = NSOpenPanel()
    panel.title = "Antinote MCP — Read-Only Folder Access"
    panel.message = "Select the folder containing Antinote's live database. This helper can read the selected folder but cannot modify it. It will remember this selection for future MCP requests."
    panel.prompt = "Allow Read-Only Access"
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.canCreateDirectories = false
    if CommandLine.arguments.count > 2 {
        panel.directoryURL = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
    }
    app.activate(ignoringOtherApps: true)
    guard panel.runModal() == .OK, let folder = panel.url else { throw fail("Folder selection cancelled. No permission was changed.") }
    // A selection grants access for this process; the bookmark keeps only this
    // folder's read permission available on subsequent helper launches.
    let url = try databaseURL(in: folder)
    let database = try openReadOnly(url)
    sqlite3_close(database)
    let data = try folder.bookmarkData(options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess], includingResourceValuesForKeys: nil, relativeTo: nil)
    UserDefaults.standard.set(data, forKey: bookmarkKey)
    try emit(["authorized": true, "readOnly": true, "databaseName": url.lastPathComponent])
}

func selfTest() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let url = folder.appendingPathComponent("probe.sqlite")
    var writer: OpaquePointer?
    guard sqlite3_open(url.path, &writer) == SQLITE_OK, let writer else { throw fail("Self-test database creation failed.") }
    defer { sqlite3_close(writer) }
    guard sqlite3_exec(writer, "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES ('committed WAL row');", nil, nil, nil) == SQLITE_OK else {
        throw fail("Self-test WAL setup failed.")
    }
    let reader = try openReadOnly(url)
    let attemptedWrite = sqlite3_exec(reader, "INSERT INTO probe VALUES ('must not be written')", nil, nil, nil)
    sqlite3_close(reader)
    guard attemptedWrite == SQLITE_READONLY else { throw fail("Self-test read-only enforcement failed.") }
    // Keep the writer open so the result proves WAL changes are included.
    FileHandle.standardOutput.write(try snapshot(url))
}

do {
    switch CommandLine.arguments.dropFirst().first ?? "status" {
    case "grant": try grant()
    case "status":
        if UserDefaults.standard.data(forKey: bookmarkKey) == nil {
            try emit(["authorized": false, "readOnly": true])
        } else {
            try withFolder { folder in
                let url = try databaseURL(in: folder)
                let database = try openReadOnly(url)
                sqlite3_close(database)
                try emit(["authorized": true, "readOnly": true, "databaseName": url.lastPathComponent])
            }
        }
    case "snapshot":
        try withFolder { folder in FileHandle.standardOutput.write(try snapshot(databaseURL(in: folder))) }
    case "self-test": try selfTest()
    default: throw fail("Usage: AntinoteReader [grant|status|snapshot|self-test]")
    }
} catch {
    // Never include database contents, SQL, bookmark data, or user-selected paths.
    let message = (error as? ReaderError)?.message ?? "Antinote Reader failed. Re-select the database folder and try again."
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
