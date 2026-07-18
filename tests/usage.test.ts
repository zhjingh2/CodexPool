import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { addCurrentAccount, listAccounts } from "../src/account-store/index.js";
import { refreshAccount } from "../src/usage/index.js";

const AUTH_TEXT = `${JSON.stringify(
  {
    auth_mode: "chatgpt",
    tokens: {
      account_id: "usage-account",
      access_token: "access-before",
      refresh_token: "refresh-before",
    },
  },
  null,
)}\n`;

const REFRESHED_AUTH_TEXT = AUTH_TEXT.replace("access-before", "access-after").replace(
  "refresh-before",
  "refresh-after",
);

function createEnvironment() {
  const root = mkdtempSync(join(tmpdir(), "codex-pool-usage-test-"));
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

test("refreshes an account in an isolated runtime and persists safe quota metadata", async () => {
  const environment = createEnvironment();
  try {
    addCurrentAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });
    const staleRuntime = join(
      environment.poolHome,
      "runtime",
      "work",
      "run-11111111-1111-4111-8111-111111111111",
    );
    mkdirSync(staleRuntime, { mode: 0o700, recursive: true });
    writeFileSync(join(staleRuntime, "auth.json"), AUTH_TEXT, { mode: 0o600 });
    const snapshot = await refreshAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
      query: async ({ codexHome }) => {
        assert.equal(existsSync(staleRuntime), false);
        assert.equal(readFileSync(join(codexHome, "auth.json"), "utf8"), AUTH_TEXT);
        writeFileSync(join(codexHome, "auth.json"), REFRESHED_AUTH_TEXT, { mode: 0o600 });
        return {
          email: "work@example.com",
          planType: "pro",
          primary: {
            usedPercent: 24,
            remainingPercent: 76,
            resetsAt: 1784949981,
            windowDurationMins: 10080,
          },
          secondary: null,
          usage: {
            lifetimeTokens: 15022720,
            peakDailyTokens: 15022720,
            currentStreakDays: 1,
            longestStreakDays: 1,
          },
          dailyUsageBuckets: [{ startDate: "2026-07-17", tokens: 15022720 }],
          usageStatus: "available",
          usageError: null,
          fetchedAt: "2026-07-18T12:00:00.000Z",
        };
      },
    });

    assert.equal(snapshot.planType, "pro");
    assert.equal(readFileSync(join(environment.poolHome, "accounts", "work", "auth.json"), "utf8"), REFRESHED_AUTH_TEXT);
    const account = listAccounts({ env: environment.env, userHome: environment.root })[0];
    assert.equal(account?.emailMasked, "wo***@example.com");
    assert.equal(account?.planType, "pro");
    assert.equal(account?.primaryQuota?.remainingPercent, 76);
    assert.equal(account?.lastRefreshedAt, "2026-07-18T12:00:00.000Z");
    assert.equal(account?.usageStatus, "available");
    assert.deepEqual(readdirSync(join(environment.poolHome, "runtime", "work")), []);
    assert.equal(existsSync(join(environment.poolHome, "pool.lock")), false);
  } finally {
    environment.cleanup();
  }
});

test("falls back to the stored ID token when app-server omits the email", async () => {
  const environment = createEnvironment();
  try {
    const payload = Buffer.from(
      JSON.stringify({ email: "token@example.com", email_verified: true }),
    ).toString("base64url");
    const authWithEmail = JSON.parse(AUTH_TEXT) as { tokens: Record<string, string> };
    authWithEmail.tokens.id_token = `header.${payload}.signature`;
    writeFileSync(
      join(environment.codexHome, "auth.json"),
      `${JSON.stringify(authWithEmail, null, 2)}\n`,
      { mode: 0o600 },
    );
    addCurrentAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      processList: () => "",
      loginStatus: () => true,
    });

    const snapshot = await refreshAccount({
      alias: "work",
      env: environment.env,
      userHome: environment.root,
      query: async () => ({
        email: null,
        planType: "plus",
        primary: null,
        secondary: null,
        usage: null,
        dailyUsageBuckets: null,
        usageStatus: "unavailable",
        usageError: "temporarily unavailable",
        fetchedAt: "2026-07-18T12:00:00.000Z",
      }),
    });

    assert.equal(snapshot.email, "token@example.com");
    const account = listAccounts({ env: environment.env, userHome: environment.root })[0];
    assert.equal(account?.email, "token@example.com");
  } finally {
    environment.cleanup();
  }
});
