# 诡计设计师 · 剧本杀诡计工作台

> 一句话需求 → 一份可直接开本的剧本杀方案，外加一整套开本工具。

基于 **EdgeOne Makers Agents Runtime + LangGraph** 构建的剧本杀诡计设计 Agent。输入题材、人数、难度与诡计类型，自动联网检索经典套路与玩家雷点，流式输出完整诡计方案（含公平性自查、DM 提示、防杠要点），并提供沉浸式互动剧情、AI 封面生成与 DM 开本工具链。

## 项目亮点

| 能力 | 说明 |
| --- | --- |
| **分段流式生成** | 方案拆 3 段独立生成，各段独立超时/重试，任一段失败只丢一段，不再整体卡死 |
| **智能追问** | 需求有空白时先问 2~3 个带选项的关键问题；说「直接生成」可跳过 |
| **多方案对比** | 一次给出 A/B/C 三个创意方向，选定后展开完整方案 |
| **迭代修改** | 基于上一版增量调整（换诡计、加红鲱鱼、调难度），不被旧稿锚定 |
| **沉浸互动剧情** | 第二人称冒险模式，限时抉择 + 死亡/存疑/安全结局 + 死亡次数评级 + 隐藏真结局 |
| **AI 封面生成** | 通义万相 wan2.5，电影剧照风的人物海报 / 群像 / 场景三种风格，前端叠加排版 |
| **开本工具链** | DM 主持台（流程+线索清单+计时器）、证据链时间线、角色速览卡、救场手册 |
| **多格式导出** | 完整版/玩家版 Word、扑克式线索卡（裁开即用）、Markdown、PNG 封面 |

## 一、技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React + TypeScript + Vite（手写 CSS，无 UI 框架） |
| 后端 | Python 3.11 + LangGraph（多节点状态机编排） |
| 对话模型 | 阿里云 DashScope / 通义千问（qwen-plus、qwen-flash） |
| 生图模型 | 通义万相 wan2.5-t2i-preview |
| 检索 | 平台内置 web_search + 高德地图 API（天气/地点） |
| 存储 | EdgeOne Makers KV/Blob（LangGraph Checkpointer）+ 浏览器 localStorage |
| 文档生成 | docx（前端按需动态加载，不拖慢首屏） |
| 图形 | Canvas + SVG（封面合成、程序化封面） |
| 音效 | Web Audio API 实时合成（零音频文件） |

## 二、运行流程

```
用户输入
  └→ understand ──┬─(闲聊/咨询)──────────────→ compose → END
                  ├─(需要追问)─→ 输出问题 → END（等待回答）
                  └─(要方案)──→ research → design → extract → compose → END
                                   ↑                    ↑
                              联网检索经典套路      结构化提取
                              （失败自动降级）      线索/角色/时间线
```

| 节点 | 作用 |
| --- | --- |
| `understand` | 意图分类（new / iterate / question）+ 需求字段抽取 + 追问判断 + 对比模式识别 |
| `research` | 调用平台内置 `web_search` 检索经典诡计、常见套路、玩家雷点；失败自动降级 |
| `design` | 分 3 段流式生成：案件与诡计 / 凶手与线索 / 时间线与沉浸剧情 |
| `extract` | 轻量模型把 Markdown 提取为结构化摘要（供线索卡、沉浸模式、导出使用） |
| `compose` | 收尾成稿，附 DM 提示、防杠要点、可迭代方向 |

多轮记忆由平台 `context.store.langgraph_checkpointer` 以 `thread_id = conversation_id` 持久化，跨实例可恢复；**不依赖任何自建数据库**。

## 三、关键设计决策

### 1. 为什么分段流式生成

早期版本一次生成完整方案，模型思考 + 输出共享 token 预算，长方案经常在第 4~5 分钟被平台超时掐断，用户拿到的是一段半成品。

改造后：
- 方案拆成 3 段，每段有独立超时（`[115s, 85s]`）与全局截止时间
- 任一段超时只丢该段，其余部分正常交付，并给出「可补写」提示
- 已流出的内容保留在页面上，避免用户白等

### 2. 为什么做双解析兜底

结构化摘要由轻量模型（qwen-flash）提取，实测**不稳定**：偶发返回空结果或字段缺失。

因此前端不把结构化数据当作唯一来源：
- 优先后端 `extract` 的结构化结果
- 同时用 `src/lib/parsePlan.ts` 从**流式 Markdown 正文**现场解析角色表、线索表、时间线
- 两者合并，缺哪补哪

这样即使提取失败，沉浸模式和线索卡依然可用。

### 3. 追问与对比的状态机

用两个 state 字段驱动多轮分支：
- `pending`：已发出追问，等待用户回答
- `mode`：`compare`（等待选方向）/ `compared`（已选定，进入生成）

配套的意图兜底：明显的寒暄、能力咨询（「你好」「你能做什么」）降级为问答，避免新用户一进来就被抛一堆诡计专业问题。

### 4. SSE 心跳与断流降级

平台函数有执行时长上限，长任务容易在收尾阶段被断开。应对：
- 后端每 20 秒发一次心跳事件，避免中间层判定空闲
- 前端识别「正文已完整但收尾中断」的情形，**降级为提示而非报错**，并保留「从断点重试」入口

### 5. 前端性能

- docx 库（约 380KB）拆为独立 chunk，点击导出时才动态加载 → 首屏 JS 从 734KB 降到 351KB
- 首页鼠标跟随动画用 `requestAnimationFrame` 节流，避免高频 `mousemove` 触发过多渲染
- 历史方案书架写入 localStorage 时逐份淘汰重试，配额超限不会整批失败

## 四、项目结构

```
.
├── agents/                      # Makers 会话模式 Runtime（文件/目录即路由）
│   ├── _lib/                    # 私有包（_ 前缀不生成路由）
│   │   ├── app.py               # HTTP 入口：SSE、会话 CRUD、导出、AI 封面
│   │   ├── config.py            # 环境变量读取（密钥不落代码）
│   │   ├── graph.py             # LangGraph 工作流装配
│   │   ├── nodes.py             # understand / research / design / extract / compose
│   │   ├── models.py            # ChatOpenAI → 模型网关
│   │   ├── prompts.py           # 角色设定、安全边界、成稿结构约束
│   │   ├── schemas.py           # 结构化输出的 Pydantic Schema
│   │   ├── kb.py                # 本地知识库检索
│   │   ├── search.py            # 联网检索与结果归一化
│   │   ├── amap.py              # 高德天气/地点（失败静默降级）
│   │   └── state.py             # LangGraph State
│   ├── trick-designer/index.py  # POST /trick-designer
│   └── stop/index.py            # POST /stop
├── src/
│   ├── components/              # 聊天、沉浸模式、DM 主持台、时间线、角色卡等
│   ├── lib/api.ts               # SSE 解析、会话 CRUD
│   ├── lib/parsePlan.ts         # Markdown → 结构化方案（前端兜底解析）
│   ├── lib/exporters.ts         # 封面 SVG / Canvas 合成
│   ├── lib/docxExporters.ts     # Word 导出（按需加载）
│   ├── lib/shelf.ts             # 本地方案书架
│   ├── lib/sound.ts             # Web Audio 音效合成
│   └── App.tsx
├── edgeone.json                 # Makers 项目配置
└── package.json
```

## 五、本地调试

```bash
npm install
python -m venv .venv && source .venv/bin/activate
pip install -r agents/requirements.txt

npm i -g edgeone
edgeone makers link      # 同步控制台项目的环境变量
edgeone makers dev       # http://localhost:8088
```

校验：

```bash
npm run build                       # 前端类型检查 + 构建
python -m compileall agents         # 后端语法检查
```

## 六、接口约定

所有 `agents/*` 请求必须携带请求头 `Makers-Conversation-Id`（6–36 字符）。

| 路由 | 请求体 | 响应 |
| --- | --- | --- |
| `POST /trick-designer` | `{ "action": "chat", "message": "..." }` | SSE：`session / status / notice / meta / token / done / error` |
| `POST /trick-designer` | `{ "action": "retry" }` | 从 checkpoint 断点续跑 |
| `POST /trick-designer` | `{ "action": "sessions" }` / `"history"` / `"delete"` | 会话管理 |
| `POST /trick-designer` | `{ "action": "export" }` | 导出用完整方案 |
| `POST /trick-designer` | `{ "action": "ai_cover", "cover_style": "character" }` | Base64 封面图（style 可选 `character` / `group` / `scene`） |
| `POST /stop` | `{ "conversationId": "..." }` | 中止当前运行 |

## 七、异常与降级

- **联网检索失败/超时**：单条 25s 超时，失败仅提示，不阻断生成
- **结构化提取失败**：前端用 Markdown 解析兜底，功能不中断
- **某一段设计超时**：保留已生成内容，标注「待补充」，可让模型补写
- **模型超时/限流/鉴权失败**：统一转为中文友好提示，通过 SSE `error` 推送
- **收尾断流**：正文完整时降级为提示，保留断点重试入口
- **客户端断开**：监听 `signal` 中止图执行，避免无效 token 消耗

## 八、安全与内容边界

- 只用于虚构剧本杀创作，不生成真实暴力细节，不设计可现实复刻的行凶手法
- 线索必须对所有玩家可得，拒绝「只有上帝视角才能破案」的诡计
- 禁止靠降低玩家智商制造难度
- 交付内容固定附「创作声明」

## 九、已知限制

| 问题 | 现状 |
| --- | --- |
| 生图模型对多人小脸不稳定 | 已改用 wan2.5 + 电影剧照构图，人物占比放大 |
| 长会话 token 累积 | 已限制最近对话窗口，建议长剧本拆会话 |
| 平台函数执行时长上限 | 标准模式 4~5 分钟接近上限，收尾可能被断开（已有降级处理） |
| 生成中刷新页面 | 依赖 checkpointer 恢复，正在生成的段落可能需重试 |

> 注：`agents/_lib/knowledge/` 下的诡计方法论语料为作者原创整理，未包含在本公开仓库中；目录为空时检索自动降级，不影响运行。

## 十、免责声明

本项目仅用于剧本杀虚构内容创作与娱乐，不构成任何现实行为指导。
