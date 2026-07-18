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

默认列表读取本地账号元数据和凭证健康状态，并标记当前激活账号；`--refresh` 会为每个账号创建隔离临时 `CODEX_HOME`，启动短生命周期 app-server，查询套餐、额度、重置时间和用量后更新缓存。

## 永久清理账号

```bash
node dist/src/cli/main.js account purge personal
```

该命令只允许清理非当前激活账号，并要求交互式精确输入别名确认。脚本或非交互环境可显式传入 `--confirm personal`。清理范围是账号池中的 `auth.json`、`metadata.json` 和额度缓存；共享的 Codex 会话、项目和插件状态不会删除。清理完成后不可恢复，只能重新登录。
