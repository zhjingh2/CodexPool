import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addCurrentAccount, listAccounts } from "../src/account-store/index.js";
import { AccountStoreError } from "../src/account-store/errors.js";

const AUTH_TEXT = `${JSON.stringify(
  {
    auth_mode: "chatgpt",
    tokens: {
      account_id: "list-account",
      access_token: "list-access-secret",
      refresh_token: "list-refresh-secret",
    },
  },
  null,
)}\n`;

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
