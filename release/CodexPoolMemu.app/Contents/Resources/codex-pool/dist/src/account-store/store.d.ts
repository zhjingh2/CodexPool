import type { AddAccountResult } from "./types.js";
export interface AddCurrentAccountOptions {
    alias: string;
    env?: NodeJS.ProcessEnv;
    userHome?: string;
    now?: () => Date;
    processList?: () => string;
    loginStatus?: (codexHome: string, env: NodeJS.ProcessEnv) => boolean;
}
export interface ImportAccountOptions {
    alias: string;
    authHome: string;
    poolHome: string;
    now?: () => Date;
    setActiveAccount?: boolean;
}
export declare function addCurrentAccount(options: AddCurrentAccountOptions): AddAccountResult;
export declare function importAccountFromHome(options: ImportAccountOptions): AddAccountResult;
