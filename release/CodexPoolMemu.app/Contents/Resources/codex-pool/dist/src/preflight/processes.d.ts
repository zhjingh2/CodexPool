export interface CodexProcessSummary {
    desktopAppCount: number;
    appServerCount: number;
}
export declare function summarizeCodexProcesses(processList: string): CodexProcessSummary;
