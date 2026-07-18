import { spawn } from "node:child_process";
import { AccountStoreError } from "../account-store/errors.js";
import { redactSensitiveText } from "../security/redact.js";

export interface RateLimitWindow {
  usedPercent: number;
  remainingPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
}

export interface AccountUsageSummary {
  lifetimeTokens: number | null;
  peakDailyTokens: number | null;
  currentStreakDays: number | null;
  longestStreakDays: number | null;
}

export interface AccountUsageBucket {
  startDate: string;
  tokens: number;
}

export interface AccountSnapshot {
  email: string | null;
  planType: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  usage: AccountUsageSummary | null;
  dailyUsageBuckets: AccountUsageBucket[] | null;
  usageStatus: "available" | "unavailable";
  usageError: string | null;
  fetchedAt: string;
}

interface JsonRpcMessage {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

export interface AccountServerOptions {
  codexHome: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  run?: (options: AccountServerOptions) => Promise<AccountSnapshot>;
}

function parseWindow(value: unknown): RateLimitWindow | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const window = value as {
    usedPercent?: unknown;
    resetsAt?: unknown;
    windowDurationMins?: unknown;
  };
  if (typeof window.usedPercent !== "number") {
    return null;
  }
  const usedPercent = Math.max(0, Math.min(100, Math.round(window.usedPercent)));
  return {
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt: typeof window.resetsAt === "number" ? window.resetsAt : null,
    windowDurationMins:
      typeof window.windowDurationMins === "number" ? window.windowDurationMins : null,
  };
}

function parseAccountResponse(value: unknown): { email: string | null; planType: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { email: null, planType: null };
  }
  const response = value as { account?: unknown };
  if (!response.account || typeof response.account !== "object") {
    return { email: null, planType: null };
  }
  const account = response.account as { email?: unknown; planType?: unknown };
  return {
    email: typeof account.email === "string" ? account.email : null,
    planType: typeof account.planType === "string" ? account.planType : null,
  };
}

function hasAccountResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const response = value as { account?: unknown };
  return Boolean(response.account && typeof response.account === "object");
}

function parseRateLimitsResponse(value: unknown): {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  planType: string | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { primary: null, secondary: null, planType: null };
  }
  const response = value as { rateLimits?: unknown };
  const rateLimits = response.rateLimits as {
    primary?: unknown;
    secondary?: unknown;
    planType?: unknown;
  } | undefined;
  return {
    primary: parseWindow(rateLimits?.primary),
    secondary: parseWindow(rateLimits?.secondary),
    planType: typeof rateLimits?.planType === "string" ? rateLimits.planType : null,
  };
}

function parseUsageResponse(value: unknown): {
  usage: AccountUsageSummary | null;
  dailyUsageBuckets: AccountUsageBucket[] | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { usage: null, dailyUsageBuckets: null };
  }
  const response = value as {
    summary?: Record<string, unknown>;
    dailyUsageBuckets?: unknown;
  };
  const summary = response.summary;
  const numberOrNull = (key: string): number | null =>
    typeof summary?.[key] === "number" ? (summary[key] as number) : null;
  const usage = summary
    ? {
        lifetimeTokens: numberOrNull("lifetimeTokens"),
        peakDailyTokens: numberOrNull("peakDailyTokens"),
        currentStreakDays: numberOrNull("currentStreakDays"),
        longestStreakDays: numberOrNull("longestStreakDays"),
      }
    : null;
  const buckets = Array.isArray(response.dailyUsageBuckets)
    ? response.dailyUsageBuckets.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const bucket = item as { startDate?: unknown; tokens?: unknown };
        return typeof bucket.startDate === "string" && typeof bucket.tokens === "number"
          ? [{ startDate: bucket.startDate, tokens: bucket.tokens }]
          : [];
      })
    : null;
  return { usage, dailyUsageBuckets: buckets };
}

function rpcError(message: JsonRpcMessage, method: string): AccountStoreError {
  return new AccountStoreError(
    "APP_SERVER_REQUEST_FAILED",
    `${method} 请求失败：${message.error?.message ?? "未知 app-server 错误"}`,
  );
}

export async function queryAccountServer(options: AccountServerOptions): Promise<AccountSnapshot> {
  if (options.run) {
    return options.run(options);
  }
  const timeoutMs = options.timeoutMs ?? 20_000;
  return await new Promise<AccountSnapshot>((resolve, reject) => {
    const child = spawn("codex", ["app-server", "--stdio"], {
      env: { ...options.env, CODEX_HOME: options.codexHome },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const responses = new Map<number, unknown>();
    let buffer = "";
    let settled = false;
    let usageError: string | null = null;
    let usageGraceTimer: NodeJS.Timeout | undefined;
    let accountRetryTimer: NodeJS.Timeout | undefined;
    let rateLimitsRetryTimer: NodeJS.Timeout | undefined;
    let rateLimitsRequestSent = false;
    let rateLimitsAttempts = 0;
    let usageRequestSent = false;
    const timer = setTimeout(() => {
      finish(new AccountStoreError("APP_SERVER_TIMEOUT", "app-server 查询超时"));
    }, timeoutMs);

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (usageGraceTimer) clearTimeout(usageGraceTimer);
      if (accountRetryTimer) clearTimeout(accountRetryTimer);
      if (rateLimitsRetryTimer) clearTimeout(rateLimitsRetryTimer);
      child.kill("SIGTERM");
      if (error) {
        reject(error);
        return;
      }
      const account = parseAccountResponse(responses.get(2));
      const limits = parseRateLimitsResponse(responses.get(3));
      const usage = parseUsageResponse(responses.get(4));
      resolve({
        email: account.email,
        planType: account.planType ?? limits.planType,
        primary: limits.primary,
        secondary: limits.secondary,
        usage: usage.usage,
        dailyUsageBuckets: usage.dailyUsageBuckets,
        usageStatus: usageError === null ? "available" : "unavailable",
        usageError,
        fetchedAt: new Date().toISOString(),
      });
    };

    const sendRequest = (id: number, method: string, params: object): void => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    };

    const sendRateLimitsRequest = (): void => {
      if (rateLimitsRequestSent || settled) return;
      rateLimitsRequestSent = true;
      rateLimitsAttempts += 1;
      sendRequest(3, "account/rateLimits/read", {});
    };

    const sendUsageRequest = (): void => {
      if (usageRequestSent || settled) return;
      usageRequestSent = true;
      sendRequest(4, "account/usage/read", {});
    };

    const handleAccountResponse = (message: JsonRpcMessage): void => {
      if (message.error) {
        finish(rpcError(message, "account/read"));
        return;
      }
      responses.set(2, message.result);
      if (hasAccountResponse(message.result) || message.id === 5) {
        sendRateLimitsRequest();
        return;
      }
      accountRetryTimer = setTimeout(() => {
        accountRetryTimer = undefined;
        sendRequest(5, "account/read", { refreshToken: true });
      }, Math.min(150, timeoutMs));
    };

    child.on("error", (error) => finish(new AccountStoreError("APP_SERVER_UNAVAILABLE", error.message)));
    child.on("exit", (code) => {
      if (settled) return;
      if (responses.has(2) && responses.has(3)) {
        usageError ??= "account/usage/read 未返回结果";
        responses.set(4, null);
        finish();
      } else {
        finish(new AccountStoreError("APP_SERVER_EXITED", `app-server 异常退出（${code ?? "未知状态"}）`));
      }
    });
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
        if (!line) continue;
        let message: JsonRpcMessage;
        try {
          message = JSON.parse(line) as JsonRpcMessage;
        } catch {
          finish(new AccountStoreError("APP_SERVER_PROTOCOL_ERROR", "app-server 返回了无效 JSON"));
          return;
        }
        if (message.id === undefined) continue;
        if (message.id === 2 || message.id === 5) {
          handleAccountResponse(message);
        } else if (message.error) {
          if (message.id === 4) {
            usageError = redactSensitiveText(
              message.error.message ?? "未知 app-server 错误",
            );
            responses.set(4, null);
          } else if (message.id === 3 && rateLimitsAttempts < 3) {
            // 限时网络/后端失败时重试，避免一次短暂错误导致整个面板刷新失败。
            rateLimitsRequestSent = false;
            rateLimitsRetryTimer = setTimeout(() => {
              rateLimitsRetryTimer = undefined;
              sendRateLimitsRequest();
            }, Math.min(250 * rateLimitsAttempts, timeoutMs));
          } else {
            finish(rpcError(message, message.id === 2 ? "account/read" : message.id === 3 ? "account/rateLimits/read" : "initialize"));
            return;
          }
        } else {
          responses.set(message.id, message.result);
        }
        if (message.id === 3 && !message.error) {
          sendUsageRequest();
        }
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
          sendRequest(2, "account/read", { refreshToken: true });
        }
        if (responses.has(2) && responses.has(3) && responses.has(4)) {
          finish();
          return;
        }
        if (responses.has(2) && responses.has(3) && !usageGraceTimer) {
          usageGraceTimer = setTimeout(() => {
            usageError = "account/usage/read 暂时不可用";
            responses.set(4, null);
            finish();
          }, Math.min(3_000, timeoutMs));
        }
      }
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "codex-pool", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      },
    })}\n`);
  });
}
