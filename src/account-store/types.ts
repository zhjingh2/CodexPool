export interface AccountMetadata {
  schemaVersion: 1;
  alias: string;
  accountFingerprint: string;
  authMode: string;
  emailMasked: string | null;
  planType: string | null;
  addedAt: string;
  updatedAt: string;
  primaryQuota?: AccountQuotaWindow | null;
  secondaryQuota?: AccountQuotaWindow | null;
  lastRefreshedAt?: string | null;
}

export interface AddAccountResult {
  alias: string;
  accountFingerprint: string;
  authMode: string;
  accountDirectory: string;
}

export type CredentialStatus = "ok" | "missing" | "invalid";

export interface AccountQuotaWindow {
  usedPercent: number;
  remainingPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
}

export interface AccountSummary extends AccountMetadata {
  current: boolean;
  enabled: boolean;
  credentialStatus: CredentialStatus;
  credentialMessage: string | null;
  primaryQuota?: AccountQuotaWindow | null;
  secondaryQuota?: AccountQuotaWindow | null;
  lastRefreshedAt?: string | null;
}

export interface ParsedAuthIdentity {
  fingerprint: string;
  authMode: string;
}
