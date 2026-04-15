# Mini OpenClaw

这是一个为了学习而写的极简版 OpenClaw。

这一版刻意更贴近原工程的 skill 设计：

- `session`：对话状态与 transcript
- `events`：运行中的生命周期、assistant、tool 事件
- `ReAct loop`：reasoning -> action -> observation -> next step
- `subagents`：最小版的多智能体协作
- `tools`：模型可调用的工具
- `skills`：以 catalog 的形式暴露给模型的专项说明书
- `nl2sql`：参考 Vanna 风格，把自然语言分析请求转成 SQL
- `agent runner`：把模型调用、工具调用、流式输出串起来

它不是 OpenClaw 的拷贝，也不追求功能一致，而是把大项目里最重要的执行思路压缩成一个能读懂的小样例。

## 文件

- `types.ts`：基础类型
- `event-bus.ts`：事件总线
- `session-store.ts`：内存版 session store
- `skills.ts`：skill catalog 与 system prompt
- `sql.ts`：schema 读取、demo SQL 推断、SQLite 只读执行
- `tools.ts`：示例工具，包括 `read_skill`
- `mock-model.ts`：一个模拟模型，演示 ReAct 和 subagent 协作
- `openai-compatible-model.ts`：可接 OpenAI 兼容接口的真实模型
- `agent-runner.ts`：最小 agent loop
- `index.ts`：启动 demo

## 运行

默认使用 mock 模型：

```bash
bun examples/mini-openclaw/index.ts
```

也可以用 Node 22+：

```bash
node --import tsx examples/mini-openclaw/index.ts
```

默认会优先读取项目根目录下的 `.env.local`，如果没有，再读取 `.env`。

你可以在仓库根目录新建一个 `.env.local`：

```env
OPENCLAW_MINI_MODEL=real
OPENAI_API_KEY=your-key
OPENCLAW_MINI_MODEL_NAME=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
OPENCLAW_MINI_SQLITE_DB_PATH=/path/to/your.db
OPENCLAW_MINI_SQL_SCHEMA_PATH=/path/to/schema.txt
```

如果你要切到真实模型：

```bash
OPENCLAW_MINI_MODEL=real \
OPENAI_API_KEY=your-key \
OPENCLAW_MINI_MODEL_NAME=gpt-4o-mini \
node --import tsx examples/mini-openclaw/index.ts
```

如果你接的是 OpenAI 兼容网关，也可以额外设置：

```bash
OPENAI_BASE_URL=https://your-endpoint.example/v1
```

如果你想让它做自然语言转 SQL：

- 不配置数据库也可以，agent 会基于内置 demo schema 先生成 SQL
- 如果配置了 `OPENCLAW_MINI_SQL_SCHEMA_PATH`，会优先读取你自己的 schema 文本
- 如果配置了 `OPENCLAW_MINI_SQLITE_DB_PATH`，`run_sql_query` 可以执行只读 SQL 预览

## 你会看到什么

1. agent 启动
2. runner 把 skill catalog 放进 system prompt
3. 模型先输出 reasoning 片段
4. 模型决定要不要先调用 `read_skill`
5. 如果任务可拆分，模型可以调用 `spawn_subagent`
6. 主 agent 通过 `wait_subagents` 收集子代理结果
7. 对于 SQL 请求，模型会先调用 `describe_data_schema`
8. 如有需要，模型再调用 `run_sql_query` 做只读预览
9. 模型再决定要不要调用业务工具，例如 `get_weather`
10. 工具执行并返回 observation
11. assistant 再继续输出最终答案
12. transcript 被保存回 session

## 这个样例和真实 OpenClaw 的对应关系

- `AgentRunner.run()` 类似大项目里的 agent loop 外壳
- `EventBus` 类似 `src/infra/agent-events.ts`
- `SessionStore` 类似 session store + transcript 的简化版
- `MockModel.streamTurn()` 模拟 provider stream + tool call + reasoning
- `buildMiniSystemPrompt()` 模拟真实项目把 skills catalog 注入运行上下文
- `read_skill` 模拟模型按需读取 skill 文件，而不是本地代码先匹配再硬塞进去
- `spawn_subagent` / `wait_subagents` 模拟原工程里的 `sessions_spawn` / `sessions_yield`

建议阅读顺序：

1. `index.ts`
2. `agent-runner.ts`
3. `skills.ts`
4. `mock-model.ts`
5. `openai-compatible-model.ts`
6. `tools.ts`
