#!/usr/bin/env node

import { AccountStoreError, addCurrentAccount } from "../account-store/index.js";
import { switchAccount } from "../auth-swap/index.js";
import { runDoctor } from "../preflight/doctor.js";
import { renderDoctorReport } from "../preflight/render.js";
import { loginAccount } from "../runtime/index.js";

const HELP = `Codex Pool

Usage:
  codex-pool doctor [--json]
  codex-pool account add <alias> [--json]
  codex-pool account login <alias>
  codex-pool switch <alias>
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
    if ((action !== "add" && action !== "login") || !alias) {
      process.stderr.write(
        "Usage: codex-pool account add <alias> [--json]\n" +
          "       codex-pool account login <alias>\n",
      );
      return 2;
    }
    if (action === "login") {
      if (accountOptions.length > 0) {
        process.stderr.write("account login 不接受额外参数\n");
        return 2;
      }
      try {
        const result = loginAccount({ alias });
        process.stdout.write(`已将新登录的 Codex 账号保存为 ${result.alias}。\n`);
        return 0;
      } catch (error) {
        if (error instanceof AccountStoreError) {
          process.stderr.write(`账号登录失败：${error.message}\n`);
          return 1;
        }
        process.stderr.write("账号登录失败：发生未预期错误，当前账号保持不变。\n");
        return 1;
      }
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

  if (command === "switch") {
    const [alias, ...switchOptions] = options;
    if (!alias || switchOptions.length > 0) {
      process.stderr.write("Usage: codex-pool switch <alias>\n");
      return 2;
    }
    try {
      const result = switchAccount({ alias });
      const previous = result.previousAlias ? `（原账号：${result.previousAlias}）` : "";
      process.stdout.write(`已切换到 Codex 账号 ${result.alias}${previous}。\n`);
      return 0;
    } catch (error) {
      if (error instanceof AccountStoreError) {
        process.stderr.write(`账号切换失败：${error.message}\n`);
        return 1;
      }
      process.stderr.write("账号切换失败：发生未预期错误，当前账号可能未改变。\n");
      return 1;
    }
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
