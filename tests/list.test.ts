import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addCurrentAccount, listAccounts } from "../src/account-store/index.js";
import { AccountStoreError } from "../src/account-store/errors.js";

function authText(accountId: string): string {
  return `${JSON.stringify(
  {
    auth_mode: "chatgpt",
    tokens: {
      account_id: accountId,
      access_token: "list-access-secret",
      refresh_token: "list-refresh-secret",
    },
  },
  null,
)}\n`;
}

const AUTH_TEXT = authText("list-account");

function createEnvironment() {
  const root = mkdtempSync(join(tmpdir(), "codex-pool-list-test-"));
  const codexHome = join(root, "codex-home");
  const poolHome = join(root, "pool-home");
  mkdirSync(codexHome, { mode: 0o700 });
  writeFileSync(join(codexHome, "config.toml"), 'cli_auth_credentials_store = "file"\n', { mode: 0o600 });
  writeFileSync(join(codexHome, "auth.json"), AUTH_TEXT, { mode: 0o600 });
  return {
    root,
    codexHome,
    poolHome,
    env: { CODEX_HOME: codexHome, CODEX_POOL_HOME: poolHome },
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

test("lists saved accounts without exposing credential fields", () => {
  const environment = createEnvironment();
  try {
    addCurrentAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    const accounts = listAccounts({ env: environment.env, userHome: environment.root });
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]?.alias, "work");
    assert.equal(accounts[0]?.current, true);
    assert.equal(accounts[0]?.enabled, true);
    assert.equal(accounts[0]?.credentialStatus, "ok");
    assert.equal("access_token" in accounts[0]!, false);
    assert.equal("refresh_token" in accounts[0]!, false);
    assert.equal(JSON.stringify(accounts).includes("list-access-secret"), false);
  } finally {
    environment.cleanup();
  }
});

test("reports missing account credentials instead of reading them as healthy", () => {
  const environment = createEnvironment();
  try {
    addCurrentAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    unlinkSync(join(environment.poolHome, "accounts", "work", "auth.json"));
    const accounts = listAccounts({ env: environment.env, userHome: environment.root });
    assert.equal(accounts[0]?.credentialStatus, "missing");
    assert.equal(existsSync(join(environment.poolHome, "accounts", "work", "metadata.json")), true);
  } finally {
    environment.cleanup();
  }
});

test("rejects a malformed account metadata file", () => {
  const environment = createEnvironment();
  try {
    mkdirSync(join(environment.poolHome, "accounts", "broken"), { mode: 0o700, recursive: true });
    writeFileSync(
      join(environment.poolHome, "accounts", "broken", "metadata.json"),
      "{\"alias\":\"broken\"}\n",
      { mode: 0o600 },
    );
    assert.throws(
      () => listAccounts({ env: environment.env, userHome: environment.root }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "CORRUPT_ACCOUNT_STORE",
    );
  } finally {
    environment.cleanup();
  }
});

test("reconciles active-account after an external login to a saved account", () => {
  const environment = createEnvironment();
  try {
    addCurrentAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    writeFileSync(join(environment.codexHome, "auth.json"), authText("other-account"), { mode: 0o600 });
    addCurrentAccount({
      alias: "personal",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    const refreshedAuth = authText("list-account")
      .replace("list-access-secret", "fresh-access-secret")
      .replace("list-refresh-secret", "fresh-refresh-secret");
    writeFileSync(join(environment.codexHome, "auth.json"), refreshedAuth, { mode: 0o600 });

    const accounts = listAccounts({ env: environment.env, userHome: environment.root });
    assert.equal(accounts.find((account) => account.alias === "work")?.current, true);
    assert.equal(accounts.find((account) => account.alias === "personal")?.current, false);
    assert.equal(readFileSync(join(environment.poolHome, "active-account"), "utf8"), "work\n");
    assert.equal(readFileSync(join(environment.poolHome, "accounts", "work", "auth.json"), "utf8"), refreshedAuth);
  } finally {
    environment.cleanup();
  }
});

test("clears active-account when external login is not saved in the pool", () => {
  const environment = createEnvironment();
  try {
    addCurrentAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    writeFileSync(join(environment.codexHome, "auth.json"), authText("unknown-account"), { mode: 0o600 });

    const accounts = listAccounts({ env: environment.env, userHome: environment.root });
    assert.equal(accounts[0]?.current, false);
    assert.equal(readFileSync(join(environment.poolHome, "active-account"), "utf8"), "");
  } finally {
    environment.cleanup();
  }
});
