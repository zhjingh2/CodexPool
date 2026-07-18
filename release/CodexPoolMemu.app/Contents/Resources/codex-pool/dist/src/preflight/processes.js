export function summarizeCodexProcesses(processList) {
    let desktopAppCount = 0;
    let appServerCount = 0;
    for (const line of processList.split(/\r?\n/u)) {
        if (line.includes("/Applications/ChatGPT.app/Contents/MacOS/ChatGPT")) {
            desktopAppCount += 1;
        }
        if (/\bcodex(?:\s|\S*\/codex\s).*\bapp-server\b/u.test(line)) {
            appServerCount += 1;
        }
    }
    return { desktopAppCount, appServerCount };
}
//# sourceMappingURL=processes.js.map