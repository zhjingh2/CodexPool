import type { ParsedAuthIdentity } from "./types.js";
export declare function extractAuthEmail(authText: string): string | null;
export declare function parseAuthIdentity(authText: string): ParsedAuthIdentity;
