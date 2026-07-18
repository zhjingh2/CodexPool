import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { queryAccountServer } from "../src/app-server/index.js";

test("keeps rate limits when account usage is temporarily unavailable", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-pool-app-server-test-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const executable = join(bin, "codex");
    writeFileSync(executable, `#!/usr/bin/env node
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 1) send({ jsonrpc: "2.0", id: 1, result: {} });
  if (message.id === 2) send({ jsonrpc: "2.0", id: 2, result: { account: { email: "work@example.com", planType: "plus" } } });
  if (message.id === 3) send({ jsonrpc: "2.0", id: 3, result: { rateLimits: { primary: { usedPercent: 39, resetsAt: 1784949981, windowDurationMins: 10080 }, secondary: null, planType: "plus" } } });
  if (message.id === 4) send({ jsonrpc: "2.0", id: 4, error: { code: -32000, message: "failed to fetch token usage profile" } });
});
`, { mode: 0o700 });
    chmodSync(executable, 0o700);

    const snapshot = await queryAccountServer({
      codexHome: root,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
      timeoutMs: 5_000,
    });

    assert.equal(snapshot.planType, "plus");
    assert.equal(snapshot.primary?.remainingPercent, 61);
    assert.equal(snapshot.usage, null);
    assert.equal(snapshot.dailyUsageBuckets, null);
    assert.equal(snapshot.usageStatus, "unavailable");
    assert.match(snapshot.usageError ?? "", /failed to fetch token usage profile/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("loads the account before requesting rate limits and retries a temporarily null account", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-pool-app-server-test-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const executable = join(bin, "codex");
    writeFileSync(executable, `#!/usr/bin/env node
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let accountReads = 0;
let accountLoaded = false;
let rateLimitsLoaded = false;
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 1) send({ jsonrpc: "2.0", id: 1, result: {} });
  if (message.method === "account/read") {
    accountReads += 1;
    if (accountReads === 1) {
      send({ jsonrpc: "2.0", id: message.id, result: { account: null, requiresOpenaiAuth: true } });
    } else {
      accountLoaded = true;
      send({ jsonrpc: "2.0", id: message.id, result: { account: { email: "work@example.com", planType: "plus" } } });
    }
  }
  if (message.id === 3) {
    if (!accountLoaded) process.exit(3);
    rateLimitsLoaded = true;
    send({ jsonrpc: "2.0", id: 3, result: { rateLimits: { primary: { usedPercent: 25 }, planType: "plus" } } });
  }
  if (message.id === 4) {
    if (!accountLoaded || !rateLimitsLoaded) process.exit(4);
    send({ jsonrpc: "2.0", id: 4, result: { summary: {}, dailyUsageBuckets: [] } });
  }
});

`, { mode: 0o700 });
    chmodSync(executable, 0o700);

    const snapshot = await queryAccountServer({
      codexHome: root,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
      timeoutMs: 5_000,
    });

    assert.equal(snapshot.email, "work@example.com");
    assert.equal(snapshot.planType, "plus");
    assert.equal(snapshot.primary?.remainingPercent, 75);
    assert.equal(snapshot.usageStatus, "available");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("retries a transient rate limits failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-pool-app-server-test-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const executable = join(bin, "codex");
    writeFileSync(executable, `#!/usr/bin/env node
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let rateLimitsReads = 0;
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 1) send({ jsonrpc: "2.0", id: 1, result: {} });
  if (message.id === 2) send({ jsonrpc: "2.0", id: 2, result: { account: { email: "work@example.com", planType: "plus" } } });
  if (message.id === 3) {
    rateLimitsReads += 1;
    if (rateLimitsReads === 1) {
      send({ jsonrpc: "2.0", id: 3, error: { code: -32000, message: "failed to fetch rate limits" } });
    } else {
      send({ jsonrpc: "2.0", id: 3, result: { rateLimits: { primary: { usedPercent: 17 }, planType: "plus" } } });
    }
  }
  if (message.id === 4) send({ jsonrpc: "2.0", id: 4, result: { summary: {}, dailyUsageBuckets: [] } });
});
`, { mode: 0o700 });
    chmodSync(executable, 0o700);

    const snapshot = await queryAccountServer({
      codexHome: root,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
      timeoutMs: 5_000,
    });

    assert.equal(snapshot.email, "work@example.com");
    assert.equal(snapshot.primary?.remainingPercent, 83);
    assert.equal(snapshot.usageStatus, "available");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
