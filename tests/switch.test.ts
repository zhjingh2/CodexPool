import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { importAccountFromHome } from "../src/account-store/index.js";
import { addCurrentAccount } from "../src/account-store/index.js";
import { AccountStoreError } from "../src/account-store/errors.js";
import { switchAccount } from "../src/auth-swap/index.js";

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

function createEnvironment(): {
  root: string;
  codexHome: string;
  poolHome: string;
  cleanup(): void;
} {
  const root = mkdtempSync(join(tmpdir(), "codex-pool-switch-test-"));
  const codexHome = join(root, "codex-home");
  const poolHome = join(root, "pool-home");
  mkdirSync(codexHome, { mode: 0o700 });
  writeFileSync(join(codexHome, "auth.json"), authText("account-a"), { mode: 0o600 });
  chmodSync(join(codexHome, "auth.json"), 0o600);
  return { root, codexHome, poolHome, cleanup: () => rmSync(root, { force: true, recursive: true }) };
}

function addAccounts(environment: ReturnType<typeof createEnvironment>): void {
  addCurrentAccount({
    alias: "work",
    env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
    userHome: environment.root,
    processList: () => "",
    loginStatus: () => true,
  });

  const personalHome = join(environment.root, "personal-home");
  mkdirSync(personalHome, { mode: 0o700 });
  writeFileSync(join(personalHome, "auth.json"), authText("account-b"), { mode: 0o600 });
  importAccountFromHome({
    alias: "personal",
    authHome: personalHome,
    poolHome: environment.poolHome,
    setActiveAccount: false,
  });
}

test("switches auth.json without config.toml and updates active-account after verification", () => {
  const environment = createEnvironment();
  try {
    addAccounts(environment);
    const result = switchAccount({
      alias: "personal",
      env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
      userHome: environment.root,
      processList: () => "",
      loginStatus: (codexHome) => {
        assert.equal(codexHome, environment.codexHome);
        return readFileSync(join(codexHome, "auth.json"), "utf8") === authText("account-b");
      },
      now: () => new Date("2026-07-18T00:00:00.000Z"),
    });

    assert.equal(result.alias, "personal");
    assert.equal(result.previousAlias, "work");
    assert.equal(readFileSync(join(environment.codexHome, "auth.json"), "utf8"), authText("account-b"));
    assert.equal(readFileSync(join(environment.poolHome, "active-account"), "utf8"), "personal\n");
    assert.equal(existsSync(join(environment.poolHome, "switch-journal.json")), false);
    assert.equal(statSync(join(environment.codexHome, "auth.json")).mode & 0o777, 0o600);
  } finally {
    environment.cleanup();
  }
});

test("launches Codex App only after a successful switch when requested", () => {
  const environment = createEnvironment();
  try {
    addAccounts(environment);
    let launched = false;
    const result = switchAccount({
      alias: "personal",
      launch: true,
      launchApp: () => {
        launched = true;
        return true;
      },
      env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    assert.equal(result.alias, "personal");
    assert.equal(launched, true);
    assert.equal(existsSync(join(environment.poolHome, "switch-journal.json")), false);
  } finally {
    environment.cleanup();
  }
});

test("does not roll back a committed switch when App launch fails", () => {
  const environment = createEnvironment();
  try {
    addAccounts(environment);
    assert.throws(
      () =>
        switchAccount({
          alias: "personal",
          launch: true,
          launchApp: () => false,
          env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
          userHome: environment.root,
          processList: () => "",
          loginStatus: () => true,
        }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "APP_LAUNCH_FAILED",
    );
    assert.equal(readFileSync(join(environment.poolHome, "active-account"), "utf8"), "personal\n");
    assert.equal(readFileSync(join(environment.codexHome, "auth.json"), "utf8"), authText("account-b"));
  } finally {
    environment.cleanup();
  }
});

test("restores the previous auth and active account when target verification fails", () => {
  const environment = createEnvironment();
  try {
    addAccounts(environment);
    assert.throws(
      () =>
        switchAccount({
          alias: "personal",
          env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
          userHome: environment.root,
          processList: () => "",
          loginStatus: () => false,
        }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "TARGET_LOGIN_INVALID",
    );
    assert.equal(readFileSync(join(environment.codexHome, "auth.json"), "utf8"), authText("account-a"));
    assert.equal(readFileSync(join(environment.poolHome, "active-account"), "utf8"), "work\n");
    assert.equal(existsSync(join(environment.poolHome, "switch-journal.json")), false);
  } finally {
    environment.cleanup();
  }
});

test("switches to a saved account when the global CODEX_HOME is logged out", () => {
  const environment = createEnvironment();
  try {
    addAccounts(environment);
    rmSync(join(environment.codexHome, "auth.json"));

    const result = switchAccount({
      alias: "personal",
      env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
      userHome: environment.root,
      processList: () => "",
      loginStatus: (codexHome) => {
        assert.equal(readFileSync(join(codexHome, "auth.json"), "utf8"), authText("account-b"));
        return true;
      },
    });

    assert.equal(result.previousAlias, null);
    assert.equal(readFileSync(join(environment.codexHome, "auth.json"), "utf8"), authText("account-b"));
    assert.equal(readFileSync(join(environment.poolHome, "active-account"), "utf8"), "personal\n");
    assert.equal(existsSync(join(environment.poolHome, "switch-journal.json")), false);
  } finally {
    environment.cleanup();
  }
});

test("removes the new auth and leaves CODEX_HOME logged out when verification fails", () => {
  const environment = createEnvironment();
  try {
    addAccounts(environment);
    rmSync(join(environment.codexHome, "auth.json"));

    assert.throws(
      () =>
        switchAccount({
          alias: "personal",
          env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
          userHome: environment.root,
          processList: () => "",
          loginStatus: () => false,
        }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "TARGET_LOGIN_INVALID",
    );
    assert.equal(existsSync(join(environment.codexHome, "auth.json")), false);
    assert.equal(existsSync(join(environment.poolHome, "active-account")), false);
    assert.equal(existsSync(join(environment.poolHome, "switch-journal.json")), false);
  } finally {
    environment.cleanup();
  }
});

test("refuses to switch while Codex processes are running", () => {
  const environment = createEnvironment();
  try {
    addAccounts(environment);
    assert.throws(
      () =>
        switchAccount({
          alias: "personal",
          env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
          userHome: environment.root,
          processList: () => "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
          loginStatus: () => true,
        }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "CODEX_RUNNING",
    );
    assert.equal(readFileSync(join(environment.codexHome, "auth.json"), "utf8"), authText("account-a"));
  } finally {
    environment.cleanup();
  }
});

test("refuses to switch to an account marked for re-login", () => {
  const environment = createEnvironment();
  try {
    addAccounts(environment);
    const metadataPath = join(environment.poolHome, "accounts", "personal", "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
    metadata.needsRelogin = true;
    metadata.reloginReason = "登录凭证已失效，请重新登录";
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });

    assert.throws(
      () =>
        switchAccount({
          alias: "personal",
          env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
          userHome: environment.root,
          processList: () => "",
          loginStatus: () => true,
        }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "ACCOUNT_NEEDS_RELOGIN",
    );
    assert.equal(readFileSync(join(environment.codexHome, "auth.json"), "utf8"), authText("account-a"));
  } finally {
    environment.cleanup();
  }
});

test("does not create an empty account directory when the target is missing", () => {
  const environment = createEnvironment();
  try {
    addAccounts(environment);
    const missingDirectory = join(environment.poolHome, "accounts", "company");
    assert.equal(existsSync(missingDirectory), false);
    assert.throws(
      () =>
        switchAccount({
          alias: "company",
          env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
          userHome: environment.root,
          processList: () => "",
          loginStatus: () => true,
        }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "CORRUPT_ACCOUNT_STORE",
    );
    assert.equal(existsSync(missingDirectory), false);
  } finally {
    environment.cleanup();
  }
});

test("recovers an unfinished switch journal before the next switch", () => {
  const environment = createEnvironment();
  try {
    addAccounts(environment);
    assert.throws(
      () =>
        switchAccount({
          alias: "personal",
          env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
          userHome: environment.root,
          processList: () => "",
          loginStatus: () => {
            throw new Error("simulated interruption");
          },
        }),
      /simulated interruption/,
    );
    assert.equal(existsSync(join(environment.poolHome, "switch-journal.json")), true);
    assert.equal(readFileSync(join(environment.codexHome, "auth.json"), "utf8"), authText("account-b"));

    const result = switchAccount({
      alias: "personal",
      env: { CODEX_HOME: environment.codexHome, CODEX_POOL_HOME: environment.poolHome },
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    assert.equal(result.previousAlias, "work");
    assert.equal(readFileSync(join(environment.poolHome, "active-account"), "utf8"), "personal\n");
    assert.equal(existsSync(join(environment.poolHome, "switch-journal.json")), false);
  } finally {
    environment.cleanup();
  }
});
