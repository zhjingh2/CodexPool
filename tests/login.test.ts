import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AccountStoreError } from "../src/account-store/index.js";
import { loginAccount } from "../src/runtime/index.js";

const LOGIN_AUTH = `${JSON.stringify(
  {
    auth_mode: "chatgpt",
    tokens: {
      account_id: "account-login",
      access_token: "access-login-secret",
      refresh_token: "refresh-login-secret",
    },
  },
  null,
)}\n`;

function createEnvironment(): { root: string; poolHome: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), "codex-pool-login-test-"));
  const poolHome = join(root, "pool-home");
  return { root, poolHome, cleanup: () => rmSync(root, { force: true, recursive: true }) };
}

test("logs into an isolated CODEX_HOME and imports only after success", () => {
  const environment = createEnvironment();
  try {
    const result = loginAccount({
      alias: "personal",
      env: { CODEX_POOL_HOME: environment.poolHome },
      userHome: environment.root,
      now: () => new Date("2026-07-18T00:00:00.000Z"),
      runLogin: (loginEnv) => {
        assert.notEqual(loginEnv.CODEX_HOME, undefined);
        assert.equal(
          loginEnv.CODEX_HOME?.startsWith(join(environment.poolHome, "runtime", "login")),
          true,
        );
        writeFileSync(join(loginEnv.CODEX_HOME!, "auth.json"), LOGIN_AUTH, { mode: 0o600 });
        return 0;
      },
    });

    assert.equal(result.alias, "personal");
    assert.equal(
      readFileSync(join(environment.poolHome, "accounts", "personal", "auth.json"), "utf8"),
      LOGIN_AUTH,
    );
    assert.equal(existsSync(join(environment.poolHome, "active-account")), false);
    assert.deepEqual(
      readdirSync(join(environment.poolHome, "runtime", "login")),
      [],
    );
  } finally {
    environment.cleanup();
  }
});
test("a cancelled official login leaves the current account and pool unchanged", () => {
  const environment = createEnvironment();
  try {
    assert.throws(
      () =>
        loginAccount({
          alias: "personal",
          env: { CODEX_POOL_HOME: environment.poolHome },
          userHome: environment.root,
          runLogin: () => 1,
        }),
      (error: unknown) => error instanceof AccountStoreError && error.code === "LOGIN_CANCELLED",
    );
    assert.equal(existsSync(join(environment.poolHome, "accounts")), false);
    assert.deepEqual(
      readdirSync(join(environment.poolHome, "runtime", "login")),
      [],
    );
  } finally {
    environment.cleanup();
  }
});

test("re-login clears the needs-relogin marker for the same account", () => {
  const environment = createEnvironment();
  try {
    loginAccount({
      alias: "personal",
      env: { CODEX_POOL_HOME: environment.poolHome },
      userHome: environment.root,
      runLogin: (loginEnv) => {
        writeFileSync(join(loginEnv.CODEX_HOME!, "auth.json"), LOGIN_AUTH, { mode: 0o600 });
        return 0;
      },
    });
    const metadataPath = join(environment.poolHome, "accounts", "personal", "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
    metadata.needsRelogin = true;
    metadata.reloginReason = "登录凭证已失效，请重新登录";
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });

    loginAccount({
      alias: "personal",
      env: { CODEX_POOL_HOME: environment.poolHome },
      userHome: environment.root,
      runLogin: (loginEnv) => {
        writeFileSync(join(loginEnv.CODEX_HOME!, "auth.json"), LOGIN_AUTH, { mode: 0o600 });
        return 0;
      },
    });

    const updatedMetadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
    assert.equal(updatedMetadata.needsRelogin, false);
    assert.equal(updatedMetadata.reloginReason, null);
  } finally {
    environment.cleanup();
  }
});
