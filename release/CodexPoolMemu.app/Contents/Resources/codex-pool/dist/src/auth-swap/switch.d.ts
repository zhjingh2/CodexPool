export interface SwitchAccountOptions {
    alias: string;
    launch?: boolean;
    env?: NodeJS.ProcessEnv;
    userHome?: string;
    now?: () => Date;
    processList?: () => string;
    loginStatus?: (codexHome: string, env: NodeJS.ProcessEnv) => boolean;
    launchApp?: (env: NodeJS.ProcessEnv) => boolean;
}
export interface SwitchAccountResult {
    alias: string;
    accountFingerprint: string;
    previousAlias: string | null;
}
export declare function recoverPendingSwitch(options: {
    poolHome: string;
    codexHome: string;
}): void;
export declare function switchAccount(options: SwitchAccountOptions): SwitchAccountResult;
