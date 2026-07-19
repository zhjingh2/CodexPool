import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AccountStoreError } from "../account-store/errors.js";
import { importAccountFromHome } from "../account-store/store.js";
import { ensurePrivateDirectory, writePrivateFileAtomically, } from "../account-store/files.js";
import { resolvePoolHome, validateAccountAlias } from "../account-store/paths.js";
function defaultRunLogin(env) {
    const result = spawnSync("codex", ["login"], {
        env,
        stdio: "inherit",
    });
    return result.status;
}
function createLoginRuntime(poolHome) {
    const runtimeRoot = join(poolHome, "runtime", "login");
    ensurePrivateDirectory(runtimeRoot);
    const runtimeDirectory = mkdtempSync(join(runtimeRoot, "run-"));
    chmodSync(runtimeDirectory, 0o700);
    writePrivateFileAtomically(join(runtimeDirectory, "config.toml"), 'cli_auth_credentials_store = "file"\n');
    return runtimeDirectory;
}
export function loginAccount(options) {
    const alias = validateAccountAlias(options.alias);
    const env = options.env ?? process.env;
    const userHome = options.userHome ?? homedir();
    const poolHome = resolvePoolHome(env, userHome);
    const runtimeDirectory = createLoginRuntime(poolHome);
    const loginEnv = { ...env, CODEX_HOME: runtimeDirectory };
    try {
        const status = (options.runLogin ?? defaultRunLogin)(loginEnv);
        if (status !== 0) {
            throw new AccountStoreError("LOGIN_CANCELLED", "官方登录未完成，当前账号保持不变");
        }
        const importOptions = {
            alias,
            authHome: runtimeDirectory,
            poolHome,
            setActiveAccount: false,
            replaceNeedsRelogin: true,
        };
        if (options.now) {
            return importAccountFromHome({ ...importOptions, now: options.now });
        }
        return importAccountFromHome(importOptions);
    }
    finally {
        try {
            rmSync(runtimeDirectory, { force: true, recursive: true });
        }
        catch {
            throw new AccountStoreError("RUNTIME_CLEANUP_FAILED", "登录流程已结束，但临时目录清理失败；请勿继续切换账号，并手动检查 Codex Pool runtime 目录");
        }
    }
}
//# sourceMappingURL=login.js.map