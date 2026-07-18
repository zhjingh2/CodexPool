export function detectCredentialStoreMode(configText) {
    for (const rawLine of configText.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith("#")) {
            continue;
        }
        const match = line.match(/^cli_auth_credentials_store\s*=\s*["']?(file|keyring|auto)["']?\s*(?:#.*)?$/iu);
        if (match?.[1]) {
            return match[1].toLowerCase();
        }
    }
    return "unknown";
}
//# sourceMappingURL=config.js.map