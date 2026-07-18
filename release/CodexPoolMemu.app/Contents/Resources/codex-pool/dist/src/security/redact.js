const SENSITIVE_ASSIGNMENT = /((?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|password|secret)\s*[=:]\s*)([^\s,;]+)/gi;
const BEARER_TOKEN = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
export function redactSensitiveText(value) {
    return value
        .replace(BEARER_TOKEN, "$1<REDACTED>")
        .replace(SENSITIVE_ASSIGNMENT, "$1<REDACTED>")
        .replace(JWT, "<REDACTED_JWT>");
}
//# sourceMappingURL=redact.js.map