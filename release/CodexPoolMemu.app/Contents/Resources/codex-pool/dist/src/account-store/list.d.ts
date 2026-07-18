import type { AccountMetadata, AccountSummary } from "./types.js";
export interface ListAccountsOptions {
    env?: NodeJS.ProcessEnv;
    userHome?: string;
}
export declare function parseAccountMetadata(text: string, alias: string): AccountMetadata;
export declare function readAccountMetadata(accountDirectory: string, alias: string): AccountMetadata;
export declare function listAccounts(options?: ListAccountsOptions): AccountSummary[];
