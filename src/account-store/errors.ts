export class AccountStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AccountStoreError";
    this.code = code;
  }
}

