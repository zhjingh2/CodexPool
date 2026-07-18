export type SwitchPhase = "prepared" | "auth-replaced" | "verified" | "active-updated" | "committed";
export interface SwitchJournal {
    schemaVersion: 1;
    transactionId: string;
    poolHome: string;
    codexHome: string;
    authPath: string;
    activeAccountPath: string;
    backupPath: string;
    transactionDirectory: string;
    previousAlias: string | null;
    targetAlias: string;
    targetFingerprint: string;
    phase: SwitchPhase;
    createdAt: string;
}
export declare function getSwitchJournalPath(poolHome: string): string;
export declare function writeSwitchJournal(journal: SwitchJournal): void;
export declare function readSwitchJournal(poolHome: string): SwitchJournal;
export declare function removeSwitchJournal(poolHome: string): void;
export declare function removeSwitchTransactionDirectory(path: string): void;
