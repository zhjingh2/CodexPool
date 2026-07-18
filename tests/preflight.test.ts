import assert from "node:assert/strict";
import test from "node:test";
import { detectCredentialStoreMode } from "../src/preflight/config.js";
import {
  formatFileMode,
  resolveCodexHome,
  runDoctor,
  type DoctorDependencies,
} from "../src/preflight/doctor.js";
import { summarizeCodexProcesses } from "../src/preflight/processes.js";
import { redactSensitiveText } from "../src/security/redact.js";

test("resolves CODEX_HOME and defaults to ~/.codex", () => {
  assert.equal(
    resolveCodexHome({}, "/Users/example"),
    "/Users/example/.codex",
  );
  assert.equal(
    resolveCodexHome({ CODEX_HOME: "/tmp/codex-a" }, "/Users/example"),
    "/tmp/codex-a",
  );
});

test("detects explicit credential store modes without parsing secrets", () => {
  assert.equal(
    detectCredentialStoreMode('cli_auth_credentials_store = "file"'),
    "file",
  );
  assert.equal(
    detectCredentialStoreMode("cli_auth_credentials_store = 'keyring'"),
    "keyring",
  );
  assert.equal(detectCredentialStoreMode("# cli_auth_credentials_store = 'file'"), "unknown");
});

test("formats credential file permissions", () => {
  assert.equal(formatFileMode(0o600), "600");
  assert.equal(formatFileMode(0o644), "644");
});

test("summarizes Codex processes without exposing command lines", () => {
  const summary = summarizeCodexProcesses(
    [
      "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      "/Applications/ChatGPT.app/Contents/Resources/codex app-server",
      "unrelated process",
    ].join("\n"),
  );
  assert.deepEqual(summary, { desktopAppCount: 1, appServerCount: 1 });
});

test("redacts credential-like values", () => {
  const redacted = redactSensitiveText(
    "access_token=secret-value Authorization: Bearer abc123 eyJheader.payload.signature",
  );
  assert.equal(redacted.includes("secret-value"), false);
  assert.equal(redacted.includes("abc123"), false);
  assert.equal(redacted.includes("eyJheader.payload.signature"), false);
  assert.match(redacted, /<REDACTED>/u);
});

test("doctor can run entirely against injected fake dependencies", () => {
  const schemaPath = "/tmp/fake-schema.json";
  const dependencies: DoctorDependencies = {
    env: {},
    homeDir: "/Users/example",
    platform: "darwin",
    pathExists: (path) =>
      path === "/Users/example/.codex" ||
      path === "/Users/example/.codex/auth.json" ||
      path === "/Users/example/.codex/config.toml",
    readText: (path) =>
      path === schemaPath
        ? "account/read account/rateLimits/read account/usage/read"
        : path === "/Users/example/.codex/config.toml"
          ? 'cli_auth_credentials_store = "file"\n'
          : "",
    fileMode: () => 0o600,
    run: (command, args) => {
      if (command === "codex" && args[0] === "--version") {
        return { status: 0, stdout: "codex-cli 0.144.5\n", stderr: "" };
      }
      if (command === "codex" && args[0] === "login") {
        return { status: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
      }
      if (command === "ps") {
        return { status: 0, stdout: "unrelated process\n", stderr: "" };
      }
      if (command === "codex" && args[0] === "app-server") {
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected command" };
    },
    makeTempDir: () => "/tmp/fake-schema-dir",
    removeTree: () => undefined,
    listJsonFiles: () => [schemaPath],
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  };

  const report = runDoctor(dependencies);
  assert.equal(report.ready, true);
  assert.equal(report.checks.find((check) => check.id === "app-server-api")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "credential-store")?.status, "pass");
});
