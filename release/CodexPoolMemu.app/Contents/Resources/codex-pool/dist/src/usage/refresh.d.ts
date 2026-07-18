import { type AccountServerOptions, type AccountSnapshot } from "../app-server/index.js";
export interface RefreshAccountOptions {
    alias: string;
    env?: NodeJS.ProcessEnv;
    userHome?: string;
    now?: () => Date;
    query?: (options: AccountServerOptions) => Promise<AccountSnapshot>;
}
export declare function refreshAccount(options: RefreshAccountOptions): Promise<AccountSnapshot>;
