# Pi RPC Rust 最小示例总结

这个示例实现了一个最小可用的 `pi --mode rpc` Rust 客户端，覆盖 4 类常见能力：

- `list`：列出 commands / skills / models
- `session`：查看和操作 session
- `tooluse`：发送 prompt，并观察工具调用与执行事件
- `skill`：列出并触发 skill

## 运行前提

确保本机可直接运行：

```bash
pi --mode rpc --no-session
```

## 依赖

`Cargo.toml` 最小依赖：

```toml
[dependencies]
anyhow = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

## 核心设计

客户端本质做了 4 件事：

1. 启动子进程：`pi --mode rpc --no-session`
2. 向 stdin 按 **JSONL** 写命令，一行一个 JSON
3. 从 stdout 按行读取 JSON 事件
4. 区分两类交互：
   - 请求-响应型：如 `get_state`、`get_commands`
   - 流式事件型：如 `prompt`

## 支持的命令

### 1. list

#### 列出全部 commands

```bash
cargo run -- list-commands
```

返回 extension commands、prompt templates 和 skills。

#### 列出 models

```bash
cargo run -- list-models
```

#### 只列出 skills

```bash
cargo run -- list-skills
```

内部实现是调用：

```json
{"type":"get_commands"}
```

然后按 `source == "skill"` 过滤。

---

### 2. session

#### 查看 session 状态

```bash
cargo run -- session-state
```

对应 RPC：

```json
{"type":"get_state"}
```

#### 新建 session

```bash
cargo run -- new-session
```

对应 RPC：

```json
{"type":"new_session"}
```

#### 设置 session 名称

```bash
cargo run -- set-session-name my-work
```

对应 RPC：

```json
{"type":"set_session_name","name":"my-work"}
```

---

### 3. tooluse

```bash
cargo run -- tooluse "读取当前目录下 README 并总结"
```

本质仍然是发送：

```json
{"type":"prompt","message":"读取当前目录下 README 并总结"}
```

但程序会额外打印这些事件：

- `toolcall_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `text_delta`

这样可以看到工具调用过程，例如：

```text
[toolcall] read {"path":"README.md"}
[tool:start] read {"path":"README.md"}
[tool:end] read ok
这里是总结...
[turn_end]
[agent_end]
```

---

### 4. skill

先列出可用 skill：

```bash
cargo run -- list-skills
```

然后执行：

```bash
cargo run -- skill skill:find-skills "帮我找一个浏览器自动化 skill"
```

内部并不是独立 RPC 命令，而是发送普通 prompt：

```text
/skill:find-skills 帮我找一个浏览器自动化 skill
```

也就是：

```json
{"type":"prompt","message":"/skill:find-skills 帮我找一个浏览器自动化 skill"}
```

## 事件解析重点

### 请求-响应类

像这些命令：

- `get_state`
- `get_commands`
- `get_available_models`
- `new_session`
- `set_session_name`

都会返回：

```json
{"type":"response","id":"req-x",...}
```

客户端只要按 `id` 匹配即可。

### prompt 类

`prompt` 比较特殊：

1. 先收到一条 `response`，表示命令已接收
2. 后续真正内容通过事件流输出
3. 直到 `agent_end` 才算结束

所以 `prompt` 不能像普通 request 一样只等一条 response。

## Rust 版最小实现思路

核心结构体：

```rust
struct PiRpc {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}
```

### 关键方法

#### 1. `send()`

- 给命令自动加 `id`
- 序列化为 JSON
- 写入一行到 stdin

#### 2. `request()`

- 用于 `get_state`、`get_commands` 这种命令
- 持续读 stdout
- 直到读到同 `id` 的 `response`

#### 3. `prompt_until_end()`

- 用于 `prompt`
- 持续读取事件
- 打印工具调用和文本流
- 直到 `agent_end`

## 解析策略

程序只最小关注这些事件：

- `response`
- `message_update.text_delta`
- `message_update.toolcall_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `turn_end`
- `agent_end`

其中：

### 文本输出

当收到：

```json
assistantMessageEvent.type == "text_delta"
```

直接把 `delta` 输出到屏幕。

### 工具调用

当收到：

```json
assistantMessageEvent.type == "toolcall_end"
```

打印工具名和参数。

### 工具执行

关注：

- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`

这样就能看到 tool use 的完整生命周期。

## 一个很重要的点

pi RPC 是 **严格 JSONL + LF 分隔**：

- 一行一个 JSON
- 用 `\n` 分隔
- 客户端应逐行解析

## 适合后续增强的方向

这个最小版已经够演示，但后续可继续升级：

1. 做成 Rust REPL
2. 改为 Tokio 异步版
3. 把 `serde_json::Value` 替换成强类型 `enum`
4. 支持并发请求和更完整的事件分发
5. 增加仅提取最终回答的简洁模式

## 一句话总结

这个 Rust 最小示例已经能作为一个可工作的 `pi-rpc` 客户端骨架：

- 普通 RPC 请求能发
- 流式 prompt 能收
- tool use 能观测
- skills 能发现并触发
- session 能查询和控制
