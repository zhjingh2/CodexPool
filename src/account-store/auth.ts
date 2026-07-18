import { createHash } from "node:crypto";
import { AccountStoreError } from "./errors.js";
import type { ParsedAuthIdentity } from "./types.js";

interface AuthTokens {
  account_id?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
}

interface AuthDocument {
  auth_mode?: unknown;
  tokens?: unknown;
}

export function extractAuthEmail(authText: string): string | null {
  try {
    const document = JSON.parse(authText) as AuthDocument;
    if (!document.tokens || typeof document.tokens !== "object" || Array.isArray(document.tokens)) {
      return null;
    }
    const idToken = (document.tokens as AuthTokens).id_token;
    if (typeof idToken !== "string") return null;
    const payloadPart = idToken.split(".")[1];
    if (!payloadPart) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
      email?: unknown;
      email_verified?: unknown;
    };
    if (typeof payload.email !== "string" || !payload.email.includes("@")) return null;
    if (payload.email_verified === false) return null;
    return payload.email;
  } catch {
    return null;
  }
}

export function parseAuthIdentity(authText: string): ParsedAuthIdentity {
  let document: AuthDocument;
  try {
    const parsed: unknown = JSON.parse(authText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    document = parsed as AuthDocument;
  } catch {
    throw new AccountStoreError("INVALID_AUTH_FILE", "auth.json 不是有效的 JSON 对象");
  }

  const authMode = document.auth_mode;
  if (typeof authMode !== "string" || authMode.trim().length === 0) {
    throw new AccountStoreError("INVALID_AUTH_FILE", "auth.json 缺少有效的 auth_mode");
  }

  if (!document.tokens || typeof document.tokens !== "object" || Array.isArray(document.tokens)) {
    throw new AccountStoreError("INVALID_AUTH_FILE", "auth.json 缺少 tokens 对象");
  }
  const tokens = document.tokens as AuthTokens;

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
