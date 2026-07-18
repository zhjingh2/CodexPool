export declare function ensurePrivateDirectory(path: string): void;
export declare function assertRegularPrivateSourceFile(path: string): void;
export declare function writePrivateFileAtomically(path: string, content: string | Buffer): void;
export declare function acquirePoolLock(poolHome: string): () => void;
