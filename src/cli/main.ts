#!/usr/bin/env node

import {
  AccountStoreError,
  addCurrentAccount,
  listAccounts,
  purgeAccount,
  renameAccount,
} from "../account-store/index.js";
import { switchAccount } from "../auth-swap/index.js";
import { runDoctor } from "../preflight/doctor.js";
import { renderDoctorReport } from "../preflight/render.js";
import { loginAccount } from "../runtime/index.js";
import { refreshAccount } from "../usage/index.js";
import { createInterface } from "node:readline/promises";
import { stdin as standardInput, stdout as standardOutput } from "node:process";

const HELP = `Codex Pool

Usage:
  codex-pool doctor [--json]
  codex-pool account add <alias> [--json]
  codex-pool account login <alias>
  codex-pool account list [--refresh] [--json]
  codex-pool account rename <from> <to>
  codex-pool account purge <alias>
  codex-pool switch <alias> [--launch]
  codex-pool --help
  codex-pool --version
`;

function renderAccounts(accounts: ReturnType<typeof listAccounts>, json: boolean): string {
  if (json) {
    return `${JSON.stringify(accounts, null, 2)}\n`;
  }
  if (accounts.length === 0) {
    return "账号池为空，请先使用 account add 或 account login。\n";
  }
  const lines = ["别名\t套餐\t状态\t凭证\t当前\t短期额度\t短期重置"];
  for (const account of accounts) {
    const plan = account.planType ?? "未查询";
    const status = account.credentialStatus === "ok" ? "可用" : "异常";
    const credential = account.credentialStatus === "ok" ? "正常" : account.credentialMessage ?? "需检查";
    const quota = account.primaryQuota
      ? `剩余 ${account.primaryQuota.remainingPercent}%`
      : "未查询";
    const reset = account.primaryQuota?.resetsAt
      ? new Date(account.primaryQuota.resetsAt * 1000).toLocaleString()
      : "未查询";
    lines.push(
      `${account.alias}\t${plan}\t${status}\t${credential}\t${account.current ? "✓" : "-"}\t${quota}\t${reset}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main(args: string[]): Promise<number> {
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
    if (action === "list") {
      const listOptions = (alias ? [alias, ...accountOptions] : accountOptions);
      const unknownOption = listOptions.find(
        (option) => option !== "--json" && option !== "--refresh",
      );
      if (unknownOption) {
        process.stderr.write(`Unknown option: ${unknownOption}\n`);
        return 2;
      }
      try {
        const json = listOptions.includes("--json");
        const refresh = listOptions.includes("--refresh");
        let refreshFailed = false;
        if (refresh) {
          for (const account of listAccounts()) {
            try {
              await refreshAccount({ alias: account.alias });
            } catch (error) {
              refreshFailed = true;
              const message = error instanceof Error ? error.message : "未知错误";
              process.stderr.write(`账号 ${account.alias} 刷新失败：${message}\n`);
            }
          }
        }
        process.stdout.write(renderAccounts(listAccounts(), json));
        return refreshFailed ? 1 : 0;
      } catch (error) {
        if (error instanceof AccountStoreError) {
          process.stderr.write(`账号列表读取失败：${error.message}\n`);
          return 1;
        }
        process.stderr.write("账号列表读取失败：发生未预期错误。\n");
        return 1;
      }
    }
    if (action === "rename") {
      const to = accountOptions[0];
      if (!alias || !to || accountOptions.length > 1) {
        process.stderr.write("Usage: codex-pool account rename <from> <to>\n");
        return 2;
      }
      try {
        const result = renameAccount({ from: alias, to });
        process.stdout.write(`已将账号 ${result.from} 重命名为 ${result.to}。\n`);
        return 0;
      } catch (error) {
        if (error instanceof AccountStoreError) {
          process.stderr.write(`账号重命名失败：${error.message}\n`);
          return 1;
        }
        process.stderr.write("账号重命名失败：发生未预期错误。\n");
        return 1;
      }
    }
    if (action === "purge") {
      if (!alias) {
        process.stderr.write("Usage: codex-pool account purge <alias>\n");
        return 2;
      }
      let confirmation: string | undefined;
      if (accountOptions.length === 2 && accountOptions[0] === "--confirm") {
        confirmation = accountOptions[1];
      } else if (accountOptions.length > 0) {
        process.stderr.write("Usage: codex-pool account purge <alias> [--confirm <alias>]\n");
        return 2;
      } else if (standardInput.isTTY && standardOutput.isTTY) {
        const prompt = createInterface({ input: standardInput, output: standardOutput });
        confirmation = await prompt.question(`永久删除账号 ${alias}？请输入账号别名确认：`);
        prompt.close();
      }
      try {
        const result = purgeAccount({
          alias,
          ...(confirmation === undefined ? {} : { confirmation }),
        });
        process.stdout.write(`已永久删除账号 ${result.alias} 的本地凭证、元数据和用量缓存。\n`);
        return 0;
      } catch (error) {
        if (error instanceof AccountStoreError) {
          process.stderr.write(`账号 purge 失败：${error.message}\n`);
          return 1;
        }
        process.stderr.write("账号 purge 失败：发生未预期错误，未完成删除。\n");
        return 1;
      }
    }
    if ((action !== "add" && action !== "login") || !alias) {
      process.stderr.write(
        "Usage: codex-pool account add <alias> [--json]\n" +
          "       codex-pool account login <alias>\n" +
          "       codex-pool account list [--refresh] [--json]\n" +
          "       codex-pool account rename <from> <to>\n" +
          "       codex-pool account purge <alias>\n",
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
    if (!alias || switchOptions.length > 1 || switchOptions.some((option) => option !== "--launch")) {
      process.stderr.write("Usage: codex-pool switch <alias> [--launch]\n");
      return 2;
    }
    try {
      const result = switchAccount({ alias, ...(switchOptions.includes("--launch") ? { launch: true } : {}) });
      const previous = result.previousAlias ? `（原账号：${result.previousAlias}）` : "";
      process.stdout.write(`已切换到 Codex 账号 ${result.alias}${previous}。\n`);
      return 0;
    } catch (error) {
      if (error instanceof AccountStoreError) {
        process.stderr.write(
          error.code === "APP_LAUNCH_FAILED"
            ? `账号切换完成，但 Codex App 启动失败：${error.message}\n`
            : `账号切换失败：${error.message}\n`,
        );
        return 1;
      }
      process.stderr.write("账号切换失败：发生未预期错误，当前账号可能未改变。\n");
      return 1;
    }
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  return 2;
}

void main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
