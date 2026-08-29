import Foundation
import SQLite3

/// §24 ローカル保存。SQLite 1 ファイル。
///
/// 仕様書がはっきり書いている 2 つの「保存しないもの」を、ここで**構造として**守る:
///   - Raw screenshot は原則保存しない → 画像を入れる列を作らない
///   - Meeting audio も既定では永続保存しない → 音声を入れる列を作らない
///   - Context は **metadata だけ**（§25 の source / sensitivity / 期限）。本文は入れない
///
/// 列が無ければ、後から「つい入れてしまう」ことができない。
final class LocalStore {
    static let shared = LocalStore()

    private var db: OpaquePointer?
    private(set) var path: String = ""

    static var defaultPath: String {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Astra")
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.appendingPathComponent("astra.sqlite").path
    }

    private init() {}

    /// テスト用に別ファイルを開けるようにしてある。
    init(path: String) { open(path) }

    @discardableResult
    func open(_ path: String = LocalStore.defaultPath) -> Bool {
        close()
        self.path = path
        guard sqlite3_open(path, &db) == SQLITE_OK else { return false }
        return migrate()
    }

    func close() {
        if db != nil { sqlite3_close(db); db = nil }
    }

    /// §24 のテーブル一式。画像・音声・本文の列は**意図的に無い**。
    static let tables = [
        "tasks", "conversations", "context_metadata",
        "meetings", "transcripts", "artifacts", "plugin_permissions",
    ]

    @discardableResult
    func migrate() -> Bool {
        let sql = """
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL,
          started_at REAL NOT NULL, steps_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY, started_at REAL NOT NULL, last_turn_at REAL);
        -- 文脈は **metadata だけ**。summary/本文の列は作らない（§25）。
        CREATE TABLE IF NOT EXISTS context_metadata (
          id TEXT PRIMARY KEY, source TEXT NOT NULL, application TEXT NOT NULL,
          sensitivity TEXT NOT NULL, captured_at REAL NOT NULL, expires_at REAL NOT NULL);
        -- 音声そのものは入れない。場所と長さだけ（§24）。
        CREATE TABLE IF NOT EXISTS meetings (
          id TEXT PRIMARY KEY, title TEXT, started_at REAL NOT NULL,
          ended_at REAL, detected_app TEXT, journal_path TEXT);
        CREATE TABLE IF NOT EXISTS transcripts (
          id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, speaker TEXT,
          text TEXT NOT NULL, at REAL NOT NULL);
        -- 画像バイト列は入れない。参照だけ（§24 raw screenshot は保存しない）。
        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY, meeting_id TEXT, kind TEXT NOT NULL,
          ref TEXT NOT NULL, created_at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS plugin_permissions (
          plugin TEXT NOT NULL, capability TEXT NOT NULL, granted INTEGER NOT NULL,
          decided_at REAL NOT NULL, PRIMARY KEY (plugin, capability));
        """
        return exec(sql)
    }

    @discardableResult
    func exec(_ sql: String) -> Bool {
        sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK
    }

    /// 実際に在るテーブル名。migrate の検査に使う。
    func tableNames() -> [String] {
        var out: [String] = []
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT name FROM sqlite_master WHERE type='table'", -1, &stmt, nil) == SQLITE_OK
        else { return out }
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let c = sqlite3_column_text(stmt, 0) { out.append(String(cString: c)) }
        }
        sqlite3_finalize(stmt)
        return out
    }

    /// あるテーブルの列名。「画像や本文の列を作っていない」ことの検査に使う。
    func columnNames(_ table: String) -> [String] {
        var out: [String] = []
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "PRAGMA table_info(\(table))", -1, &stmt, nil) == SQLITE_OK else { return out }
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let c = sqlite3_column_text(stmt, 1) { out.append(String(cString: c)) }
        }
        sqlite3_finalize(stmt)
        return out
    }

    // MARK: - tasks（§23 UI を閉じても消えない）

    func save(_ task: AgentTask) {
        let steps = task.steps.map { "\($0.tool)\u{1}\($0.title)\u{1}\($0.state.rawValue)" }
            .joined(separator: "\u{2}")
        let sql = "INSERT OR REPLACE INTO tasks (id,title,status,started_at,steps_json) VALUES (?,?,?,?,?)"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
        bind(stmt, 1, task.id.uuidString)
        bind(stmt, 2, task.title)
        bind(stmt, 3, task.status.rawValue)
        sqlite3_bind_double(stmt, 4, task.startedAt.timeIntervalSince1970)
        bind(stmt, 5, steps)
        sqlite3_step(stmt)
        sqlite3_finalize(stmt)
    }

    /// 走っていた task を読み戻す（§23 Dock を開き直したら状態が戻る）。
    func loadTasks(status: AgentRunState? = nil) -> [AgentTask] {
        var sql = "SELECT id,title,status,started_at,steps_json FROM tasks"
        if status != nil { sql += " WHERE status = ?" }
        sql += " ORDER BY started_at DESC"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
        if let status { bind(stmt, 1, status.rawValue) }
        var out: [AgentTask] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let idText = sqlite3_column_text(stmt, 0).map({ String(cString: $0) }),
                  let id = UUID(uuidString: idText),
                  let title = sqlite3_column_text(stmt, 1).map({ String(cString: $0) }),
                  let statusText = sqlite3_column_text(stmt, 2).map({ String(cString: $0) }),
                  let run = AgentRunState(rawValue: statusText) else { continue }
            let started = Date(timeIntervalSince1970: sqlite3_column_double(stmt, 3))
            let stepsText = sqlite3_column_text(stmt, 4).map { String(cString: $0) } ?? ""
            let steps: [AgentStep] = stepsText.split(separator: "\u{2}").compactMap { chunk in
                let parts = chunk.split(separator: "\u{1}", omittingEmptySubsequences: false)
                guard parts.count == 3, let st = AgentRunState(rawValue: String(parts[2])) else { return nil }
                return AgentStep(title: String(parts[1]), tool: String(parts[0]), state: st)
            }
            out.append(AgentTask(id: id, title: title, status: run, steps: steps,
                                 startedAt: started, context: ContextBundle()))
        }
        sqlite3_finalize(stmt)
        return out
    }

    // MARK: - context metadata（§25 本文は保存しない）

    func saveContextMetadata(_ fact: ContextFact) {
        let sql = """
        INSERT OR REPLACE INTO context_metadata
        (id,source,application,sensitivity,captured_at,expires_at) VALUES (?,?,?,?,?,?)
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
        bind(stmt, 1, fact.id.uuidString)
        bind(stmt, 2, String(fact.source.rawValue))
        bind(stmt, 3, fact.application)
        bind(stmt, 4, fact.sensitivity.rawValue)
        sqlite3_bind_double(stmt, 5, fact.capturedAt.timeIntervalSince1970)
        sqlite3_bind_double(stmt, 6, fact.expiresAt.timeIntervalSince1970)
        sqlite3_step(stmt)
        sqlite3_finalize(stmt)
    }

    func countRows(_ table: String) -> Int {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM \(table)", -1, &stmt, nil) == SQLITE_OK else { return -1 }
        defer { sqlite3_finalize(stmt) }
        return sqlite3_step(stmt) == SQLITE_ROW ? Int(sqlite3_column_int(stmt, 0)) : -1
    }

    private func bind(_ stmt: OpaquePointer?, _ index: Int32, _ value: String) {
        sqlite3_bind_text(stmt, index, (value as NSString).utf8String, -1, nil)
    }
}
