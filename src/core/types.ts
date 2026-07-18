export type CheckStatus = "pass" | "warning" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: CheckStatus;
  summary: string;
}

export interface DoctorReport {
  ready: boolean;
  generatedAt: string;
  checks: DoctorCheck[];
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

