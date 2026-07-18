import type { AddAccountResult } from "../account-store/types.js";
export interface LoginAccountOptions {
    alias: string;
    env?: NodeJS.ProcessEnv;
    userHome?: string;
    now?: () => Date;
    runLogin?: (env: NodeJS.ProcessEnv) => number | null;
}
export declare function loginAccount(options: LoginAccountOptions): AddAccountResult;
