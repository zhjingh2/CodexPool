import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { AccountStoreError } from "../account-store/errors.js";
import { ensurePrivateDirectory, writePrivateFileAtomically, } from "../account-store/files.js";
export function getSwitchJournalPath(poolHome) {
    return join(resolve(poolHome), "switch-journal.json");
}
export function writeSwitchJournal(journal) {
    ensurePrivateDirectory(journal.poolHome);
    writePrivateFileAtomically(getSwitchJournalPath(journal.poolHome), `${JSON.stringify(journal, null, 2)}\n`);
}
export function readSwitchJournal(poolHome) {
    const path = getSwitchJournalPath(poolHome);
    if (!existsSync(path)) {
        throw new AccountStoreError("SWITCH_JOURNAL_NOT_FOUND", "没有待恢复的切换事务");
    }
    let value;
    try {
        value = JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        throw new AccountStoreError("CORRUPT_SWITCH_JOURNAL", "switch journal 已损坏，无法安全恢复；请保留文件并人工检查");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new AccountStoreError("CORRUPT_SWITCH_JOURNAL", "switch journal 字段不完整，无法安全恢复");
    }
    const journal = value;
    const phases = [
        "prepared",
        "auth-replaced",
        "verified",
        "active-updated",
        "committed",
    ];
    if (journal.schemaVersion !== 1 ||
        typeof journal.transactionId !== "string" ||
        typeof journal.poolHome !== "string" ||
        typeof journal.codexHome !== "string" ||
        typeof journal.authPath !== "string" ||
        typeof journal.activeAccountPath !== "string" ||
        typeof journal.backupPath !== "string" ||
        typeof journal.transactionDirectory !== "string" ||
        (journal.previousAlias !== null && typeof journal.previousAlias !== "string") ||
        typeof journal.targetAlias !== "string" ||
        typeof journal.targetFingerprint !== "string" ||
        !phases.includes(journal.phase) ||
        typeof journal.createdAt !== "string") {
        throw new AccountStoreError("CORRUPT_SWITCH_JOURNAL", "switch journal 字段不完整，无法安全恢复");
    }
    return journal;
}
export function removeSwitchJournal(poolHome) {
    const path = getSwitchJournalPath(poolHome);
    if (existsSync(path)) {
        unlinkSync(path);
    }
}
export function removeSwitchTransactionDirectory(path) {
    rmSync(path, { force: true, recursive: true });
}
//# sourceMappingURL=index.js.map