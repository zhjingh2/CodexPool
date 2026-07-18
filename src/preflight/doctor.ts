import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, platform as currentPlatform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CommandResult, DoctorCheck, DoctorReport } from "../core/types.js";
import { redactSensitiveText } from "../security/redact.js";
import { detectCredentialStoreMode } from "./config.js";
import { summarizeCodexProcesses } from "./processes.js";

export interface DoctorDependencies {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: NodeJS.Platform;
  pathExists(path: string): boolean;
  readText(path: string): string;
  fileMode(path: string): number;
  run(command: string, args: string[], env?: NodeJS.ProcessEnv): CommandResult;
  makeTempDir(prefix: string): string;
  removeTree(path: string): void;
  listJsonFiles(path: string): string[];
  now(): Date;
}

function defaultRun(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    timeout: 15_000,
  });

  const commandResult: CommandResult = {
    status: result.status,
    stdout: redactSensitiveText(result.stdout ?? ""),
    stderr: redactSensitiveText(result.stderr ?? ""),
  };
  if (result.error) {
    commandResult.error = redactSensitiveText(result.error.message);
  }
  return commandResult;
}

function listJsonFilesRecursively(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonFilesRecursively(path));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(path);
    }
  }
  return files;
}

export function createDefaultDoctorDependencies(): DoctorDependencies {
  return {
    env: process.env,
    homeDir: homedir(),
    platform: currentPlatform(),
    pathExists: existsSync,
    readText: (path) => readFileSync(path, "utf8"),
    fileMode: (path) => statSync(path).mode & 0o777,
    run: defaultRun,
    makeTempDir: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
    removeTree: (path) => rmSync(path, { force: true, recursive: true }),
    listJsonFiles: listJsonFilesRecursively,
    now: () => new Date(),
  };
}

export function resolveCodexHome(env: NodeJS.ProcessEnv, homeDir: string): string {
  const configured = env.CODEX_HOME?.trim();
  return configured ? resolve(configured) : join(homeDir, ".codex");
}

export function formatFileMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

function checkAppServerSchema(
  dependencies: DoctorDependencies,
  codexEnv: NodeJS.ProcessEnv,
): DoctorCheck {
  const schemaDirectory = dependencies.makeTempDir("codex-pool-doctor-");
  try {
    const result = dependencies.run(
      "codex",
      ["app-server", "generate-json-schema", "--experimental", "--out", schemaDirectory],
      codexEnv,
    );
    if (result.status !== 0) {
      const reason = result.error ?? (result.stderr.trim() || "schema generation failed");
      return {
        id: "app-server-api",
        label: "App Server account API",
        status: "fail",
        summary: `不可用：${reason}`,
      };
    }

    const schemaText = dependencies
      .listJsonFiles(schemaDirectory)
      .map((path) => dependencies.readText(path))
      .join("\n");
    const requiredMethods = [
      "account/read",
      "account/rateLimits/read",
      "account/usage/read",
    ];
    const missing = requiredMethods.filter((method) => !schemaText.includes(method));
    if (missing.length > 0) {
      return {
        id: "app-server-api",
        label: "App Server account API",
        status: "fail",
        summary: `缺少接口：${missing.join(", ")}`,
      };
    }

    return {
      id: "app-server-api",
      label: "App Server account API",
      status: "pass",
      summary: "账号、限额和用量接口可用",
    };
  } finally {
    dependencies.removeTree(schemaDirectory);
  }
}

export function runDoctor(
  dependencies: DoctorDependencies = createDefaultDoctorDependencies(),
): DoctorReport {
  const checks: DoctorCheck[] = [];
  const codexHome = resolveCodexHome(dependencies.env, dependencies.homeDir);
  const authPath = join(codexHome, "auth.json");
  const configPath = join(codexHome, "config.toml");
  const journalPath = join(dependencies.homeDir, ".codex-pool", "switch-journal.json");
  const codexEnv = { ...dependencies.env, CODEX_HOME: codexHome };

  checks.push({
    id: "platform",
    label: "Platform",
    status: dependencies.platform === "darwin" ? "pass" : "fail",
    summary:
      dependencies.platform === "darwin"
        ? "macOS"
        : `当前为 ${dependencies.platform}，MVP 仅支持 macOS`,
  });

  const versionResult = dependencies.run("codex", ["--version"], codexEnv);
  const codexAvailable = versionResult.status === 0;
  checks.push({
    id: "codex-cli",
    label: "Codex CLI",
    status: codexAvailable ? "pass" : "fail",
    summary: codexAvailable
      ? versionResult.stdout.trim() || "已安装"
      : versionResult.error ?? (versionResult.stderr.trim() || "未找到 codex 命令"),
  });

  checks.push({
    id: "codex-home",
    label: "CODEX_HOME",
    status: dependencies.pathExists(codexHome) ? "pass" : "fail",
    summary: codexHome,
  });

  const authExists = dependencies.pathExists(authPath);
  checks.push({
    id: "credential-file",
    label: "Credential file",
    status: authExists ? "pass" : "fail",
    summary: authExists ? "auth.json 存在" : "auth.json 不存在",
  });

  if (authExists) {
    const mode = dependencies.fileMode(authPath);
    const modeText = formatFileMode(mode);
    const exposedToOtherUsers = (mode & 0o077) !== 0;
    checks.push({
      id: "credential-permissions",
      label: "Credential permissions",
      status: exposedToOtherUsers ? "fail" : mode === 0o600 ? "pass" : "warning",
      summary:
        mode === 0o600
          ? "600"
          : exposedToOtherUsers
            ? `${modeText}，凭证对组或其他用户可见`
            : `${modeText}，建议设置为 600`,
    });
  }

  const configText = dependencies.pathExists(configPath)
    ? dependencies.readText(configPath)
    : "";
  const credentialStoreMode = detectCredentialStoreMode(configText);
  checks.push({
    id: "credential-store",
    label: "Credential store",
    status:
      credentialStoreMode === "file"
        ? "pass"
        : credentialStoreMode === "keyring"
          ? "fail"
          : authExists
            ? "warning"
            : "fail",
    summary:
      credentialStoreMode === "file"
        ? "file（已显式配置）"
        : credentialStoreMode === "keyring"
          ? "keyring（MVP 暂不支持）"
          : credentialStoreMode === "auto"
            ? "auto；检测到 auth.json，但建议显式固定为 file"
            : authExists
              ? "未显式配置；检测到 auth.json，建议固定为 file"
              : "无法确认文件凭证模式",
  });

  if (codexAvailable && authExists) {
    const loginResult = dependencies.run("codex", ["login", "status"], codexEnv);
    checks.push({
      id: "login-status",
      label: "Login",
      status: loginResult.status === 0 ? "pass" : "fail",
      summary:
        loginResult.status === 0
          ? loginResult.stdout.trim() || "已登录"
          : loginResult.error ?? (loginResult.stderr.trim() || "登录状态不可用"),
    });
  }

  const processResult = dependencies.run(
    "ps",
    ["-axo", "pid=,ppid=,command="],
    dependencies.env,
  );
  if (processResult.status === 0) {
    const processSummary = summarizeCodexProcesses(processResult.stdout);
    const running = processSummary.desktopAppCount + processSummary.appServerCount > 0;
    checks.push({
      id: "running-processes",
      label: "Codex processes",
      status: running ? "warning" : "pass",
      summary: running
        ? `桌面 App ${processSummary.desktopAppCount} 个，app-server ${processSummary.appServerCount} 个；切换前必须退出`
        : "未检测到桌面 App 或 app-server",
    });
  } else {
    checks.push({
      id: "running-processes",
      label: "Codex processes",
      status: "warning",
      summary: "无法读取进程列表",
    });
  }

  if (codexAvailable) {
    checks.push(checkAppServerSchema(dependencies, codexEnv));
  }

  checks.push({
    id: "switch-journal",
    label: "Switch journal",
    status: dependencies.pathExists(journalPath) ? "warning" : "pass",
    summary: dependencies.pathExists(journalPath)
      ? "检测到未完成的 switch journal"
      : "无未完成切换",
  });

  return {
    ready: !checks.some((check) => check.status === "fail"),
    generatedAt: dependencies.now().toISOString(),
    checks,
  };
}
