import type { CommandResult, DoctorReport } from "../core/types.js";
export interface DoctorDependencies {
    env: NodeJS.ProcessEnv;
    homeDir: string;
    platform: NodeJS.Platform;
    pathExists(path: string): boolean;
    readText(path: string): string;
    fileMode(path: string): number;
    run(command: string, args: string[], env?: NodeJS.ProcessEnv): CommandResult;
    makeTempDir(prefix: string): string;
    removeTree(path: string): void;
    listJsonFiles(path: string): string[];
    now(): Date;
}
export declare function createDefaultDoctorDependencies(): DoctorDependencies;
export declare function resolveCodexHome(env: NodeJS.ProcessEnv, homeDir: string): string;
export declare function formatFileMode(mode: number): string;
export declare function runDoctor(dependencies?: DoctorDependencies): DoctorReport;
