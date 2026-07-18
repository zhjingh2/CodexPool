import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync, } from "node:fs";
import { dirname, join } from "node:path";
import { AccountStoreError } from "./errors.js";
export function ensurePrivateDirectory(path) {
    if (!existsSync(path)) {
        mkdirSync(path, { mode: 0o700, recursive: true });
    }
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new AccountStoreError("UNSAFE_DIRECTORY", `不安全的账号仓库目录：${path}`);
    }
    chmodSync(path, 0o700);
}
export function assertRegularPrivateSourceFile(path) {
    if (!existsSync(path)) {
        throw new AccountStoreError("AUTH_NOT_FOUND", "当前 CODEX_HOME 中不存在 auth.json");
    }
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) {
        throw new AccountStoreError("UNSAFE_AUTH_FILE", "auth.json 必须是普通文件，不能是符号链接");
    }
    if (info.size > 1024 * 1024) {
        throw new AccountStoreError("AUTH_FILE_TOO_LARGE", "auth.json 大小异常，已拒绝导入");
    }
    if ((info.mode & 0o077) !== 0) {
        throw new AccountStoreError("UNSAFE_AUTH_PERMISSIONS", "auth.json 对组或其他用户可见");
    }
}
export function writePrivateFileAtomically(path, content) {
    const parent = dirname(path);
    ensurePrivateDirectory(parent);
    const temporaryPath = join(parent, `.tmp-${process.pid}-${randomUUID()}`);
    let descriptor;
    try {
        descriptor = openSync(temporaryPath, "wx", 0o600);
        if (typeof content === "string") {
            writeSync(descriptor, content);
        }
        else {
            writeSync(descriptor, content, 0, content.length, null);
        }
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        renameSync(temporaryPath, path);
        chmodSync(path, 0o600);
    }
    catch (error) {
        if (descriptor !== undefined) {
            closeSync(descriptor);
        }
        if (existsSync(temporaryPath)) {
            unlinkSync(temporaryPath);
        }
        throw error;
    }
}
export function acquirePoolLock(poolHome) {
    ensurePrivateDirectory(poolHome);
    const lockPath = join(poolHome, "pool.lock");
    let descriptor;
    try {
        descriptor = openSync(lockPath, "wx", 0o600);
    }
    catch {
        let stale = false;
        try {
            const lock = JSON.parse(readFileSync(lockPath, "utf8"));
            if (typeof lock.pid === "number" && Number.isInteger(lock.pid) && lock.pid > 0) {
                try {
                    process.kill(lock.pid, 0);
                }
                catch (error) {
                    stale = error.code === "ESRCH";
                }
            }
        }
        catch {
            stale = false;
        }
        if (!stale) {
            throw new AccountStoreError("POOL_LOCKED", "Codex Pool 正在执行另一个账号操作；如果上次进程异常退出，请先检查 pool.lock");
        }
        try {
            unlinkSync(lockPath);
            descriptor = openSync(lockPath, "wx", 0o600);
        }
        catch {
            throw new AccountStoreError("POOL_LOCKED", "Codex Pool 正在执行另一个账号操作；如果上次进程异常退出，请先检查 pool.lock");
        }
    }
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    return () => {
        if (existsSync(lockPath)) {
            unlinkSync(lockPath);
        }
    };
}
//# sourceMappingURL=files.js.map