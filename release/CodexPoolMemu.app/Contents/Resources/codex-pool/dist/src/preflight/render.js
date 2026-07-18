const ICONS = {
    pass: "✓",
    warning: "⚠",
    fail: "✗",
};
export function renderDoctorReport(report) {
    const lines = ["Codex Pool Doctor", ""];
    for (const check of report.checks) {
        lines.push(`${ICONS[check.status]} ${check.label}: ${check.summary}`);
    }
    lines.push("");
    lines.push(report.ready
        ? report.checks.some((check) => check.status === "warning")
            ? "Environment is ready with warnings."
            : "Environment is ready."
        : "Environment is not ready.");
    return lines.join("\n");
}
//# sourceMappingURL=render.js.map