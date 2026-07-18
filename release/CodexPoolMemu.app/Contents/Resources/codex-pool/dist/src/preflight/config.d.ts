export type CredentialStoreMode = "file" | "keyring" | "auto" | "unknown";
export declare function detectCredentialStoreMode(configText: string): CredentialStoreMode;
