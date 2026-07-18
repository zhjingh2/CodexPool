import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseAuthIdentity } from "./auth.js";
import { AccountStoreError } from "./errors.js";
import {
  acquirePoolLock,
  assertRegularPrivateSourceFile,
  writePrivateFileAtomically,
} from "./files.js";
import { getAccountDirectory } from "./paths.js";
import { resolveCodexHome } from "../preflight/doctor.js";
import type { AccountMetadata } from "./types.js";

export interface ReconcileCurrentAccountOptions {
  poolHome: string;
  activeAlias: string | null;
  accounts: readonly Pick<AccountMetadata, "alias" | "accountFingerprint">[];
  env?: NodeJS.ProcessEnv;
  userHome?: string;
}

export type ReconcileCurrentAccountStatus = "matched" | "unknown" | "unavailable";

export interface ReconcileCurrentAccountResult {
  activeAlias: string | null;
  status: ReconcileCurrentAccountStatus;
  credentialsSynced: boolean;
}

interface GlobalAuth {
  content: Buffer;
  fingerprint: string;
}

function readGlobalAuth(codexHome: string): GlobalAuth | null {
  const authPath = join(codexHome, "auth.json");
  if (!existsSync(authPath)) return null;
  try {
    assertRegularPrivateSourceFile(authPath);
    const content = readFileSync(authPath);
    return {
      content,
      fingerprint: parseAuthIdentity(content.toString("utf8")).fingerprint,
    };
  } catch (error) {
    if (error instanceof AccountStoreError) return null;
    return null;
  }
}

/**
 * Reconciles the pool marker with the account currently present in global CODEX_HOME.
 * Unknown valid credentials are deliberately not imported; they clear the marker so
 * the UI cannot claim that a different saved account is active.
 */
export function reconcileCurrentAccount(
  options: ReconcileCurrentAccountOptions,
): ReconcileCurrentAccountResult {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env, options.userHome ?? homedir());
  const globalAuth = readGlobalAuth(codexHome);
  if (!globalAuth) {
    return {
      activeAlias: options.activeAlias,
      status: "unavailable",
      credentialsSynced: false,
    };
  }

  const matched = options.accounts.find(
    (account) => account.accountFingerprint === globalAuth.fingerprint,
  );
  const nextAlias = matched?.alias ?? null;
  if (!matched) {
    if (nextAlias === options.activeAlias) {
      return {
        activeAlias: nextAlias,
        status: "unknown",
        credentialsSynced: false,
      };
    }
    const releaseLock = acquirePoolLock(options.poolHome);
    try {
      writePrivateFileAtomically(join(options.poolHome, "active-account"), "");
    } finally {
      releaseLock();
    }
    return {
      activeAlias: null,
      status: "unknown",
      credentialsSynced: false,
    };
  }

  const targetAuthPath = join(
    getAccountDirectory(options.poolHome, matched.alias),
    "auth.json",
  );
  let credentialsSynced = false;
  if (existsSync(targetAuthPath)) {
    try {
      assertRegularPrivateSourceFile(targetAuthPath);
      credentialsSynced = !readFileSync(targetAuthPath).equals(globalAuth.content);
    } catch (error) {
      if (error instanceof AccountStoreError && error.code === "UNSAFE_AUTH_FILE") {
        throw error;
      }
      credentialsSynced = true;
    }
  } else {
    credentialsSynced = true;
  }

  if (nextAlias === options.activeAlias && !credentialsSynced) {
    return {
      activeAlias: nextAlias,
      status: "matched",
      credentialsSynced: false,
    };
  }

  const releaseLock = acquirePoolLock(options.poolHome);
  try {
    if (credentialsSynced) {
      writePrivateFileAtomically(targetAuthPath, globalAuth.content);
    }
    if (nextAlias !== options.activeAlias) {
      writePrivateFileAtomically(join(options.poolHome, "active-account"), `${nextAlias}\n`);
    }
  } finally {
    releaseLock();
  }

  return {
    activeAlias: nextAlias,
    status: "matched",
    credentialsSynced,
  };
}
