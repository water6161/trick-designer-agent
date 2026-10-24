# 诡计设计师 · 剧本杀诡计工作台

基于 **EdgeOne Makers Agents Runtime + LangGraph** 的剧本杀诡计设计 Agent：输入题材、人数、难度与诡计类型，自动联网检索经典套路与玩家雷点，输出完整诡计方案，并附公平性自查、DM 开本提示与防杠要点。

## 线上环境

| 项 | 值 |
| --- | --- |
| Makers 项目 | `trick-designer-agent`（Project ID：`makers-bfvelax99njw`） |
| 临时域名 | `https://trick-designer-agent-5qq5gzrp.edgeone.cool` |
| 控制台 | `https://console.cloud.tencent.com/edgeone/pages/project/makers-bfvelax99njw` |
| 访问方式 | 首次访问使用 `edgeone makers deploy` 输出的带 `eo_token` 的 URL；绑定自定义域名后可直接使用正式域名 |

> `eo_token` 是部署预览的临时访问凭证，不写入仓库。正式对外开放请按「五、部署」后的域名绑定流程操作。

## 一、项目结构

```
.
├── agents/                      # Makers 会话模式 Runtime（文件/目录即路由）
│   ├── _lib/                    # 私有包（_ 前缀不生成路由）
│   │   ├── app.py               # HTTP 入口实现：SSE、会话列表/历史/删除、异常兜底
│   │   ├── config.py            # 环境变量读取（密钥不落代码）
│   │   ├── graph.py             # LangGraph 工作流装配
│   │   ├── nodes.py             # understand / research / design / audit / compose
│   │   ├── models.py            # ChatOpenAI → Makers 模型网关
│   │   ├── prompts.py           # 角色、安全边界、成稿结构约束
│   │   ├── schemas.py           # 结构化输出的 Pydantic Schema
│   │   ├── search.py            # 平台内置 web_search 检索与结果归一化
│   │   ├── state.py             # LangGraph State
│   │   └── logger.py            # stdout/stderr 日志（平台采集）
│   ├── trick-designer/
│   │   └── index.py             # POST /trick-designer
│   ├── stop/
│   │   └── index.py             # POST /stop（尽力而为地中止当前运行）
│   └── requirements.txt
├── src/                         # 暗黑风格对话前端（React + Vite + TS）
│   ├── components/
│   ├── lib/api.ts               # SSE 解析、会话列表/历史/删除/停止
│   ├── lib/markdown.tsx
│   ├── App.tsx
│   └── index.css
├── edgeone.json                 # Makers 项目配置
├── requirements.txt             # 本地调试依赖（与 agents/requirements.txt 一致）
└── package.json
```

## 二、运行流程

```
understand → research → design → audit → compose
      │
      └─(纯咨询类问题)────────────→ compose
```

| 节点 | 作用 |
| --- | --- |
| `understand` | 解析题材/人数/难度/诡计类型/特殊设定，判断是新建、迭代还是咨询 |
| `research` | 调用平台内置 `web_search` 检索经典诡计、常见套路、玩家雷点；失败自动降级 |
| `design` | 生成结构化方案：死者、背景、核心诡计、凶手逻辑、人物、公开/深入线索、时间线、红鲱鱼 |
| `audit` | 独立公平性审查：锁凶充分性评分、是否降智、是否只有上帝视角能破、其他合理解释、bug 与修复建议 |
| `compose` | 按固定 Markdown 结构流式成稿，附 DM 提示、防杠要点、易卡壳点、可迭代方向 |

多轮记忆由平台 `context.store.langgraph_checkpointer` 以 `thread_id = conversation_id` 持久化，跨实例可恢复；不依赖任何自建数据库。

## 三、环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` | 是 | 模型网关密钥，由 Makers 自动注入，代码只从 `context.env` 读取 |
| `AI_GATEWAY_BASE_URL` | 否 | 默认 `https://ai-gateway.edgeone.link/v1` |
| `AI_GATEWAY_MODEL` | 否 | 默认 `@makers/deepseek-v4-flash`；切换模型只改此变量 |
| `WSA_API_KEY` | 否 | 联网搜索备用密钥；当前检索使用平台内置 `web_search` |

> 禁止把任何密钥写入代码或提交到仓库。`.env` 仅用于本地调试且已被 `.gitignore` 忽略。

## 四、本地调试

```bash
npm install
python -m venv .venv
# Windows
.venv\Scripts\activate
pip install -r agents/requirements.txt

npm i -g edgeone
edgeone makers link      # 同步控制台项目的环境变量
edgeone makers dev       # 默认 http://localhost:8088
```

- 前端页面：`http://localhost:8088/`
- 本地链路追踪面板：`http://localhost:8088/agent-metrics`

前端构建校验：

```bash
npm run build
```

后端语法与导入校验：

```bash
python -m compileall agents
python -c "import sys; sys.path.insert(0, 'agents'); from _lib.graph import build_graph; print(build_graph().get_graph().nodes.keys())"
```

## 五、部署

### CLI（推荐）

```bash
edgeone login
edgeone makers deploy -n <项目名>
```

### Git

将仓库推送到 GitHub / Gitee / Coding，在控制台导入 Makers 项目，默认 `main` 分支提交会自动部署。

部署后请在控制台确认：

1. 环境变量已注入 `AI_GATEWAY_API_KEY`、`AI_GATEWAY_BASE_URL`、`AI_GATEWAY_MODEL`；
2. `edgeone.json` 中 `agents.framework = langgraph`；
3. 前端接口路径 `/trick-designer` 与 `/stop` 均可访问。

## 六、接口约定

所有 `agents/*` 请求必须携带请求头 `Makers-Conversation-Id`（6–36 字符，允许 `0-9 a-z A-Z - _ .`）。

| 路由 | 请求体 | 响应 |
| --- | --- | --- |
| `POST /trick-designer` | `{ "action": "chat", "message": "..." }` | SSE：`session / status / notice / meta / token / done / error` |
| `POST /trick-designer` | `{ "action": "sessions" }` | `{ "sessions": [{ id, title, updatedAt }] }` |
| `POST /trick-designer` | `{ "action": "history" }` | `{ "messages": [{ role, content, createdAt }] }` |
| `POST /trick-designer` | `{ "action": "delete", "conversation_id": "..." }` | `{ "ok": true }` |
| `POST /stop` | `{ "conversationId": "..." }` | `{ status, conversationId, aborted }` |

## 七、异常与降级

- **联网检索失败/超时**：并发检索单条 25s 超时，失败仅提示，不阻断方案生成。
- **公平性自查失败**：返回「未经完整审查」提示，方案仍可交付，但不伪造评分。
- **模型超时 / 限流 / 上下文超限 / 鉴权失败**：统一转为中文友好提示，通过 SSE `error` 事件推给前端。
- **记忆写入失败**：只记录日志，不打断当前对话。
- **客户端断开**：监听 `context.request.signal`，中止图执行，避免无效 token 消耗。
- **会话操作失败**：`sessions / history / delete` 返回 `error` 字段，前端明确提示而不是静默失败。

## 八、安全与公平性边界

- 只用于虚构剧本杀创作；不生成真实暴力、血腥过度描写，不设计可现实复刻的行凶手法。
- 诡计仅限虚构娱乐，不引导模仿犯罪，不产出猎奇或恐怖尺度超标内容。
- 线索必须对所有玩家可得；拒绝「只有上帝视角才能破案」的诡计；禁止通过强行降智制造难度。
- 交付内容固定附「创作声明」，提醒仅用于虚构剧本娱乐。

## 九、已知风险与修复建议

| 风险 | 影响 | 建议 |
| --- | --- | --- |
| 模型网关对函数调用（tool_calls）支持不稳定 | 结构化方案可能重试后仍失败 | 已做一次重试 + JSON 兜底；若持续失败，可在控制台切换 `AI_GATEWAY_MODEL` 到工具调用更稳的模型 |
| `web_search` 在本地未开通 | 检索降级为内置经验 | 线上确认平台已启用联网搜索；`WSA_API_KEY` 保留为后续直连备选 |
| 长会话 token 累积 | 接近上下文上限 | 已限制最近对话窗口；前端提示新建会话；建议长剧本按「设计 → 迭代」拆会话 |
| `context.utils.abort_active_run` 参数形态随平台版本变化 | 停止按钮可能只中断前端流 | 已做异常兜底；客户端断开时 `signal` 仍会中止图执行 |
| 前端非 SSE 的错误响应 | 可能显示为空回答 | 已识别 `application/json` 响应并转成错误提示 |
| 平台 checkpointer 会序列化 `configurable` | 放入 EnvConfig / 工具对象会导致 `MemoryStorageError` | 依赖改为闭包注入，`configurable` 仅保留 `thread_id`（已线上验证） |
| devDependencies 审计告警 | `npm audit` 在开发依赖中有 moderate/high 提示 | 生产依赖 `npm audit --omit=dev` 为 0；升级 Vite 主版本需单独评估 |

## 十、免责声明

本项目仅用于剧本杀虚构内容创作与娱乐，不构成任何现实行为指导。
