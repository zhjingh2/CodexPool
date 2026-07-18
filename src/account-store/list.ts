import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseAuthIdentity } from "./auth.js";
import { AccountStoreError } from "./errors.js";
import { assertRegularPrivateSourceFile } from "./files.js";
import { resolvePoolHome, validateAccountAlias } from "./paths.js";
import type { AccountMetadata, AccountSummary } from "./types.js";

export interface ListAccountsOptions {
  env?: NodeJS.ProcessEnv;
  userHome?: string;
}

export function parseAccountMetadata(text: string, alias: string): AccountMetadata {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AccountStoreError(
      "CORRUPT_ACCOUNT_STORE",
      `账号 ${alias} 的 metadata.json 已损坏，请先修复账号仓库`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AccountStoreError(
      "CORRUPT_ACCOUNT_STORE",
      `账号 ${alias} 的 metadata.json 已损坏，请先修复账号仓库`,
    );
  }
  const metadata = value as Partial<AccountMetadata>;
  if (
    metadata.schemaVersion !== 1 ||
    metadata.alias !== alias ||
    typeof metadata.accountFingerprint !== "string" ||
    metadata.accountFingerprint.length !== 64 ||
    typeof metadata.authMode !== "string"
  ) {
    throw new AccountStoreError(
      "CORRUPT_ACCOUNT_STORE",
      `账号 ${alias} 的 metadata.json 字段不完整，请先修复账号仓库`,
    );
  }
  return metadata as AccountMetadata;
}

export function readAccountMetadata(accountDirectory: string, alias: string): AccountMetadata {
  const metadataPath = join(accountDirectory, "metadata.json");
  if (!existsSync(metadataPath)) {
    throw new AccountStoreError(
      "CORRUPT_ACCOUNT_STORE",
      `账号 ${alias} 缺少 metadata.json，请先修复账号仓库`,
    );
  }
  return parseAccountMetadata(readFileSync(metadataPath, "utf8"), alias);
}

function readActiveAlias(poolHome: string): string | null {
  const path = join(poolHome, "active-account");
  if (!existsSync(path)) {
    return null;
  }
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new AccountStoreError(
      "UNSAFE_ACTIVE_ACCOUNT",
      "active-account 必须是普通文件，不能是符号链接",
    );
  }
  const text = readFileSync(path, "utf8").trim();
  return text ? validateAccountAlias(text) : null;
}

function inspectCredential(accountDirectory: string, metadata: AccountMetadata): {
  status: AccountSummary["credentialStatus"];
  message: string | null;
} {
  const authPath = join(accountDirectory, "auth.json");
  if (!existsSync(authPath)) {
    return { status: "missing", message: "auth.json 不存在" };
  }
  try {
    assertRegularPrivateSourceFile(authPath);
    const identity = parseAuthIdentity(readFileSync(authPath, "utf8"));
    if (identity.fingerprint !== metadata.accountFingerprint) {
      return { status: "invalid", message: "auth.json 与 metadata.json 指纹不一致" };
    }
    return { status: "ok", message: null };
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof AccountStoreError ? error.message : "auth.json 无法读取",
    };
  }
}

export function listAccounts(options: ListAccountsOptions = {}): AccountSummary[] {
  const env = options.env ?? process.env;
  const poolHome = resolvePoolHome(env, options.userHome ?? homedir());
  const accountsRoot = join(poolHome, "accounts");
  if (!existsSync(accountsRoot)) {
    return [];
  }
  const accountsInfo = lstatSync(accountsRoot);
  if (!accountsInfo.isDirectory() || accountsInfo.isSymbolicLink()) {
    throw new AccountStoreError(
      "UNSAFE_DIRECTORY",
      "账号仓库 accounts 目录必须是普通目录，不能是符号链接",
    );
  }
  const activeAlias = readActiveAlias(poolHome);
  const accounts: AccountSummary[] = [];
  for (const entry of readdirSync(accountsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const alias = validateAccountAlias(entry.name);
    const accountDirectory = join(accountsRoot, alias);
    const metadata = readAccountMetadata(accountDirectory, alias);
    const credential = inspectCredential(accountDirectory, metadata);
    accounts.push({
      ...metadata,
      current: activeAlias === alias,
      enabled: true,
      credentialStatus: credential.status,
      credentialMessage: credential.message,
    });
  }
  return accounts.sort((left, right) => left.alias.localeCompare(right.alias));
}
