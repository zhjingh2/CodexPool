import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addCurrentAccount,
  importAccountFromHome,
  listAccounts,
  purgeAccount,
  renameAccount,
} from "../src/account-store/index.js";
import { AccountStoreError } from "../src/account-store/errors.js";

function authText(accountId: string): string {
  return `${JSON.stringify(
    {
      auth_mode: "chatgpt",
      tokens: {
        account_id: accountId,
        access_token: `access-${accountId}`,
        refresh_token: `refresh-${accountId}`,
      },
    },
    null,
  )}\n`;
}

function createEnvironment() {
  const root = mkdtempSync(join(tmpdir(), "codex-pool-maintenance-test-"));
  const codexHome = join(root, "codex-home");
  const poolHome = join(root, "pool-home");
  mkdirSync(codexHome, { mode: 0o700 });
  writeFileSync(join(codexHome, "config.toml"), 'cli_auth_credentials_store = "file"\n', { mode: 0o600 });
  writeFileSync(join(codexHome, "auth.json"), authText("account-a"), { mode: 0o600 });
  return {
    root,
    codexHome,
    poolHome,
    env: { CODEX_HOME: codexHome, CODEX_POOL_HOME: poolHome },
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

test("renames an account without changing its credentials or current state", () => {
  const environment = createEnvironment();
  try {
    addCurrentAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    const beforeAuth = readFileSync(join(environment.poolHome, "accounts", "work", "auth.json"), "utf8");
    const result = renameAccount({
      from: "work",
      to: "company",
      env: environment.env,
      userHome: environment.root,
    });
    assert.equal(result.from, "work");
    assert.equal(result.to, "company");
    assert.equal(result.current, true);
    assert.equal(existsSync(join(environment.poolHome, "accounts", "work")), false);
    assert.equal(readFileSync(join(environment.poolHome, "accounts", "company", "auth.json"), "utf8"), beforeAuth);
    assert.equal(readFileSync(join(environment.poolHome, "accounts", "company", "metadata.json"), "utf8").includes('"alias": "company"'), true);
    assert.equal(readFileSync(join(environment.poolHome, "active-account"), "utf8"), "company\n");
    assert.equal(listAccounts({ env: environment.env, userHome: environment.root })[0]?.alias, "company");
  } finally {
    environment.cleanup();
  }
});

test("renaming an inactive account leaves active-account unchanged", () => {
  const environment = createEnvironment();
  try {
    addCurrentAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    const otherHome = join(environment.root, "other-home");
    mkdirSync(otherHome, { mode: 0o700 });
    writeFileSync(join(otherHome, "auth.json"), authText("account-b"), { mode: 0o600 });
    importAccountFromHome({
      alias: "personal",
      authHome: otherHome,
      poolHome: environment.poolHome,
      setActiveAccount: false,
    });
    const result = renameAccount({
      from: "personal",
      to: "private",
      env: environment.env,
      userHome: environment.root,
    });
    assert.equal(result.current, false);
    assert.equal(readFileSync(join(environment.poolHome, "active-account"), "utf8"), "work\n");
    assert.equal(listAccounts({ env: environment.env, userHome: environment.root }).some((account) => account.alias === "private"), true);
  } finally {
    environment.cleanup();
  }
});

test("rejects rename when destination exists or source is missing", () => {
  const environment = createEnvironment();
  try {
    addCurrentAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    assert.throws(
      () => renameAccount({ from: "missing", to: "company", env: environment.env, userHome: environment.root }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "ALIAS_NOT_FOUND",
    );
    const otherHome = join(environment.root, "other-home");
    mkdirSync(otherHome, { mode: 0o700 });
    writeFileSync(join(otherHome, "auth.json"), authText("account-b"), { mode: 0o600 });
    importAccountFromHome({ alias: "company", authHome: otherHome, poolHome: environment.poolHome, setActiveAccount: false });
    assert.throws(
      () => renameAccount({ from: "work", to: "company", env: environment.env, userHome: environment.root }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "ALIAS_EXISTS",
    );
  } finally {
    environment.cleanup();
  }
});

test("purges an inactive account only after exact confirmation", () => {
  const environment = createEnvironment();
  try {
    addCurrentAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    const otherHome = join(environment.root, "other-home");
    mkdirSync(otherHome, { mode: 0o700 });
    writeFileSync(join(otherHome, "auth.json"), authText("account-b"), { mode: 0o600 });
    importAccountFromHome({ alias: "personal", authHome: otherHome, poolHome: environment.poolHome, setActiveAccount: false });

    assert.throws(
      () => purgeAccount({ alias: "personal", env: environment.env, userHome: environment.root }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "PURGE_CONFIRMATION_REQUIRED",
    );
    const result = purgeAccount({
      alias: "personal",
      confirmation: "personal",
      env: environment.env,
      userHome: environment.root,
    });
    assert.equal(result.alias, "personal");
    assert.equal(existsSync(join(environment.poolHome, "accounts", "personal")), false);
    assert.equal(existsSync(join(environment.poolHome, "accounts", "work")), true);
    assert.equal(readFileSync(join(environment.poolHome, "active-account"), "utf8"), "work\n");
  } finally {
    environment.cleanup();
  }
});

test("does not purge the current account", () => {
  const environment = createEnvironment();
  try {
    addCurrentAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    assert.throws(
      () => purgeAccount({ alias: "work", confirmation: "work", env: environment.env, userHome: environment.root }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "CURRENT_ACCOUNT_PROTECTED",
    );
    assert.equal(existsSync(join(environment.poolHome, "accounts", "work")), true);
  } finally {
    environment.cleanup();
  }
});
