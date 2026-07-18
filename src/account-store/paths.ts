import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AccountStoreError } from "./errors.js";

const ACCOUNT_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;
const RESERVED_ALIASES = new Set([".", "..", "runtime", "accounts"]);

export function validateAccountAlias(alias: string): string {
  const normalized = alias.trim();
  if (!ACCOUNT_ALIAS_PATTERN.test(normalized) || RESERVED_ALIASES.has(normalized)) {
    throw new AccountStoreError(
      "INVALID_ALIAS",
      "账号别名必须为 1-32 个字母、数字、点、下划线或连字符，并且不能包含路径分隔符",
    );
  }
  return normalized;
}

export function resolvePoolHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
): string {
  const configured = env.CODEX_POOL_HOME?.trim();
  return configured ? resolve(configured) : join(userHome, ".codex-pool");
}

export function getAccountDirectory(poolHome: string, alias: string): string {
  const safeAlias = validateAccountAlias(alias);
  const accountsRoot = resolve(poolHome, "accounts");
  const accountDirectory = resolve(accountsRoot, safeAlias);
  if (!accountDirectory.startsWith(`${accountsRoot}/`)) {
    throw new AccountStoreError("UNSAFE_PATH", "账号目录超出账号仓库范围");
  }
  return accountDirectory;
}
