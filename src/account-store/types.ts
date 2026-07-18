export interface AccountMetadata {
  schemaVersion: 1;
  alias: string;
  accountFingerprint: string;
  authMode: string;
  emailMasked: string | null;
  planType: string | null;
  addedAt: string;
  updatedAt: string;
}

export interface AddAccountResult {
  alias: string;
  accountFingerprint: string;
  authMode: string;
  accountDirectory: string;
}

export interface ParsedAuthIdentity {
  fingerprint: string;
  authMode: string;
}

