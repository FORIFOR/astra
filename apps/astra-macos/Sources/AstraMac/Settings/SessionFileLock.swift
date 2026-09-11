import Foundation
import CryptoKit
import Darwin

/// A kernel lock spans read → rotate → persist across app processes. The OS releases
/// it on a crash; keep the file so another process can never lock a different inode.
enum SessionFileLock {
    static func acquire(_ key: String) async throws -> Int32 {
        try await Task.detached {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("com.astra.session-locks", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                   attributes: [.posixPermissions: 0o700])
            let name = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
            let path = directory.appendingPathComponent(name + ".lock").path
            let descriptor = Darwin.open(path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, S_IRUSR | S_IWUSR)
            guard descriptor >= 0 else { throw POSIXError(.EACCES) }
            guard flock(descriptor, LOCK_EX) == 0 else {
                Darwin.close(descriptor); throw POSIXError(.EWOULDBLOCK)
            }
            return descriptor
        }.value
    }

    static func release(_ descriptor: Int32) {
        _ = flock(descriptor, LOCK_UN)
        Darwin.close(descriptor)
    }
}
