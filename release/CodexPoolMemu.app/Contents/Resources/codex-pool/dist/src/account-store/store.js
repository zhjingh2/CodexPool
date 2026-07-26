import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveCodexHome } from "../preflight/doctor.js";
import { parseAuthIdentity } from "./auth.js";
import { readAccountMetadata } from "./list.js";
import { AccountStoreError } from "./errors.js";
import { acquirePoolLock, assertRegularPrivateSourceFile, ensurePrivateDirectory, writePrivateFileAtomically, } from "./files.js";
import { getAccountDirectory, resolvePoolHome, validateAccountAlias } from "./paths.js";
function defaultLoginStatus(codexHome, env) {
    const result = spawnSync("codex", ["login", "status"], {
        encoding: "utf8",
        env: { ...env, CODEX_HOME: codexHome },
        timeout: 15_000,
    });
    return result.status === 0;
}
function parseStoredMetadata(metadataText, directoryAlias) {
    let value;
    try {
        value = JSON.parse(metadataText);
    }
    catch {
        throw new AccountStoreError("CORRUPT_ACCOUNT_STORE", `账号 ${directoryAlias} 的 metadata.json 已损坏，请先修复账号仓库`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new AccountStoreError("CORRUPT_ACCOUNT_STORE", `账号 ${directoryAlias} 的 metadata.json 已损坏，请先修复账号仓库`);
    }
    const metadata = value;
    if (metadata.schemaVersion !== 1 ||
        metadata.alias !== directoryAlias ||
        typeof metadata.accountFingerprint !== "string" ||
        metadata.accountFingerprint.length !== 64 ||
        typeof metadata.authMode !== "string") {
        throw new AccountStoreError("CORRUPT_ACCOUNT_STORE", `账号 ${directoryAlias} 的 metadata.json 字段不完整，请先修复账号仓库`);
    }
    return metadata;
}
function readExistingMetadata(accountsRoot) {
    if (!existsSync(accountsRoot)) {
        return [];
    }
    const metadata = [];
    for (const entry of readdirSync(accountsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
            continue;
        }
        const metadataPath = join(accountsRoot, entry.name, "metadata.json");
        if (!existsSync(metadataPath)) {
            throw new AccountStoreError("CORRUPT_ACCOUNT_STORE", `账号 ${entry.name} 缺少 metadata.json，请先修复账号仓库`);
        }
        metadata.push(parseStoredMetadata(readFileSync(metadataPath, "utf8"), entry.name));
    }
    return metadata;
}
export function addCurrentAccount(options) {
    const alias = validateAccountAlias(options.alias);
    const env = options.env ?? process.env;
    const userHome = options.userHome ?? homedir();
    const now = options.now ?? (() => new Date());
    const codexHome = resolveCodexHome(env, userHome);
    const poolHome = resolvePoolHome(env, userHome);
    if (!(options.loginStatus ?? defaultLoginStatus)(codexHome, env)) {
        throw new AccountStoreError("NOT_LOGGED_IN", "当前 CODEX_HOME 的登录状态无效，请先使用官方 codex login 完成登录");
    }
    return importAccountFromHome({
        alias,
        authHome: codexHome,
        poolHome,
        now,
    });
}
export function importAccountFromHome(options) {
    const alias = validateAccountAlias(options.alias);
    const now = options.now ?? (() => new Date());
    const authPath = join(options.authHome, "auth.json");
    const accountDirectory = getAccountDirectory(options.poolHome, alias);
    assertRegularPrivateSourceFile(authPath);
    const authBuffer = readFileSync(authPath);
    const identity = parseAuthIdentity(authBuffer.toString("utf8"));
    const accountsRoot = join(options.poolHome, "accounts");
    ensurePrivateDirectory(options.poolHome);
    ensurePrivateDirectory(accountsRoot);
    const releaseLock = acquirePoolLock(options.poolHome);
    let accountDirectoryCreated = false;
    try {
        const existingMetadata = existsSync(accountDirectory)
            ? readAccountMetadata(accountDirectory, alias)
            : undefined;
        if (existingMetadata && !options.replaceNeedsRelogin) {
            throw new AccountStoreError("ALIAS_EXISTS", `账号别名 ${alias} 已存在`);
        }
        if (existingMetadata && !existingMetadata.needsRelogin) {
            throw new AccountStoreError("ALIAS_EXISTS", `账号别名 ${alias} 已存在`);
        }
        if (existingMetadata && existingMetadata.accountFingerprint !== identity.fingerprint) {
            throw new AccountStoreError("ACCOUNT_ALIAS_MISMATCH", `重新登录的账号与 ${alias} 不是同一个账号，已拒绝覆盖`);
        }
        const existingAccounts = readExistingMetadata(accountsRoot);
        const duplicate = existingAccounts.find((account) => account.accountFingerprint === identity.fingerprint && account.alias !== alias);
        if (duplicate) {
            throw new AccountStoreError("ACCOUNT_EXISTS", `当前账号已经保存为 ${duplicate.alias}，不会重复导入`);
        }
        ensurePrivateDirectory(accountDirectory);
        accountDirectoryCreated = !existingMetadata;
        const timestamp = now().toISOString();
        const metadata = existingMetadata
            ? {
                ...existingMetadata,
                authMode: identity.authMode,
                needsRelogin: false,
                reloginReason: null,
                updatedAt: timestamp,
            }
            : {
                schemaVersion: 1,
                alias,
                accountFingerprint: identity.fingerprint,
                authMode: identity.authMode,
                emailMasked: null,
                planType: null,
                addedAt: timestamp,
                updatedAt: timestamp,
            };
        writePrivateFileAtomically(join(accountDirectory, "auth.json"), authBuffer);
        writePrivateFileAtomically(join(accountDirectory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
        if (options.setActiveAccount !== false) {
            writePrivateFileAtomically(join(options.poolHome, "active-account"), `${alias}\n`);
        }
        return {
            alias,
            accountFingerprint: identity.fingerprint,
            authMode: identity.authMode,
            accountDirectory,
        };
    }
    catch (error) {
        if (accountDirectoryCreated && existsSync(accountDirectory)) {
            rmSync(accountDirectory, { force: true, recursive: true });
        }
        throw error;
    }
    finally {
        releaseLock();
    }
}
//# sourceMappingURL=store.js.map