import assert from "node:assert/strict";
import {
  chmodSync,
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
import { AccountStoreError, addCurrentAccount } from "../src/account-store/index.js";
import { extractAuthEmail, parseAuthIdentity } from "../src/account-store/auth.js";
import { validateAccountAlias } from "../src/account-store/paths.js";

const AUTH_DOCUMENT = {
  auth_mode: "chatgpt",
  tokens: {
    account_id: "account-a",
    access_token: "access-secret-a",
    refresh_token: "refresh-secret-a",
    id_token: "id-secret-a",
  },
};

interface TestEnvironment {
  root: string;
  codexHome: string;
  poolHome: string;
  authText: string;
  cleanup(): void;
}

function createTestEnvironment(storeMode = "file"): TestEnvironment {
  const root = mkdtempSync(join(tmpdir(), "codex-pool-account-test-"));
  const codexHome = join(root, "codex-home");
  const poolHome = join(root, "pool-home");
  mkdirSync(codexHome, { mode: 0o700 });
  const authText = `${JSON.stringify(AUTH_DOCUMENT, null, 2)}\n`;
  writeFileSync(join(codexHome, "auth.json"), authText, { mode: 0o600 });
  chmodSync(join(codexHome, "auth.json"), 0o600);
  writeFileSync(
    join(codexHome, "config.toml"),
    `cli_auth_credentials_store = "${storeMode}"\n`,
    { mode: 0o600 },
  );
  return {
    root,
    codexHome,
    poolHome,
    authText,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

function addInTestEnvironment(environment: TestEnvironment, alias: string) {
  return addCurrentAccount({
    alias,
    env: {
      CODEX_HOME: environment.codexHome,
      CODEX_POOL_HOME: environment.poolHome,
    },
    userHome: environment.root,
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    processList: () => "",
    loginStatus: () => true,
  });
}

test("validates account aliases before creating paths", () => {
  assert.equal(validateAccountAlias("work-1"), "work-1");
  assert.throws(() => validateAccountAlias("../work"), AccountStoreError);
  assert.throws(() => validateAccountAlias("a/b"), AccountStoreError);
  assert.throws(() => validateAccountAlias(""), AccountStoreError);
});

test("derives a stable fingerprint without returning the raw account id", () => {
  const first = parseAuthIdentity(JSON.stringify(AUTH_DOCUMENT));
  const second = parseAuthIdentity(JSON.stringify(AUTH_DOCUMENT));
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.fingerprint.includes("account-a"), false);
  assert.equal(first.authMode, "chatgpt");
});

test("extracts a verified email from the local ID token without exposing credentials", () => {
  const payload = Buffer.from(JSON.stringify({ email: "work@example.com", email_verified: true }))
    .toString("base64url");
  const authText = JSON.stringify({
    ...AUTH_DOCUMENT,
    tokens: { ...AUTH_DOCUMENT.tokens, id_token: `header.${payload}.signature` },
  });
  assert.equal(extractAuthEmail(authText), "work@example.com");
  assert.equal(extractAuthEmail(JSON.stringify(AUTH_DOCUMENT)), null);
});

test("imports the current account with private permissions and safe metadata", () => {
  const environment = createTestEnvironment();
  try {
    const result = addInTestEnvironment(environment, "work");
    const accountDirectory = join(environment.poolHome, "accounts", "work");
    const storedAuthPath = join(accountDirectory, "auth.json");
    const metadataPath = join(accountDirectory, "metadata.json");
    const activeAccountPath = join(environment.poolHome, "active-account");

    assert.equal(result.alias, "work");
    assert.equal(readFileSync(storedAuthPath, "utf8"), environment.authText);
    assert.equal(statSync(environment.poolHome).mode & 0o777, 0o700);
    assert.equal(statSync(accountDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(storedAuthPath).mode & 0o777, 0o600);
    assert.equal(statSync(metadataPath).mode & 0o777, 0o600);
    assert.equal(statSync(activeAccountPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(activeAccountPath, "utf8"), "work\n");

    const metadataText = readFileSync(metadataPath, "utf8");
    const metadata = JSON.parse(metadataText) as Record<string, unknown>;
    assert.equal(metadata.alias, "work");
    assert.equal(metadata.authMode, "chatgpt");
    assert.equal(metadata.addedAt, "2026-07-18T00:00:00.000Z");
    assert.equal(metadataText.includes("access-secret-a"), false);
    assert.equal(metadataText.includes("refresh-secret-a"), false);
    assert.equal(metadataText.includes("account-a"), false);
  } finally {
    environment.cleanup();
  }
});

test("rejects duplicate aliases and duplicate account fingerprints", () => {
  const environment = createTestEnvironment();
  try {
    addInTestEnvironment(environment, "work");

    assert.throws(
      () => addInTestEnvironment(environment, "work"),
      (error: unknown) => error instanceof AccountStoreError && error.code === "ALIAS_EXISTS",
    );
    assert.throws(
      () => addInTestEnvironment(environment, "personal"),
      (error: unknown) => error instanceof AccountStoreError && error.code === "ACCOUNT_EXISTS",
    );
  } finally {
    environment.cleanup();
  }
});

test("requires explicit file credential storage", () => {
  const environment = createTestEnvironment("auto");
  try {
    assert.throws(
      () => addInTestEnvironment(environment, "work"),
      (error: unknown) =>
        error instanceof AccountStoreError && error.code === "FILE_STORE_REQUIRED",
    );
  } finally {
    environment.cleanup();
  }
});

test("allows importing the current account while Codex App is running", () => {
  const environment = createTestEnvironment();
  try {
    const result = addCurrentAccount({
      alias: "work",
      env: {
        CODEX_HOME: environment.codexHome,
        CODEX_POOL_HOME: environment.poolHome,
      },
      userHome: environment.root,
      processList: () => "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      loginStatus: () => true,
    });
    assert.equal(result.alias, "work");
  } finally {
    environment.cleanup();
  }
});

test("refuses to import an account with an invalid login status", () => {
  const environment = createTestEnvironment();
  try {
    assert.throws(
      () =>
        addCurrentAccount({
          alias: "work",
          env: {
            CODEX_HOME: environment.codexHome,
            CODEX_POOL_HOME: environment.poolHome,
          },
          userHome: environment.root,
          processList: () => "",
          loginStatus: () => false,
        }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "NOT_LOGGED_IN",
    );
  } finally {
    environment.cleanup();
  }
});
