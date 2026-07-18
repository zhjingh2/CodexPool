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
export interface AccountServerOptions {
    codexHome: string;
    env: NodeJS.ProcessEnv;
    timeoutMs?: number;
    run?: (options: AccountServerOptions) => Promise<AccountSnapshot>;
}
export declare function queryAccountServer(options: AccountServerOptions): Promise<AccountSnapshot>;
