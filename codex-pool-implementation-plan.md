# Codex Pool 实现计划书

**版本**：MVP v0.1  
**目标平台**：macOS 优先  
**核心模式**：冷切换全局 `~/.codex/auth.json`  
**文档状态**：MVP 核心功能实现中

## 1. 项目概述

Codex Pool 是一个本地账号管理工具，用于管理多个 Codex/ChatGPT 账号，并在账号之间进行安全的冷切换。

第一版聚焦六件事：

- 导入当前已登录账号；
- 通过官方登录流程添加新账号；
- 查看账号列表、套餐、额度和重置时间；
- 修改账号别名；
- 永久清除某个账号的本地凭证；
- 将指定账号切换为当前全局 Codex 登录账号。

工具不修改 Codex App 的 UI，也不尝试在运行中的 Codex App 会话里热切换账号。

## 2. 目标与非目标

### 2.1 目标

- 管理多个由用户本人或组织授权使用的 Codex 账号；
- 为每个账号保存独立的登录凭证副本；
- 显示账号邮箱、套餐、额度百分比、重置时间和 token 使用统计；
- 在切换前保存当前账号最新凭证，避免 token 刷新丢失；
- 原子地替换全局 `~/.codex/auth.json`；
- 切换后验证目标账号并提供清晰错误信息；
- 账号凭证只保存在本机，不上传到服务端。

### 2.2 非目标

- 不支持运行中 Codex App 的热切换；
- 不修改或注入官方桌面 App 的登录页面；
- 不通过 Plugin、MCP 或浏览器自动化替换宿主认证；
- 不实现多账号自动轮换或绕过平台限制；
- 不保证显示精确的“剩余 token 数”，只显示后端提供的额度百分比和重置时间；
- 不删除账号关联的全部 Codex 会话、项目、worktree 或日志。

## 3. 已知运行环境

当前机器检查结果：

- Codex CLI 版本为 `0.144.5`；
- `CODEX_HOME` 未设置，实际使用默认目录 `~/.codex`；
- 当前登录方式为 ChatGPT；
- `~/.codex/auth.json` 存在，权限为 `600`；
- `config.toml` 当前未显式设置 `cli_auth_credentials_store`；
- 桌面 ChatGPT App 正在运行，并启动了内置 Codex app-server；
- 当前 App Server 正在使用 `~/.codex` 下的 IPC 和 SQLite 状态文件。

实现前应在工具初始化时确认：

```toml
cli_auth_credentials_store = "file"
```

如果用户使用 macOS Keychain 存储凭证，MVP 应明确提示暂不支持直接导入和切换，或引导用户迁移到文件凭证模式。

## 4. 核心设计

### 4.1 账号仓库

建议使用独立的本地账号仓库：

```text
~/.codex-pool/
├── config.json
├── active-account
├── switch-journal.json
├── runtime/
└── accounts/
    ├── work/
    │   ├── auth.json
    │   └── metadata.json
    └── personal/
        ├── auth.json
        └── metadata.json
```

目录权限：

```text
~/.codex-pool                 700
~/.codex-pool/accounts        700
账号目录                       700
auth.json                     600
metadata.json                 600
```

`runtime/` 只用于临时启动 app-server 或官方登录流程，不作为账号凭证的长期存储位置。每次任务结束后应清理对应的临时目录。

`metadata.json` 只保存展示和管理信息，不保存 token：

```json
{
  "id": "work",
  "label": "工作账号",
  "emailMasked": "z***@example.com",
  "planType": "pro",
  "accountFingerprint": "sha256:...",
  "enabled": true,
  "addedAt": "2026-07-18T12:30:00+08:00",
  "lastActivatedAt": "2026-07-18T12:30:00+08:00",
  "lastUsageRefreshAt": "2026-07-18T12:30:00+08:00"
}
```

`accountFingerprint` 用于判断重复账号，建议由账号标识计算哈希后保存，不在界面展示原始账号标识。

### 4.2 当前账号与账号仓库的关系

全局文件 `~/.codex/auth.json` 是当前激活账号的工作副本；账号仓库中的 `accounts/<id>/auth.json` 是该账号的保存副本。

切换时必须先把当前全局副本同步回当前账号，再写入目标账号副本：

```text
当前 ~/.codex/auth.json
        ↓ 保存
账号 A 的保存副本
        ↓ 切换
账号 B 的保存副本
        ↓ 原子写入
新的 ~/.codex/auth.json
```

这样可以保留运行期间自动刷新后的 refresh token。

### 4.2.1 切换事务与恢复

`auth.json` 和 `active-account` 必须作为一个事务更新，不能只依赖两个独立文件的写入顺序。切换开始前写入：

```text
~/.codex-pool/switch-journal.json
```

Journal 至少记录：

```json
{
  "operation": "switch",
  "fromAccount": "work",
  "toAccount": "company",
  "previousAuthFingerprint": "sha256:...",
  "targetAuthFingerprint": "sha256:...",
  "phase": "target-written",
  "startedAt": "2026-07-18T12:30:00+08:00"
}
```

切换阶段：

```text
写入 journal
    ↓
保存当前 ~/.codex/auth.json 到当前账号仓库
    ↓
原子写入目标 auth.json
    ↓
验证目标账号
    ↓
更新 active-account
    ↓
删除 journal
```

程序启动时如果发现未清理的 journal，应读取当前 `auth.json` 的账号指纹，判断切换处于哪个阶段：

- 目标账号已验证：补写 `active-account` 并清理 journal；
- 目标账号未验证：从账号仓库恢复原账号；
- 状态无法判断：停止操作并要求用户手动确认，不得盲目覆盖凭证。

`active-account` 只能作为显示缓存，不能作为认证事实来源；真实当前账号必须以 `auth.json` 经 `account/read` 验证后的结果为准。

### 4.3 状态采集

优先通过当前 Codex 版本的本地 app-server 协议获取信息，不直接解析私有网络接口：

- `account/read`：读取账号邮箱和套餐；
- `account/rateLimits/read`：读取额度窗口、使用百分比和重置时间；
- `account/usage/read`：读取每日及累计 token 使用统计。

App Server 当前仍属于实验性接口，客户端应根据本机 Codex 版本生成或校验 JSON Schema，避免硬编码未来可能变化的字段。

官方参考：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Authentication](https://learn.chatgpt.com/docs/auth)。

### 4.3.1 非当前账号的额度查询

账号仓库中的 `accounts/<id>/auth.json` 不是完整的运行环境，不能直接把账号仓库目录作为长期 `CODEX_HOME` 使用。查询非当前账号时，必须创建临时运行目录：

```text
~/.codex-pool/runtime/<account-id>/<run-id>/
├── auth.json
└── config.toml
```

执行流程：

1. 创建权限为 `700` 的临时运行目录；
2. 将账号仓库中的凭证复制为临时目录下的 `auth.json`，权限设为 `600`；
3. 写入最小化 `config.toml`，明确使用文件凭证；
4. 以该目录作为 `CODEX_HOME` 启动短生命周期 app-server；
5. 完成 `initialize`/`initialized` 握手，并启用当前版本所需的实验性能力；
6. 调用 `account/read`、`account/rateLimits/read` 和 `account/usage/read`；
7. 如果 app-server 刷新了 token，将临时 `auth.json` 原子同步回账号仓库；
8. 销毁本次临时运行目录，不在账号仓库写入 SQLite、session 或日志。

多个账号的刷新可以串行执行；如果并行执行，每个账号必须使用独立的运行目录和账号锁，不能共享同一个 `CODEX_HOME`。

## 5. 命令行接口

### 5.1 `codex-pool account add work`

把当前已登录的 Codex 账号保存为 `work`。

执行要求：

1. 检查 `work` 别名是否已存在；
2. 检查当前 `auth.json` 是否存在且为合法 JSON；
3. 读取当前账号信息并计算指纹；
4. 检查是否已被其他别名保存；
5. 原子复制凭证到账号仓库；
6. 写入脱敏元数据；
7. 默认将该账号标记为当前账号。

重复账号不得静默覆盖，应提示用户更新已有账号或使用新别名。

### 5.2 `codex-pool account login personal`

启动官方 `codex login` 流程，并将新登录账号保存为 `personal`。

建议流程：

1. 提示用户完全退出 Codex App；
2. 保存当前激活账号的最新凭证；
3. 创建 `~/.codex-pool/runtime/login/<run-id>/` 临时 `CODEX_HOME`；
4. 在临时环境中启动官方 `codex login` 流程，不清理当前全局认证；
5. 用户在浏览器中完成登录；
6. 读取并验证新账号信息；
7. 将临时环境中的凭证保存为 `personal`；
8. 清理临时登录目录；
9. 保持原全局账号不变，并提示用户之后执行 `codex-pool switch personal`；
10. 如果登录取消或失败，删除临时目录并保留当前账号不变。

工具不得自行收集用户名、密码、Cookie 或浏览器会话。

### 5.3 `codex-pool account list [--refresh]`

列出账号别名、邮箱、套餐、启用状态、当前激活状态、额度和重置时间。

默认读取缓存并快速返回；使用 `--refresh` 时重新查询最新账号状态。

推荐显示字段：

```text
别名       套餐    状态    短期额度    短期重置       长期额度    当前
work       Pro     可用    剩余 38%    今天 16:20     剩余 61%    ✓
personal   Plus    耗尽    剩余 0%     今天 18:45     剩余 27%    -
```

当后端不提供精确 token 上限时，显示百分比，不伪造绝对 token 余额。

### 5.4 `codex-pool account rename work company`

把账号别名从 `work` 改为 `company`，不改变凭证和账号指纹。

如果 `company` 已存在，应拒绝操作，避免覆盖账号。

### 5.5 `codex-pool account purge personal`

永久删除 `personal` 的本地凭证、元数据和用量缓存。

安全规则：

- 当前激活账号不能直接 purge；
- 必须先切换到其他账号，或明确执行带有登出语义的强制操作；
- 需要输入账号别名确认；
- 不删除共享的 Codex 会话、SQLite 状态、项目和插件；
- 完成后提示：之后只能重新执行官方登录。

### 5.6 `codex-pool switch company [--launch]`

冷切换全局 Codex 登录到 `company`，默认不自动启动 Codex App；指定 `--launch` 时，只有认证切换事务完整提交后才启动 Codex App。默认通过 `open -a ChatGPT` 启动，可用 `CODEX_APP_NAME` 覆盖应用名称。

执行流程：

```text
检查目标账号存在且可用
        ↓
检查 Codex App/app-server 是否退出
        ↓
获取切换锁
        ↓
保存当前 ~/.codex/auth.json
        ↓
验证当前副本所属账号
        ↓
原子写入 company 的 auth.json
        ↓
设置权限 600
        ↓
运行 codex login status
        ↓
通过 account/read 验证目标账号
        ↓
更新 active-account
        ↓
释放锁
        ↓
使用 --launch 时通过 macOS open 启动 Codex App
```

如果 App 仍在运行，应拒绝切换并说明原因，而不是强制覆盖凭证。

如果 `--launch` 启动失败，账号切换保持已提交状态，不回滚认证文件；工具应提示用户手动打开 Codex App。

## 6. 冷切换与文件安全

### 6.1 进程检查

切换前至少检查：

- ChatGPT/Codex 桌面 App 主进程；
- 内置 Codex app-server；
- 外部 `codex app-server`；
- 相关 remote-control 或后台 Codex 进程。

检测到活动进程时，默认拒绝并提示用户退出。MVP 不自动强杀进程。

### 6.2 原子替换

不要直接覆盖 `~/.codex/auth.json`。建议：

1. 在同目录写入临时文件；
2. 设置临时文件权限为 `600`；
3. 校验 JSON 和目标账号指纹；
4. 使用同文件系统内的原子 rename 替换；
5. 切换失败时恢复前一个副本。

### 6.3 并发锁

使用单独的锁文件，例如：

```text
~/.codex-pool/switch.lock
```

任何 add、login、purge、switch 操作都必须获取该锁，避免并发修改账号仓库或全局认证文件。

额度刷新也必须获取对应账号的细粒度锁，避免刷新过程与 `switch` 同时更新同一个账号的保存凭证。

### 6.4 事务恢复

切换实现必须支持进程在任意阶段退出后的恢复。临时文件、journal 和账号仓库更新应遵循以下规则：

- journal 先写入并落盘，再开始替换全局凭证；
- 临时 `auth.json` 先完整写入、校验并落盘，再原子替换目标文件；
- `active-account` 只有在目标账号验证成功后才更新；
- journal 清理必须是最后一步；
- 重启恢复时不能依赖上一次进程仍在内存中的状态；
- 恢复失败时保留 journal 和必要的诊断信息，但不得把 token 写入日志。

## 7. 技术实现建议

### 7.1 分阶段技术路线

**阶段一：CLI 原型**

- TypeScript/Node.js；
- 实现账号仓库和文件权限；
- 实现 `add`、`list`、`rename`、`purge`、`switch`；
- 通过子进程调用 `codex login status` 和 `codex app-server`；
- 先验证冷切换流程。

**阶段二：额度采集**

- 实现 app-server JSON-RPC 客户端；
- 接入 `account/read`、`account/rateLimits/read`、`account/usage/read`；
- 加入缓存、超时、重试和版本兼容提示；
- 增加 `account list --refresh`。

**阶段三：登录编排**

- 实现 `account login <alias>`；
- 管理退出、登录、校验和导入流程；
- 处理登录取消、过期、重复账号和网络失败。

**阶段四：桌面入口**

- 提供 macOS 菜单栏 UI；
- 显示账号状态和额度；
- 点击账号后执行冷切换；
- 提供“打开 Codex App”按钮；
- 不尝试修改已运行 App 的账号状态。

### 7.2 推荐模块

```text
src/
├── cli/                 命令解析和交互提示
├── account-store/       账号目录、元数据、锁和权限
├── auth-swap/           全局 auth.json 备份、校验、原子替换
├── runtime/             临时 CODEX_HOME、登录和额度查询运行目录
├── transaction/         switch journal、阶段提交和崩溃恢复
├── process-guard/       App/app-server 进程检测
├── app-server/          JSON-RPC 客户端和版本适配
├── usage/               额度、重置时间和缓存
└── ui/                  后续菜单栏界面
```

## 8. 异常处理

需要覆盖以下情况：

- `auth.json` 不存在；
- 当前使用 Keychain 而不是文件凭证；
- auth 文件格式损坏；
- 账号登录过期；
- refresh token 已失效；
- 目标别名不存在；
- 目标账号已被标记不可用；
- 账号重复导入；
- App 仍在运行；
- app-server 无法启动；
- 额度接口超时；
- 临时 CODEX_HOME 创建或清理失败；
- 切换后账号校验失败；
- 切换中断或磁盘写入失败；
- switch journal 残留或与当前 auth.json 不一致；
- Codex 版本升级导致协议字段变化。

任何切换失败都必须尽量保持原账号可恢复，并显示下一步操作，而不是留下半写入的 `auth.json`。

## 9. 测试计划

### 9.1 单元测试

- 别名合法性校验；
- 重复账号指纹检测；
- 元数据读写；
- 权限检查；
- 原子替换；
- 切换锁；
- switch journal 阶段推进和崩溃恢复；
- 失败回滚；
- 当前账号保护；
- purge 确认逻辑。

### 9.2 集成测试

- A/B 两个真实测试账号的导入；
- A → B → A 冷切换；
- refresh token 已更新后的再次切换；
- 登录流程取消时当前账号仍然保持可用；
- 非当前账号额度刷新不会污染账号凭证目录；
- 切换任意阶段中断后可以恢复或安全回滚；
- Codex App 完全退出和重新打开；
- app-server 额度查询；
- 登录取消和登录过期；
- 目标账号不存在或凭证损坏。

### 9.3 手工验收

1. 添加 A，列表能看到账号邮箱和套餐；
2. 登录 B，列表能看到 A/B；
3. 退出 App 后切换到 B；
4. 重新打开 App，确认 Profile 显示 B；
5. 使用 B 一次任务；
6. 再次退出 App 并切回 A；
7. 确认 A 仍然可以正常登录和运行；
8. purge B 后，列表和账号仓库不再保留 B 的凭证；
9. 验证共享项目、会话和插件未被误删。

## 10. 验收标准

MVP 完成需要满足：

- 可以导入至少两个文件凭证模式的 ChatGPT/Codex 账号；
- `account list --refresh` 能展示账号状态和限额信息；
- `switch` 在 App 未退出时拒绝执行；
- 切换后 `codex login status` 和 `account/read` 均确认目标账号；
- 切换失败不会破坏原账号凭证；
- 登录失败或取消不会清空当前账号；
- refresh token 更新后再次切换仍能成功；
- 非当前账号刷新不会在账号仓库产生 SQLite、session 或日志文件；
- 进程崩溃后 `auth.json`、`active-account` 和 switch journal 能恢复到一致状态；
- purge 不会误删其他账号和共享 Codex 状态；
- 凭证不会出现在日志、终端错误信息或元数据中；
- Codex App 完全退出并重启后能使用切换后的账号。

## 11. 主要风险与决策

| 风险 | 影响 | 应对 |
|---|---|---|
| App Server 协议变化 | 额度采集失效 | 按 Codex 版本生成 Schema，保留适配层 |
| App 未完全退出 | 凭证竞态、切换不生效 | 检测进程并默认拒绝切换 |
| refresh token 轮换 | 保存副本过期 | 切换前先同步当前全局 `auth.json` |
| Keychain 凭证模式 | 无法直接替换文件 | MVP 明确限制为 file store |
| 共享 SQLite 状态 | 会话和账号混用 | 只切换认证，不删除共享状态，并在 UI 中说明 |
| 凭证集中保存 | 安全风险提升 | 严格权限，正式版使用 Keychain 加密账号仓库 |
| 多账号使用合规性 | 账号受限或封禁风险 | 仅支持用户本人或组织授权账号，遵守平台条款 |

## 12. 推荐的 MVP 范围

第一版只实现以下命令：

```bash
codex-pool account add work
codex-pool account login personal
codex-pool account list [--refresh]
codex-pool account rename work company
codex-pool account purge personal
codex-pool switch company [--launch]
```

其中：

- `--launch` 在切换验证成功后自动重新打开 Codex App；
- 默认 `switch` 不启动 App，方便用户手动控制切换后的工作方式。

`remove`、`restore`、`disable`、`enable`、`update` 暂不作为 MVP 命令，等账号数量增加、需要归档和批量管理时再加入。
