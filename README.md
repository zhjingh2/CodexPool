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

