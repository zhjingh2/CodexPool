import { createHash } from "node:crypto";
import { AccountStoreError } from "./errors.js";
export function extractAuthEmail(authText) {
    try {
        const document = JSON.parse(authText);
        if (!document.tokens || typeof document.tokens !== "object" || Array.isArray(document.tokens)) {
            return null;
        }
        const idToken = document.tokens.id_token;
        if (typeof idToken !== "string")
            return null;
        const payloadPart = idToken.split(".")[1];
        if (!payloadPart)
            return null;
        const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
        if (typeof payload.email !== "string" || !payload.email.includes("@"))
            return null;
        if (payload.email_verified === false)
            return null;
        return payload.email;
    }
    catch {
        return null;
    }
}
export function parseAuthIdentity(authText) {
    let document;
    try {
        const parsed = JSON.parse(authText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("not an object");
        }
        document = parsed;
    }
    catch {
        throw new AccountStoreError("INVALID_AUTH_FILE", "auth.json 不是有效的 JSON 对象");
    }
    const authMode = document.auth_mode;
    if (typeof authMode !== "string" || authMode.trim().length === 0) {
        throw new AccountStoreError("INVALID_AUTH_FILE", "auth.json 缺少有效的 auth_mode");
    }
    if (!document.tokens || typeof document.tokens !== "object" || Array.isArray(document.tokens)) {
        throw new AccountStoreError("INVALID_AUTH_FILE", "auth.json 缺少 tokens 对象");
    }
    const tokens = document.tokens;
    if (typeof tokens.account_id !== "string" || tokens.account_id.trim().length === 0) {
        throw new AccountStoreError("INVALID_AUTH_FILE", "auth.json 缺少有效的账号标识");
    }
    if (typeof tokens.access_token !== "string" || tokens.access_token.length === 0) {
        throw new AccountStoreError("INVALID_AUTH_FILE", "auth.json 缺少 access token");
    }
    if (typeof tokens.refresh_token !== "string" || tokens.refresh_token.length === 0) {
        throw new AccountStoreError("INVALID_AUTH_FILE", "auth.json 缺少 refresh token");
    }
    return {
        fingerprint: createHash("sha256").update(tokens.account_id).digest("hex"),
        authMode,
    };
}
//# sourceMappingURL=auth.js.map