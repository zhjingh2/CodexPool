import type { AccountMetadata } from "./types.js";
export interface ReconcileCurrentAccountOptions {
    poolHome: string;
    activeAlias: string | null;
    accounts: readonly Pick<AccountMetadata, "alias" | "accountFingerprint">[];
    env?: NodeJS.ProcessEnv;
    userHome?: string;
}
export type ReconcileCurrentAccountStatus = "matched" | "unknown" | "unavailable";
export interface ReconcileCurrentAccountResult {
    activeAlias: string | null;
    status: ReconcileCurrentAccountStatus;
    credentialsSynced: boolean;
}
/**
 * Reconciles the pool marker with the account currently present in global CODEX_HOME.
 * Unknown valid credentials are deliberately not imported; they clear the marker so
 * the UI cannot claim that a different saved account is active.
 */
export declare function reconcileCurrentAccount(options: ReconcileCurrentAccountOptions): ReconcileCurrentAccountResult;
