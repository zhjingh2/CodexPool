# Codex Pool

Codex Pool 是一个面向 macOS 的本地 Codex 多账号管理工具。当前实现处于第一阶段，仅包含安全、只读的环境预检。

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

完全退出 Codex App 和 app-server 后运行：

```bash
node dist/src/cli/main.js account add work
```

该命令要求 `cli_auth_credentials_store = "file"`，并将当前 `auth.json` 原子复制到 `~/.codex-pool/accounts/work/`。账号指纹只保存 SHA-256 哈希，命令不会输出或记录 token。

## 添加新账号

```bash
node dist/src/cli/main.js account login personal
```

该命令会在 `~/.codex-pool/runtime/login/` 下创建临时 `CODEX_HOME`，调用官方 `codex login`。登录取消或失败时不会清理当前全局账号；成功后才会导入新账号，并删除临时目录。

## 冷切换账号

退出 Codex App 和 app-server 后执行：

```bash
node dist/src/cli/main.js switch company
```

该命令会校验目标账号、备份当前全局 `auth.json`，原子替换凭证，运行 `codex login status` 验证目标账号，再更新 `active-account`。切换过程中如果进程中断，下次切换会先根据 `switch-journal.json` 恢复到一致状态。

## 查看账号列表

```bash
node dist/src/cli/main.js account list
node dist/src/cli/main.js account list --json
```

当前列表读取本地账号元数据和凭证健康状态，并标记当前激活账号；额度和重置时间会在后续 app-server 采集阶段接入，暂显示为“未查询”。
