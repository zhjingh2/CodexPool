import { spawn } from "node:child_process";
import { AccountStoreError } from "../account-store/errors.js";
import { redactSensitiveText } from "../security/redact.js";
function parseWindow(value) {
    if (!value || typeof value !== "object") {
        return null;
    }
    const window = value;
    if (typeof window.usedPercent !== "number") {
        return null;
    }
    const usedPercent = Math.max(0, Math.min(100, Math.round(window.usedPercent)));
    return {
        usedPercent,
        remainingPercent: 100 - usedPercent,
        resetsAt: typeof window.resetsAt === "number" ? window.resetsAt : null,
        windowDurationMins: typeof window.windowDurationMins === "number" ? window.windowDurationMins : null,
    };
}
function parseAccountResponse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { email: null, planType: null };
    }
    const response = value;
    if (!response.account || typeof response.account !== "object") {
        return { email: null, planType: null };
    }
    const account = response.account;
    return {
        email: typeof account.email === "string" ? account.email : null,
        planType: typeof account.planType === "string" ? account.planType : null,
    };
}
function hasAccountResponse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const response = value;
    return Boolean(response.account && typeof response.account === "object");
}
function parseRateLimitsResponse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { primary: null, secondary: null, planType: null };
    }
    const response = value;
    const rateLimits = response.rateLimits;
    return {
        primary: parseWindow(rateLimits?.primary),
        secondary: parseWindow(rateLimits?.secondary),
        planType: typeof rateLimits?.planType === "string" ? rateLimits.planType : null,
    };
}
function parseUsageResponse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { usage: null, dailyUsageBuckets: null };
    }
    const response = value;
    const summary = response.summary;
    const numberOrNull = (key) => typeof summary?.[key] === "number" ? summary[key] : null;
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
            if (!item || typeof item !== "object")
                return [];
            const bucket = item;
            return typeof bucket.startDate === "string" && typeof bucket.tokens === "number"
                ? [{ startDate: bucket.startDate, tokens: bucket.tokens }]
                : [];
        })
        : null;
    return { usage, dailyUsageBuckets: buckets };
}
function rpcError(message, method) {
    return new AccountStoreError("APP_SERVER_REQUEST_FAILED", `${method} 请求失败：${message.error?.message ?? "未知 app-server 错误"}`);
}
export async function queryAccountServer(options) {
    if (options.run) {
        return options.run(options);
    }
    const timeoutMs = options.timeoutMs ?? 20_000;
    return await new Promise((resolve, reject) => {
        const child = spawn("codex", ["app-server", "--stdio"], {
            env: { ...options.env, CODEX_HOME: options.codexHome },
            stdio: ["pipe", "pipe", "pipe"],
        });
        const responses = new Map();
        let buffer = "";
        let settled = false;
        let usageError = null;
        let usageGraceTimer;
        let accountRetryTimer;
        let rateLimitsRetryTimer;
        let terminationTimer;
        let forcedCompletionTimer;
        let rateLimitsRequestSent = false;
        let rateLimitsAttempts = 0;
        let usageRequestSent = false;
        const timer = setTimeout(() => {
            finish(new AccountStoreError("APP_SERVER_TIMEOUT", "app-server 查询超时"));
        }, timeoutMs);
        const finish = (error, waitForClose = true) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (usageGraceTimer)
                clearTimeout(usageGraceTimer);
            if (accountRetryTimer)
                clearTimeout(accountRetryTimer);
            if (rateLimitsRetryTimer)
                clearTimeout(rateLimitsRetryTimer);
            child.stdin.end();
            let completed = false;
            const complete = () => {
                if (completed)
                    return;
                completed = true;
                if (terminationTimer)
                    clearTimeout(terminationTimer);
                if (forcedCompletionTimer)
                    clearTimeout(forcedCompletionTimer);
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
            if (!waitForClose || child.exitCode !== null || child.signalCode !== null) {
                complete();
                return;
            }
            child.once("close", complete);
            child.kill("SIGTERM");
            terminationTimer = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                    child.kill("SIGKILL");
                    forcedCompletionTimer = setTimeout(complete, 500);
                    forcedCompletionTimer.unref();
                }
            }, 1_000);
            terminationTimer.unref();
        };
        const sendRequest = (id, method, params) => {
            child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        };
        const sendRateLimitsRequest = () => {
            if (rateLimitsRequestSent || settled)
                return;
            rateLimitsRequestSent = true;
            rateLimitsAttempts += 1;
            sendRequest(3, "account/rateLimits/read", {});
        };
        const sendUsageRequest = () => {
            if (usageRequestSent || settled)
                return;
            usageRequestSent = true;
            sendRequest(4, "account/usage/read", {});
        };
        const handleAccountResponse = (message) => {
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
        child.on("error", (error) => finish(new AccountStoreError("APP_SERVER_UNAVAILABLE", error.message), false));
        child.on("exit", (code) => {
            if (settled)
                return;
            if (responses.has(2) && responses.has(3)) {
                usageError ??= "account/usage/read 未返回结果";
                responses.set(4, null);
                finish();
            }
            else {
                finish(new AccountStoreError("APP_SERVER_EXITED", `app-server 异常退出（${code ?? "未知状态"}）`));
            }
        });
        child.stdout.on("data", (chunk) => {
            buffer += chunk.toString("utf8");
            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex >= 0) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);
                newlineIndex = buffer.indexOf("\n");
                if (!line)
                    continue;
                let message;
                try {
                    message = JSON.parse(line);
                }
                catch {
                    finish(new AccountStoreError("APP_SERVER_PROTOCOL_ERROR", "app-server 返回了无效 JSON"));
                    return;
                }
                if (message.id === undefined)
                    continue;
                if (message.id === 2 || message.id === 5) {
                    handleAccountResponse(message);
                }
                else if (message.error) {
                    if (message.id === 4) {
                        usageError = redactSensitiveText(message.error.message ?? "未知 app-server 错误");
                        responses.set(4, null);
                    }
                    else if (message.id === 3 && rateLimitsAttempts < 3) {
                        // 限时网络/后端失败时重试，避免一次短暂错误导致整个面板刷新失败。
                        rateLimitsRequestSent = false;
                        rateLimitsRetryTimer = setTimeout(() => {
                            rateLimitsRetryTimer = undefined;
                            sendRateLimitsRequest();
                        }, Math.min(250 * rateLimitsAttempts, timeoutMs));
                    }
                    else {
                        finish(rpcError(message, message.id === 2 ? "account/read" : message.id === 3 ? "account/rateLimits/read" : "initialize"));
                        return;
                    }
                }
                else {
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
//# sourceMappingURL=index.js.map