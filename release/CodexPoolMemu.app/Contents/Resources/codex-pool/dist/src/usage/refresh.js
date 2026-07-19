import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { acquirePoolLock, assertRegularPrivateSourceFile, ensurePrivateDirectory, writePrivateFileAtomically, } from "../account-store/files.js";
import { readAccountMetadata } from "../account-store/list.js";
import { extractAuthEmail, parseAuthIdentity } from "../account-store/auth.js";
import { AccountStoreError } from "../account-store/errors.js";
import { getAccountDirectory, resolvePoolHome, validateAccountAlias } from "../account-store/paths.js";
import { queryAccountServer, } from "../app-server/index.js";
function maskEmail(email) {
    if (!email || !email.includes("@"))
        return null;
    const [local, domain] = email.split("@", 2);
    if (!local || !domain)
        return null;
    const visible = local.length <= 2 ? local[0] ?? "*" : local.slice(0, 2);
    return `${visible}***@${domain}`;
}
function createRuntime(poolHome, alias) {
    const runtimeRoot = join(poolHome, "runtime", alias);
    ensurePrivateDirectory(runtimeRoot);
    const resolvedRuntimeRoot = resolve(runtimeRoot);
    for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
        if (!/^run-[0-9a-f-]{36}$/u.test(entry.name))
            continue;
        const staleRuntime = resolve(runtimeRoot, entry.name);
        if (!staleRuntime.startsWith(`${resolvedRuntimeRoot}/`))
            continue;
        const info = lstatSync(staleRuntime);
        if (!info.isDirectory() || info.isSymbolicLink())
            continue;
        rmSync(staleRuntime, { force: true, recursive: true });
    }
    const runtimeDirectory = join(runtimeRoot, `run-${randomUUID()}`);
    ensurePrivateDirectory(runtimeDirectory);
    chmodSync(runtimeDirectory, 0o700);
    writePrivateFileAtomically(join(runtimeDirectory, "config.toml"), 'cli_auth_credentials_store = "file"\n');
    return runtimeDirectory;
}
function updateMetadata(accountDirectory, metadata, snapshot, now) {
    const updated = {
        ...metadata,
        needsRelogin: false,
        reloginReason: null,
        email: snapshot.email,
        emailMasked: maskEmail(snapshot.email),
        planType: snapshot.planType,
        updatedAt: now().toISOString(),
        primaryQuota: snapshot.primary,
        secondaryQuota: snapshot.secondary,
        lastRefreshedAt: snapshot.fetchedAt,
        usageStatus: snapshot.usageStatus,
        usageMessage: snapshot.usageError,
    };
    writePrivateFileAtomically(join(accountDirectory, "metadata.json"), `${JSON.stringify(updated, null, 2)}\n`);
}
function isAuthenticationFailure(error) {
    if (!(error instanceof AccountStoreError))
        return false;
    const detail = `${error.code} ${error.message}`.toLowerCase();
    if (error.code !== "APP_SERVER_REQUEST_FAILED")
        return false;
    return /(unauthoriz|forbidden|invalid[_ -]?grant|invalid[_ -]?(access|refresh)[ _-]?token|token[^\n]*(expired|invalid)|login required|not authenticated|authentication failed)/u.test(detail);
}
function markNeedsRelogin(accountDirectory, metadata, now, reason) {
    writePrivateFileAtomically(join(accountDirectory, "metadata.json"), `${JSON.stringify({
        ...metadata,
        needsRelogin: true,
        reloginReason: reason,
        updatedAt: now().toISOString(),
    }, null, 2)}\n`);
}
export async function refreshAccount(options) {
    const alias = validateAccountAlias(options.alias);
    const env = options.env ?? process.env;
    const userHome = options.userHome ?? homedir();
    const poolHome = resolvePoolHome(env, userHome);
    const accountDirectory = getAccountDirectory(poolHome, alias);
    const authPath = join(accountDirectory, "auth.json");
    const releaseLock = acquirePoolLock(poolHome);
    let runtimeDirectory;
    try {
        const metadata = readAccountMetadata(accountDirectory, alias);
        assertRegularPrivateSourceFile(authPath);
        const storedAuth = readFileSync(authPath);
        const storedIdentity = parseAuthIdentity(storedAuth.toString("utf8"));
        if (storedIdentity.fingerprint !== metadata.accountFingerprint) {
            throw new AccountStoreError("ACCOUNT_METADATA_MISMATCH", `账号 ${alias} 的 auth.json 与 metadata.json 指纹不一致，请先修复账号仓库`);
        }
        runtimeDirectory = createRuntime(poolHome, alias);
        writePrivateFileAtomically(join(runtimeDirectory, "auth.json"), storedAuth);
        const snapshot = await (options.query ?? queryAccountServer)({
            codexHome: runtimeDirectory,
            env,
        });
        let emailSourceAuth = storedAuth;
        const refreshedAuthPath = join(runtimeDirectory, "auth.json");
        if (existsSync(refreshedAuthPath)) {
            assertRegularPrivateSourceFile(refreshedAuthPath);
            const refreshedAuth = readFileSync(refreshedAuthPath);
            const refreshedIdentity = parseAuthIdentity(refreshedAuth.toString("utf8"));
            if (refreshedIdentity.fingerprint !== metadata.accountFingerprint) {
                throw new AccountStoreError("AUTH_REFRESH_ACCOUNT_MISMATCH", `账号 ${alias} 的 app-server 刷新结果属于其他账号，已拒绝写回`);
            }
            if (!refreshedAuth.equals(storedAuth)) {
                writePrivateFileAtomically(authPath, refreshedAuth);
            }
            emailSourceAuth = refreshedAuth;
        }
        const resolvedSnapshot = snapshot.email
            ? snapshot
            : { ...snapshot, email: extractAuthEmail(emailSourceAuth.toString("utf8")) };
        updateMetadata(accountDirectory, metadata, resolvedSnapshot, options.now ?? (() => new Date()));
        return resolvedSnapshot;
    }
    catch (error) {
        if (isAuthenticationFailure(error)) {
            markNeedsRelogin(accountDirectory, readAccountMetadata(accountDirectory, alias), options.now ?? (() => new Date()), "登录凭证已失效，请重新登录");
        }
        throw error;
    }
    finally {
        try {
            if (runtimeDirectory) {
                rmSync(runtimeDirectory, { force: true, recursive: true });
            }
        }
        finally {
            releaseLock();
        }
    }
}
//# sourceMappingURL=refresh.js.map