import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AccountStoreError } from "../account-store/errors.js";
import {
  acquirePoolLock,
  assertRegularPrivateSourceFile,
  ensurePrivateDirectory,
  writePrivateFileAtomically,
} from "../account-store/files.js";
import { parseAuthIdentity } from "../account-store/auth.js";
import {
  getAccountDirectory,
  resolvePoolHome,
  validateAccountAlias,
} from "../account-store/paths.js";
import { listAccounts, readAccountMetadata } from "../account-store/list.js";
import { resolveCodexHome } from "../preflight/doctor.js";
import { detectCredentialStoreMode } from "../preflight/config.js";
import { summarizeCodexProcesses } from "../preflight/processes.js";
import {
  getSwitchJournalPath,
  readSwitchJournal,
  removeSwitchJournal,
  removeSwitchTransactionDirectory,
  type SwitchJournal,
  writeSwitchJournal,
} from "../transaction/index.js";

export interface SwitchAccountOptions {
  alias: string;
  launch?: boolean;
  env?: NodeJS.ProcessEnv;
  userHome?: string;
  now?: () => Date;
  processList?: () => string;
  loginStatus?: (codexHome: string, env: NodeJS.ProcessEnv) => boolean;
  launchApp?: (env: NodeJS.ProcessEnv) => boolean;
}

export interface SwitchAccountResult {
  alias: string;
  accountFingerprint: string;
  previousAlias: string | null;
}

function defaultProcessList(): string {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout : "";
}

function defaultLoginStatus(codexHome: string, env: NodeJS.ProcessEnv): boolean {
  const result = spawnSync("codex", ["login", "status"], {
    encoding: "utf8",
    env: { ...env, CODEX_HOME: codexHome },
    timeout: 15_000,
  });
  return result.status === 0;
}

function defaultLaunchApp(env: NodeJS.ProcessEnv): boolean {
  const appName = env.CODEX_APP_NAME?.trim() || "ChatGPT";
  const result = spawnSync("open", ["-a", appName], {
    encoding: "utf8",
    env,
    timeout: 15_000,
  });
  return result.status === 0;
}

function readActiveAlias(activeAccountPath: string): string | null {
  if (!existsSync(activeAccountPath)) {
    return null;
  }
  const info = lstatSync(activeAccountPath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new AccountStoreError(
      "UNSAFE_ACTIVE_ACCOUNT",
      "active-account 必须是普通文件，不能是符号链接",
    );
  }
  const alias = readFileSync(activeAccountPath, "utf8").trim();
  return alias ? validateAccountAlias(alias) : null;
}

function readStoredFingerprint(poolHome: string, alias: string): string {
  const metadataPath = join(getAccountDirectory(poolHome, alias), "metadata.json");
  if (!existsSync(metadataPath)) {
    throw new AccountStoreError(
      "CORRUPT_ACCOUNT_STORE",
      `账号 ${alias} 缺少 metadata.json，请先修复账号仓库`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch {
    throw new AccountStoreError(
      "CORRUPT_ACCOUNT_STORE",
      `账号 ${alias} 的 metadata.json 已损坏，请先修复账号仓库`,
    );
  }
  const metadata = value as { accountFingerprint?: unknown };
  if (typeof metadata.accountFingerprint !== "string") {
    throw new AccountStoreError(
      "CORRUPT_ACCOUNT_STORE",
      `账号 ${alias} 的 metadata.json 缺少账号指纹`,
    );
  }
  return metadata.accountFingerprint;
}

function assertJournalBelongsToPool(journal: SwitchJournal, poolHome: string): void {
  const expectedPool = resolve(poolHome);
  const expectedCodexHome = resolve(journal.codexHome);
  if (
    resolve(journal.poolHome) !== expectedPool ||
    journal.authPath !== join(expectedCodexHome, "auth.json") ||
    journal.activeAccountPath !== join(expectedPool, "active-account") ||
    !resolve(journal.backupPath).startsWith(`${expectedPool}/runtime/switch/`) ||
    !resolve(journal.transactionDirectory).startsWith(`${expectedPool}/runtime/switch/`)
  ) {
    throw new AccountStoreError(
      "UNSAFE_SWITCH_JOURNAL",
      "switch journal 路径不属于当前账号仓库，已拒绝恢复",
    );
  }
}

function restorePreviousState(journal: SwitchJournal): void {
  assertRegularPrivateSourceFile(journal.backupPath);
  const previousAuth = readFileSync(journal.backupPath);
  writePrivateFileAtomically(journal.authPath, previousAuth);

  if (journal.previousAlias === null) {
    if (existsSync(journal.activeAccountPath)) {
      const info = lstatSync(journal.activeAccountPath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new AccountStoreError(
          "UNSAFE_ACTIVE_ACCOUNT",
          "active-account 必须是普通文件，不能是符号链接",
        );
      }
      unlinkSync(journal.activeAccountPath);
    }
  } else {
    writePrivateFileAtomically(
      journal.activeAccountPath,
      `${validateAccountAlias(journal.previousAlias)}\n`,
    );
  }
}

function finishCommittedJournal(journal: SwitchJournal): void {
  removeSwitchJournal(journal.poolHome);
  removeSwitchTransactionDirectory(journal.transactionDirectory);
}

function recoverJournal(journal: SwitchJournal): void {
  if (journal.phase === "committed") {
    finishCommittedJournal(journal);
    return;
  }
  try {
    restorePreviousState(journal);
    removeSwitchTransactionDirectory(journal.transactionDirectory);
    removeSwitchJournal(journal.poolHome);
  } catch (error) {
    throw new AccountStoreError(
      "SWITCH_RECOVERY_FAILED",
      `切换事务恢复失败，请保留 ${getSwitchJournalPath(journal.poolHome)} 并勿继续切换：${
        error instanceof Error ? error.message : "未知错误"
      }`,
    );
  }
}

export function recoverPendingSwitch(options: {
  poolHome: string;
  codexHome: string;
}): void {
  const journalPath = getSwitchJournalPath(options.poolHome);
  if (!existsSync(journalPath)) {
    return;
  }
  const journal = readSwitchJournal(options.poolHome);
  assertJournalBelongsToPool(journal, options.poolHome);
  if (resolve(journal.codexHome) !== resolve(options.codexHome)) {
    throw new AccountStoreError(
      "UNSAFE_SWITCH_JOURNAL",
      "switch journal 对应的 CODEX_HOME 与当前配置不一致",
    );
  }
  recoverJournal(journal);
}

export function switchAccount(options: SwitchAccountOptions): SwitchAccountResult {
  const alias = validateAccountAlias(options.alias);
  const env = options.env ?? process.env;
  const userHome = options.userHome ?? homedir();
  const poolHome = resolvePoolHome(env, userHome);
  const codexHome = resolveCodexHome(env, userHome);
  const authPath = join(codexHome, "auth.json");
  const activeAccountPath = join(poolHome, "active-account");
  const targetDirectory = getAccountDirectory(poolHome, alias);
  const targetAuthPath = join(targetDirectory, "auth.json");

  const running = summarizeCodexProcesses((options.processList ?? defaultProcessList)());
  if (running.desktopAppCount + running.appServerCount > 0) {
    throw new AccountStoreError(
      "CODEX_RUNNING",
      "Codex App 或 app-server 仍在运行；请完全退出后再切换账号",
    );
  }

  // Codex App/CLI may have changed the global auth.json since the last pool switch.
  // Reconcile first so an external login does not produce a stale active-account error.
  listAccounts({ env, userHome });

  const releasePoolLock = acquirePoolLock(poolHome);
  let lockReleased = false;
  const releaseLock = (): void => {
    if (!lockReleased) {
      releasePoolLock();
      lockReleased = true;
    }
  };
  try {
    recoverPendingSwitch({ poolHome, codexHome });

    const configPath = join(codexHome, "config.toml");
    if (!existsSync(configPath)) {
      throw new AccountStoreError("CONFIG_NOT_FOUND", "当前 CODEX_HOME 中不存在 config.toml");
    }
    if (detectCredentialStoreMode(readFileSync(configPath, "utf8")) !== "file") {
      throw new AccountStoreError(
        "FILE_STORE_REQUIRED",
        "switch 要求 cli_auth_credentials_store 显式配置为 file",
      );
    }

    const targetMetadataFingerprint = readStoredFingerprint(poolHome, alias);
    const targetMetadata = readAccountMetadata(targetDirectory, alias);
    if (targetMetadata.needsRelogin) {
      throw new AccountStoreError(
        "ACCOUNT_NEEDS_RELOGIN",
        `账号 ${alias} 的登录凭证已失效，请先重新登录该账号`,
      );
    }
    assertRegularPrivateSourceFile(targetAuthPath);
    const targetIdentity = parseAuthIdentity(readFileSync(targetAuthPath, "utf8"));
    if (targetIdentity.fingerprint !== targetMetadataFingerprint) {
      throw new AccountStoreError(
        "ACCOUNT_METADATA_MISMATCH",
        `账号 ${alias} 的 auth.json 与 metadata.json 指纹不一致，请先修复账号仓库`,
      );
    }

    assertRegularPrivateSourceFile(authPath);
    const currentIdentity = parseAuthIdentity(readFileSync(authPath, "utf8"));
    const previousAlias = readActiveAlias(activeAccountPath);
    if (previousAlias) {
      const storedFingerprint = readStoredFingerprint(poolHome, previousAlias);
      if (storedFingerprint !== currentIdentity.fingerprint) {
        throw new AccountStoreError(
          "ACTIVE_ACCOUNT_MISMATCH",
          `active-account 指向 ${previousAlias}，但全局 auth.json 属于其他账号，请先修复状态`,
        );
      }
    }

    if (previousAlias === alias && currentIdentity.fingerprint === targetIdentity.fingerprint) {
      return {
        alias,
        accountFingerprint: targetIdentity.fingerprint,
        previousAlias,
      };
    }

    const now = options.now ?? (() => new Date());
    const transactionId = randomUUID();
    const transactionDirectory = join(poolHome, "runtime", "switch", transactionId);
    const backupPath = join(transactionDirectory, "previous-auth.json");
    let journal: SwitchJournal | undefined;

    ensurePrivateDirectory(transactionDirectory);
    writePrivateFileAtomically(backupPath, readFileSync(authPath));
    journal = {
      schemaVersion: 1,
      transactionId,
      poolHome: resolve(poolHome),
      codexHome: resolve(codexHome),
      authPath,
      activeAccountPath,
      backupPath,
      transactionDirectory,
      previousAlias,
      targetAlias: alias,
      targetFingerprint: targetIdentity.fingerprint,
      phase: "prepared",
      createdAt: now().toISOString(),
    };
    writeSwitchJournal(journal);

    writePrivateFileAtomically(authPath, readFileSync(targetAuthPath));
    journal.phase = "auth-replaced";
    writeSwitchJournal(journal);

    if (!(options.loginStatus ?? defaultLoginStatus)(codexHome, env)) {
      recoverJournal(journal);
      throw new AccountStoreError(
        "TARGET_LOGIN_INVALID",
        `目标账号 ${alias} 的登录状态校验失败，已恢复原账号 ${previousAlias ?? ""}`.trim(),
      );
    }
    journal.phase = "verified";
    writeSwitchJournal(journal);

    writePrivateFileAtomically(activeAccountPath, `${alias}\n`);
    journal.phase = "active-updated";
    writeSwitchJournal(journal);

    journal.phase = "committed";
    writeSwitchJournal(journal);
    finishCommittedJournal(journal);
    releaseLock();

    if (options.launch && !(options.launchApp ?? defaultLaunchApp)(env)) {
      throw new AccountStoreError(
        "APP_LAUNCH_FAILED",
        "账号已切换成功，但 Codex App 启动失败；请手动打开 Codex App",
      );
    }

    return {
      alias,
      accountFingerprint: targetIdentity.fingerprint,
      previousAlias,
    };
  } finally {
    releaseLock();
  }
}
