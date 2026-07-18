export interface RenameAccountOptions {
    from: string;
    to: string;
    env?: NodeJS.ProcessEnv;
    userHome?: string;
}
export interface RenameAccountResult {
    from: string;
    to: string;
    accountFingerprint: string;
    current: boolean;
}
export interface PurgeAccountOptions {
    alias: string;
    /** 必须与账号别名完全一致，避免误删。 */
    confirmation?: string;
    env?: NodeJS.ProcessEnv;
    userHome?: string;
}
export interface PurgeAccountResult {
    alias: string;
    accountFingerprint: string;
    current: false;
}
export declare function renameAccount(options: RenameAccountOptions): RenameAccountResult;
export declare function purgeAccount(options: PurgeAccountOptions): PurgeAccountResult;
