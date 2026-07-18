#!/usr/bin/env node

import { AccountStoreError, addCurrentAccount } from "../account-store/index.js";
import { runDoctor } from "../preflight/doctor.js";
import { renderDoctorReport } from "../preflight/render.js";

const HELP = `Codex Pool

Usage:
  codex-pool doctor [--json]
  codex-pool account add <alias> [--json]
  codex-pool --help
  codex-pool --version
`;

function main(args: string[]): number {
  const [command, ...options] = args;

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  if (command === "--version" || command === "-V") {
    process.stdout.write("0.1.0\n");
    return 0;
  }

  if (command === "doctor") {
    const unknownOption = options.find((option) => option !== "--json");
    if (unknownOption) {
      process.stderr.write(`Unknown option: ${unknownOption}\n`);
      return 2;
    }

    const report = runDoctor();
    process.stdout.write(
      options.includes("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${renderDoctorReport(report)}\n`,
    );
    return report.ready ? 0 : 1;
  }

  if (command === "account") {
    const [action, alias, ...accountOptions] = options;
    if (action !== "add" || !alias) {
      process.stderr.write("Usage: codex-pool account add <alias> [--json]\n");
      return 2;
    }
    const unknownOption = accountOptions.find((option) => option !== "--json");
    if (unknownOption) {
      process.stderr.write(`Unknown option: ${unknownOption}\n`);
      return 2;
    }

    try {
      const result = addCurrentAccount({ alias });
      process.stdout.write(
        accountOptions.includes("--json")
          ? `${JSON.stringify(result, null, 2)}\n`
          : `已将当前 Codex 账号保存为 ${result.alias}。\n`,
      );
      return 0;
    } catch (error) {
      if (error instanceof AccountStoreError) {
        process.stderr.write(`账号导入失败：${error.message}\n`);
        return 1;
      }
      process.stderr.write("账号导入失败：发生未预期错误，未写入账号凭证。\n");
      return 1;
    }
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
