export class AccountStoreError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "AccountStoreError";
        this.code = code;
    }
}
//# sourceMappingURL=errors.js.map