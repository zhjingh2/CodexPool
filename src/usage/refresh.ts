import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  acquirePoolLock,
  assertRegularPrivateSourceFile,
  ensurePrivateDirectory,
  writePrivateFileAtomically,
} from "../account-store/files.js";
import { readAccountMetadata } from "../account-store/list.js";
import { extractAuthEmail, parseAuthIdentity } from "../account-store/auth.js";
import { AccountStoreError } from "../account-store/errors.js";
import { getAccountDirectory, resolvePoolHome, validateAccountAlias } from "../account-store/paths.js";
import type { AccountMetadata } from "../account-store/types.js";
import {
  queryAccountServer,
  type AccountServerOptions,
  type AccountSnapshot,
} from "../app-server/index.js";

export interface RefreshAccountOptions {
  alias: string;
  env?: NodeJS.ProcessEnv;
  userHome?: string;
  now?: () => Date;
  query?: (options: AccountServerOptions) => Promise<AccountSnapshot>;
}

function maskEmail(email: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  const [local, domain] = email.split("@", 2);
  if (!local || !domain) return null;
  const visible = local.length <= 2 ? local[0] ?? "*" : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

function createRuntime(poolHome: string, alias: string): string {
  const runtimeRoot = join(poolHome, "runtime", alias);
  ensurePrivateDirectory(runtimeRoot);
  const runtimeDirectory = join(runtimeRoot, `run-${randomUUID()}`);
  ensurePrivateDirectory(runtimeDirectory);
  chmodSync(runtimeDirectory, 0o700);
  writePrivateFileAtomically(
    join(runtimeDirectory, "config.toml"),
    'cli_auth_credentials_store = "file"\n',
  );
  return runtimeDirectory;
}

function updateMetadata(
  accountDirectory: string,
  metadata: AccountMetadata,
  snapshot: AccountSnapshot,
  now: () => Date,
): void {
  const updated: AccountMetadata = {
    ...metadata,
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
  writePrivateFileAtomically(
    join(accountDirectory, "metadata.json"),
    `${JSON.stringify(updated, null, 2)}\n`,
  );
}

export async function refreshAccount(options: RefreshAccountOptions): Promise<AccountSnapshot> {
  const alias = validateAccountAlias(options.alias);
  const env = options.env ?? process.env;
  const userHome = options.userHome ?? homedir();
  const poolHome = resolvePoolHome(env, userHome);
  const accountDirectory = getAccountDirectory(poolHome, alias);
  const authPath = join(accountDirectory, "auth.json");
  const releaseLock = acquirePoolLock(poolHome);
  let runtimeDirectory: string | undefined;
  try {
    const metadata = readAccountMetadata(accountDirectory, alias);
    assertRegularPrivateSourceFile(authPath);
    const storedAuth = readFileSync(authPath);
    const storedIdentity = parseAuthIdentity(storedAuth.toString("utf8"));
    if (storedIdentity.fingerprint !== metadata.accountFingerprint) {
      throw new AccountStoreError(
        "ACCOUNT_METADATA_MISMATCH",
        `账号 ${alias} 的 auth.json 与 metadata.json 指纹不一致，请先修复账号仓库`,
      );
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
        throw new AccountStoreError(
          "AUTH_REFRESH_ACCOUNT_MISMATCH",
          `账号 ${alias} 的 app-server 刷新结果属于其他账号，已拒绝写回`,
        );
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
  } finally {
    try {
      if (runtimeDirectory) {
        rmSync(runtimeDirectory, { force: true, recursive: true });
      }
    } finally {
      releaseLock();
    }
  }
}
