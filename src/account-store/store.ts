import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveCodexHome } from "../preflight/doctor.js";
import { detectCredentialStoreMode } from "../preflight/config.js";
import { summarizeCodexProcesses } from "../preflight/processes.js";
import { parseAuthIdentity } from "./auth.js";
import { AccountStoreError } from "./errors.js";
import {
  acquirePoolLock,
  assertRegularPrivateSourceFile,
  ensurePrivateDirectory,
  writePrivateFileAtomically,
} from "./files.js";
import { getAccountDirectory, resolvePoolHome, validateAccountAlias } from "./paths.js";
import type { AccountMetadata, AddAccountResult } from "./types.js";

export interface AddCurrentAccountOptions {
  alias: string;
  env?: NodeJS.ProcessEnv;
  userHome?: string;
  now?: () => Date;
  processList?: () => string;
  loginStatus?: (codexHome: string, env: NodeJS.ProcessEnv) => boolean;
}

export interface ImportAccountOptions {
  alias: string;
  authHome: string;
  poolHome: string;
  now?: () => Date;
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

function parseStoredMetadata(metadataText: string, directoryAlias: string): AccountMetadata {
  let value: unknown;
  try {
    value = JSON.parse(metadataText);
  } catch {
    throw new AccountStoreError(
      "CORRUPT_ACCOUNT_STORE",
      `账号 ${directoryAlias} 的 metadata.json 已损坏，请先修复账号仓库`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AccountStoreError(
      "CORRUPT_ACCOUNT_STORE",
      `账号 ${directoryAlias} 的 metadata.json 已损坏，请先修复账号仓库`,
    );
  }

  const metadata = value as Partial<AccountMetadata>;
  if (
    metadata.schemaVersion !== 1 ||
    metadata.alias !== directoryAlias ||
    typeof metadata.accountFingerprint !== "string" ||
    metadata.accountFingerprint.length !== 64 ||
    typeof metadata.authMode !== "string"
  ) {
    throw new AccountStoreError(
      "CORRUPT_ACCOUNT_STORE",
      `账号 ${directoryAlias} 的 metadata.json 字段不完整，请先修复账号仓库`,
    );
  }
  return metadata as AccountMetadata;
}

function readExistingMetadata(accountsRoot: string): AccountMetadata[] {
  if (!existsSync(accountsRoot)) {
    return [];
  }

  const metadata: AccountMetadata[] = [];
  for (const entry of readdirSync(accountsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const metadataPath = join(accountsRoot, entry.name, "metadata.json");
    if (!existsSync(metadataPath)) {
      throw new AccountStoreError(
        "CORRUPT_ACCOUNT_STORE",
        `账号 ${entry.name} 缺少 metadata.json，请先修复账号仓库`,
      );
    }
    metadata.push(parseStoredMetadata(readFileSync(metadataPath, "utf8"), entry.name));
  }
  return metadata;
}

export function addCurrentAccount(options: AddCurrentAccountOptions): AddAccountResult {
  const alias = validateAccountAlias(options.alias);
  const env = options.env ?? process.env;
  const userHome = options.userHome ?? homedir();
  const now = options.now ?? (() => new Date());
  const codexHome = resolveCodexHome(env, userHome);
  const poolHome = resolvePoolHome(env, userHome);
  const configPath = join(codexHome, "config.toml");

  const running = summarizeCodexProcesses((options.processList ?? defaultProcessList)());
  if (running.desktopAppCount + running.appServerCount > 0) {
    throw new AccountStoreError(
      "CODEX_RUNNING",
      "Codex App 或 app-server 仍在运行；请完全退出后再导入当前账号",
    );
  }

  if (!existsSync(configPath)) {
    throw new AccountStoreError("CONFIG_NOT_FOUND", "当前 CODEX_HOME 中不存在 config.toml");
  }
  const credentialStoreMode = detectCredentialStoreMode(readFileSync(configPath, "utf8"));
  if (credentialStoreMode !== "file") {
    throw new AccountStoreError(
      "FILE_STORE_REQUIRED",
      "account add 要求 cli_auth_credentials_store 显式配置为 file",
    );
  }

  if (!(options.loginStatus ?? defaultLoginStatus)(codexHome, env)) {
    throw new AccountStoreError(
      "NOT_LOGGED_IN",
      "当前 CODEX_HOME 的登录状态无效，请先使用官方 codex login 完成登录",
    );
  }

  return importAccountFromHome({
    alias,
    authHome: codexHome,
    poolHome,
    now,
  });
}

export function importAccountFromHome(options: ImportAccountOptions): AddAccountResult {
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
    if (existsSync(accountDirectory)) {
      throw new AccountStoreError("ALIAS_EXISTS", `账号别名 ${alias} 已存在`);
    }

    const existingAccounts = readExistingMetadata(accountsRoot);
    const duplicate = existingAccounts.find(
      (account) => account.accountFingerprint === identity.fingerprint,
    );
    if (duplicate) {
      throw new AccountStoreError(
        "ACCOUNT_EXISTS",
        `当前账号已经保存为 ${duplicate.alias}，不会重复导入`,
      );
    }

    ensurePrivateDirectory(accountDirectory);
    accountDirectoryCreated = true;
    const timestamp = now().toISOString();
    const metadata: AccountMetadata = {
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
    writePrivateFileAtomically(
      join(accountDirectory, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    writePrivateFileAtomically(join(options.poolHome, "active-account"), `${alias}\n`);

    return {
      alias,
      accountFingerprint: identity.fingerprint,
      authMode: identity.authMode,
      accountDirectory,
    };
  } catch (error) {
    if (accountDirectoryCreated && existsSync(accountDirectory)) {
      rmSync(accountDirectory, { force: true, recursive: true });
    }
    throw error;
  } finally {
    releaseLock();
  }
}
