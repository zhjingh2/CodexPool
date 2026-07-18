import Cocoa
import SwiftUI

private struct QuotaWindow: Codable {
    let remainingPercent: Int?
    let resetsAt: Int?
}

private struct PoolAccount: Codable, Identifiable {
    let alias: String
    let email: String?
    let emailMasked: String?
    let planType: String?
    let current: Bool
    let credentialStatus: String
    let credentialMessage: String?
    let usageStatus: String?
    let primaryQuota: QuotaWindow?

    var id: String { alias }

    var remainingPercent: Int {
        max(0, min(100, primaryQuota?.remainingPercent ?? 0))
    }

    var planLabel: String { planType ?? "未查询" }

    var displayEmail: String { email ?? "邮箱未刷新" }

    var credentialLabel: String {
        credentialStatus == "ok" ? "凭证正常" : credentialMessage ?? "凭证需检查"
    }

    var quotaLabel: String {
        primaryQuota == nil ? "额度未查询" : "剩余 \(remainingPercent)%"
    }

    var resetLabel: String {
        guard let resetsAt = primaryQuota?.resetsAt else { return "重置时间未查询" }
        let date = Date(timeIntervalSince1970: TimeInterval(resetsAt))
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

private struct CLIResult {
    let exitCode: Int32
    let stdout: String
    let stderr: String
}

private enum PoolCLI {
    static func run(arguments: [String]) async -> CLIResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                let stdout = Pipe()
                let stderr = Pipe()
                process.standardOutput = stdout
                process.standardError = stderr
                process.currentDirectoryURL = projectRoot
                process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
                process.arguments = ["node", cliPath.path] + arguments

                do {
                    try process.run()
                    process.waitUntilExit()
                    let output = stdout.fileHandleForReading.readDataToEndOfFile()
                    let error = stderr.fileHandleForReading.readDataToEndOfFile()
                    continuation.resume(returning: CLIResult(
                        exitCode: process.terminationStatus,
                        stdout: String(data: output, encoding: .utf8) ?? "",
                        stderr: String(data: error, encoding: .utf8) ?? "",
                    ))
                } catch {
                    continuation.resume(returning: CLIResult(
                        exitCode: 127,
                        stdout: "",
                        stderr: "无法启动 codex-pool：\(error.localizedDescription)",
                    ))
                }
            }
        }
    }

    static var projectRoot: URL {
        if let configured = ProcessInfo.processInfo.environment["CODEX_POOL_ROOT"], !configured.isEmpty {
            return URL(fileURLWithPath: configured, isDirectory: true)
        }
        let executable = URL(fileURLWithPath: CommandLine.arguments[0])
        let derivedRoot = executable.deletingLastPathComponent().deletingLastPathComponent()
        if FileManager.default.fileExists(atPath: derivedRoot.appendingPathComponent("package.json").path) {
            return derivedRoot
        }
        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    }

    static var cliPath: URL {
        if let configured = ProcessInfo.processInfo.environment["CODEX_POOL_CLI"], !configured.isEmpty {
            return URL(fileURLWithPath: configured)
        }
        return projectRoot.appendingPathComponent("dist/src/cli/main.js")
    }
}

private final class PoolModel: ObservableObject {
    @Published var accounts: [PoolAccount] = []
    @Published var isLoading = false
    @Published var isRefreshing = false
    @Published var message: String?
    @Published var error: String?

    private static let refreshTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = .current
        formatter.dateFormat = "MM-dd HH:mm:ss"
        return formatter
    }()

    func load(refresh: Bool = false) {
        guard !isLoading else { return }
        isLoading = true
        isRefreshing = refresh
        error = nil
        Task {
            let arguments = refresh ? ["account", "list", "--refresh", "--json"] : ["account", "list", "--json"]
            let result = await PoolCLI.run(arguments: arguments)
            await MainActor.run {
                self.isLoading = false
                self.isRefreshing = false
                if let data = result.stdout.data(using: .utf8),
                   let decoded = try? JSONDecoder().decode([PoolAccount].self, from: data) {
                    self.accounts = decoded
                    self.message = refresh && result.exitCode == 0
                        ? "额度于 \(Self.refreshTimeFormatter.string(from: Date())) 更新"
                        : nil
                    if result.exitCode != 0 {
                        self.error = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                    }
                } else {
                    self.error = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? "无法读取账号列表"
                        : result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
        }
    }

    func switchAccount(_ account: PoolAccount) {
        guard !isLoading else { return }
        isLoading = true
        error = nil
        message = "正在切换到 \(account.alias)…"
        Task {
            let result = await PoolCLI.run(arguments: ["switch", account.alias, "--launch"])
            await MainActor.run {
                self.isLoading = false
                if result.exitCode == 0 {
                    self.message = "已切换到 \(account.alias)，Codex App 正在打开"
                    self.load()
                } else {
                    self.message = nil
                    self.error = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? "账号切换失败"
                        : result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
        }
    }

    func addCurrentAccount(alias: String) {
        guard !isLoading else { return }
        let normalizedAlias = alias.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedAlias.isEmpty else { return }
        isLoading = true
        isRefreshing = false
        error = nil
        message = "正在导入当前账号…"
        Task {
            let result = await PoolCLI.run(arguments: ["account", "add", normalizedAlias, "--json"])
            await MainActor.run {
                self.isLoading = false
                if result.exitCode == 0 {
                    self.message = "已将当前账号导入为 \(normalizedAlias)"
                    self.load()
                } else {
                    let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                    if detail.contains("已存在") || detail.contains("已经存在") || detail.contains("已经保存") {
                        self.message = "账号已存在，无需重复导入"
                        self.error = nil
                    } else {
                        self.message = nil
                        self.error = detail.isEmpty ? "账号导入失败" : detail
                    }
                }
            }
        }
    }

    func addCurrentAccount() {
        guard let email = accounts.first(where: { $0.current })?.email,
              !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "当前账号邮箱未刷新，请先点击刷新按钮"
            message = nil
            return
        }
        addCurrentAccount(alias: email)
    }

    func renameAccount(_ account: PoolAccount, to alias: String) {
        guard !isLoading else { return }
        let normalizedAlias = alias.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedAlias.isEmpty else { return }
        isLoading = true
        isRefreshing = false
        error = nil
        message = "正在重命名 \(account.alias)…"
        Task {
            let result = await PoolCLI.run(arguments: ["account", "rename", account.alias, normalizedAlias])
            await MainActor.run {
                self.isLoading = false
                if result.exitCode == 0 {
                    self.message = "已将 \(account.alias) 重命名为 \(normalizedAlias)"
                    self.load()
                } else {
                    self.message = nil
                    let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                    self.error = detail.isEmpty ? "账号重命名失败" : detail
                }
            }
        }
    }

    func purgeAccount(_ account: PoolAccount) {
        guard !isLoading else { return }
        guard !account.current else {
            error = "当前激活账号不能永久删除，请先切换账号"
            message = nil
            return
        }
        isLoading = true
        isRefreshing = false
        error = nil
        message = "正在删除 (account.alias)…"
        Task {
            let result = await PoolCLI.run(arguments: [
                "account", "purge", account.alias, "--confirm", account.alias,
            ])
            await MainActor.run {
                self.isLoading = false
                if result.exitCode == 0 {
                    self.message = "已永久删除账号 \(account.alias)"
                    self.load()
                } else {
                    self.message = nil
                    let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                    self.error = detail.isEmpty ? "账号永久删除失败" : detail
                }
            }
        }
    }
}

private struct ContentView: View {
    @ObservedObject var model: PoolModel
    @State private var accountToRename: PoolAccount?
    @State private var accountToPurge: PoolAccount?

    private let background = Color(red: 0.055, green: 0.067, blue: 0.082)
    private let panel = Color(red: 0.09, green: 0.106, blue: 0.13)
    private let amber = Color(red: 1.0, green: 0.64, blue: 0.25)
    private let aqua = Color(red: 0.25, green: 0.86, blue: 0.72)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 12) {
                    accountSection
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 16)
            }
            footer
        }
        .frame(width: 370, height: 515)
        .background(background)
        .preferredColorScheme(.dark)
        .sheet(item: $accountToRename) { account in
            RenameAccountSheet(currentAlias: account.alias) { newAlias in
                model.renameAccount(account, to: newAlias)
            }
        }
        .alert(item: $accountToPurge) { account in
            Alert(
                title: Text("永久删除账号？"),
                message: Text("将删除该账号的本地凭证、元数据和用量缓存。此操作不可恢复。"),
                primaryButton: .destructive(Text("永久删除")) {
                    model.purgeAccount(account)
                },
                secondaryButton: .cancel(),
            )
        }
    }

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text("CODEX POOL")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .tracking(1.5)
                    .foregroundStyle(amber)
                Text("账号控制台")
                    .font(.system(size: 22, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
            }
            Spacer()
            Button {
                model.addCurrentAccount()
            } label: {
                Image(systemName: "person.badge.plus")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.75))
                    .frame(width: 32, height: 32)
                    .background(Color.white.opacity(0.07), in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(model.isLoading)
            .help("按当前账号邮箱导入 Codex 账号")
            Button {
                model.load(refresh: true)
            } label: {
                Group {
                    if model.isRefreshing {
                        ProgressView()
                            .controlSize(.small)
                            .tint(amber)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.75))
                    }
                }
                .frame(width: 32, height: 32)
                .background(Color.white.opacity(0.07), in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(model.isLoading)
            .help(model.isRefreshing ? "正在刷新账号额度" : "刷新账号额度")
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 14)
    }

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("账号池")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.72))
                Spacer()
                Text("\(model.accounts.count) 个账号")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.36))
            }
            if model.accounts.isEmpty && !model.isLoading {
                Text("账号池为空，请先使用 account add 或 account login。")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(.white.opacity(0.5))
                    .padding(.vertical, 18)
            } else {
                ForEach(model.accounts.sorted { left, right in
                    if left.current != right.current { return left.current }
                    return left.alias.localizedCaseInsensitiveCompare(right.alias) == .orderedAscending
                }) { account in
                    accountRow(account)
                }
            }
        }
    }

    private func accountRow(_ account: PoolAccount) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                Circle()
                    .fill(account.current ? amber : (account.credentialStatus == "ok" ? aqua : Color.red.opacity(0.8)))
                    .frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.alias)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("\(account.planLabel) · \(account.displayEmail)")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.42))
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                }
                Spacer()
                if account.current {
                    Text("当前")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(amber)
                } else {
                    Button("切换") {
                        model.switchAccount(account)
                    }
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6)
                    .background(aqua, in: Capsule())
                    .buttonStyle(.plain)
                    .disabled(model.isLoading)
                }
                accountActions(for: account)
            }
            quotaBar(account)
        }
        .padding(13)
        .background(
            account.current
                ? LinearGradient(
                    colors: [Color(red: 0.16, green: 0.13, blue: 0.10), panel],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing,
                )
                : LinearGradient(colors: [panel, panel], startPoint: .top, endPoint: .bottom),
            in: RoundedRectangle(cornerRadius: 13, style: .continuous),
        )
        .overlay {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(account.current ? amber.opacity(0.42) : Color.white.opacity(0.06), lineWidth: 1)
        }
    }

    private func accountActions(for account: PoolAccount) -> some View {
        Menu {
            Button("重命名") {
                accountToRename = account
            }
            Divider()
            if account.current {
                Button("永久删除", role: .destructive) {}
                    .disabled(true)
            } else {
                Button("永久删除", role: .destructive) {
                    accountToPurge = account
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.62))
                .frame(width: 26, height: 26)
                .background(Color.white.opacity(0.06), in: Circle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .disabled(model.isLoading)
        .help(account.current ? "重命名账号；当前账号不可永久删除" : "账号操作")
    }

    private func quotaBar(_ account: PoolAccount) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                if account.primaryQuota == nil {
                    Text("额度未查询")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.58))
                } else {
                    Text("剩余")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.55))
                    Text("\(account.remainingPercent)%")
                        .font(.system(size: 19, weight: .bold, design: .rounded))
                        .foregroundStyle(account.current ? amber : aqua)
                }
                Spacer()
                Text(account.resetLabel)
                    .font(.system(size: 10, weight: .regular, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.34))
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.08))
                    Capsule()
                        .fill(account.current ? amber : aqua)
                        .frame(width: proxy.size.width * CGFloat(account.remainingPercent) / 100)
                }
            }
            .frame(height: 5)
        }
    }

private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = model.error {
                Text(error)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(Color.red.opacity(0.9))
                    .lineLimit(2)
            } else if let message = model.message {
                Text(message)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(aqua)
            }
            HStack {
                Text("冷切换模式 · App 运行时会拒绝切换")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.3))
                Spacer()
                Button {
                    NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications/ChatGPT.app"))
                } label: {
                    Image(systemName: "macwindow")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.58))
                        .frame(width: 26, height: 26)
                }
                .buttonStyle(.plain)
                .help("打开 Codex App")
                Button {
                    NSApp.terminate(nil)
                } label: {
                    Image(systemName: "power")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.58))
                        .frame(width: 26, height: 26)
                }
                .buttonStyle(.plain)
                .help("退出 Codex Pool")
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 13)
        .background(Color.black.opacity(0.18))
    }
}

private struct RenameAccountSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var alias: String
    let currentAlias: String
    let onSubmit: (String) -> Void

    init(currentAlias: String, onSubmit: @escaping (String) -> Void) {
        self.currentAlias = currentAlias
        self.onSubmit = onSubmit
        _alias = State(initialValue: currentAlias)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("重命名账号")
                .font(.system(size: 16, weight: .semibold, design: .rounded))
            Text("只修改账号别名，不会改变登录凭证或额度缓存。")
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
            TextField("新账号别名", text: $alias)
                .textFieldStyle(.roundedBorder)
                .onSubmit(submit)
            HStack {
                Spacer()
                Button("取消") { dismiss() }
                Button("保存") { submit() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(alias.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 340)
    }

    private func submit() {
        let normalizedAlias = alias.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedAlias.isEmpty, normalizedAlias != currentAlias else {
            dismiss()
            return
        }
        onSubmit(normalizedAlias)
        dismiss()
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model = PoolModel()
    private let popover = NSPopover()
    private var statusItem: NSStatusItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            let customIconPath = PoolCLI.projectRoot.appendingPathComponent("macos/assets/codex-pool-account.png")
            if let customIcon = NSImage(contentsOfFile: customIconPath.path) {
                customIcon.size = NSSize(width: 18, height: 18)
                // The custom asset is monochrome; let macOS tint it for light/dark menu bars.
                customIcon.isTemplate = true
                button.image = customIcon
            } else {
                button.image = NSImage(systemSymbolName: "person.2.wave.2.fill", accessibilityDescription: "Codex Pool")
                button.image?.isTemplate = true
            }
            button.action = #selector(togglePopover)
            button.target = self
        }
        popover.behavior = .transient
        popover.contentSize = NSSize(width: 370, height: 515)
        popover.contentViewController = NSHostingController(rootView: ContentView(model: model))
        model.load()
    }

    @objc private func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
            model.load(refresh: true)
        }
    }
}

@main
private struct CodexPoolMenuBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}
