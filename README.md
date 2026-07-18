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

该命令不要求退出 Codex App，只读取当前 `auth.json` 并将其原子复制到 `~/.codex-pool/accounts/work/`。它要求 `cli_auth_credentials_store = "file"`；账号指纹只保存 SHA-256 哈希，命令不会输出或记录 token。账号切换仍属于冷切换操作，必须先退出 Codex App 和 app-server。

## 添加新账号

```bash
node dist/src/cli/main.js account login personal
```

该命令会在 `~/.codex-pool/runtime/login/` 下创建临时 `CODEX_HOME`，调用官方 `codex login`。登录取消或失败时不会清理当前全局账号；成功后才会导入新账号，并删除临时目录。

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

菜单栏面板会复用 `codex-pool account list --json`、`account add <alias>`、`account rename`、`account purge` 和 `switch <alias> --launch`，展示当前账号、完整邮箱、套餐、额度和重置时间，并提供导入当前账号、刷新、切换、重命名、永久删除、打开 Codex App 和退出 Codex Pool 入口。每次打开面板时会自动刷新一次账号额度；面板先显示本地缓存，刷新期间显示转圈状态。导入按钮不弹窗，直接使用当前账号的完整邮箱作为账号别名；如果邮箱尚未刷新，会提示先刷新，如果别名或当前账号已存在，会在面板中提示无需重复导入。导入当前账号不要求退出 Codex App。卡片右上角的 `⋯` 菜单提供重命名和永久删除；永久删除只需确认框，不要求输入别名，当前激活账号不可删除。底部的退出按钮只结束 Codex Pool，不会退出 Codex App。默认从当前项目的 `dist/src/cli/main.js` 读取 CLI；如果作为独立应用启动，可设置 `CODEX_POOL_ROOT` 或 `CODEX_POOL_CLI` 指向项目和 CLI 路径。菜单栏图标位于 `macos/assets/codex-pool-account.png`，缺少资源时自动回退到 SF Symbol。完整邮箱在成功刷新账号信息后写入本地元数据，刷新未成功时显示“邮箱未刷新”，不会回退显示掩码邮箱。
