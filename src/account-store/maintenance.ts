import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AccountStoreError } from "./errors.js";
import { acquirePoolLock, writePrivateFileAtomically } from "./files.js";
import { getAccountDirectory, resolvePoolHome, validateAccountAlias } from "./paths.js";
import { readAccountMetadata } from "./list.js";
import type { AccountMetadata } from "./types.js";

export interface RenameAccountOptions {
  from: string;
  to: string;
  env?: NodeJS.ProcessEnv;
  userHome?: string;
}

export interface RenameAccountResult {
  from: string;
  to: string;
  accountFingerprint: string;
  current: boolean;
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function readActiveAlias(activePath: string): string | null {
  if (!existsSync(activePath)) {
    return null;
  }
  const info = lstatSync(activePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new AccountStoreError(
      "UNSAFE_ACTIVE_ACCOUNT",
      "active-account 必须是普通文件，不能是符号链接",
    );
  }
  const value = readFileSync(activePath, "utf8").trim();
  return value ? validateAccountAlias(value) : null;
}

function writeRenamedMetadata(path: string, metadata: AccountMetadata, alias: string): void {
  writePrivateFileAtomically(
    path,
    `${JSON.stringify({ ...metadata, alias }, null, 2)}\n`,
  );
}

export function renameAccount(options: RenameAccountOptions): RenameAccountResult {
  const from = validateAccountAlias(options.from);
  const to = validateAccountAlias(options.to);
  if (from === to) {
    throw new AccountStoreError("SAME_ALIAS", "原账号别名和新账号别名不能相同");
  }
  const env = options.env ?? process.env;
  const poolHome = resolvePoolHome(env, options.userHome ?? homedir());
  const fromDirectory = getAccountDirectory(poolHome, from);
  const toDirectory = getAccountDirectory(poolHome, to);
  const activePath = join(poolHome, "active-account");

  const releaseLock = acquirePoolLock(poolHome);
  let moved = false;
  let metadata: AccountMetadata | undefined;
  let metadataText: string | undefined;
  let activeAlias: string | null = null;
  try {
    if (!pathExists(fromDirectory)) {
      throw new AccountStoreError("ALIAS_NOT_FOUND", `账号别名 ${from} 不存在`);
    }
    const fromInfo = lstatSync(fromDirectory);
    if (!fromInfo.isDirectory() || fromInfo.isSymbolicLink()) {
      throw new AccountStoreError("UNSAFE_DIRECTORY", `账号 ${from} 的目录不安全`);
    }
    if (pathExists(toDirectory)) {
      throw new AccountStoreError("ALIAS_EXISTS", `账号别名 ${to} 已存在`);
    }
    metadata = readAccountMetadata(fromDirectory, from);
    metadataText = readFileSync(join(fromDirectory, "metadata.json"), "utf8");
    activeAlias = readActiveAlias(activePath);

    renameSync(fromDirectory, toDirectory);
    moved = true;
    writeRenamedMetadata(join(toDirectory, "metadata.json"), metadata, to);
    if (activeAlias === from) {
      writePrivateFileAtomically(activePath, `${to}\n`);
    }

    return {
      from,
      to,
      accountFingerprint: metadata.accountFingerprint,
      current: activeAlias === from,
    };
  } catch (error) {
    try {
      if (moved && metadata && metadataText) {
        writePrivateFileAtomically(join(toDirectory, "metadata.json"), metadataText);
        if (activeAlias === from) {
          writePrivateFileAtomically(activePath, `${from}\n`);
        }
        renameSync(toDirectory, fromDirectory);
      }
    } catch {
      throw new AccountStoreError(
        "RENAME_ROLLBACK_FAILED",
        `账号重命名失败且回滚失败，请保留账号仓库并检查 ${poolHome}`,
      );
    }
    throw error;
  } finally {
    releaseLock();
  }
}
