# Codex Pool

Codex Pool 是一个面向 macOS 的本地 Codex 多账号管理工具，支持文件凭证模式下的账号导入、官方登录、额度总览、冷切换和账号清理。

## 开发

```bash
npm install
npm run build
npm test
```

## 环境预检

```bash
npm run doctor
```

或者构建后直接运行：

```bash
node dist/src/cli/main.js doctor
node dist/src/cli/main.js doctor --json
```

`doctor` 只检查本机 Codex 环境，不修改 `~/.codex`、认证凭证或 Codex App 状态，也不会输出 token 内容。

## 导入当前账号

```bash
node dist/src/cli/main.js account add work
```

该命令不要求退出 Codex App，只读取当前 `auth.json` 并将其原子复制到默认的 `~/.codex-pool/accounts/work/`。设置 `CODEX_POOL_HOME` 后，可以将账号池放到其他目录。它要求 `cli_auth_credentials_store = "file"`；账号指纹只保存 SHA-256 哈希，命令不会输出或记录 token。账号切换仍属于冷切换操作，必须先退出 Codex App 和 app-server。

## 添加新账号

```bash
node dist/src/cli/main.js account login personal
```

该命令会在账号池的 `runtime/login/` 下创建临时 `CODEX_HOME`，调用官方 `codex login`。只有登录成功后才会导入新账号，且不会替换当前全局账号；登录取消或失败时当前账号保持不变。无论成功、取消还是失败，流程结束时都会清理临时目录。

## 冷切换账号

退出 Codex App 和 app-server 后执行：

```bash
node dist/src/cli/main.js switch company
node dist/src/cli/main.js switch company --launch
```

该命令会校验目标账号、备份当前全局 `auth.json`，原子替换凭证，运行 `codex login status` 验证目标账号，再更新 `active-account`。指定 `--launch` 时，仅在切换事务完成后通过 macOS `open -a ChatGPT` 启动 Codex App；如果启动失败，账号切换不会回滚，需要手动打开 App。若 App 名称不同，可通过 `CODEX_APP_NAME` 覆盖默认的 `ChatGPT`。切换过程中如果进程中断，下次切换会先根据 `switch-journal.json` 恢复到一致状态。

## 重命名账号

```bash
node dist/src/cli/main.js account rename work company
```

该命令只修改账号别名和对应目录名，不修改凭证、账号指纹或额度缓存；如果原账号不存在或新别名已存在，会拒绝操作。

## 查看账号列表

```bash
node dist/src/cli/main.js account list
node dist/src/cli/main.js account list --json
node dist/src/cli/main.js account list --refresh
```

默认列表读取本地账号元数据和凭证健康状态，并标记当前激活账号；`--refresh` 会为每个账号创建隔离临时 `CODEX_HOME`，启动短生命周期 app-server，查询套餐、额度、重置时间和用量后更新缓存。如果 token 用量档案暂时不可用，套餐和额度仍会更新，用量状态显示为“暂不可用”。

## 永久清理账号

```bash
node dist/src/cli/main.js account purge personal
```

该命令只允许清理非当前激活账号，并要求交互式精确输入别名确认。脚本或非交互环境可显式传入 `--confirm personal`。清理范围是账号池中的 `auth.json`、`metadata.json` 和额度缓存；共享的 Codex 会话、项目和插件状态不会删除。清理完成后不可恢复，只能重新登录。

## macOS 菜单栏面板

在 macOS 上可以启动原生菜单栏账号面板：

```bash
npm run menu
```

菜单栏面板会复用 `codex-pool account list --json`、`account login <alias>`、`account rename`、`account purge` 和 `switch <alias> --launch`，展示当前账号、完整邮箱、套餐、额度和重置时间，并提供添加新账号登录、刷新、切换、重命名、永久删除、打开 Codex App 和退出 CodexPoolMemu 入口。每次打开面板时会自动刷新一次账号额度；面板先显示本地缓存，刷新期间显示转圈状态。添加按钮会启动隔离的官方 Codex 登录流程，并自动生成易读的随机别名；登录成功后保存新账号，不替换当前全局账号。卡片右上角的 `⋯` 菜单提供重命名和永久删除；永久删除只需确认框，不要求输入别名，当前激活账号不可删除。底部的退出按钮只结束 CodexPoolMemu，不会退出 Codex App。默认从当前项目的 `dist/src/cli/main.js` 读取 CLI；如果作为独立应用启动，可设置 `CODEX_POOL_ROOT` 或 `CODEX_POOL_CLI` 指向项目和 CLI 路径。菜单栏图标位于 `macos/assets/codex-pool-account.png`，缺少资源时自动回退到 SF Symbol。完整邮箱在成功刷新账号信息后写入本地元数据，刷新未成功时显示“邮箱未刷新”，不会回退显示掩码邮箱。

> 外部登录同步：每次读取账号列表前，程序会对比全局 `auth.json` 与账号池的账号指纹。如果匹配已保存账号，会同时原子同步最新凭证和 `active-account`，并清除该账号的“需要重新登录”标记；如果是未导入账号，清空当前标记但不自动创建账号，仍可通过 CLI 的 `account add <alias>` 命令导入。如果 Codex App 被手动退出登录导致全局凭证消失，CodexPool 只清空 `active-account`，保留账号记录，不会自动 purge；账号额度查询明确返回认证失败后，会标记“需要重新登录”，并禁用切换入口。

### 打包 macOS App

```bash
npm run menu:app
open .build/CodexPoolMemu.app
```

该命令会先构建 TypeScript CLI，再生成标准 macOS App Bundle，并把运行所需的 `dist/src`、`package.json` 和菜单栏图标复制到 App 的 `Contents/Resources/codex-pool/`。App 会自动从 Bundle 中解析 CLI，不依赖启动时的工作目录。Node.js 和 Codex CLI 仍需安装在本机；App 会补充 Homebrew、`~/.npm-global/bin` 和 `~/.local/bin` 等常见 PATH。

仓库同时提供预编译 App：`release/CodexPoolMemu.app`。克隆仓库或下载 ZIP 后，可以将该 App 拖到“应用程序”文件夹再打开。当前版本未进行 Apple Developer 签名和公证，首次打开时可能需要在“系统设置 > 隐私与安全性”中允许运行；Node.js 和 Codex CLI 仍需安装在本机。源码更新后请重新运行 `npm run menu:app`，再更新 `release/CodexPoolMemu.app`。

### 登录后自动启动

```bash
npm run menu:install
```

该命令会重新打包 App，将其安装到 `~/Applications/CodexPoolMemu.app`，并安装、立即加载 `~/Library/LaunchAgents/com.codexpool.menubar.plist`。之后每次登录 macOS 都会自动启动 CodexPoolMemu。如果终端通过 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` 上网，安装时会将已设置的代理保存到 LaunchAgent，使 App 与终端使用相同的网络出口；代理变更后请重新运行该命令。从 Finder 手动打开 App 时，App 也会读取已保存在 LaunchAgent 中的代理配置。日志位于 `~/Library/Logs/CodexPool/`。

App 会将每次 CLI 操作的时间、操作类型、退出码和脱敏后的错误摘要写入 `~/Library/Logs/CodexPool/CodexPoolMemu.diagnostic.log`。额度查询会等待短生命周期 app-server 完全退出后再删除临时 `CODEX_HOME`；查询前也会清理同账号遗留的 `run-*` 目录。

移除已安装 App 和登录启动：

```bash
npm run menu:uninstall
```
