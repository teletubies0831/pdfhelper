# PDFPal 知识图谱功能 · 架构与实施方案

> 状态：**阶段 1 已实施完成**，`pnpm check` 全绿（exit 0）。阶段 1 的实际落地范围与实施中新增的两条仓库约定见文末 §10。
> 目标：在现有 PDFPal 插件内新增"知识图谱构建"能力（文献为核心节点，知识实体为枢纽节点），纯前端、IndexedDB 存储、无后端。
> 本文档对应 `ARCHITECTURE.md` 的既有架构规则，所有新增代码必须通过 `pnpm check`。

---

## 1. 现有插件架构（实际读码结论）

### 1.1 工程与运行时

- **框架**：WXT 0.20 + TypeScript 5.9（strict + noUncheckedIndexedAccess）+ Vite（rolldown）。
- **目标**：Edge / Chrome，Manifest V3，版本 1.0.6。
- **构建入口**（`entrypoints/`，规则：≤25 行、只启动运行时）：
  - `background.ts` → `src/background/bootstrap.ts`
  - `viewer/main.ts`（9 行）→ 同步 `mountViewerShell()` 注入模板 + 动态 `import('app/bootstrap')`
  - `sidepanel/`、`selection-page/`、`tutorial/`
- **关键事实**：**没有 popup**。扩展图标 `action.onClicked` 首启开 Sidepanel，否则开 Viewer 标签页。

### 1.2 manifest（`wxt.config.ts` + 构建产物）

```jsonc
"permissions": ["tabs", "storage", "contextMenus", "sidePanel"],
"host_permissions": ["<all_urls>"],
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

- **CSP 是本功能的第一约束**：`script-src` 只允许 `'self'` + `'wasm-unsafe-eval'`。**没有 `unsafe-eval`**，因此任何依赖 `eval()` / `new Function()` 的图库或布局算法都会在运行时抛错。`wasm-unsafe-eval` 已存在（onnxruntime / transformers WASM 需要），所以 WASM 型布局引擎是可行的。
- `host_permissions: <all_urls>` 已覆盖用户自配 LLM endpoint，**新增图谱功能无需新增权限**（除非引入 alarms/offscreen，见 §7）。

### 1.3 分层与强制依赖规则

```text
entrypoints/                 只启动运行时
src/background/              后台消息路由、右键菜单、AI 网络请求（组合根，可 import 模块内部）
src/modules/*                6 个纯业务模块，对外只走各自 public.ts
src/infrastructure/          IndexedDB / Storage / PDF 文本抽取
src/viewer/core/pdf-reader/  PDF.js 原语层（不得依赖 features/services/shared-ui/app 装配层）
src/viewer/app/              装配：模板注入、elements、registrations、编排器、状态、hooks
src/viewer/features/         9 个功能（单向依赖，跨 feature 只能 import 对方 public.ts）
src/viewer/services/         模块 ↔ Viewer 的纯桥接
src/viewer/shared-ui/        跨功能共享 UI
src/viewer/templates/        HTML 模板（?raw 注入）
```

`scripts/check-architecture.mjs` **强制**（违反即 `pnpm check` 失败）：

| 规则 | 具体含义 |
|---|---|
| 跨 feature 导入必须走对方 `public.ts` | 新 feature 只能被别的 feature 通过 `public.ts` 引用 |
| 跨 module 导入必须走对方 `public.ts` | background 组合根豁免 |
| `src/**` 不得 import `entrypoints/**` | 入口只允许被入口引用 |
| `core/pdf-reader` 不得依赖 features/services/shared-ui/app（白名单 3 个文件） | 见上 |
| 跨组循环依赖禁止（Tarjan SCC，同组内环豁免） | 分组：feature / module / layer |
| 单文件 ≤ **700 行** | 判定用 `source.split(/\r?\n/).length` → 换行结尾文件实际 **≤699 行** |
| 入口文件 ≤ **25 行** | |
| 文件名禁 `v\d+` / `final` / `legacy` | `/\b(v\d+\|final\|legacy)\b/i` 作用于**含扩展名的 basename** |
| 模板 DOM id 全局唯一 | 只扫 `entrypoints/viewer/*.html` + `src/viewer/templates/*.html` |
| `requiredElement(...)` / `getElementById(...)` 的 id 必须存在于模板 | 命令 `check:element-ids`；**只认字符串字面量**，拼接 id 会绕过检查 |
| 标记 `@deprecated` 的文件不得被非入口代码 import | |
| `viewer/main.ts` 三个基础样式 import 必须存在且顺序正确 | pdfjs → katex → `./style.css` |

**非致命但会失败的告警规则**：文件路径不含 `repository|database|storage|migration|persistence` 却出现 `localStorage` / `indexedDB` → 架构告警（当前 1 条遗留）。**图谱所有持久化文件的文件名必须带 `repository` 或 `database`。**

**三条"没写在规则里但必须知道"的事实**：
1. **`src/viewer/services/` 完全没有架构约束**——它可 import 任意 feature 内部文件（`viewer-document-agent.ts` 已 import `features/assistant/chat-image-service` 这一内部文件）。图谱的"模块 ↔ Viewer 桥接"可放这里。
2. **跨 feature 规则只约束"源文件也在 `features/` 下"**。因此 `app/registrations/*` 与 `services/*` import feature 的 `public.ts` 是惯例（且必要），而不是被脚本强制。**但新增 feature 仍必须提供 `public.ts`**，否则其它 feature 无法合法引用它。
3. 多个不变式是**模块导入期 throw** 而非静默失败：`workspace-navigation.ts`（视图数）、`app-shell.ts`（root 缺失）、`register-pdf-runtime.ts`、`embedded-agent-tool-runtime.ts`（工具缺 handler）。**踩错 = 启动白屏，不是降级。**

### 1.4 现有存储

| 数据库 / 键 | 版本 | Store | 归属 |
|---|---|---|---|
| `pdf-helper-document-agent` | **4** | documents / chunks / sessions / visionCache / longTermMemories / paperLibrary | `infrastructure/database/workspace-database.ts` 集中管理 |
| `pdfpal-knowledge-vectors` | 2 | vectors（索引 `recordKey`、`modelId`） | knowledge 模块私有 |
| `pdf-helper-recent-files` | — | recent-files | recent-files feature 私有 |
| `browser.storage.local` | — | `pdf-helper-ai-connection-table-v1`（现行连接表）+ 3 个遗留键 | ai 模块 |
| `localStorage` | — | `pdf-helper-knowledge-library`、`pdf-helper-knowledge-corpus-v1`、`KNOWLEDGE_NOTES_STORAGE_KEY`、`READING_JOURNAL_STORAGE_KEY`、`SAVED_CARDS_STORAGE_KEY` 等 | knowledge / paper-card |

`workspace-database.ts` 提供的公共原语：`openDocumentAgentDatabase()`、`requestToPromise<T>(req)`、`transactionDone(tx)`、`ensureIndex()`；升级用 `onblocked` 拒绝并提示"关闭旧页面"。

### 1.5 已有可复用能力（本功能的价值支点）

| 能力 | 位置（已验证） | 对图谱的意义 |
|---|---|---|
| AI Provider 适配器 `chat(config, messages, maxOutputTokens, signal?)` | `modules/ai/providers/provider.ts:47-52` | 一次性非流式请求直接用 `adapter.chat()`；**无 options 参数，不支持 `response_format`** |
| 一次性请求路由 `handleAiRequest(message, onOverviewProgress?)` | `src/background/ai/request-handler.ts`（239 行，**是 if 链不是 switch**） | 新增 `pdf-helper:ai-*` 请求类型即接入；catch 统一返回 `{ok:false,error}`，从不抛出 |
| 一次性补全原语 `requestOverviewCompletion()` | `src/background/ai/overview-completion.ts`（30 行） | **强制 `reasoning:'disabled'` + 预算 8192 起、截断后 ×2 重试**的成熟模式；图谱抽取必须复用以避免"思考吃掉全部预算 → 空 content" |
| 背景服务先例 `related-literature-service.ts`（144 行） | 同上 | 已有"召回候选 → 只对 Top-K 调 LLM → 受控输出 → 失败降级不污染主数据"的漏斗范式，**关系判断直接照这个写** |
| 429 限流退避 | `modules/ai/providers/provider-rate-limit.ts`（98 行） | 按 `baseUrl+apiKey` 分片的内存队列，**仅在实际收到 429 后才排队**；识别 RPM 提示与 `Retry-After`；配额/欠费类错误直接抛出不再重试；最多重试 3 次 |
| **JSON 输出** | 全仓库 **零** `response_format` / `json_object` / `json_schema` 匹配 | ⚠️ **没有 JSON mode**。必须走"提示词要求 JSON + 防御式解析"路线，参照 `parseProfile`（`runtime-contracts.ts:88-122`：取首个 `{` 到末个 `}` 再逐字段校验）与 `parseReadingModeDetection`（剥 ```json 围栏 + 正则兜底） |
| 全文分块与取用 | `modules/document-agent/public.ts` → `getDocumentChunks(documentId)`（按 `order` 排序）、`replaceDocumentChunks`、`createDocumentAgentId`、`DocumentChunk{id,order,startPage,endPage,text,heading?,summary?,keywords?}` | **抽取输入就是 chunks，无需重新解析 PDF**；`startPage`/`endPage` + `heading` 天然提供证据定位；`initializeDocumentKnowledge` 首次建档时 `hasApiKey:false` 让打开 PDF **零 Token**（`viewer-document-agent.ts:50-118`） |
| 分块策略 | `document-chunker.ts`：paper **9000/500**、general 8000/450、novel 7000/600；chunk id `${documentId}:chunk:${order}`，正文带 `[Page N]` 前缀 | 图谱抽取按 chunk 授权，天然对齐现有粒度 |
| 本地 embedding | `HuggingFaceEmbeddingProvider`（139 行）：`pipeline('feature-extraction', id, {device:'wasm', dtype:'q8'})`，预设 `Xenova/bge-small-zh-v1.5`（**512 维，默认**）/ `all-MiniLM-L6-v2`（384）/ `bge-small-en-v1.5`（384）/ `multilingual-e5-small`（384，约 118MB） | 实体对齐与向量召回可零 API 成本；**调用方需自己分批（现有实现每批 8 条）** |
| 向量仓储 | `IndexedDbKnowledgeVectorRepository`（100 行）：DB `pdfpal-knowledge-vectors` v2、store `vectors`（keyPath `id`）、索引 `recordKey`/`modelId`；id = `modelId\0recordKey\0chunkIndex`；`embedding` 是**普通 `number[]`**；该库**从不 close** | 换模型/dtype 会自动失效缓存（`modelIndexId`），图谱复用同一范式即可零迁移 |
| Worker 先例 | `features/knowledge-base/knowledge-index.worker.ts`（110 行），创建方式 `new Worker(new URL("./x.worker.ts", import.meta.url), { type: "module" })`（`current-pdf-add-to-library.ts:182-185`） | WXT/Vite 下已跑通并产出独立 chunk（`assets/knowledge-index.worker-*.js` 565KB）；图谱布局 Worker 照此办理 |
| Markdown 渲染 | `shared-ui/markdown/markdown-renderer.ts`（655 行）：`renderChatMarkdown(element, markdown, false)`，marked + DOMPurify + katex | 证据/证据链展示；**注意该文件已 655 行，接近 700 上限，不要往里加东西** |
| 原文跳转 | `shared-ui/navigation/source-pdf-navigation.ts`（99 行）：`isSourcePdfCurrentlyOpen`、`ensureSourcePdfOpen(name, recentEntryId)`、`openSourcePdfInNewTab`、`openSourcePdfFromKnowledge` | **"点击实体跳回原文"零新增能力** |
| 精确证据高亮 | `core/pdf-reader/public` → `navigateToPdfPageWhenVisible(page)`；`features/translation/public` → `jumpToPdfCitations(page, quotes)`（`citation-and-summary.ts:493`，会等文本层、定位引文、画 10s 临时高亮层）；配套 `preserveReadingPositionForSourceNavigation()` | **"跳回证据原文并高亮"的正确 API 是 `jumpToPdfCitations`**（不是我一开始以为的 `navigateToDestinationWithoutReturnHistory`，后者只用于目录跳转且未从 `app/public.ts` 导出） |
| 现成的跳转编排范本 | `features/knowledge-base/knowledge-item-commands.ts:155-210`（`openSelectedKnowledgeSource`） | **逐行照抄即可**：`ensureSourcePdfOpen` → 校验 `pdfDocument.value` → clamp 页码 → 关页面 → 有 quote 走 `jumpToPdfCitations`，否则 `navigateToPdfPageWhenVisible` → `setStatus(...)` |
| 文档身份 | `app/document-identity.ts`：`getPdfFingerprint()`、`getDocumentChatId()`（= `createDocumentAgentId`） | paperId 的稳定键来源 |
| 对话/卡片身份匹配 | `features/assistant/paper-library-reader.ts` 的 `normalizeDocumentTitle` / `documentTitleMatches` | 实体对齐的字符串归一化可直接复用 |
| 一次性 AI 调用入口（Viewer 侧） | `shared-ui/markdown/markdown-renderer.ts:75` → `requestAiContent(messages, context, configOverride?, {signal, timeoutMs, routeId})`，默认超时 **120s** | 图谱抽取/判断走 `runtime.sendMessage`，与 document-agent 同一注入方式 |
| 依赖反转（hook）注入 | `app/application-navigation.ts:17` `setKnowledgeRenderHandler`；`app/knowledge-refresh.ts` `setKnowledgeRefreshHandler` + `notifyKnowledgeRefresh()`；以及 window 自定义事件 `pdf-helper:knowledge-corpus-change` | 图谱页照此新增自己的 `setGraphRenderHandler` 槽位，`app/` 不 import feature |

### 1.6 视图装配（新增一个工作区页面的完整改动面）

新增图谱页不是加一个文件，而是**必须同步改 5 处**，否则构建期断言会抛错：

1. `templates/workspace-stage.html` 的 `<!-- workspace-views -->` 占位由 `app/app-shell.ts` 用模板数组填充 → 加一行。
2. `app/workspace-navigation.ts`：`WorkspaceView` 联合类型 + `WORKSPACE_ORDER` + `workspaceElements` 映射。**该文件在模块顶层有硬断言**：`workspaceStageElement.children.length` 必须等于视图数量，否则 throw。
3. `app/elements/*-elements.ts` + `app/viewer-elements.ts` 聚合导出。
4. `app/application-navigation.ts`：`setCurrentApplicationView` 的联合类型与按钮 active/aria-current 处理。
5. `app/models/app-view-models.ts`：`PersistedAppView` + `PersistedAppViewState`；`app-view-persistence.ts` 读写；`app/app-view-restore.ts` 恢复。
6. `templates/toolbar.html` 的 `<nav class="toolbar-group ... workspace-tabs">` 加入口按钮。
7. `app/bootstrap.ts` 注册 `registerGraphEvents()`；新增 `app/registrations/register-graph-events.ts`。

**页面切换范式**（`openKnowledgeBasePage` / `closeKnowledgeBasePage`）：`openToken` 自增防竞态 → 切按钮 active → `setCurrentApplicationView(view)` → `transitionWorkspaceView(view)`（300ms 动画，`prefers-reduced-motion` 时直接 settle）→ `requestAnimationFrame` 内校验 token 与当前视图后再渲染 → 关闭时 `persistCurrentAppViewState()`。

---

## 2. 建议的 IndexedDB Schema

### 2.1 决策：新建独立数据库，不并入 document-agent

| 方案 | 结论 |
|---|---|
| 并入 `pdf-helper-document-agent`（v4→v5） | ❌ 该库被 document-agent + memory 共用，跨模块共享一个 version 会形成隐式耦合，任一模块升级都触发 `onblocked` 全页面阻塞提示 |
| **新建 `pdfpal-knowledge-graph`** | ✅ 与 `pdfpal-knowledge-vectors` 同构，图谱模块私有，独立 version 演进；**零迁移风险，不触碰现有 6 个 store** |

- DB 名：`pdfpal-knowledge-graph`
- 初始版本：`1`
- 打开逻辑、`requestToPromise` / `transactionDone` / `ensureIndex` 约定与 `workspace-database.ts` 完全一致（新仓储文件名含 `repository`，避免架构告警）。

### 2.2 Object Stores

> 用户原始需求里的 `papers` 与现有 `paperLibrary`（`pdf-helper-document-agent`）职责重叠。**建议 `papers` 只存"图谱视角的论文投影"**（title/year/authors/venue/doi/abstract/folderId + 抽取状态），通过 `paperId` 与 `documentAgentId`/`fingerprint` 关联，不做第二份真相源。若你希望绝对单一真相源，可改为不建 `papers`、运行时 join `paperLibrary`；代价是每次渲染要看两个库。**默认采用"投影表"方案，便于纯前端离线渲染与导出。**

#### `papers` — keyPath `paperId`
```
paperId            string   // = createDocumentAgentId(fingerprint, name, numPages)
documentAgentId    string   // 关联 document-agent documents.id
fingerprint        string
title              string
year               number|null
authors            string[]
venue              string
doi                string
abstract           string
folderId           string|null
extractionStatus   'none'|'queued'|'extracting'|'ready'|'error'
extractionError    string|null
extractedAt        number|null
createdAt          number
updatedAt          number
```
索引：`folderId`、`year`、`fingerprint`、`extractionStatus`

#### `entities` — keyPath `entityId`
```
entityId       string   // `entity:<uuid>`
name           string
normalizedName string   // 归一化后建索引，用于同名合并
aliases        string[]
type           'Method'|'Task'|'Dataset'|'Metric'|'Concept'|'Claim'
status         'pending'|'confirmed'|'rejected'|'merged'
confidence     number   // 0..1
sourcePaperId  string
evidence       Array<{ paperId, pageNumber, chunkId?, quote, chunkHeading? }>
mergedInto     string|null  // status='merged' 时指向存活实体
userEdited     boolean
createdAt      number
updatedAt      number
```
索引：`name`、`normalizedName`、`type`、`status`、`sourcePaperId`

#### `edges` — keyPath `edgeId`
```
edgeId          string   // `edge:<uuid>`
source          string   // paperId | entityId | `user:self` | `folder:<id>` | `tag:<id>`
sourceKind      'paper'|'entity'|'user'|'folder'|'tag'
target          string
targetKind      'paper'|'entity'|'note'|'highlight'|'folder'|'tag'
type            EdgeType
direction       'directed'|'undirected'   // SIMILAR_TO / RELATED_TO 为 undirected
confidence      number
evidence        Array<{ paperId, pageNumber, quote, chunkId? }>
sourcePaperId   string|null   // 产生该边的论文（原始需求要求）
origin          'ai'|'rule'|'user'   // 关系判断来源，可溯源/可审计
originKey       string|null   // 幂等键：如 `pair:<a>|<b>|<type>` 或 `cite:<doi>`
provenance      { model?, connectionId?, promptVersion?, judgedAt? }
createdAt       number
updatedAt       number
```
索引：`source`、`target`、`type`、`sourcePaperId`、`origin`、`originKey`（唯一，用于**去重/不重复请求**）、复合查询用 `type` + `source`

> **幂等键 `originKey` 是"缓存不重复请求"的关键**：AI 关系结论写入时用 `pair` 规范化（小 id 在前）生成确定性键，`index(originKey, {unique:true})` 直接挡住重复 LLM 调用。

#### `notes` / `highlights` / `folders` / `tags`
按需求建档，字段与需求一致；`notes`/`highlights` 建 `paperId` 索引，`folders` 建 `parentId` 索引，`tags` 建 `name` 索引。
意图：这些 store 是图谱的**用户侧投影**（个人数据默认私有），`User -> Paper/Entity` 边落在 `edges`。

#### `extractionJobs` — 新增（需求未列，但异步/重试/断点必需）
```
jobId        string
paperId      string
kind         'entity-extraction'|'relation-judgement'|'entity-alignment'
status       'queued'|'running'|'done'|'failed'|'cancelled'
attempts     number
lastError    string|null
cursor       { chunkIndex?, pairIndex? } | null   // 断点续跑
createdAt    number
updatedAt    number
```
索引：`paperId`、`status`、`kind`

#### `vectors` — 新增（可复用独立库，也可放 `pdfpal-knowledge-vectors`）
```
id        string   // `${subjectKind}:${subjectId}:${modelId}`
subjectKind 'paper'|'entity'
subjectId  string
modelId    string
vector     Float32Array
updatedAt  number
```
索引：`subjectKind`、`subjectId`、`modelId`

> 若希望省一个库，`vectors` 可直接复用 `pdfpal-knowledge-vectors`（该库已有 `recordKey`/`modelId` 索引，`recordKey` 用 `graph-paper:<paperId>` / `graph-entity:<entityId>` 前缀即可零迁移复用）。**推荐复用**。

#### `settings` — keyPath `key`
```
key: 'graph-settings'
value: {
  autoExtractOnImport: boolean
  minConfidenceToAutoCheck: number      // 默认 0.75
  entityMergeSimilarityThreshold: number // 默认 0.86
  relationTopK: number                   // 默认 5
  maximalRecallCandidates: number        // 默认 40
  maxConcurrentAiRequests: number        // 默认 2
  embeddingMode: 'off'|'local'|'api'
  ignoredEntityNames: string[]           // "不再提示"
  schemaVersion: number
}
```

### 2.3 边类型枚举（含需求未列但对话/用户侧必需的）

```ts
type PaperPaperEdge = 'CITES'|'EXTENDS'|'IMPROVES'|'COMPARES_WITH'|'SIMILAR_TO';
type PaperEntityEdge = 'PROPOSES'|'USES'|'EVALUATES_ON'|'REPORTS'|'MENTIONS';
type EntityEntityEdge = 'ALIAS_OF'|'PART_OF'|'RELATED_TO'|'SUBCLASS_OF';
type UserEdge = 'IN_FOLDER'|'HIGHLIGHTED'|'TAGGED'|'ANNOTATED_AS'|'MENTIONED_IN_NOTE';
type EdgeType = PaperPaperEdge | PaperEntityEdge | EntityEntityEdge | UserEdge;
```
另建议增加阶段 1 兼容边 `HAS_KEYWORD`（需求阶段 1 明确要求，阶段 2 起降级为可选层，可由用户开关关闭）。

---

## 3. 需要新增 / 修改的模块清单

### 3.1 新增模块 `src/modules/knowledge-graph/`（纯业务，无 DOM）

```text
knowledge-graph/
├── public.ts                          组合根 + 对外唯一出口
├── contracts.ts                       全部实体/边/任务/设置类型 + 边类型常量
├── domain/
│   ├── graph-node.ts                  GraphNode 联合类型与判别
│   ├── graph-edge.ts                  GraphEdge、EdgeType、方向/置信度规则
│   ├── entity-normalization.ts        归一化：小写/全半角/去空白/去中英标点/单复数
│   ├── entity-similarity.ts           编辑距离(Levenshtein/最优字符串对齐) + token Jaccard + 余弦
│   └── candidate-scoring.ts           漏斗打分的纯函数（引用/共享实体/同folder/向量）
├── application/
│   ├── graph-repository-facade.ts     组合根：装配仓储与端口
│   ├── entity-extraction-service.ts   编排抽取（分块 → 批量 LLM → 落 pending）
│   ├── entity-confirmation-service.ts 多选确认 → confirmed + 建 Paper→Entity 边
│   ├── entity-alignment-service.ts    同名直并 + 相似度阈值建议合并 + 合并执行（重挂边）
│   ├── candidate-recall-service.ts    零成本粗筛 + 向量召回（O(N·K)）
│   ├── relation-judgement-service.ts  仅 Top-K 调 LLM + 幂等缓存
│   ├── graph-query-service.ts         邻接表/子图/过滤/搜索（内存图，无图数据库）
│   ├── personal-graph-service.ts      笔记/高亮/文件夹/标签 → 用户边
│   └── graph-transfer.ts              导出/导入 JSON（版本化 + 校验 + 冲突消解）
├── ports/
│   ├── graph-repository.ts
│   ├── entity-repository.ts
│   ├── edge-repository.ts
│   ├── extraction-job-repository.ts
│   └── graph-settings-repository.ts
└── adapters/indexed-db/
    ├── knowledge-graph-database.ts    DB 名/版本/store 常量 + open()
    ├── indexed-db-graph-repository.ts
    └── browser-storage-graph-settings-repository.ts
```

**为什么单独建模块**：符合"模块描述保存什么、基础设施负责怎么保存、界面不直连 IndexedDB"，且能被 AI 助手经 MCP 复用（§5.4）。

### 3.2 新增 Viewer feature `src/viewer/features/knowledge-graph/`

```text
features/knowledge-graph/
├── AGENTS.md                       按 knowledge-base 既有约定加作用域说明
├── public.ts                       只导出被 app 注册层与（将来）其他 feature 需要的符号
├── knowledge-graph-page.ts         页面编排：open/close/refresh（照抄 openKnowledgeBasePage 范式）
├── graph-view-elements.ts          本 feature 的 DOM 句柄（若 id 多，也可放 app/elements）
├── graph-canvas-renderer.ts        Canvas 2D 渲染 + 交互（hit-test / 缩放 / 平移）★ ≤700 行
├── graph-force-layout.ts           力导向布局（自研或 WASM），可放 Worker
├── graph-layout.worker.ts          大图布局 Worker（≥N 节点时启用）
├── graph-subgraph-view.ts          子图构建（当前论文 / 主题 / 邻居 N 跳 / 全图）
├── graph-filter-panel.ts           类型/年份/置信度/文件夹/标签过滤 + 搜索
├── graph-inspector-panel.ts        节点/边详情：属性 + 证据 + 跳回原文
├── entity-review-dialog.ts         候选多选确认卡片（分组、全选、编辑、合并、忽略、不再提示）
├── entity-merge-dialog.ts          相似实体合并确认（逐条/批量）
├── relation-analysis-panel.ts      "分析关系"触发 + 进度 + Token 预估
└── graph-*.css                     样式（按职责拆分，避免单文件超限）
```

**图库选型（关键决策）**

| 方案 | 体积 | CSP 风险 | 结论 |
|---|---|---|---|
| **自研 Canvas 2D + 自研力导向**（推荐） | **0 KB 新增依赖** | **零风险**（纯 2D context，无 eval） | ✅ **默认推荐**。已有 Canvas 经验（`ink-eraser`、批注层）；节点数用子图+聚合同步控制；`requestAnimationFrame` + `OffscreenCanvas`/Worker 可平滑 |
| Cytoscape.js | ~300KB min / ~90KB gzip | 需实测（其选择器编译路径在部分版本依赖动态函数构造，受 `script-src 'self'` 限制） | ⚠️ 若要采用，**必须先做一次 dev 构建实测**，不能只看文档 |
| AntV G6 v5 | 打包 ~1.8MB、tree-shaking 差（见下方社区 issue） | 中 | ❌ 体积与现有"`bootstrap` chunk 已 1.1MB"的现实冲突 |
| Vis.js / D3 | D3 需按模块引入；vis-network 体积大 | 低 | ⚠️ 备选 |

> 参考：[AntV G6 #7105 打包体积 1.8M](https://github.com/antvis/G6/issues/7105)、[G6 #7539 无 tree-shaking](https://github.com/antvis/G6/issues/7539)、[Chrome MV3 CSP 参考](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy.md.txt)
> 现有产物规模基线（`.output/edge-mv3`）：`chunks/bootstrap-*.js` 1142 KB、`knowledge-index.worker-*.js` 565 KB、`ort-wasm...wasm` 23 MB。**图谱功能应避免再引入大依赖。**

**关于 Dexie.js**：现有代码全部是**手写 IndexedDB 封装**（`requestToPromise`/`transactionDone`/`ensureIndex`）。引入 Dexie 会形成第二套持久化范式，与 `pnpm check` 的架构意图（"存储键、数据库版本和迁移逻辑属于基础设施"）及既有代码风格冲突。**建议不引入 Dexie**，沿用现有工厂函数模式（新增一个 `knowledge-graph-database.ts`），保持范式统一。

### 3.3 修改既有文件清单

| 文件 | 改动 | 风险 |
|---|---|---|
| `src/modules/ai/contracts.ts` | 新增 3 个请求类型 interface + 加入 `AiRuntimeRequest` 联合 + **加入 `isAiRuntimeRequest` 手写字符串白名单**（漏掉任一处消息会被静默丢弃） | 中（两处手写清单，易漏） |
| `src/background/ai/request-handler.ts` | 新增 3 个 `if (message.type === ...)` 分支（**是 if 链不是 switch**，默认兜底是普通 chat，新分支要放在它之前） | 低 |
| `src/background/ai/`（新文件） | `entity-extraction-service.ts`、`relation-judgement-service.ts`（照 `related-literature-service.ts` 范式，均 <300 行） | 低 |
| `src/viewer/templates/knowledge-graph.html`（新） | 图谱页（必须放进 `#workspace-stage`）；`<div>` 必须配平；**所有 id 全局唯一** | 中 |
| `src/viewer/app/app-shell.ts` | `?raw` 导入 + 替换数组加一行（+ 新对话框放进根 overlay 数组） | 低 |
| `src/viewer/app/workspace-navigation.ts` | 联合类型 + `WORKSPACE_ORDER` + `workspaceElements` + 顶层断言文案 | **高**：三者与模板必须严格一致，否则**模块导入期 throw，启动白屏** |
| `src/viewer/app/application-navigation.ts` | `setCurrentApplicationView` 联合类型 + 按钮 active/`aria-current`（顺带可清理死成员 `"journal"`） | 低 |
| `src/viewer/app/models/app-view-models.ts`、`app-view-persistence.ts`、`app-view-restore.ts` | 新增 `"graph"` 视图 + 图谱页字段；**注意 `app-view-persistence.ts:31-37` 还会再校验一次视图字符串** | **中**：漏改则刷新后回退到 viewer（不崩但体验断裂） |
| `src/viewer/app/elements/knowledge-graph-elements.ts`（新）+ `viewer-elements.ts` | `requiredElement<T>("id")` 句柄 + `export *` 聚合（`viewer-elements.ts` 现为 9 行 barrel） | 低 |
| `src/viewer/templates/toolbar.html:91-98` | `nav.workspace-tabs` 加"知识图谱"入口按钮 + 图标 | 低 |
| `src/viewer/app/bootstrap.ts` | `registerKnowledgeGraphEvents()` | 低 |
| `src/viewer/app/registrations/register-knowledge-graph-events.ts`（新） | 事件装配 + 注入 `setGraphRenderHandler` 槽位 | 低 |
| `entrypoints/viewer/style.css` | `@import` 图谱 CSS（**feature CSS 从不被 TS import**） | 低 |
| **`src/viewer/templates/reader-workspace.html`（170-457 行是设置面板）** | ⚠️ **设置对话框不在 `overlays.html`**，在 `reader-workspace.html` 的 `#assistant-settings-panel`。新增 `data-settings-tab="graph"` 按钮 + `data-settings-panel="graph"` 面板 | **中**：需 6 处同步改（见 §3.4） |
| `src/viewer/features/assistant/settings-primary-transition.ts:1-12` | `SettingsPrimaryPanelName` 联合 + `PANEL_ORDER` | 低 |
| `src/viewer/app/registrations/register-assistant-events.ts:257-269` | `data-settings-tab` 点击白名单加 `"graph"` | 低 |
| `src/viewer/features/assistant/settings-navigation.ts:512-530` | `updateSettingsFooter()` 增加 footer 文案分支 | 低 |
| `src/viewer/app/elements/assistant-elements.ts` | 新设置区元素句柄 | 低 |
| `public/_locales/zh_CN/messages.json` 等 | 新文案 | 低 |
| `package.json` + `scripts/` | 新增 `test:knowledge-graph` 等契约测试并接入 `pnpm check`（现为 18 个测试） | 低 |
| `ARCHITECTURE.md` / `README.md` | 记录新模块与新 feature | 低 |

> **未改动**：`core/pdf-reader/`、`modules/document-agent/`、`modules/memory/`、`modules/knowledge/`、`workspace-database.ts`、以及现有 7 类 AI 请求的行为。**因此不破坏现有阅读、笔记、RAG 功能**（验收标准之一）。

### 3.4 设置区新增"知识图谱"分节的 6 个触点（已验证）

设置面板的**唯一真相源是 HTML**（`reader-workspace.html:181-186` 的 `role="tablist"` + `:188-444` 的 `#settings-pages`），Tab 与面板句柄在 `assistant-elements.ts:117-125` **于模块加载时一次性 querySelectorAll 捕获**——所以**不能运行时注册**，必须写进初始模板。

1. `reader-workspace.html`：tablist 加按钮，`#settings-pages` 内加 `<div class="settings-page" data-settings-panel="graph" hidden>`。
2. `settings-primary-transition.ts`：union + `PANEL_ORDER`。
3. `register-assistant-events.ts:257-269`：点击白名单。
4. `settings-navigation.ts` `updateSettingsFooter()`：footer 文案。
5. `assistant-elements.ts`：元素句柄。
6. `features/assistant/settings-*.css`：样式。

图谱设置项建议放这里：自动抽取开关、置信度阈值、合并相似度阈值、Top-K、并发数、embedding 模式、导出/导入、清理缓存。

---

## 4. 分阶段实现计划

### 阶段 1 · MVP（骨架可跑通，先证明链路）
1. `knowledge-graph-database.ts`：建 `pdfpal-knowledge-graph` v1，6 个 store + 索引 + 幂等键唯一索引。
2. `papers` 投影表 + 与 `document-agent` 的 `createDocumentAgentId`/`getDocumentChunks` 对接；文档打开时 upsert 投影行。
3. 图谱页面 + 工具栏入口 + 视图装配 7 处改动 + 持久化/恢复。
4. **零依赖 Canvas 自研渲染器**：节点/边绘制、缩放平移、hover、click；节点 = Paper + Keyword 共现，边 = `CITES` / `HAS_KEYWORD`。
5. `graph-query-service`：邻接表、子图、过滤、搜索（内存实现）。
6. 交付：能看见第一个可交互图谱；`pnpm check` 全绿。

### 阶段 2 · 实体图谱（本功能的主体价值）
7. `entity-extraction-service`（模块）+ `entity-extraction-service`（background，走 `adapter.chat`）：分块 → 按类型批量抽取 → 每候选带 `name/type/confidence/evidence{pageNumber,quote}` → **只写 `status:'pending'`**。
8. 异步触发：文档 `processingStatus` 转为 `ready`（或首次进入图谱页）时入 `extractionJobs` 队列；**不阻塞阅读 UI**。并发受 `maxConcurrentAiRequests` 限制。
9. `entity-review-dialog`：按类型分组、高置信度默认勾选、低置信度折叠、全选/全不选/按组选、手动添加、忽略、不再提示、编辑名称/类型、合并同义词 → 确认后写 `confirmed` + 建 `Paper→Entity` 边。
10. `entity-normalization` + `entity-similarity` + `entity-alignment-service`：
    - 完全同名（归一化后）→ **静默合并**（`mergedInto` + 重挂边，保留 `aliases`）。
    - 相似度 > 阈值 → 生成 `ALIAS_OF` 建议边，**提示用户确认**（不静默）。
    - `Transformer` / `Transformer模型` 归一化到同一键。
11. 共享实体自动成边：两篇论文确认同一实体 → 建立 `Paper→Entity` 各一条，**图谱查询时按实体自然形成文献间接连接**（不写 Paper→Paper 边，不花 Token）。
12. 交付：实体枢纽图谱 + 多选确认 + 合并 + 快速索引查询。

### 阶段 3 · 个性化与智能
13. `personal-graph-service`：`notes`/`highlights`/`folders`/`tags` 同步入图（`IN_FOLDER` / `HIGHLIGHTED` / `TAGGED` / `ANNOTATED_AS` / `MENTIONED_IN_NOTE`），UI 上用虚线/弱化样式区分"用户边"，并提供隐私开关。
14. `relation-analysis-panel` + `relation-judgement-service`（按需触发）：
    - **粗筛（0 Token）**：引用关系、共享实体数、同 `folderId`、年份接近度。
    - **向量召回（可选）**：本地 embedding（零 API 成本）或用户 embedding API；向量缓存到 `pdfpal-knowledge-vectors`，内存算余弦。
    - **只对 Top-K（默认 5）候选对**调 LLM，输出严格 JSON `{type, confidence, evidence}`。
    - 写 `edges` 时带 `originKey` 幂等 → **重复点击不重复请求**；失败进 `extractionJobs.attempts` 重试，超限标记 failed 并保留原因。
    - **复杂度 O(N×K)**，禁止 O(N²)。
15. 阅读器联动：点击实体/边 → `openSourcePdfFromKnowledge(documentName, recentEntryId, pageNumber)` 跳回原文对应页；证据高亮用 `quote` + `pageNumber`。
16. 交付：按需深度关系 + 可溯源证据 + Token 可控。

### 阶段 4 · 规模化
17. 增量更新与冲突消解：重抽取时按 `originKey`/`normalizedName` 做 upsert；实体被合并后新边自动重挂到存活实体；提供"孤儿实体"清理。
18. 大图性能：子图渲染 + 邻居 N 跳 + 度数/社区聚合（"折叠节点"）+ Worker 布局 + 视口裁剪 + 分页加载；节点上限阈值以上自动降级为聚合视图。
19. 导出/导入 JSON（版本化 + 校验 + 冲突策略：跳过/覆盖/合并），支持完整备份与迁移。
    - **这是本仓库的第一个用户数据导出能力**。现状核实：除"带批注 PDF 导出"（`pdf-attachment-service.ts`，PDF 专用）外，**不存在**通用 JSON 下载助手、不存在 IndexedDB 遍历导出、不存在导入校验工具；唯一 JSON 导入是"知识库笔记导入"（`knowledge-import-and-capture.ts`，接受裸数组 / `{notes}` / `{items}`，逐字段强制转换 + 重新生成 id + 追加不去重）。
    - 应照抄的**版本化约定**（已验证的三种）：批注 codec `{format:"pdf-helper.annotations", version:1}` + `parseEmbeddedHelperPayload()` **严格校验、不匹配返回 `null`、不抛异常、无迁移路径**；knowledge 仓储 `{schemaVersion:1, records:[...]}`；ai 连接表把版本写进**键名**（`…-table-v1`）并保留唯一的真实迁移函数 `migrateLegacy`。
    - 建议图谱快照：`{format:"pdfpal.knowledge-graph", version:1, exportedAt/savedAt: ISO字符串, papers, entities, edges, …}`；`parseGraphSnapshot(): GraphSnapshot | null` 严格校验；id 用 `crypto.randomUUID()`（非热路径可不加 guard，热路径照 `createDocumentTabId()` 的 `typeof crypto.randomUUID === "function"` 写法），持久身份用 `graph-node:<uuid>` 这类**命名空间复合键**（与 `getKnowledgeRecordKey("knowledge-note", id)` 同构）。
    - **无 `structuredClone` 先例**（全仓库 0 处），深拷贝一律走显式 codec（`toJsonSafeAnnotationValue`）或 `JSON.parse(JSON.stringify())` 往返。图谱导出若含 `Float32Array` 向量，需自己写 JSON-safe 包装（照 `{__pdfHelperTypedArray:"Float32Array", values:[…]}`）。
20. 评估指标：抽取准确率（抽样人工标注）、用户采纳率（确认/候选比）、平均 Token/论文、边重复请求命中率。

---

## 5. 关键消息通信与 API 设计

### 5.1 分层职责（严格遵守现有架构）

```text
Viewer feature（DOM/交互）
   ↓ 调用模块 public.ts
modules/knowledge-graph（纯业务：归一化、相似度、打分、仓储端口、编排）
   ↓ 需要 LLM 时，走 runtime.sendMessage
Background（组合根）
   provider-runtime.getProviderAdapter(config) → adapter.chat(...)
   ↓ 结果回传
Viewer 写回 IndexedDB（经模块仓储）
```

> **关键**：LLM 网络请求**必须留在 background**（与现有 7 类请求一致，避免 Viewer 持有 Key 直连带来的 CSP/生命周期问题），而**IndexedDB 读写留在 Viewer/模块**（background 是 Service Worker，随时可能被回收，不适合长任务落库）。

### 5.2 新增 3 个运行时请求（加入 `AiRuntimeRequest`）

```ts
// 1) 候选实体抽取（长任务，分批）
export interface AiExtractEntitiesRequest {
  type: 'pdf-helper:ai-extract-entities';
  requestId: string;
  paperId: string;
  paperTitle: string;
  chunks: Array<{ chunkId: string; heading?: string; startPage: number; endPage: number; text: string }>;
  entityTypes: Array<'Method'|'Task'|'Dataset'|'Metric'|'Concept'|'Claim'>;
  maxCandidatesPerChunk: number;   // Token 闸门
}

// 2) 关系判断（仅 Top-K 对，按需）
export interface AiJudgeRelationsRequest {
  type: 'pdf-helper:ai-judge-relations';
  requestId: string;
  pairs: Array<{
    pairKey: string;                    // 幂等键（规范化，小 id 在前）
    left:  { paperId: string; title: string; summary: string };
    right: { paperId: string; title: string; summary: string };
    sharedEntities: string[];
    recallReasons: string[];            // 命中原因，供模型参考
  }>;
  allowedEdgeTypes: PaperPaperEdge[];   // CITES/EXTENDS/IMPROVES/COMPARES_WITH/SIMILAR_TO
}

// 3) 实体等价判定（歧义兜底，可选）
export interface AiJudgeEntityEquivalenceRequest {
  type: 'pdf-helper:ai-judge-entity-equivalence';
  requestId: string;
  candidates: Array<{ leftName: string; rightName: string; contexts: string[] }>;
}
```

**复用而非新增的部分**：
- `AiRuntimeResponse` 形状直接复用（`{ok, content?, error?}`），图谱服务返回**已解析并校验的 JSON 字符串**；Viewer 侧再做 schema 校验（沿用 `zod@4`，已是依赖）。
- 进度上报复用 `pdf-helper:ai-document-overview-progress` 的同款模式（**注意该进度消息刻意不在 `AiRuntimeRequest` 联合里**，是 fire-and-forget 广播 + `requestId` 匹配），图谱用 `pdf-helper:ai-graph-progress`。
- 截断/思考模式处理**必须**复用 `requestOverviewCompletion()`（`reasoning:'disabled'` + 预算 8192 起、`finishReason === 'length'` 时 ×2 重试），否则图谱抽取在推理模型上会"思考吃掉全部输出预算 → `content` 为空"。
- **没有 JSON mode**：全仓库零 `response_format`/`json_object`/`json_schema`。必须提示词要求 JSON + 防御式解析，照 `parseProfile`（取首个 `{` 到末个 `}` 再逐字段校验，失败抛带中文说明的错误）和 `parseReadingModeDetection`（剥 ```json 围栏 + 正则兜底）。**图谱的解析器要放在模块 domain 里并写单测**，这是最容易出 bug 的一环。
- 超时预算：provider 单请求硬超时 **120s**（`deepseek-provider.ts` 内自建 AbortController），Viewer 侧 `requestAiContent` 默认也是 **120s**。→ **每批 chunk 数必须控制在单次 120s 内**，这也是"分批 + 断点续跑"的另一个理由。
- 并发与批量既有取值：embedding `embedDocuments` **每批 8 条**（调用方自己切批）；chunk 摘要入库截断 3000 字符；profile 合成输入上限 24000 字符。图谱抽取的 token 预算应参照这些量级。
- 限流：`provider-rate-limit.ts` 自动生效（**仅在实际 429 后排队**，最多重试 3 次，配额/欠费类错误直接抛出）。图谱侧再加**并发闸门 + 指数退避 + 任务级 attempts**，避免 Token 浪费（验收标准）。
- Service Worker 保活：现有 `withAiRequestLifetime` 每 20s ping `getPlatformInfo()` 保活。**注意 `pauseForBrowser()` 用的是 `window.setTimeout`，background 里不可用**——图谱的长任务不能指望它，必须靠"分批 + 落库断点"。

### 5.3 模块对外 API（`modules/knowledge-graph/public.ts`）

```ts
// 组合根（单例）
export const knowledgeGraphRepository: KnowledgeGraphRepository;
export const entityExtractionService: EntityExtractionService;
export const relationJudgementService: RelationJudgementService;

// 查询
export function buildAdjacency(edges: GraphEdge[]): AdjacencyIndex;
export function buildSubgraph(input: {
  focusPaperId?: string; focusEntityId?: string;
  hops: number; edgeTypes: EdgeType[]; minConfidence: number;
}): GraphSubgraph;

// 归一化 / 相似度（纯函数，重点单测对象）
export function normalizeEntityName(name: string): string;
export function entitySimilarity(a: string, b: string): number;
export function suggestEntityMerges(entities: GraphEntity[], threshold: number): MergeSuggestion[];

// 漏斗召回（纯函数，重点单测对象）
export function recallCandidatePairs(input: {
  papers: GraphPaper[]; confirmedEdges: GraphEdge[];
  vectors?: Map<string, Float32Array>; folders: Map<string, string>;
}): CandidatePair[];   // 返回已排序、已截断到 maxCandidates 的候选，**保证 O(N·K)**

// 导出 / 导入
export function exportGraphSnapshot(repo: KnowledgeGraphRepository): Promise<GraphSnapshot>;
export function importGraphSnapshot(repo: KnowledgeGraphRepository, snapshot: unknown, strategy: 'skip'|'overwrite'|'merge'): Promise<ImportReport>;
```

`GraphSnapshot` 为版本化 JSON：`{ schemaVersion, exportedAt, papers, entities, edges, notes, highlights, folders, tags, settings }`，导入前用 `zod` 校验，**不合法即拒绝且不写库**。

### 5.4 可选：MCP 工具（让 AI 助手能查图谱）
在 `modules/ai/mcp/agent-tool-catalog.ts`（15 工具唯一来源）追加 2~3 个工具，例如：
- `graph.searchEntities(query, type?)`
- `graph.getPaperNeighbors(paperId, hops)`
- `graph.explainEdge(edgeId)`

并相应更新 `agent-tool-handlers.ts` 与命名映射表（注意 `ARCHITECTURE.md` §11-⑤：目前已有三套工具命名，**新增时应只用目录内的单一命名**，不要再引入第四套）。

---

## 6. 前端交互流程

### 6.1 候选实体确认（用户干细活的主界面）

```text
[文档就绪] ──异步──▶ 抽取候选（不阻塞 UI）
                        │
                        ▼
              entities(status='pending')
                        │
        图谱页出现"待确认 N 个候选"角标
                        │
                        ▼
   ┌──────── 候选确认卡片（模态） ────────┐
   │ ☑ 方法 Method (6)        [全选][清空] │  ← 高置信度默认勾选
   │   ☑ Transformer      0.95  "…原文…"  │
   │   ☑ Attention        0.92  "…原文…"  │
   │ ☐ 任务 Task (4)          [全选][清空] │  ← 低置信度默认折叠
   │   ☐ …（展开后）                      │
   │ 每行操作：✎改名称  ⇄改类型  ⊘忽略  ⊘不再提示 │
   │ 底部：合并同义词 | 手动添加 | 取消 | 确认入图 │
   └──────────────────────────────────────┘
                        │ 确认
          ┌─────────────┴─────────────┐
          ▼                           ▼
  entities → 'confirmed'      建 Paper→Entity 边
  （归一化同名 → 合并）        （PROPOSES/USES/EVALUATES_ON/…）
```

- 多选是**一等公民**：每行 checkbox + 每组 全选/清空 + 全局 全选/全不选。
- 合并同义词：在卡片内多选若干候选 → "合并为…" → 选主名 → 生成 `ALIAS_OF` + 存活实体。
- 确认操作是**单事务**：`entities` 状态更新 + 边创建在一次 `readwrite` 事务内 → 不会出现"实体已确认但没边"的半成品。
- 撤销：确认后提供一次性"撤销本次确认"（按 `jobId` 反查）。

### 6.2 图谱页布局

```text
┌ 工具栏 workspace-tabs: [PDF 阅读][知识库][单词库][知识图谱] ◀ 新增 ────────┐
├──────────────────────────────────────────────────────────────────────────┤
│ ← 返回 PDF   [全图][当前论文][主题][个人图谱]   🔍搜索   ⛭过滤  ⤓导出 ⤒导入 │
├───────────────┬──────────────────────────────────┬───────────────────────┤
│ 过滤面板       │                                  │ 详情检查器            │
│ ☑ Paper       │        Canvas 图谱舞台           │ ┌ 选中：Transformer ┐ │
│ ☑ Method      │   ●───●  Paper 节点（较大）       │ │ 类型 Method  0.95 │ │
│ ☑ Task        │      ╲ │                         │ │ 别名 ×2           │ │
│ ☑ Dataset     │       ◉  Entity 枢纽             │ │ 相关论文 (7) →    │ │
│ ☑ Metric      │      ╱ │                         │ │ 常用数据集 (3)    │ │
│ ☑ Concept     │   ●───●                          │ │ 相关方法 (5)      │ │
│ ── 年份 ──     │  实线=AI边 虚线=用户边            │ ├ 证据 ─────────── │ │
│ 2019 ─ 2026   │  箭头=方向 粗细=置信度            │ │ p.4 "…原文片段…"  │ │
│ ── 置信度 ──   │                                  │ │ [跳回原文 p.4]    │ │
│ ≥ 0.60 ▁▃▅▇   │  [Zoom +][−][Fit][⚙ 布局]        │ └───────────────────┘ │
│ ── 文件夹/标签 ─│  右下：节点 N / 边 M / 已折叠 K    │ 关系分析： [分析关系] │
└───────────────┴──────────────────────────────────┴───────────────────────┘
```

### 6.3 点击行为（验收标准"点击节点/边显示属性和证据"）

| 目标 | 详情面板内容 | 主动作 |
|---|---|---|
| **Paper 节点** | 年份、作者、venue、DOI、摘要、文件夹、标签、方法实体列表、笔记、高亮数 | `openSourcePdfFromKnowledge(name, recentEntryId, page)` 跳回原文 |
| **Entity 节点** | 类型、置信度、别名、相关论文列表（按共享强度排序）、关联数据集、关联方法；来源论文 | 展开邻居 / 跳回来源论文对应页 |
| **边** | 关系类型、方向、置信度、来源论文、创建时间、`origin`(ai/rule/user)、模型与 promptVersion | 显示原文证据（Markdown 渲染）；跳回证据页 |

所有边**必须**能展示 `evidence[]`；若某边无证据（如规则推导的 `IN_FOLDER`），面板明确标注"规则推导，无原文证据"，不伪装成 AI 结论。

### 6.4 空态与引导
- 无 `papers`：提示"打开一篇 PDF 即开始建图"。
- 有 `papers` 无 `entities`：「开始抽取候选实体」（预估 Token，可取消）。
- 有 `pending`：角标 + 「待确认 N 个」。
- 无 AI Key：图谱仍可用（阶段 1 的引用/关键词层 + 手动添加），AI 动作置灰并给出设置入口。

---

## 7. 浏览器插件特有限制与风险点

### 7.1 MV3 Service Worker 生命周期（**最高风险**）
- **风险**：SW 会被回收（通常 30s 空闲，长任务亦可能被中断）。实体抽取是"逐块多次 LLM 调用"，**不可能**在单次 SW 生命周期内完成。
- **对策**（分层，不引入新权限）：
  1. **任务状态落 IndexedDB（`extractionJobs`）+ 断点 `cursor`**：每完成一块就持久化进度。SW 被杀后，由 Viewer 侧（页面仍活着）重新发请求续跑。
  2. **并发闸门**：`maxConcurrentAiRequests`（默认 2）+ 指数退避，避免同时多个 chunk 请求拖长 SW 存活需求。
  3. **单次请求保持短小**：每块抽取限制 `maxCandidatesPerChunk`，控制单次响应时长。
  4. 可选增强：引入 `chrome.alarms` 做"稍后续跑"调度（**需新增 `alarms` 权限**）；
     或 `offscreen document` 承载长任务（**需新增 `offscreen` 权限**，且要新增 `entrypoints/offscreen/`）。
     → **建议先不加权限**，阶段 1-3 用"Viewer 页面驱动的续跑队列"即可；阶段 4 若实测 SW 中断率影响体验，再评估加权限（当前 manifest **完全没有** `alarms`/`offscreen`/`declarativeNetRequest`，保持最小权限是产品优势）。

### 7.2 CSP（**第二高风险，直接决定图库选型**）
- `extension_pages: script-src 'self' 'wasm-unsafe-eval'`：**无 `unsafe-eval`/`unsafe-inline`**。
- 影响：任何用 `eval` / `new Function` 的布局或渲染库会直接抛错；内联事件属性（`onclick="…"`）与内联 `<script>` 一律不可用（现有代码全是 `addEventListener`，**新增代码必须沿用**）。
- 对策：**自研 Canvas 2D 渲染器（0 依赖、0 风险）**；若选第三方库，必须先做一次真实 dev 构建 + 打开图谱页实测，而不是依赖文档。

### 7.3 host_permissions 与网络
- `<all_urls>` 已覆盖用户自配 endpoint，**无需新增权限**。
- 若采纳"用户 embedding API"，复用 `normalizeAiBaseUrl`（强制 HTTPS，仅 localhost 允许 HTTP，禁内嵌凭据、禁查询参数）。
- Worker 与 WASM：`HuggingFaceEmbeddingProvider` 已解决"MV3 不能执行 blob: 模块"的问题（`useWasmCache=false` + 从扩展源加载 WASM + `numThreads=1`）。**若图谱的布局 Worker 也要加载 WASM 布局引擎，必须复用同一套处理**，否则会踩同一个坑。

### 7.4 存储配额
- 图谱数据量：Paper/Entity/Edge 都是小记录，**不是瓶颈**；真正的增长点是向量与证据引文。
- 对策：`evidence.quote` 截断（建议 ≤200 字）+ 只存 `chunkId`/`pageNumber` 回查原文；向量用 `Float32Array`（非 number[]）存储；提供"清理向量缓存 / 清理已忽略候选 / 压缩证据"入口。
- 现有 23MB WASM + 模型缓存已占用可观配额，图谱导出/导入可作为跨设备迁移手段。

### 7.5 消息通信竞态
- 现有模式：`runtime.sendMessage` + `requestId` 匹配 + `openToken`/`workspaceTransitionToken` 防竞态。图谱必须沿用：**同一 `paperId` 的重复抽取请求要用 `requestId` 去重**，切页/关页时中止 UI 回调但**不中断落库**。
- 一次性请求与流式 Port：图谱用**一次性请求**（无增量价值 + 需要完整 JSON），不新增 Port。

### 7.6 与现有功能的隔离风险
- **`workspace-navigation.ts` 顶层硬断言**是新增视图最容易被忽略的破坏点（构建期不报，运行期 throw 白屏）。**必须同步改**，且 `check-element-ids` 只校验 id 存在性、不校验视图数。
- `app-view-persistence` / `app-view-restore`：新增 `"graph"` 视图若漏改恢复逻辑，刷新后会回到 viewer（不崩，但体验断裂）。
- **不改动 `core/pdf-reader/` 与 3 个既有 DB**，是"不破坏现有阅读、笔记、RAG"的结构性保证。
- 图谱页与知识库页共享"返回 PDF"、"跳回原文"能力 → 复用 `shared-ui/navigation` 与 `openSourcePdfFromKnowledge`，**不要复制一份**。

### 7.7 Token 成本风险（验收标准的核心）
- **禁止**：`papers × entities` 全量两两比较；禁止每次进图谱页重新抽取。
- **保证机制**：`recallCandidatePairs()` 是纯函数、有上限、可单测；`edges.originKey` 唯一索引让重复判断在写入层被物理阻断；`extractionJobs` 记录已跑过的 `paperId`（内容指纹不变则跳过）。
- **可观测性**：面板显示"本次估算 Token / 已完成 / 跳过（命中缓存）"，让用户看得见漏斗效果。

### 7.8 其余风险点
| 风险 | 说明 | 对策 |
|---|---|---|
| 模型输出非法 JSON | 推理模型易截断/加解释文字 | 复用 `requestOverviewCompletion`；`zod` 严格校验；失败不落库、进重试 |
| 实体爆炸 | 一篇论文可抽出上百候选 | 每块候选数上限 + 置信度阈值 + 低置信度默认折叠 + "不再提示" |
| 归一化过度合并 | 如 `BERT` / `BERT-based` 被误并 | 静默合并**仅限归一化完全相等**；相似一律**用户确认** |
| 删论文留下孤边 | | 删除走"引用计数 + 级联清理"，并入 `extractionJobs` 清理 |
| 700 行文件限制 | 渲染器 + 交互容易超 | 一开始就拆成 `canvas-renderer` / `force-layout` / `filter-panel` / `inspector-panel` |
| **700 行余量已经很薄** | 检查脚本的 `lineCount = source.split(/\r?\n/).length`，即**换行结尾文件实际 ≤699 行**。当前最接近上限的是 `features/vocabulary-library/styles.css`（692 脚本行）、`features/assistant/chat-messages.css`（691）、`settings-navigation.ts`（683）、`paper-library-card.css`（672）、`reader-workspace.html`（636）、`register-assistant-events.ts`（603） | ⚠️ **新增设置区时 `reader-workspace.html`（636）与 `settings-navigation.ts`（683）都只剩几十行余量**；图谱设置面板内容建议放进独立模板/独立 feature，不要塞进 `settings-navigation.ts` |
| 中文文案与 i18n | 现有 `_locales/zh_CN` | 新文案进 `messages.json`，不硬编码 |
| 用户反馈 API 不统一 | 无通用 toast：`setStatus(msg, isError)`（`app/status-bar.ts`，11 行，仅 `textContent` + error class，**无自动消失、无队列**）、`showSettingsStatus(msg, kind)`（设置区专用，success 5s / info 8s 自动消失）、`setKnowledgePageStatus`（知识库页专用）、以及一个**未导出**的私有 toast `showBackgroundIndexNotice`（`current-pdf-add-to-library.ts:38-60`，带进度条） | 图谱页用 `setStatus`；设置区用 `showSettingsStatus`；**长时间抽取的进度 toast 需要把那个私有实现提升为共享 API 或自行实现**（别复制第二份） |
| label 扫描的边界 | `check-element-ids.mjs` 同时校验 `requiredElement(...)` 与 `getElementById(...)` 的**字符串字面量**；动态拼接 id 会绕过检查（不受保护） | 图谱元素句柄一律用字符串字面量，别拼字符串 |

---

## 8. 验收标准自查表

| 验收项 | 方案如何满足 |
|---|---|
| 纯前端、无后端 | 全部逻辑在扩展内；仅调用用户自配 LLM/embedding endpoint |
| 数据全在 IndexedDB，可导出/导入 | `pdfpal-knowledge-graph`；`graph-transfer.ts` 版本化 JSON |
| 新增论文不触发 O(N²) LLM | `recallCandidatePairs` 有 `maximalRecallCandidates` 上限 + Top-K=5 + `originKey` 幂等 |
| 用户可多选 / 合并同义词 / 手动添加 | `entity-review-dialog` + `entity-merge-dialog` |
| 共享实体自动建立文献间接连接 | Paper→Entity 边 + 内存邻接表二跳查询，0 Token |
| 图谱可交互，点节点/边显示属性与证据 | Canvas 渲染 + `graph-inspector-panel` |
| 每条边可溯源到原文 | `edges.evidence[{paperId,pageNumber,quote}]` + `openSourcePdfFromKnowledge` |
| Token 可控、深度关系按需 | 仅在点击"分析关系"时触发；面板显示估算与缓存命中 |
| 不破坏现有阅读/笔记/RAG | 不改 `core/pdf-reader`、不改 3 个既有 DB、不改模块 public 契约（只增量） |
| 符合 MV3 与 CSP | 零新增依赖优先、零新增权限、`addEventListener` + 无 eval |

---

## 9. 已确认的关键决策（全部按推荐项落地）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 图库 | **自研 Canvas 2D**（0 依赖、0 CSP 风险；视觉语义完全自控） |
| 2 | Dexie | **不引入**（保持手写 IndexedDB 范式） |
| 3 | `papers` | **独立投影表**，并已用 `shouldWriteProjection` 把"不是第二真相源"写成可测规则 |
| 4 | `HAS_KEYWORD` | **阶段 1 保留**（无 AI Key 时的兜底层，已实现） |
| 5 | 权限 | **不加** `alarms`/`offscreen`（manifest 权限保持不变） |
| 6 | 本地 embedding | **默认 `off`**，设置三档 off/local/api（归一化已强制 `off` 兜底） |
| 7 | 交付顺序 | 阶段 1→4 逐阶段交付，每阶段跑全量 `pnpm check` |

---

## 10. 阶段 1 实施结果（已完成）

### 10.1 新增文件

```text
src/modules/knowledge-graph/
├── public.ts                                       对外唯一出口 + openKnowledgeGraph() 组合根
├── contracts.ts                                    类型与边类型常量（保持零运行时 import 的叶子）
├── domain/
│   ├── graph-identity.ts                           originKey / 边端点规范化 / 置信度钳制
│   ├── graph-query.ts                              邻接表 / 子图 BFS / 共享实体间接相连
│   ├── paper-projection.ts                         论文投影 + 增量同步 + 删除检测
│   ├── paper-projection-plan.ts                    投影版本常量 + 是否需重写的判定
│   ├── graph-render-model.ts                       纯几何与视觉编码（可无 DOM 单测）
│   └── graph-settings.ts                           设置归一化（越界值必被钳制）
├── application/
│   ├── keyword-layer.ts                            关键词边 + 关键词节点物化
│   └── graph-service.ts                            refreshGraphProjection / loadGraphSnapshot
└── adapters/indexed-db/
    ├── knowledge-graph-database.ts                 DB 常量 + open + promise helper
    └── knowledge-graph-repository.ts               仓储（含 originKey 唯一索引写入）

src/viewer/features/knowledge-graph/
├── public.ts · knowledge-graph-page.ts             页面控制器（open/close/筛选/交互）
├── graph-canvas-renderer.ts                        Canvas 绘制 + hit-test（样式已外置到 domain）
├── graph-force-layout.ts                           确定性力导向布局（种子化，无 Math.random）
├── graph-viewport.ts                               缩放/平移/适应画布 + 钳制
├── graph-inspector.ts                              论文/实体/边三种详情 + 证据 + 跳原文
├── graph-source-navigation.ts                      跳回来源 PDF 指定页
├── graph-theme.ts                                  调色板 + origin 文案
└── styles.css                                      页面样式

src/viewer/templates/knowledge-graph.html           图页面模板（id 全局唯一、div 配平）
src/viewer/app/elements/knowledge-graph-elements.ts 元素句柄
src/viewer/app/models/graph-models.ts               图谱页视图状态（StateCell）
src/viewer/app/registrations/register-knowledge-graph-events.ts  事件装配
scripts/test-knowledge-graph.mjs                    契约测试（约 60 条断言）
```

### 10.2 修改的既有文件

`app-shell.ts`、`workspace-navigation.ts`（视图联合/顺序/映射/断言/可见性探测 5 处一次改完）、`application-navigation.ts`、`app-view-models.ts`、`app-view-persistence.ts`、`app-view-restore.ts`、`feature-models.ts`、`viewer-elements.ts`、`bootstrap.ts`、`toolbar.html`、`entrypoints/viewer/style.css`、`package.json`、`tsconfig.json`。

另修 3 个既有浏览器测试的视图白名单（它们自行拼装 `#workspace-stage`，新增页面后子元素数与断言不符）：`test-workspace-vocabulary.mjs`、`test-toolbar-hit-targets.mjs`、`test-responsive-workspace.mjs`。

### 10.3 实施中新增的两条仓库约定（后续阶段请沿用）

1. **`tsconfig.json` 启用 `allowImportingTsExtensions`**，`src/modules/**` 内部相对 import 带 `.ts` 扩展名。
   原因：`scripts/test-*.mjs` 用 Node 原生类型剥离直接跑领域模块，Node 不做扩展名推断；纯类型 import 会被擦除所以既有测试没暴露这个问题。该开关只放宽、不强制，既有代码无需改动。
2. **`contracts.ts` 必须保持"零运行时 import"的叶子模块**。
   原因：`domain/*` 需要从 contracts 取运行时常量时会产生 `contracts → … → domain` 环。做法是把这类常量（如 `KNOWLEDGE_GRAPH_PROJECTION_VERSION`）声明在真正使用它的无依赖模块里，再由 contracts/public 转发。

### 10.4 阶段 1 验证结果

```text
pnpm check → exit 0
  typecheck（strict + noUncheckedIndexedAccess）        ✅
  19 个测试（含新增 test:knowledge-graph）              ✅ 0 failures
  check:architecture（274 个 TS 文件）                  ✅ 跨组循环为 0
  check:element-ids（424 个模板 id / 390 引用）         ✅ 0 错误
  build（wxt build -b edge）                            ✅
  check:production                                      ✅
```

- **Graphviz 页面未白屏**：`workspace-navigation.ts` 的顶层断言与模板子元素数一致；`test-workspace-vocabulary` 与 `test-toolbar-hit-targets` 在真实无头浏览器里完成了 `viewer ↔ knowledge ↔ graph ↔ vocabulary` 的切换并断言了 `hidden/inert` 状态。
- **包体影响**：`bootstrap` chunk 1142KB → 1178KB（+36KB，含图谱页、渲染器、布局与样式），无新增运行时依赖。
- **零新增权限**：manifest 权限仍为 `tabs, storage, contextMenus, sidePanel`。

### 10.5 阶段 1 未覆盖（留给阶段 2+）

- `entities` 目前**只承载关键词物化节点**；真实候选实体的抽取、`pending/confirmed/merged` 状态流转、多选确认 UI 由阶段 2 落地（字段与索引已就位，无需迁移）。
- 布局在 320 节点以上降级为 90 次迭代预览；Worker 化与聚合折叠属阶段 4。

### 10.6 阶段 2 前置件（已完成）

阶段 2 的两块"纯逻辑、高风险、可独立验证"的部分先行落地，其余（LLM 抽取、确认 UI）仍待阶段 2 正式开工。

**实体对齐（`domain/entity-normalization.ts` + `domain/entity-similarity.ts`）**

- 归一化拆成两个互不混淆的用途：`normalizeEntityName` 是**相等键**（归一化相同 ⇒ 可静默合并）；`tokenizeEntityName` 只喂**相似度评分**（只能产生待用户确认的建议）。
- 相等键覆盖：全/半角、大小写、变音符号、Unicode 上下标（`BERTₗᵢₙₖ` = `BERTlink`）、版本尾缀（`v2` / `(2017)` / `[preprint]`）、中英通用描述词尾缀（模型/算法/方法/网络/框架/机制/技术 + model/algorithm/method/approach/framework/architecture/network/technique/mechanism/scheme/strategy/pipeline）、复数、标点与分隔符。
- 评分用 编辑距离 + 字符 3-gram Dice + **模糊词元重叠** + 可选 embedding 余弦；无向/空名/幂等性都有专门断言。
- 阈值带（**实测标定，非拍脑袋**）：真实变体落在 **0.88–0.98**，完全不同的实体最高只到 **0.79**（`ResNet` vs `ResNeXt`），`0.86` 恰好落在空白带里。
- **关键实测发现**：描述词变体（`Transformer` / `Transformer Model` / `…Networks` / `…Architecture`）在归一化后就是**精确匹配**，根本不会进入评分路径。因此评分的实际职责只剩"真正的措辞差异"（复数/拼写/语序）。这一点已写进模块注释，避免后来者误以为评分承担了描述词归并。
- 另一个实测发现：**精确集合 token Jaccard 对实体名是错误度量**——一个字符的拼写错误会把 1.0 打到 0.5，把近乎相同的名字压到任何合理阈值之下。已改为模糊词元重叠（词元相似度 ≥0.8 记为命中）。
- `suggestEntityMerges` 增加**复核带**（`ENTITY_SIMILARITY_REVIEW_FLOOR = 0.7`）与 `autoSelectable` 标记：长名字里的单字符拼写（如 `Transformer Encoder` / `Transformer Enocder`，0.776）会被列出但**不预勾选**——分数不足以替用户下结论，但也不该让用户完全看不见。
- 存活方判定：证据更多者存活；同证据比创建时间，再比 id → **跨刷新确定性**。

**Schema v2（`KNOWLEDGE_GRAPH_DATABASE_VERSION` 1 → 2）**

提前建好阶段 2/3 需要的 5 个 store：`extractionJobs`、`notes`、`highlights`、`folders`、`tags`（含索引）。理由：它们不参与阶段 1，但独立库升版本只影响本功能；一次建齐可避免在用户已装版本上二次迁移。新增 `contracts-jobs.ts`（任务记录与 `cursor` 断点、`inputFingerprint`）与 `contracts-user-graph.ts`（用户侧记录）。

**验证**：`pnpm check` → exit 0（20 个测试，含新增 `test:entity-alignment`）。

### 10.7 阶段 2 核心：抽取解析 + 确认/合并（已完成）

**新增文件**：`application/candidate-parsing.ts`（模型输出 → 候选实体）、`application/entity-planning.ts`（纯函数：确认计划 + 合并计划）、`application/entity-service.ts`（服务层：读→计划→单事务落库）、`domain/edge-rules.ts`；仓储新增 `applyEntityPlan()`（entity+edge **单事务**）。

**设计要点**

- **先纯算、后单事务**：确认操作必须是原子的——用户点"确认"绝不能出现"实体已标 confirmed 但没有任何 `Paper→Entity` 边"的半成品，而这正是多次独立写入在页面中途关闭时会产生的状态。所有规则在纯函数里算好，仓储只做一次性写入。
- **匹配到已有实体而不是新建 twin**：这是"共享实体自动建立文献间接连接"的落地机制——两篇论文确认同一归一化实体 → 同一个 `entityId` + 两条边 → 二跳可达，**0 Token**。
- **`inputFingerprint` / `originKey` 双重幂等**：重复确认命中唯一索引而不产生重复边。
- **"不再提示"按归一化键**：忽略 `Transformer` 也会一并抑制 `Transformer模型`。
- **合并后保留 tombstone**：被吸收实体写 `status:'merged'` + `mergedInto`，其 name 进入存活者的 `aliases`，避免下次抽取把旧拼写"复活"成第二个实体；合并时先删旧 `originKey` 再写新边（否则唯一索引会拒绝重定向后的键）。

**契约测试查出 4 个真实 bug**（全部已修，这正是先行写纯逻辑的价值）：

1. **`parseEvidence` 提前返回**：`evidence` 字段缺失时直接 `return []`，跳过了"回退到 chunk 页码"的逻辑 → 候选实体丢失证据定位，违背"每条边可溯源"的承诺。
2. **`pickCanonicalEntity` 未排除 tombstone**：候选可能落到 `status:'merged'` 的记录上，导致别名链分叉、下次对齐会把旧名字复活成第二个实体。
3. **同一批次内的重复候选产生 twin**：查表用的是**原始入参数组**而不是工作集，同一响应里出现两次同一实体时会建两个实体。
4. **同一批次内重复候选产生重复边**：两条边**同一个 `originKey` 但不同 `edgeId`** → 真实事务里唯一索引会拒绝并**中止整批确认**。改为按身份（`entityId` / `originKey`）归并计划行。

**另外两处标定**（测试驱动，非拍脑袋）：

- 百分数识别窗口收窄为 `2..100`：`1.5` 这种越界值按"钳制为确定"处理，而不是除以 100 变成 0.015——后者会把真实实体藏到自动勾选阈值之下。置信度只影响预勾选与视觉权重，不影响正确性，所以"偏向确定"是安全方向。
- `USES` 等**有向边**的 `originKey` 保留端点顺序（`USES|p2|e-keep`），不排序；只有 `SIMILAR_TO` / `RELATED_TO` 才规范化顺序。测试原先按排序写，属于测试错了。

**验证**：`pnpm check` → exit 0（21 个测试；架构检查 282 个 TS 文件）。

### 10.8 阶段 2 抽取管线（已完成）

**新增文件**：`application/extraction-plan.ts`（提示词 + 分批计划，纯函数）、`application/job-policy.ts`（任务生命周期与游标，纯函数）、`adapters/indexed-db/extraction-job-repository.ts`、`src/background/ai/entity-extraction-service.ts`（仅做网络调用）。

**AI 请求接入**（第 8 类）：`AiExtractEntitiesRequest` + `AiRuntimeRequest` 联合 + **`isAiRuntimeRequest` 手写白名单** + `request-handler.ts` 的 `if` 链分支（放在默认 chat 兜底之前）+ `AiRuntimeResponse.entityExtraction`（批次元数据）。**一次请求带上整篇的 chunks**，而不是每 chunk 一次请求：调用方是 Service Worker，消息之间可能被回收，往返越少孤儿任务越少。

**提示词与分批为什么放在图谱模块而不是 background**：`src/background/**` 在本仓库无法被契约测试覆盖（没有对应的测试装载器），放进去就只能靠真实浏览器验证。提示词与分批是**图语义**（实体是什么、一次调用能带多少正文），因此移到 `modules/knowledge-graph/application/extraction-plan.ts`，background 侧只留"发请求"。**这是本轮修正的一个设计失误**：最初写在 background，测试一跑就因 Node 无法解析无扩展名 import 而失败。

**分批策略**：按 **chunk 身份**分批（而非朴素拼接），因为失败的批次要能映射回具体 chunk，重试要发出同样的分组，游标才有意义。上限取 `min(3 个 chunk, 30000 字符)`；**单个超预算的 chunk 仍会发送**（丢弃会静默丢内容，模型侧会明确报错）。

**任务生命周期（`job-policy.ts`）—— 这是 MV3 断电存活的关键**：

- `attempts` 达到 `MAX_JOB_ATTEMPTS(3)` 后才 park 为 `failed`；**可重试的失败回到 `queued` 而不是 `running`**，否则后续 resume 会把手死掉的尝试误认为在跑。
- **失败不清空游标**：进度必须活过失败，这正是游标存在的意义。
- 退避 `1s → 2s → 4s`，上限 30s，**刻意保守**——provider 层已有自己的 `Retry-After` 感知队列，这里的退避只针对瞬时错误，不应叠加成分钟级等待。
- `extractionInputFingerprint` 用 **chunk id + 各 chunk 字符数 + promptVersion + 候选上限** 构成，而不是正文哈希：长度变化足以捕捉真实编辑（重新解析、换分块策略），但**不需要为了决定是否跳过而把每篇论文的每个 chunk 都读一遍**——这是"省 Token"与"读放大"之间的取舍。
- 指纹变化即失效：重新索引（chunk 数变）、换提示词版本、改候选上限、正文被编辑，四种情况都有断言。

**契约测试查出的问题**：

- 新增 `test:entity-extraction-pipeline`（分批确定性、超预算 chunk 不丢、提示词必须包含六个类型枚举与"不得用 Keywords"「必须有原文证据」、任务状态机、指纹失效、游标算术）。
- **在既有 `test:ai-contracts` 里补上请求类型白名单断言**：`isAiRuntimeRequest` 是手写清单，background 监听器对未通过的类型是**静默丢弃**（不报错、不响应，调用方直接挂住）。现在 8 个类型逐一 pin 住，将来加了契约却忘了加白名单会在构建期失败，而不是变成一个永远没有回应的消息。
- 本轮的失败断言里有 1 处是**测试写错**（把 `'fp-1'` 指纹的 job 拿去匹配另一个指纹并期望可 resume），代码是对的。

**验证**：`pnpm check` → exit 0（22 个测试；架构检查 286 个 TS 文件）。

### 10.9 阶段 2 抽取编排（已完成）

**新增文件**：`domain/concurrency.ts`（有界并发执行器）、`application/pending-candidates.ts`（候选 upsert 计划）、`application/extraction-runner.ts`（编排）。游标单位由 chunk 改为 **batchIndex**（与 `planExtractionBatches` 的分批 1:1 对齐，避免"chunk 游标映射到变长批次"的 off-by-one）。设置新增 `extractionMaxCandidatesPerChunk`(默认 12) 与 `maxConcurrentExtractionBatches`(默认 2)。

**每批提交，而不是最后一次性提交**：MV3 worker 会在批次之间被杀。若直到最后才落库，每次中断都会丢弃**已经成功的批次——Token 已经付过**。所以每批解析后立刻 upsert 候选并写游标；副作用是候选**立即可见**（"AI 干粗活"那一半）。这要求写入可重入——同一批跑两次必须什么都不改，已由测试锁定。

**游标只跨连续成功推进**：`contiguousCompletedCount` 保证游标不会跳过失败批次。若跨过去，该批会被标记完成、重试时被跳过，**静默丢失那些实体与已花的 Token**。

**并发闸门**：provider 层已有 429 队列，但那是**撞到限流之后**才反应；执行器负责不让图谱成为撞限流的原因。`limit <= 1` 走明确的顺序路径，而不是 worker 池的特例。

**几个刻意的决定**：

- **候选 upsert 匹配 = 归一化名 + 类型**，不只是名字。同一字符串可以是两种东西（"BLEU" 既是指标也可能是数据集名），静默合并是**错误合并**，而错误合并会丢知识。归一化名负责命中已有实体，类型负责不误并。
- **pending 阶段不建边**。候选是*建议*，只有用户确认才成为图关系（走 `planEntityConfirmation`）。若为 pending 候选写 `MENTIONS` 边，未确认的 AI 猜测就进了图，"待确认"筛选会变成装饰。
- **抽取永不把候选升级为 confirmed**：只有显式用户确认能提升状态。重复抽取不得静默确认任何东西。
- **无变化不写**：`updatedAt` 不变，否则每一遍都像是"有变化"。这是可重入性的实现细节，但很容易漏。
- **同一篇论文不能并发抽取两次**（模块级 `activeRuns` 锁）：否则同一结果花两倍 Token，并让两个写者竞争同一批实体。

**编排器全部依赖注入**（chunk 加载、任务读写、实体读写、provider 调用、设置）。这不是形式主义——真实依赖是 IndexedDB 与网络 provider，而这里被测的规则恰好是"错了就丢 Token 或静默污染图谱"的那些，没有注入就一条都测不了。

**契约测试**（`test:extraction-runner`）覆盖：并发不超限且确实达到上限、单个任务失败不拖垮整轮、中止后不留下数组空洞、连续成功计数、upsert 可重入（同批两次 = 零写入）、同批内重复候选折叠、同名不同类型不并、tombstone 不收证据、无索引时明确报错、已完成作业跳过（0 Token）、指纹失效强制重跑、**从批次 1 断点续跑只发送批次 2**、parked 作业不再花 Token、**失败批次不推进游标且兄弟批次成果保留**、9 chunk→3 批的并发、并发锁、取消后已提交成果保留。

**本轮修的自身问题**：`pending-candidates.ts` 一开始规划了 `MENTIONS` 边却直接丢弃（`edgeByOriginKey` 始终为空）——属于自相矛盾的死代码，已删除并写明"pending 不建边"的理由。另有 `suggestEntityMerges` 误写为 `planEntityMerges` 并错取 `.suggestions`、`ExtractionJobRecord` 从错误的 barrel 导入，均已修正。

**验证**：`pnpm check` → exit 0（23 个测试；架构检查 289 个 TS 文件）。

### 10.10 阶段 2 接线与确认 UI（已完成 —— 阶段 2 端到端可用）

**新增文件**：`viewer/features/knowledge-graph/graph-extraction-repository.ts`（真实 ports 绑定）、`entity-review-dialog.ts`（多选确认对话框）、`templates/knowledge-graph-overlays.html`、`review-dialog.css`。

**真实 ports（唯一知道 IndexedDB / 分块仓储 / 消息传输的地方）**

- `loadChunks` 直接读 `getDocumentChunks(documentId)`，过滤空正文后映射为抽取用的 chunk —— **不需要重新解析 PDF**。
- `requestEntities` 直接用 `browser.runtime.sendMessage`，**不复用 viewer 的 `requestAiContent`**：那个 helper 是聊天形状的（缺 Key 时会弹出设置面板），而长时间抽取需要拿到原始信封以便就地报错，而不是劫持 UI。超时 180s（provider 单请求上限 120s + 批处理余量），因为这里挂住会永久占住执行器的并发槽。
- 把"不可测试的面积"收敛到这一个文件，其余规则都在注入式模块里被契约测试覆盖。

**确认对话框（`entity-review-dialog.ts`）**

- 多选是一等公民：行内勾选 + 每组全选/清空 + 全局全选/全不选。
- **高置信度默认勾选，其余列出但不勾选**；"显示低置信度候选"开关的判定与预勾选共用同一阈值，两者不会出现不一致。
- 可改名、改类型；改动后该行标记 `data-dirty` 并高亮，且汇报"人工修正 N"，**不静默应用**。
- 行内"忽略"（保留记录、之后仍可确认）与"不再提示"（写入忽略名单，按归一化键，之后抽取不再提示）。
- 确认按**论文分组**提交，因为确认计划是围绕单篇论文的 `Paper→Entity` 边构建的；边类型用 `MENTIONS`——确认只代表"这篇论文提到了它"，不等于"使用了它"。
- **关闭路径统一**：Escape 与背景点击都走 `close` 事件解析 Promise，而不是每个按钮各自 resolve，否则 Esc 会让调用方永久挂起。

**图谱页接线**：头部新增「抽取候选实体」「待确认 N」「进度读数」；抽取进度显示在页头而非模态，因为抽取要几分钟，期间用户必须能继续阅读与拖拽图谱。抽取完成后自动刷新角标、重载快照、并刷新已打开的确认对话框。

**这一轮修的问题**：`isGraphVisible` 被我误删（`getElementById` 契约之外的纯函数，构建期不报错）；新对话框的 `aria-labelledby` 标题 id 未引用（element-id 告警）；一处相对路径写深了一层；`ENTITY_STATUS_INDEX` 漏导入。另有 1 处**测试写错**（我把 `ENTITY_TYPES` 的规范顺序记成了 Method/Metric/Dataset，实际是 Method/Task/Dataset/Metric/Concept/Claim）。

**验证**：`pnpm check` → exit 0（23 个测试；291 个 TS 文件；439 个模板 id / 405 引用）。

### 10.11 阶段 2 对齐合并 UI + 抽取可用性（已完成）

**新增文件**：`application/merge-review.ts`（合并复核，纯计算）、`viewer/features/knowledge-graph/entity-merge-dialog.ts`、`scripts/test-merge-review.mjs`。

**合并复核的核心问题：`suggestEntityMerges` 是两两比较的**。三个拼写变体（`Graph Convolutional Network` / `…Networks` / `Graph Convolutional Networks`）会形成**团**——两个拼写变体彼此也超过阈值。直接把这份两两清单交给批量操作是**有害的**：合并得分最高的那一对会 tombstone 掉其中一个拼写变体，另一个合并随后被拒绝（`planEntityMerge` 拒绝指向墓碑的合并），于是用户必须**再跑一次对话框**才能完成一件显然的工作。

`collapseMergeComponents` 的做法：在建议图上求**连通分量**，每个分量选一个规范成员，其余成员全部指向它。这样一次操作就能完成整个簇。

**派生行的分数必须诚实**。通过第三个实体间接相连的两两组合在建议清单里**没有记录**，直接填 0 是**在 UI 上说谎**：`Graph Convolutional Network` vs `Graph Convolutional Networks` 实际得分 **1.000**（归一化后完全相同——那是"静默合并"的情形，本来就不该出现在建议清单里）。因此派生行会**重新计算真实分数**，同时 `autoSelectable` 保持 `false`——数是真的，但这一对没有被直接评估过，所以仍然由用户决定。

**对话框行为**：按"保留哪个实体"分组（一个规范实体常带多个拼写变体，作为一次决定呈现）；预勾选只跟 `autoSelectable`，不直接看相似度数字，阈值只存在于一处；低于自动建议阈值的行带"待你判断"标记并单独配色，避免预勾选掩盖"这是猜测"。批量合并按分数降序执行，且拒绝任何指向已被吸收实体的对（防止链式冲突）。

**抽取可用性（不再静默失败）**：新增 `refreshExtractionAvailability()`。抽取要读 `getDocumentChunks`，未建索引的论文没有正文可抽。现在在页面加载后就检测，未建索引时**禁用按钮并在 title 里说明原因**（"请先在知识库中建立索引"），而不是让用户点下去再报错。抽取结束后的 `finally` 也改为调用可用性检查，而不是无脑 `disabled = false`——论文可能仍然没有索引，重新启用只会邀请一次注定失败的点击。

**本轮修的问题**：
1. **簇处理缺失**（上述）——这是本轮的主要发现，属于产品级缺陷而非测试问题。
2. **派生行分数为 0**——会在 UI 上展示错误数字。
3. 替换函数体时误删了 `groupMergeRowsByKeep` 的函数签名与文档注释（构建期能发现，但值得记录）。
4. 有 2 处**测试写错**：一处假设 `suggestEntityMerges` 会做全局分组（实际是两两）；一处把已修复的链式行为当成期望值。

**验证**：`pnpm check` → exit 0（24 个测试；293 个 TS 文件；448 个模板 id / 414 引用）。

### 10.12 阶段 2 浏览器级验证（已完成）

**新增**：`scripts/test-knowledge-graph-dialogs.mjs`（7 个 Playwright 用例）、`test:knowledge-graph-dialogs` 接入 `pnpm check`。另在对话框模块加了 `getEntityReviewRowStats()` 诊断导出（供测试读取行状态，UI 不使用）。

**为什么需要这一层**：契约测试覆盖计划规则，但**本功能至今所有真实缺陷都出在 DOM 层**——模板 id 与句柄不一致、预勾选与阈值不一致、确认载荷错、关闭路径让调用方永久挂起。所以这一层用**真实对话框模块 + 真实模板 + 真实浏览器**跑，仓储被 stub，不碰 IndexedDB，也不需要构建产物。

**覆盖的用例**：模板 id 与句柄不漂移；默认只显示高置信度且只有它们被勾选、选择读数统计全部行（含隐藏行）；全局/分组全选与"改名+改类型"确实进入确认载荷（含 `edgeType: 'MENTIONS'`、按论文分组）；"不再提示"记录忽略名并取消勾选；**Escape 能解析调用方的 Promise 而不是挂起**；合并对话框按存活者分组、派生行标示"待你判断"且不预勾选、一次操作提交两个合并且按分数降序；空复核集禁用确认按钮。

**这一轮修的问题**：全部是**测试自身的错误**，而且每一个都暴露了一个我自己对产品的误解：

1. **stub 漏了 `preChecked`** —— 对话框于是把所有行都当作未预勾选，默认低置信度隐藏后**一行都不显示**。对话框拒绝凭空发明一个决策，这是对的行为；错的是我的 fixture。
2. **误以为分组"全选"会选中隐藏的低置信度行**。实际只作用于**用户看得见的行**——这是对的（隐藏行被静默勾选才是意外），但我的断言写成了 2。
3. **用 `textContent` 找实体名** —— 名字在 `<input value>` 里，`textContent` **不包含** input 的值，所以找不到行。改用证据引文定位。
4. **`openEntityReviewDialog()` 被 await 导致死锁** —— 那个 Promise 只在对话框关闭时 settle，await 它必然挂住。
5. **`waitForSelector('#…:not([open])')` 默认等"可见"** —— 关闭的 `<dialog>` 是 hidden，所以永远不会满足；改用 `waitForFunction` 检查 `open` 属性。
6. 两次用 PowerShell 做文本替换**破坏了文件的 UTF-8 中文**（正则字面量变成乱码直接语法报错）。教训：CJK 文件只用 edit/write 工具改。

**验证**：`pnpm check` → exit 0（26 项检查：24 个契约/行为测试 + 架构 + 模板 id + 构建 + 产物检查；293 个 TS 文件）。

### 10.13 阶段 2 收尾（已完成）

**新增**：`application/paper-cleanup.ts`（文献移除的保留规则）、`application/batch-extraction.ts`（多篇顺序抽取）、`viewer/features/knowledge-graph/graph-entity-actions.ts`（抽取/确认/合并动作），`scripts/test-graph-batch-and-cleanup.mjs`。仓储新增 `deletePaperCascade()`（纸+实体+边**单事务**）。

**文献移除的保留规则（这是本轮最有价值的设计决定）**

- 只把 **`sourcePaperId` 指向该文献**的实体列为候选删除。别的文献引入的实体是共享知识。
- **只要还有别的文献用边引用它，就永不删除**——抽取来源不等于使用；B 可能确认了 A 引入的实体，而 B 还在。
- 净效果：移除一篇文献，只移除"仅由它支撑"的知识。被保留实体的 `sourcePaperId` 仍指向已移除的文献，那是**历史溯源**而非活引用（没有任何地方按来源文献反查实体）。
- **同时删除该文献的抽取任务**：一个孤立的 `done` 任务会让重新加入同一篇文献时**静默跳过抽取**并显示过期候选——这比单纯的垃圾数据更糟。

**我原本写了一个"级联守卫"并声称它是必要的，然后发现它不可达**：在保留规则之下，指向待删实体的每条边本来就已因附着于该文献而进入删除集，所以级联永远不会触发。我没有删掉它，而是把注释改成诚实的说法——它是**面向未来保留规则变更的守卫**，不是常规路径——并在测试里覆盖"另一篇文献仍在使用的实体必须保留"这一真实行为，而不是编造一个用例去假装触发它。

**批量抽取**：构建在单篇执行器之上而不是旁边，因为所有有价值的性质都在那里（逐批提交、可恢复游标、每篇锁、指纹跳过）。这一层只加**顺序与压力控制**：一次只处理一篇，否则同时请求数会被批量大小放大，限流变成图谱自己造成的。正文未变化的文献只花一次 chunk 读取、零网络调用，所以**重跑批量是便宜且安全的**。无索引的文献在批量开始前就被过滤掉，而不是逐篇报同样的错——"10 篇里 8 篇失败：无索引"是噪音不是信息。

**架构检查抓到我自己违规**：加完批量抽取后 `knowledge-graph-page.ts` 涨到 **766 行**，超过 700 行硬限制。按职责拆出 `graph-entity-actions.ts`（259 行）：控制器负责**渲染**图谱，新文件负责**改变**图谱——不同的变更理由。新文件通过 `configureGraphActions()` 拿到控制器能力，而不是反向 import，避免模块环（这也是本仓库既有的依赖倒置惯例）。拆分后：控制器 583 行 + 动作 259 行。

**另修的问题**：仓储接口里 `deletePaper` 重复声明、两处重复实现、一行被压扁的方法签名（都是我连续编辑造成的），以及若干不再使用的 import。契约测试里 **2 处断言是我写错的**：一是以为"另一篇文献指向共享实体的边"会被删除（实际正确行为是保留，因为实体被保留了）；二是忘了被保留实体的边也会留下。

**验证**：`pnpm check` → exit 0（27 项检查；296 个 TS 文件；449 个模板 id / 415 引用）。

### 10.14 阶段 3 起点：个人图谱（已完成）

**新增**：`application/personal-graph.ts`（纯投影）、`viewer/features/knowledge-graph/graph-personal-repository.ts`（读存储 + 名称→paperId 连接）、`scripts/test-personal-graph.mjs`。

**两个设计决定**

1. **用户数据默认私有**：每条个人边的 `origin` 都是 `'user'`、`confidence` 为 **1**——用户自己断言的东西不是概率。渲染器已按 origin 决定线型（点线），检查器已按 origin 给出"用户标注"文案，所以隐私与可信度语义是**复用**而非新增。
2. **文件夹与标签是枢纽节点**：把三条笔记归入"Chapter 2"是"这些笔记属于一起"的断言；把文件夹/标签渲染成真正的节点，用户的组织结构才**可见**，而不是被压平进文献里。`collectFolderAncestors` 会沿父链发出**每一层**的 `IN_FOLDER` 边——把笔记归入 `Chapter 2 / Methods` 同时也归入 `Methods`，这才是树该有的行为，并且用 visited 集合防止 `parentId` 成环时挂死。

**`user:self` 锚点**：存在个人材料时创建一个锚点节点，所有个人节点都连到它。这样"个人图谱"是一个**视图**（切到 user 边 + 该锚点的子图）而不是一个要靠特判实现的模式，代价只是一个节点。

**无法归属的笔记不丢弃**：笔记按 `documentName` 存，图谱按 documentId 存，所以需要一个 `resolvePaperId` 注入回调做连接。返回 `undefined` 时该笔记**仍然入图**，只是仅连到用户锚点——它的文字还在，只是没有可挂靠的文献。这比丢掉用户的笔记好，且 `unresolvedPaperCount` 会把它报出来。

**渲染层扩展**：`GraphNodeKind` 从 `'paper' | 'entity'` 扩到含 `note/highlight/folder/tag/user`；`GraphSubgraph`、`GraphSnapshot` 与 `buildRenderModel` 都新增 `userNodes`。个人节点用**圆角方块**而不是圆点——形状本身携带"这是用户自己的东西"，因为图谱已经在用颜色表达来源置信度，不能再用颜色表达归属。配色也**刻意离开蓝色系**（笔记紫、高亮橙、文件夹灰蓝、标签绿）：复用蓝色会暗示用户的笔记带有模型置信度。绘制顺序为个人节点→枢纽→文献，保证图谱"关于"的节点不被用户标记遮住。

**阶段 1 埋的伏笔生效了**：`notes/highlights/folders/tags` 四个 store 与索引在第一轮就建好，本轮**零迁移**。

**本轮修的问题**：`USER_EDGE_TYPES`（`IN_FOLDER`/`HIGHLIGHTED`/`TAGGED`/`ANNOTATED_AS`）在方案文档里写了，但**从未加进契约的类型联合**——纯投影一写就报类型错。已补上独立的 `USER_EDGE_TYPES` 组，让 UI 可以按 `origin` 而不是按四个类型字符串来分组。另修 `graph-inspector` 的端点标签：它此前假定端点非 paper 即 entity，会把 `folder:9f2c…` 原样显示，检查器等于没解释；现改为按 kind 给出"笔记/高亮/文件夹/标签"文案。

**验证**：`pnpm check` → exit 0（28 项检查；298 个 TS 文件；450 个模板 id / 416 引用）。

### 10.15 阶段 3：文件夹接线与"跳回原文"（已完成）

**文件夹接线**：从知识语料（`listKnowledgeFolders` / `listKnowledgeDocuments`）读取。关键点是 **`KnowledgeLibraryDocument.documentId` 与图谱的 `paperId` 是同一个标识**，所以归档关系是**精确连接**而不是名称匹配——这也是唯一一处不需要 `resolvePaperId` 的个人数据。不在图谱投影里的文献会被跳过，避免产生渲染器反正会丢弃的 `IN_FOLDER` 边（否则会虚报用户能看到的东西）。

**"跳回原文"改为定位到句子，而不只是页码**。此前只调 `navigateToPdfPageWhenVisible(page)`；现在有引文时走 `jumpToPdfCitations(page, [quote])`，它会定位并高亮该句。这个差别正是**存证据的全部意义**：落到一篇 12 页论文的第 7 页、然后自己找那句话，几乎等于没有链接。引文定位失败时**仍然导航到该页**（常见原因是文本层重排，不是文献缺失），不能把用户丢在图谱页。

**实体检查器**：相关论文列表从"一个按钮 + 一个批量打开"改成**每篇论文一行、各带自己的跳转按钮**，并显示该实体在这篇论文里首次出现证据的页码。这个实体出现在哪一页正是读者跟随这条边的原因，所以必须从命名该论文的那一行一键到达。

**测试可执行性的一个设计调整**：`readPersonalGraph` 所在文件 import 了模块 barrel，Node 无法解析其无扩展名 import，因此该文件整体不可被契约测试执行。于是把**日期解析与笔记转换**抽到无依赖的 `graph-note-records.ts`——那里的日期处理恰恰是"静默失败"型风险：`Date.parse` 对无法解析的输入返回 `NaN`，而 `NaN` 时间戳会**污染所有涉及它的排序**（笔记会在时间轴上乱漂，且永远匹配不上任何时间筛选）。抽出后即可被测试直接执行，已覆盖"非法日期回退而非 NaN"。

**验证**：`pnpm check` → exit 0（28 项检查；298 个 TS 文件）。

### 10.16 阶段 3：按需关系判断的漏斗与解析（已完成）

**新增**：`application/relation-recall.ts`（零成本召回 + Top-K 选择 + Token 估算）、`application/relation-judgement.ts`（提示词 + 判定解析 + 建边）、`scripts/test-relation-judgement.mjs`。

**漏斗的三条承重性质**（写成纯函数正是为了能测它们）：

1. **有界**：`maxCandidates` 在返回前截断，所以后续 LLM 阶段的成本**不可能**随文献数量增长。
2. **缓存感知**：已带 `Paper → Paper` 判定边的配对直接丢弃——这是"再点一次分析关系不要钱"的机制。
   - 关键区分：**共享实体不是已判定关系**。它恰恰是促使我们去问的信号，把它算作"已判定"会压制最值得分析的配对。
3. **确定性**：同分按 pairKey 排序。否则下一次运行会针对**与缓存中不同的集合**做判断，而"已分析过"就成了假话。

**回调阈值标定为 1.5，让"仅年份接近"买不到一次模型调用**。同年发表的论文极其普遍、几乎不含关系证据；在同年度语料上它会用噪声淹没预算。其他每个信号（共享实体 3、向量 2.5、同文件夹 1.5、同来源 1）都能单独过线，弱信号组合也能过线。

**解析层的四条规则**（无 JSON mode，只能"提示词要求 JSON + 防御式解析"）：

1. **模型没回答的配对不缓存为"已判定"**。若响应被截断，把沉默当成"无关系"会把一个**永久假阴性**写进缓存，这对配对从此再也不会被问。只有**显式 `NONE`** 才可缓存。
2. **未发送的配对一律拒绝**。模型拿到的是有界候选表；凭空造出一对会给两篇没人问过的论文建边，而证据无法溯源。
3. **绝不因格式错误抛出**：坏批次产出 0 条边并报告原因，而不是中断一次 Token 已花掉的运行。
4. 边带 `origin: 'ai'` 与 `provenance{model, promptVersion, judgedAt}`；`originKey` 含判定类型，因此重新判定是**替换**旧结论而不是与它冲突。

**契约测试本轮查出 2 个真实缺陷**：

1. **`extractJson` 先试花括号、后试方括号**。对裸数组 `[{"pairKey":…}]`，花括号切片取到的是**数组内层对象**，于是整个判定列表被当成一个对象、`relationRows` 返回 null、所有配对都被报告为"未回答"——一次完全可用却被丢弃的回答。修法是把方括号候选**排到前面**，并在注释里写明原因。
2. **裸的单个判定对象被拒绝**。模型只被问一对时，回一个对象是合理行为；现在按单行载荷接受。

**另有 2 处是我的测试写错**：同文件夹得分断言漏了年份接近的 1 分（实际 2.5）；`minScore` 语义变化后需要显式给年份差异，否则测的不是文件夹信号。

**验证**：`pnpm check` → exit 0（29 项检查；299 个 TS 文件）。

### 10.17 阶段 3：判定的可替换性与否定缓存（已完成）

**新增边类型 `NO_RELATION`**（`NEGATIVE_EDGE_TYPES`）。原因是上一轮遗留的一个真实漏洞：模型判"两篇论文没有关系"时**不留任何记录**，于是 `collectJudgedPairKeys` 永远认为这一对未被判定，**每次运行都会重新付费问同一个问题**。现在否定结论也写成边：
- `confidence: 0`，因此默认会被置信度过滤器排除（一张布满"查过了，没关系"连线的图比什么都没有更糟）；
- `evidence: []`，因为否定结论没有可引用的句子；
- 仍带 `originKey` 与 `provenance`，所以它和其他结论一样受唯一索引保护、一样能被重新判定替换。

**`planRelationJudgementWrites`：判定是替换而不是累积。** 若一对论文原本是 `EXTENDS`、重新判定为 `COMPARES_WITH`，只写新边而不退役旧边会**留下两条互相矛盾的结论**，而图谱会把两条都当作当前结论呈现。因此每个被回答的配对都先退役它此前的 paper-paper 结论，再写入当前结论。

**三处边界**（都有断言）：
- **不退役正在写入的那条边**——同 `originKey` 说明结论未变，那条边就是当前结论，应当保留其身份与创建时间。
- **未回答的配对完全不在计划内**，所以截断的响应**无法用沉默推翻一个好结论**。
- **非结论边永不被退役**：共享实体（`MENTIONS`）、关键词（`HAS_KEYWORD`）、用户归档（`IN_FOLDER`）不属于这一层拥有的结论。

**本轮查出 1 个真实缺陷 + 1 处测试写错**：
- 真实缺陷：`collectJudgedPairKeys` 仍然只认 `PAPER_PAPER_EDGE_TYPES`，导致刚写入的否定记录**不被视为已判定**——即"修了写、忘了读"。已改为共用 `isPaperPaperConclusion`，让读写用同一条判断。
- 测试写错：我把"上一版结论"fixture 设成了与新结论**相同**的 `originKey`（`EXTENDS`），那样根本没有"结论变化"可测，代码正确地什么都没退役。改成 `COMPARES_WITH` 后才真正测到替换逻辑。顺带补了"判定未变时应为空操作"的断言。

**验证**：`pnpm check` → exit 0（29 项检查；301 个 TS 文件）。

### 10.18 阶段 3：关系判断编排与后台请求（已完成）

**新增**：`application/relation-runner.ts`（编排：召回 → 报价 → 询问 → 落库）、`src/background/ai/relation-judgement-service.ts`（只做网络调用）、`scripts/test-relation-runner.mjs`。第 9 类 AI 请求 `pdf-helper:ai-judge-relations` 接入三处（契约 interface + `AiRuntimeRequest` 联合 + **`isAiRuntimeRequest` 白名单**，以及 `request-handler.ts` 的 `if` 链分支）。

**编排为什么放在 modules 而不是 viewer feature**：它是对模块原语的纯协调，只依赖注入的 transport，不碰 DOM、阅读器或 IndexedDB。放在 `src/viewer/features/` 下的文件会 import 模块 barrel，而 Node 无法解析其无扩展名 import，**契约测试永远无法执行它们**。这一轮我把已经写好的 viewer 版编排挪到了 `modules/knowledge-graph/application/relation-runner.ts`——不是为了整齐，是为了能测。

**报价先于请求**：这是插件里**唯一一个用户没打字就替用户花 Token 的功能**，所以成本在任何请求构建之前就展示并确认；预览阶段被拒则**一个请求都不发**。空的运行也免费回报原因，而不是发一次没意义的调用。

**"没有可判断的论文对"必须说明是哪一种**。契约测试查出我的第一版判断有误：`candidates.length === 0` 就把原因写成"已有结论都已缓存"，但**语料本身没有信号**（不共享实体、不同文件夹、年份差很远）也会得到同样的 0——那等于告诉用户"分析过了"，而实际是**从来没跑过**。现在 `isFullyJudged` 要求**确实存在 paper-paper 结论**才判定为缓存命中，两种情况的文案不同。

**分批**：`RELATION_PAIRS_PER_CALL = 5`。调用方已按用户 Top-K 封顶，这是**第二层更小的上限**——一条判定的 prompt 比一个抽取 chunk 长得多，一次全发会把单次调用推到 provider 的 120s 超时边缘，而超时**丢掉的是整批而不是一对**。

**契约测试覆盖**：预览不发请求；Top-K 独立于召回预算地封顶付费阶段（且更小的 Top-K 报价更低）；拒绝预览则零消耗；happy path 经 `planRelationJudgementWrites` 落库而非直接写；**全缓存时零请求且说明原因是缓存**；**否定缓存也命中**（否则每次都为同一句"没有关系"付费）；**无信号与全缓存文案不同**；部分响应只写已作答的对、未作答的被报告且不缓存；请求失败不写任何东西；**无法解析的回答不算"没有关系"**（不缓存、全部报未作答）。

**验证**：`pnpm check` → exit 0（30 项检查；303 个 TS 文件）。

### 10.19 阶段 3：关系分析接入 UI（已完成）

**新增**：仓储 `applyRelationPlan()`（单事务：先退役再写入）、`createRelationAnalysisPorts()`（真实 transport 绑定）、「分析关系」按钮与 `analyzePaperRelations()`。

**顺序在事务内是承重的**：判定类型变化时，旧 `originKey` 被释放、新 `originKey` 被占用。**先写后删会撞唯一索引**，所以 `applyRelationPlan` 必须先把待退役的键删掉再写——这一点和实体合并里的处理是同一个道理。

**确认阈值 2000 tokens，而不是每次都问**。这是插件里唯一一个用户没打字就替用户花 Token 的地方，但**为每次小额运行弹确认框会变成噪音**，用户会学会不看就点掉——那比不提示更糟。超过阈值才弹出 `window.confirm`，文案包含：将判断的对数、预计 tokens、召回候选数（说明漏斗确实收窄了）、以及"已判断过的会跳过，不重复消耗"。

**向量端口显式返回 `null`**，而不是省略：embedding 默认 `off`，还没有生成向量的步骤；返回 `null` 让召回**明确地**退回零成本信号，而不是静默跳过。等向量生成接上时，只需要改这一处。

**验证**：`pnpm check` → exit 0（30 项检查；303 个 TS 文件；451 个模板 id / 417 引用）。关系按钮已在模板中且已注册（注册层第 42/97 行）。

### 10.20 阶段 3：标签派生与文献移除接线（已完成）

**标签：我把"产品决定"这个阻塞项解掉了，而不是绕过它。** 上一轮我把它记为需要先决定权威存储，但重新想了一遍——标签是唯一**没有独立存储**的个人数据源，它们只作为 `tags: string[]` 挂在知识条目上。既然不存在独立存储，"权威"这个问题本身就问错了：**名字就是身份**。归一化（大小写折叠、空白折叠）后哈希成稳定 id，于是：

- **零存储、零迁移**：不需要新建 tag 表，也不会把某张新表悄悄变成真相源而让用户已有数据分叉；
- 用户已有的标签**第一次打开图谱就已经是节点**；
- 同一会话、同一台机器、不同机器上 id 都一致（FNV-1a，纯函数）。

归一化**刻意保守**：不像实体名那样剥离标点，因为标签是用户手打的字面标签，`#important` 和 `important` 可能是有意区分。宁可精确显示用户创建的标签。

**读取时机是这一轮真正的工程决定**：`collectKnowledgeItems()` 会跑知识库同步，**太重，绝不能每次重绘都调**。所以 `readPersonalGraph` 改为**由调用方传入标签分配**，页面每次加载收集一次。这是"放在哪里"的决定，不是"能不能做"的决定。

**文献移除接线**：知识库移除 PDF 时同时调用 `removeGraphPaper()`。放在一个 `graph-removal-bridge.ts` 里，原因是结构性的：
1. 图谱 feature 依赖知识库（读笔记与文件夹），**反向静态 import 会形成跨 feature 环**；handler 内的动态 `import()` 不是初始化期依赖——知识库 worker 已经用过这个手法；
2. 知识库不该为了清理自己的尾巴就依赖图谱的存储层，它只按名字请求一个操作；
3. **它永不抛出**：调用方已经完成了移除，图谱清理失败不应让一个已成功的动作看起来失败——残留一条图谱记录远好过一条误导性的错误。

**本轮修的两个自身问题**：
1. `personal-graph.ts` 被架构检查报"直访浏览器持久化"告警——**原因是我自己写的注释里出现了那个词**。架构检查的启发式匹配文件**内容**而非行为，所以解释"为什么这里不需要数据库"的注释反而触发了"这里访问了数据库"的告警。已改写措辞。
2. 移除桥的 `import` 路径写错了一层（`./graph-extraction-repository` → `../knowledge-graph/graph-extraction-repository`）。

**验证**：`pnpm check` → exit 0（31 项检查：19 个测试脚本 + 架构 + 模板 id + 构建 + 产物；305 个 TS 文件）。

### 10.21 阶段 4：导出 / 导入（已完成）

**新增**：`application/graph-transfer.ts`（序列化 + 严格校验 + 导入计划）、`viewer/features/knowledge-graph/graph-transfer-controller.ts`（下载/读文件/应用）、导出与导入按钮、`scripts/test-graph-transfer.mjs`。

**这是本仓库第一个用户数据导出能力**，所以约定沿用仓库既有的两种版本化范式（`format` + 数字 `version`，解析失败返回 `null` 而不抛出），而不是发明第三套。

**两项刻意性质**：
1. **导出确定性**：写完前对每个数组排序，因此同一张图谱导出两次得到**逐字节相同**的文件——两份额外文件之间的 diff 才真的意味着有变化。这对"用户会打开文件看看插件到底知道什么"这个主要用途是必要的，格式化输出（2 空格缩进）也是为此。
2. **校验严格且完备**：导入是任意文本进入数据库的唯一入口，所以每个字段要么被强制转换、要么整份文件被拒绝。**格式或版本不匹配时整份拒绝**（外来文件不得半加载），但**单条畸形记录会被丢弃并计数**——为了一条读不懂的边而拒绝一份 2000 条边的导出是本末倒置。

**拒绝的情况**：非 JSON、非对象、format 不符、版本 0 或 99、缺少 papers 数组——每一种都有断言与明确文案。**强制转换的情况**：非法年份→null、未知抽取状态/实体类型/状态→回退、置信度越界→钳制、未知节点类型→丢弃、缺 originKey 或缺端点的边→丢弃。

**导入策略是显式选择，不替用户猜**：`replace` 就是"恢复备份"的含义，`merge` 就是"用另一台机器补齐这台"的含义。替他选有破坏他想扩充的图谱的风险。`merge` 时**已有记录胜出**（本地的确认或人工编辑是比一份时间不明的文件更新的信息），且**设置永不合并**——半个文件的阈值加半个文件的阈值是一个没人选过的配置。

**测试查出一个真实缺陷 + 一处死概念**：
- 缺陷：`endpointExists` 只看快照自身的实体，**没看目标图谱已持有的实体**——于是 `missingEntityReferences` 说"本地实体能救回这条边"，而边却已经被丢掉了。两处判断口径不一致。改成统一考虑"快照 ∪ 本图谱"，`merge` 现在真的能救回可解析的边。
- 死概念：我原本加了 `missingEntityReferences` 计数器，测试证明它**永远不可能非零**——指向不存在实体的边本身就是悬空边，已经被同一件事计数了。已删除，并把这个结论写进注释，避免后人再加回来。

**下载机制写清楚了而不是想当然**：object URL + `<a download>` + **延迟 10 秒 revoke**，因为同一 tick 内 revoke 会在某些浏览器版本上与浏览器自身读取 blob 竞争——那种 bug 只表现为偶尔得到一个空文件。

**验证**：`pnpm check` → exit 0（32 项检查；307 个 TS 文件；453 个模板 id / 419 引用）。

### 10.22 阶段 4：矛盾结论消解（已完成）

**问题是从正常使用中长出来的，不是 bug 造成的**：同一对论文被判断两次得到不同结论，或换模型/换提示词后一次判 `EXTENDS`、另一次判 `CITES`。由于每个结论各有自己的 `originKey`，**两条都会被存下来，图谱把两条都当作当前结论呈现**——这比只显示任意一条更糟，因为用户无法判断该信哪条。

**核心设计是"结论强度"排序**，它决定了所有自动消解的结果：

| 结论 | 强度 | 理由 |
|---|---|---|
| `SIMILAR_TO` | 1 | 模型能给出的最模糊的断言，任何具体结论都压过它 |
| `COMPARES_WITH` | 2 | 具体但对方向不作断言 |
| `CITES` | 3 | 关于参考文献的事实 |
| `IMPROVES` | 4 | 关于改进关系的断言 |
| `EXTENDS` | 5 | 最强的正面断言 |
| `NO_RELATION` | 6 | **断言"不存在"**，因此与一切正面结论冲突 |

**只有一条排序被刻意推翻**：`origin: 'user'` 的结论**无条件胜出**，无论强度多低。用户是自建图谱的最高权威，任何自动排序都不该覆盖一次刻意的决定。

**契约测试查出的死分支（本轮主要发现）**：我原本设计了一个"同级并列 → 交给用户裁决"的分支，理由是"两条同样强的断言不该被任意挑选"。测试证明它**不可达**：成为矛盾要求两个**不同**的结论类型，而每个类型的强度值**互不相同**，所以永远不会出现同级并列。我删掉了这个分支和 `needsUser` 字段，并把原因写进注释——同时把这个不变量本身写成断言，将来若有新结论类型被赋予重复强度值，测试会失败而不是静默产生无法裁决的矛盾。

顺带澄清：两条**相同**结论不算矛盾（那是重复记录，逐结论的 `originKey` 本来就阻止它们被写入）。

**消解结果可审计**：幸存的那条边会重写 `provenance.resolvedAt / resolvedBy / resolvedAgainst`，因为败者被删除后，**只有这个字段能说明发生过什么**；否则下一次扫描会看到剩下的那条边而无法知道它已被裁决过。导入导出也已同步携带这三个字段（`graph-transfer.ts` 的 provenance 解析）。

**低置信度过滤**：`minConfidence` 用于压掉"0.2 的猜测反驳 0.9 的结论"这类噪音——把噪音当成矛盾呈现，只会训练用户不看矛盾列表。

**验证**：`pnpm check` → exit 0（33 项检查；308 个 TS 文件）。

### 10.23 阶段 4：大图折叠（已完成）

**新增**：`domain/graph-condensation.ts`、`scripts/test-graph-condensation.mjs`，并接入 `redraw()`。

**为什么是"折叠"而不是"截断"**：截断本身是应对规模的坏答案——它按**恰好到达上限的那个顺序**切掉节点，因此可能把文献藏在关键词噪音之后，而且丢掉的是用户想看的结构。折叠先行更好：它移除几乎不携带结构的节点，同时保住每一篇文献和每一个真正的枢纽。

**规则基于度数，不是类型**：
- 度数为 1 的节点只挂在一个东西下面。两百个这种节点就是两百个叶子——它们组成一团毛线球，而且单个叶子几乎不告诉读者任何事。
- 度数 ≥ 2 的节点才是结构所在：它连接的正是两篇论文，而这正是图谱的全部意义。

叶子被折叠成**每个宿主一个**的合成节点（宿主是它们所挂的文献或枢纽），标签写明折叠了几项。这个聚合是**诚实的**：它不声称那些叶子是同一个东西，它只说明折叠了多少。

**文献永不被折叠**，即使度数为 1：图谱是**关于**文档的。这个不对称正是要点。

**折叠在子图构建之前运行**（而不是之后）——这也是它通常能让图谱直接落到上限以内、截断根本不触发的原因。

**契约测试本轮查出 1 个我自己造的隐患**：我原本加了 `maxLeavesPerAggregate`（每聚合上限），默认 40。测试里 60 个叶子被**静默截断成 40**，而聚合节点的标签仍然声称"折叠 40 项"看起来像完整结果——一个**隐藏的上限**让计数具有误导性。我没有去调这个参数，而是**删除了这个机制**：想少显示节点应该用 `threshold` 和 `leafDegree`，两个语义清晰的旋钮，而不是第三个会悄悄改数字的旋钮。删除理由写进了注释。

**其他被断言的性质**：小图完全不动（给用户有空间看清的东西做折叠是纯损失）；度数 2 的枢纽永不折叠；聚合节点 `confidence: 0`、`status: 'confirmed'`（它是视图产物，不是世界的主张，也不是待确认的建议）；其边 `origin: 'rule'`（不是模型结论）；**没有任何边指向被折叠的节点**（渲染器的唯一硬不变式）；孤立的叶子被丢弃而不是给它一个没有宿主的容器；**重复折叠是稳定的**（聚合节点不是叶子，所以反复渲染不会持续塌缩视图）。

**验证**：`pnpm check` → exit 0（34 项检查；309 个 TS 文件）。

### 10.24 剩余（下一步）

- 矛盾消解接 UI（已完成，见 10.26）
- **高亮读取**：已完成（见 10.29）；遗留限制：只能捕获**当前打开**的文献，且捕获不做删除对齐
- 关系分析结果预览（已完成，见 10.27）；`relation-judgement` 任务类型；向量生成与缓存
- 视口裁剪（已完成，见 10.28）；Worker 布局仍待做（渲染器在 320 节点以上仍降级为预览迭代）
- 效果评估：抽取准确率的抽样人工核对（采纳率 / 复用率 / 证据率已由统计对话框给出）
- 人工验收：**打包产物冒烟测试已完成**（见 10.30）；仍需人亲自走一遍交互链路（含统计 / 冲突 / 关系确认三个对话框与高亮入图），因为视觉与手感无法自动化

### 10.25 阶段 4：图谱质量统计与改进建议（已完成）

**新增**：`application/graph-metrics.ts`（纯计算 + 报告行 + 建议）、`viewer/features/knowledge-graph/graph-metrics-dialog.ts`（只读报告对话框）、`scripts/test-graph-metrics.mjs`，「统计」按钮与 `openGraphMetrics()`，并在既有浏览器用例套件里补 2 个用例。

**为什么没有独立指标存储**：写时自增的计数器会与数据漂移，而且漂移之后**仍然被相信**。全部按已存记录即时计算，代价是一次全量遍历，换来的是"报告的每个数字都能在画布上找到对应"。

**未定义不等于 0**（这是本轮最重要的语义）。采纳率、复用率、证据率在**没有样本**时返回 `null`，UI 显示「—」并显式说明"不是 0%"。一个空图谱显示"采纳率 0%"读起来是**测出来的失败**，会让用户去做一次毫无必要的提示词调整。

**四个计数口径都被断言锁住**：

- 采纳率分母 = `confirmed + rejected`，**排除 `merged`**：合并是用户把两个**已接受**的候选合并，把它算成拒绝会低估采纳率。
- **关键词节点与聚合节点不进任何计数**：前者是规则推导的词汇（两篇论文共享一个关键词是意料之中，不代表抽取连接了什么），后者是视图产物（一旦图谱大到开始折叠，计数就会被折叠次数推高）。关键词节点单列一项。
- 复用率按实体连接的**不同文献数**统计：同一篇文献的两条边不算复用，只连到另一个实体（没到文献）也不算——复用率就是"这是图谱还是一堆文档"的答案。
- 证据率只数**引文非空**的边（只有页码没有引文的证据不算证据）。

**建议必须绑定一个具体测量值**，否则就是在让用户凭信任接受意见：采纳率 < 40% 且已裁决 ≥ 10（点名"每段候选上限"和提示词措辞）、待确认 > 50、文献 ≥ 4 且共享实体为 0、文献 ≥ 4 且无文献间关系、证据率 < 50%、有文献尚未抽取到实体（点名全文索引）。空图谱返回空建议，并在 UI 里明说"图谱还是空的"——空列表否则无法区分"没问题"和"没跑"。

**对话框是只读的，且打开即重载快照**。统计要描述**库里存的图谱**，而页面快照可能已是几分钟前批量抽取或导入之前的状态；重载是本地免费读，所以没有理由报告过期数字——这也正是不需要"刷新"按钮的原因。个人层（笔记/文件夹/标签产生的 `origin: 'user'` 边）由控制器传入，否则那部分会被算成 0。

**浏览器层测试的一个做法**：这一层唯一真正会出错的是"数字 → 句子"，把指标函数 stub 掉等于不测。所以用例把 `graph-metrics.ts` **及其依赖闭包**在 Node 侧转译、在页面内按相对路径实例化，再把导出的函数**嫁接在 stub barrel 上**（直接 import barrel 会把 IndexedDB 适配器一起拉进来）。新增用例覆盖：空图显示「—」且全文不含 `0%`、说明文案存在、空建议区说明原因；有样本时 20% / 10% / 33% 三个比例正确、建议至少两条且点名"候选上限"、复制出的报告含比例与"建议："、Escape 能关闭。

**验证**：`pnpm check` → exit 0（38 个步骤：typecheck + 33 个测试脚本 + 架构检查 + 模板 id + 构建 + 产物检查；311 个 TS 文件；462 个模板 id / 428 引用）；对话框浏览器用例 9 个全通过（含新增 2 个，本机无头 Edge）。

### 10.26 阶段 4：矛盾消解接 UI（已完成）

**新增**：`application/conflict-service.ts`（扫描 + 批次计划 + 落库 + 结果文案）、`viewer/features/knowledge-graph/conflict-dialog.ts`（裁决对话框）、「冲突 N」按钮与 `openConflictReview()` / `refreshConflictCount()`；扩充 `test-conflict-resolution.mjs`（服务层与语义）与浏览器套件（第 10 个用例）。

**消解永不自动执行。** 退役一条边等于删掉一个花过 Token 的结论，而"谁的结论更强"本身是判断而非事实，所以列表交给人看、由人批准；徽标的存在只是让用户知道列表非空。整批**一个计划、一个事务**：半途生效会留下"保留边已标记裁决、失败边仍在库里"的状态，那正是本功能要消除的矛盾态，而用户还会再看到同一个冲突且无从解释。

**本轮在纯逻辑层修掉一个语义缺陷（由新断言查出）**：`planConflictResolution` 此前把**任何**传入的 `selectedEdgeId` 都记为 `resolvedBy: 'user'`。而陈旧 UI 会传来一个**已不存在的 edgeId**，此时规划会退回到按强度选出的存活者——那是一个**规则决定**，却会被记成"用户裁决过"。现已改为只有选择**确实命中本冲突内的一条边**才算用户决定。这条记录一旦写错就永久留在库里，且会让后续的自动消解误以为用户已经表过态。

**第二个语义修正：用户裁决优先于强度排序，且不会被后续判断推翻。** 原先只有 `origin: 'user'` 的边受保护。于是这种真实序列会出错：用户裁决了一对 → 之后某次判断为同一对写入第三条结论 → 强度比较**悄悄推翻用户的选择**（`NO_RELATION` 强度最高，尤其容易命中）。现在 `isUserDecided` 同时认"用户断言"和"这条边是你当时选中的存活者"，并且：
- 文案区分两种情形（"用户手动标注优先" vs "这一对你此前已经裁决过"），因为这是两种不同的"谁决定的"；
- `resolvedBy: 'user'` **粘滞**，后续自动通过不得把记录降级为 `'rule'`；
- `resolvedAgainst` **累加并去重**（败者已被删除，只有这个字段说明发生过什么），上界由结论类型数量决定，不会无界增长。

**批次计划的边界都被断言锁住**：只把**被用户改过**的配对作为 selection 送出（把建议值当选择送出会记成用户决定）；计划**永不退役自己正在写的 originKey**（那会把裁决变成删除存活者）；陈旧 selection（不存在的配对，或指向本冲突之外的边）会被**报出来**（`staleSelections`）而不是静默忽略——它的意思就是"这次点击没有做到你以为的事"；空计划**不开写事务**（每次扫描都开一次写事务是白拿锁）。

**打开对话框前会重新扫描**（`apply` 内部再扫一次）。理由具体而非形式：对话框可能开着几分钟，期间批量抽取或"移除文献"会改变库；按陈旧列表写存活者可能**复活一条论文已被删除的边**。期间消失的配对会落进 `staleSelections` 并在状态栏说明"按建议结论处理"。

**UI 上刻意做出的区分**：`data-keeps` / `data-retires` 两种配色，**将退役**的类型标签带删除线，建议项单独标"建议"——用户必须在点击前看到自己正要删掉哪一条；每行携带来源（AI/规则/用户）、置信度、模型与判断日期、以及原文引文（没有出处的断言不值得被选择）；`resolvedBy` 已存在的边会显示"已由你裁决（放弃 …）"，否则用户分不清一条新结论和一条早已裁决过的结论。

**我自己在测试装置上踩的坑**：新增的对话框 import 了 `./graph-theme`（复用 `describeEdgeOrigin` 的来源文案），页面内的 `require` 垫片立刻抛 `Unmocked dependency`——这正是"手写 mock 清单会过期"的典型。顺手把闭包加载改成**自动遍历相对 import**（原先是手工列清单，一个新增 import 就会让测试以"模块有 bug"的样子失败）。`graph-theme.ts` 无依赖，因此用**真实模块**而不是 stub。另外发现：`pnpm check 2>&1 | Select-Object` 这种管道会让 PowerShell 把原生命令的 stderr 当成错误并使 pwsh 退出码为 1——上一轮那次"exit 1 但看不出哪一步失败"由此而来，实际全绿；诊断时应把输出重定向到文件。

**验证**：契约测试新增断言覆盖用户裁决粘滞与累加、陈旧选择不记为用户决定、批次计划去重与自我保护、空计划零写入、以及**幂等性**（把计划应用到内存 store 后再次扫描为 0 冲突，且存活记录仍带审计字段）。浏览器用例覆盖：两组冲突渲染、强度降序、保留/退役标记与建议标记、"其中 0 组改为你的选择"、改选后读数变化、**apply 只收到被改过的那一对**、Escape 返回 `null` 且不写入、空列表禁用按钮。

### 10.27 阶段 4：关系判断结果预览（已完成）

**新增**：`JudgementReviewRow` / `buildJudgementReviewRows()` / `filterAcceptedJudgements()`（纯逻辑，`relation-judgement.ts`）、`relation-runner.ts` 的 `onJudged` 钩子与 `discardedPairs`、`viewer/features/knowledge-graph/relation-review-dialog.ts`（逐对确认对话框）；扩充 `test-relation-judgement.mjs`、`test-relation-runner.mjs` 与浏览器套件（第 11 个用例）。

**为什么必须有这一步：写进去的结论同时也是缓存。** 一对论文有了 `EXTENDS` 或 `NO_RELATION` 之后，召回漏斗就把它当作"已判断"，**再也不会问它**。所以把用户没看过的结论直接落库，等于让模型的错误永久化——而且**否定结论在画布上根本不显示**（`confidence: 0` 且被默认置信度过滤器排除），用户连"这条我没见过"都无从察觉。原先"分析关系"付了 Token 就直接写，这一步是补上用户唯一的审阅机会。

**"放弃"不是"全选"，两者必须可区分**：钩子返回 `'accept-all'`、一组 pairKey、或 `null`（关闭对话框）。`null` 被解释为**不写入**而不是替用户接受——Token 已经花了，但一条没人看过的断言不该默认变成永久记录。代价也是明说的：这些论文对下次会被重新判断（**会再次消耗 Token**），因为拒绝的结论不进缓存。

**逐对决策，而不是整批**：用户可能只想扔掉 5 条里的 2 条，所以每行一个勾选框、默认全选（付费结果就是用户要的东西，让常见情况变慢是错的），并配"全不选/全选"。`filterAcceptedJudgements` 保证被拒的配对**既不退役旧结论也不写新边**——它的旧结论原样保留，下次照常会被问到；这一点有断言，且配了一条反向断言（同一个旧结论落在**被接受**的配对上时必须被退役），否则前一条断言可能是空转的。

**否定结论在 UI 里必须解释清楚**：`NONE` 行单独配色、标注"不建立关系"，并写明它的作用是"记录已经判断过，避免下次重复消耗 Token"；没有引文的正向结论也显式说明"无法回溯到具体句子"。否定结论的置信度按设计是 0，直接显示"置信度 0.00"会读成"模型不确定"，所以改为文案"模型明确判断无实质关系"。

**每个未作答/无法解析的条目都在摘要里计数**（`rejectedCount`），否则用户看到的条数与模型实际输出对不上。

**既有测试抓到我引入的一个真实回归**：`runRelationAnalysis` 的失败分支——模型**一条结论都没给出**（每批都失败）时，我新加的早退分支把它报成"已放弃写入本次全部结论"，也就是**把 provider 超时说成是用户的决定**。现在只有当 review **确实丢弃了东西**时才会走 `discarded` 分支，否则照旧落到 `done` 并把"批失败"报出来（语义是"谁该负责"，文案错了会把用户引向一个他从未做过的决定）。

**验证**：契约测试覆盖 rows 排序（正向按置信度降序在前、否定在后）与确定性、证据与理由随行、`accept-all` 写满三条（含 `NO_RELATION` 的 `confidence: 0`）、子集接受只写一条且不动被拒配对、`null` 与空集都零写入且**不调用写端口**、未作答配对不受过滤影响（不被展示也不被缓存）、无钩子时行为与改动前完全一致。浏览器用例覆盖摘要里的模型名与"无法解析"计数、默认全选与按钮文案随选择变化、否定行与无引文行的说明文案、取消一条后写出集合正确、全不选时按钮禁用、放弃与 Escape 都返回 `null`。

### 10.28 阶段 4：大图渲染预算（视口裁剪 + 标签稀疏化）（已完成）

**新增**：`domain/graph-culling.ts`（纯几何：可见世界矩形、节点/边可见性、标签稀疏化、裁剪统计）、`scripts/test-graph-culling.mjs`（契约）、`scripts/test-graph-rendering.mjs`（真实 Canvas 的绘制预算）、`scripts/support/module-closure.mjs`（共享的转译加载器）。渲染器改造：缓存绘制顺序、按视口裁剪、标签稀疏化、命中测试同样只考虑可见内容、新增 `getRenderStats()` / `getDrawnEdgeIds()` 诊断。

**为什么先做渲染而不是先做 Worker 布局**：单帧成本里**绘制调用**是可直接测量、可直接断言的部分（每个节点是 arc + stroke，文献还要多一个内点和一个标题；每条边是一对 save/restore 加路径和可能的箭头）。布局迭代是另一件事，且改起来风险大得多；先把"画了什么"收窄，收益立刻可见，也才能判断布局是否还需要动。

**一个所有人都写错的边规则，所以它被单测钉住**：**两端都在视口外的边，只要线段穿过视口就必须画**。按"两端可见"裁剪，会让长边在用户放大去追它的**那一刻**消失——而那正是它最该在的时候。实现用 Liang–Barsky 参数化裁剪（而不是端点判断），并配了平行于边框且在外侧的用例（朴素 slab 判断最容易在这里出错）。

**`fullFrame` 只由视口决定**。最初我把"端点缺失的悬空边"也算进 `edgesCulled`，结果**只要模型里有一条悬空边，每一帧都会报告"发生了裁剪"**——而信号本身的意义就是回答"裁剪到底有没有在生效"，这样它就没用了。现在悬空边计入单独的 `edgesUnresolved`，`fullFrame` 只看视口是否丢掉了东西；契约测试里还断言了 `drawn + culled + unresolved === total` 的完备性。

**标签稀疏化基于同一个度数曲线**：`radiusForDegree` 让度数 ≥ 3 的节点半径至少比基准大 6，所以"够大得能看见"和"够该被命名"是同一个判断（阈值不是拍出来的魔数）。远端缩放（< 0.45）只保留枢纽的标题，密集的个人标记（笔记/高亮/标签/用户锚点）沿用更早的可读性阈值 0.55，文件夹例外——它们数量少且命名的是结构。**交互永远优先**：悬停/选中/搜索命中的节点在任何缩放下都带标题，否则搜索在缩小状态下等于失效。

**顺手修掉的两处真实浪费**：`drawNodes` 原本**每一帧**都对整个节点数组做一次 `[...nodes].sort(...)`（连拖动鼠标的每次 pointermove 都算），而顺序只在模型变化时才变——现在在 `setModel` 时算一次，绘制时按缓存顺序遍历并跳过不可见节点（每节点一次 Set 查询，被省掉的是一打 canvas 调用）。命中测试同理：指针在屏幕上，能命中的必然在屏幕内，所以只遍历可见内容，且边用与绘制**同一条**穿越判断（跨视口的边依然可点）。

**`-0` 的小坑**：`visibleWorldBounds` 在位移为 0 时会算出 `minX: -0`。数值上等于 0，但 `Object.is` 与 `JSON.stringify` 都不这么认为，边界结构里藏着 `-0` 是给后来人埋雷，所以在模块里归一化了（而不是在测试里放宽断言）。

**测试分两层**。纯规则用 Node 契约测试（可见矩形随缩放/平移的变化、标题框在**上边界**方向的额外余量、穿越/平行/相切/退化线段、裁剪结果保持模型顺序、`nodeById` 必须是**完整的**——可见边的另一端可能在屏幕外，渲染器要靠它取坐标）。集成层用**真实 Canvas**：6000 节点 / 9872 条的模型（80×50 网格 + 2000 个度数为 1 的叶子，才是真实图谱的形状），断言全览时 `fullFrame` 为真、**恰好 2000 个叶子没有标题**（不是"标签变少了"这种模糊说法）、放大到 3 倍后裁掉 5900+ 个节点且可见节点全部有标题、`drawn + culled + unresolved` 完备、**两条角到角的长边里恰好只有穿过该窗口的那一条在绘制列表中**、以及屏幕外节点不可命中而跨视口边可命中。为此给渲染器加了 `getRenderStats()` 与 `getDrawnEdgeIds()` 两个诊断接口（后者的注释写明只给测试用）。

**我自己在测试装置上犯的错**：先是用"移除长边后对比绘制条数"来间接断言，结果数字对不上（我据以推导的窗口已经改过），改成**直接检查绘制出来的边 id** 后就清楚了；另外把 `Promise.all(...).flat()` 用错（`[[a,b]].flat()` 变成 `[a,b]`，页面侧 `new Map` 直接报错）。顺手把两套浏览器测试里重复的转译加载器抽成 `scripts/support/module-closure.mjs`。

**验证**：`test:graph-culling`（纯逻辑）与 `test:graph-rendering`（真实 Canvas，3 个用例）均接入 `pnpm check`。

### 10.29 阶段 3 收尾：高亮入图（已完成 —— 阶段 3 全部数据源可用）

**新增**：`viewer/features/annotations/annotation-highlight-list.ts`（批注侧**只读**接口）、`modules/knowledge-graph/application/highlight-capture.ts`（纯捕获计划）、`viewer/features/knowledge-graph/graph-highlight-bridge.ts`（动态 import 的桥）、`viewer/features/knowledge-graph/graph-personal-provider.ts`（个人层装配，从页面文件拆出）；仓储新增 `listHighlights()` / `putHighlights()`；`GraphHighlightRecord` 增加可选 `note`；`scripts/test-highlight-capture.mjs` 接入 `pnpm check`。

**先把"被阻塞"这件事查清楚了，而不是继续照抄结论。** 原方案记的是"需要批注系统暴露只读接口"。实际核查结果：高亮**没有任何扩展侧存储**——它的持久化副本写在**用户 PDF 文件内部**（`embedded-helper-payload` + `pdf-attachment-service`），活动副本在 PDF.js 的 `annotationStorage` 里，而 `KnowledgeLibraryDocument` 里根本没有高亮字段。所以"接一个只读接口"是可行的，而且**不需要改动任何被禁止的模块**（`core/pdf-reader`、`document-agent`、`memory`、`knowledge`、`workspace-database.ts` 全部未动）。批注 feature 本身不在禁止清单里，加一个纯查询函数是允许的。

**只读接口的取数口径刻意选成"PDF 自己记录的内容"**：`listDocumentHighlights()` 复用 `getSerializableAnnotationEntries()`（也就是**写入 PDF 附件的那份数据**），因此图谱节点显示的文本与笔记，与文件里存的是同一份，不存在第二份会漂移的副本。它**不做任何修改**：不还原、不保存、不修复批注。

**两个必须说清楚的限制**（而不是藏在实现里）：
- **只能看到当前打开的那篇文献**。高亮在 PDF 内部，扩展不为已关闭的文献保存任何高亮数据。因此图谱保存的是一份**副本**，靠"打开文献时捕获"来刷新。
- **捕获绝不删除**。`missingIds` 只报告、不执行：批注存储尚未还原完成时捕获结果为空，任何"按捕获结果对齐删除"都会在用户刚打开 PDF 时把图谱里的高亮全删掉。这条不放心的删除留给将来有"捕获完整性"信号时再做。

**幂等性是硬要求，因为它每次打开图谱页都会跑**：同一批高亮第二次捕获必须**零写入**（`unchanged` 计入但不产生记录），`createdAt` 在更新时保留（否则节点会在按时间排序的视图里漂移）。**这里被自己的测试抓到一个真实不一致**：我最初用"原始入参"与"已存记录"比较，而记录是用 **trim 后**的值构造的，于是仅含空白差异的重复捕获会被当成编辑——**每次打开图谱页都会重写每一条高亮**。改为先把"将要写入的记录"构造出来、再与已存记录比较，两边用同一套归一化，这类分歧就不可能存在。

**第二个被测试抓到的设计缺陷更重要**：`missingIds` 原本从捕获条目里推导文档名，于是**空捕获（什么都没还原）时文档名未知**，报告结果是"没有缺失"——恰恰在最可疑的情况下给出最误导的答案。现在文档名由调用方显式传入（一次捕获只针对一篇文献），空捕获也能正确报出全部缺失记录；同时无文档名时整批拒绝写入（否则会写出一堆任何 join 都解析不到的孤儿记录）。

**跨 feature 依赖用动态 `import()`，这是仓库既有的约定而非新发明**：架构检查明确说明"动态 import 不纳入静态图，因为它不产生初始化期环"，并且**禁止**通过非 `public.ts` 的静态跨 feature import（连 `import type` 也算）。所以桥在运行时动态 import 批注 barrel，而它需要的高亮形状**在本地声明**（结构性类型）——这也让整条路径可以用注入的 reader 测试，无需 PDF.js。契约测试里额外做了两条**源码级**断言：批注 barrel 必须 re-export 高亮列表、且不得反向 import 图谱（否则就是跨 feature 环）——因为动态 import 的错误只会在"有 PDF 打开"这条无法在测试里复现的路径上炸。

**高亮节点用"用户的批注"做标签，用"高亮的原文"做证据**：笔记是用户自己的材料，在密集画布上比原句更能说明"我为什么标它"；而原句才是让这条断言可回溯的东西。为此 `GraphHighlightRecord` 增加了可选 `note`（导出/导入不带个人记录，因此无需格式变更）。

**架构检查抓到页面文件超限**：`knowledge-graph-page.ts` 因新增捕获逻辑涨到 717 行。按职责拆出 `graph-personal-provider.ts`（"用户的材料如何进入图谱"），页面只保留渲染与交互。

**验证**：契约测试覆盖首次捕获、幂等（零写入且不输出"0 新增"这类噪音）、空白差异不算编辑、更新保留 `createdAt`、批注/清空批注/换页都算编辑、部分捕获只报告不删除、空捕获报出全部缺失、无文档名整批拒绝、空文本与空 id 被跳过并计数、以及投影侧"笔记做标签 + 原文做证据 + `confidence: 1`"。

### 10.30 真实打包产物的冒烟测试（已完成 —— 阶段 1 的"启动不白屏"终于被真正验证）

**新增**：`scripts/test-built-extension.mjs`，接入 `pnpm check`（排在 `pnpm build` **之后**）。

**为什么这件事值得单独一轮**：仓库里所有测试都在"模块级隔离 + barrel 被 stub"的前提下跑，**阶段 1 的验收标准（打开工作区不白屏）此前只是对着拼装出来的 DOM 验证过**——它证明了视图切换逻辑，但没有证明**打包产物**能起来：真正的 service worker、真正的 chunk 拆分、真正生效的 CSP、真正的 IndexedDB 访问路径，全都没有被任何测试碰过。这一层用 `<unpacked>` 方式把 `.output/edge-mv3` 装进真实浏览器（Playwright persistent context + `--load-extension`），从扩展页面本身驱动图谱工作区。

**它断言的是"只有打包产物能回答的问题"**，而不是重复其他测试：MV3 service worker 恰好一个；页面引导不抛异常；`#workspace-stage` 渲染出视图，且**至少一个可见视图的布局盒大于 100×100**（"不白屏"要量出来——白屏时元素仍在，只是高度为 0）；工具栏渲染出控件；点击图谱入口后**状态行走到"已载入/已同步"**（而不是仅仅"页面变成可见"）；画布拿到真实 backing store；**IndexedDB 里真的出现了 `pdfpal-knowledge-graph`**（这是全仓库唯一一条走真实存储代码路径的断言，其余套件都把它 stub 掉）；整个过程没有 console error 与未捕获异常。

**两个把测试从"能过"变成"能诊断"的细节**：状态行会被写两次（开始时一次、完成时一次），所以等待必须匹配**完成语义**而不是"非空"——这是"页面可见"与"工作区真的加载完"的分界；等待超时后重新读取状态行并把它写进失败信息，否则失败只会显示"超时"，看不出加载路径是停在哪一步。

**踩到的两个坑**：一是 `assert.equal(pageErrors, [])` 比较的是**引用**，永远失败（应为 `deepEqual`）；二是**必须 `page.bringToFront()`**，否则页面不是前台标签页，工作区切换收尾所用的 animation frame 不会跑——表现为"点击后页面变可见但什么都没加载"，一开始很容易误判成产品 bug。

### 10.31 阶段 3 收尾：跳回原文的契约测试（已完成）

**新增**：`scripts/test-graph-source-jump.mjs`（真实浏览器，6 个用例），接入 `pnpm check`。

**这是四个阶段里最后一个没有任何自动化覆盖的交付项**：跳转跨越四个 feature（viewer 状态、导航、PDF 阅读器、引用高亮），终点是无法在无头环境断言的真实滚动效果。因此改为钉住**契约**：每个协作者被用什么参数调用、调用顺序、以及引用定位失败时走哪条回退路径。回退才是值得测的部分，因为每一条都是有人会想"简化掉"的决定：

- 引文定位失败**仍然导航到该页**（常见原因是文本层重排，不是文献缺失），否则用户会停在图谱页不知道为什么；
- **先关闭图谱页再导航**（否则用户看到的是"盖在文档上的图谱"）；
- 引文长度不足 8 字符时**不走引用跳转**，直接到页（那种"引文"更像是误选中的零碎 token）。

**测试抓到一个真实的健壮性缺陷**：页码只做了钳制而没有做**归一化**，于是 `NaN` 会原样传给阅读器（`Math.round(NaN)` → `NaN`，`Math.max(1, NaN)` 仍是 `NaN`），用户会被要求跳到一页不可能存在的页——表现为"点了跳转但哪里都没去"。页码来自**已存的证据记录**，因此畸形记录必须退化为第 1 页而不是让跳转失效。同时补了 `numPages: 0` 的用例（空文档也要给出一个阅读器能接受的页号）。测试侧则修了一处 fixture bug：`numPages: 0` 被我的辅助函数当成"没有打开文档"（`0` 是 falsy），而这是两种不同情形。

## 11. 完成度审计（对照原始目标逐项取证）

审计日期：目标第 24 轮。逐项列出**实现位置**与**自动化证据**；没有自动化证据的一律注明，不做"已验证"的暗示。

### 11.1 阶段 1

| 交付项 | 实现 | 自动化证据 |
|---|---|---|
| `pdfpal-knowledge-graph` 数据库 | `adapters/indexed-db/knowledge-graph-database.ts`（v2，9 个 store） | `test:knowledge-graph`；`test:built-extension`（真实扩展里数据库确实被创建） |
| papers 投影 | `domain/paper-projection.ts` + `paper-projection-plan.ts` | `test:knowledge-graph` |
| 图谱工作区页骨架 | `templates/knowledge-graph.html` + `features/knowledge-graph/knowledge-graph-page.ts` | `test:workspace-vocabulary`、`test:toolbar-targets`、`test:knowledge-graph-dialogs` |
| 7 处视图装配 | `app-shell`、`workspace-navigation`、`application-navigation`、`app-view-models`、`app-view-persistence`、`app-view-restore`、`feature-models`（均已含 graph 视图） | `test:workspace-vocabulary`、`test:responsive-workspace` |
| 零依赖 Canvas 2D 渲染器 | `graph-canvas-renderer.ts` + `domain/graph-render-model.ts` | `test:graph-rendering`、`test:graph-culling` |
| `CITES` / `HAS_KEYWORD` 边 | `contracts.ts` 的边类型组 + `application/keyword-layer.ts` | `test:knowledge-graph` |
| `test:knowledge-graph` 接入 CI | `package.json` 的 `check` 链 | 该测试在链中执行 |
| `pnpm check` 全绿 | — | 每轮均执行；本轮见 §11.5 |
| 启动不白屏 | — | **`test:built-extension`**（打包产物真实加载 + 视图有真实布局盒） |

### 11.2 阶段 2

| 交付项 | 实现 | 自动化证据 |
|---|---|---|
| 实体抽取 | `application/extraction-plan.ts`、`extraction-runner.ts`、`background/ai/entity-extraction-service.ts` | `test:entity-extraction`、`test:entity-extraction-pipeline`、`test:extraction-runner` |
| 多选确认 | `application/entity-service.ts` + `entity-review-dialog.ts` | `test:knowledge-graph-dialogs` |
| 对齐合并 | `domain/entity-similarity.ts`、`application/entity-planning.ts`、`entity-merge-dialog.ts` | `test:entity-alignment`、`test:merge-review`、`test:knowledge-graph-dialogs` |
| 共享实体自动成边 | 确认时命中同一 `entityId` → 两篇文献二跳可达 | `test:entity-extraction`、`test:personal-graph`（复用与共享实体断言） |

### 11.3 阶段 3

| 交付项 | 实现 | 自动化证据 |
|---|---|---|
| 笔记入图 | `graph-note-records.ts` + `application/personal-graph.ts` | `test:personal-graph` |
| 高亮入图 | `annotations/annotation-highlight-list.ts`（只读）+ `application/highlight-capture.ts` + `graph-highlight-bridge.ts` | `test:highlight-capture`（含 barrel 接线断言）；**真实 PDF 取数路径未测**（见 §11.6） |
| 文件夹入图 | `personal-graph.ts` + `graph-personal-repository.ts` | `test:personal-graph` |
| 标签入图 | `domain/tag-identity.ts` | `test:tag-identity`、`test:personal-graph` |
| 按需关系判断 | `relation-recall.ts`、`relation-judgement.ts`、`relation-runner.ts` + 结果确认对话框 | `test:relation-judgement`、`test:relation-runner`、`test:knowledge-graph-dialogs` |
| 跳回原文 | `graph-source-navigation.ts` | **`test:graph-source-jump`**（契约级：参数、顺序、三条回退路径） |

### 11.4 阶段 4

| 交付项 | 实现 | 自动化证据 |
|---|---|---|
| 增量冲突消解 | `application/conflict-resolution.ts` + `conflict-service.ts` + `conflict-dialog.ts` | `test:conflict-resolution`、`test:knowledge-graph-dialogs` |
| 大图性能 | `domain/graph-culling.ts`（视口裁剪 + 标签稀疏化）、`graph-condensation.ts`（折叠）、渲染器缓存绘制顺序 | `test:graph-culling`、`test:graph-rendering`（6000 节点 / 9872 边的绘制调用数）、`test:graph-condensation` |
| 导出 / 导入 | `application/graph-transfer.ts` + `graph-transfer-controller.ts` | `test:graph-transfer` |
| 评估 | `application/graph-metrics.ts` + 统计对话框（采纳率 / 复用率 / 证据率 + 建议） | `test:graph-metrics`、`test:knowledge-graph-dialogs` |

### 11.5 约束与门禁

- **禁止改动的模块**：`git status`/`git diff` 对 `src/viewer/core/pdf-reader`、`src/modules/document-agent`、`src/modules/knowledge`、`src/infrastructure/database/workspace-database.ts` **均无任何改动**。`src/modules/memory/public.ts` 有 1 行改动（`export * from './translation-preferences'`）——经核查**不是本功能引入的**：该改动与 `src/modules/memory/translation-preferences.ts` 同属**翻译偏好**功能，文件时间戳为 14:47，而本功能的 `src/modules/knowledge-graph/public.ts` 为 21:31（相差约 7 小时）。本功能对 memory 的依赖是**只读**的（`paperLibraryTools`、`Public` 类型）。
- **门禁**：`pnpm check` 覆盖 typecheck + 全部测试脚本 + 架构检查 + 模板 id + 构建 + **打包产物冒烟** + 产物检查；每阶段收尾都跑过一次（各轮记录见 §10.x）。架构检查拒绝跨 feature 非 `public.ts` 静态 import（动态 import 例外）、单文件 > 700 行、跨组循环等。
- **最终门禁结果**：`pnpm check` → exit 0（**43 步**：typecheck + **38 个测试脚本** + 架构检查 + 模板 id + 构建 + 打包产物冒烟 + 产物检查）；319 个 TS 文件；482 个模板 id / 448 引用；打包产物冒烟 4/4、对话框浏览器 11/11、渲染预算 3/3、跳转契约 6/6。

### 11.6 明确未做（以及为什么）

这些是**本目标之外**的自我加固项，或无法在不引入未经证实代码的前提下完成的部分。列在这里是为了不把"没做"伪装成"做完了"。

- **Worker 布局**：布局仍在主线程，节点数 > 320 时降级为 90 次迭代。视口裁剪、标签稀疏化与折叠已经解决了"画得慢"，但"布局期间主线程被占用"没有解决。要真正验证 Worker 需要构造大语料库并观察帧率，当前测试装置做不到——**宁可不做，也不交付一个无法验证的并发改造**。
- **向量生成与缓存**：`createRelationAnalysisPorts().loadVectors` 显式返回 `null`，召回退回零成本信号（共享实体 / 同文件夹 / 年份 / 来源）。仓库的 AI 层没有 embeddings 端点（DeepSeek 不提供，Bailian 提供但需另建请求类型 + 设置项 + 缓存失效），且没有 API Key 就无法验证——同样不做无法验证的功能。
- **`relation-judgement` 任务类型**：关系判断在**页面**上下文运行（不是 service worker），且单次运行通常只有 1 批调用；结论本身又是缓存（重跑只会重问未作答的配对）。加任务记录换来的可恢复性很低，属于形式大于实质。
- **抽取准确率抽样核对**：统计对话框已给出采纳率 / 复用率 / 证据率与改进建议；再做一个"抽样标记对错"的流程属于锦上添花，不是目标交付项。
- **真实 provider 调用**：全仓库没有任何测试发起真实模型调用（会消耗用户 Token 且依赖网络与密钥）。抽取与关系判断的**解析、计划、落库**全部有契约测试，但**网络那一跳没有被自动化验证过**。
- **人工验收**：打包产物冒烟测试证明了"能起来且工作区加载完成"，但**视觉与手感无法自动化**——需要人亲自走一遍：抽取 → 确认 → 合并 → 分析关系 → 结果确认 → 冲突消解 → 统计 → 导出/导入 → 高亮入图 → 跳回原文。

## 12. 变更记录：权威数据源从「阅读记录」切换为「知识库」

这一节记录一次**结构性纠正**。它不是新功能，而是把 §10.x 里一个从阶段 1 起就存在、但直到真实使用才暴露的建模错误改正过来。

### 12.1 问题（真实使用暴露）

- 用户把知识库清空后，图谱上方仍显示「过滤隐藏 10」，画布上却没有节点和边。
- 根因不是渲染，而是**成员来源错了**：`openKnowledgeGraph()` 用 `paperLibraryTools.searchPapers({ limit: 100 })` —— **阅读记录**（每个打开过的 PDF 都会写一条）作为投影输入。清空知识库与阅读记录无关，所以文献还在。
- 更糟的是级联删除是**假成功**：`knowledge-base-controller.ts` 移出文档时确实调用了 `graph-removal-bridge.removeDocumentFromGraph()` → `removeGraphPaper()`（级联删实体/边/抽取任务），但下一次投影会按阅读记录把这篇文献重新投影回来、抽取状态清成 `none`。删除看起来生效，直到下一次「重新同步」。
- 阶段 4 收尾时用 `excludedPapers`（排除名单）+「移除/恢复」对话框绕开了这个根因：因为阅读记录**没有删除入口**，「不再显示」只能表达为图谱自己记一笔。这是绕，不是修。

### 12.2 决策（已与用户逐项确认）

| 决定 | 结论 | 理由 |
|---|---|---|
| 成员与字段 | **join 投影**：成员集合 = 知识库文档；标题/文件夹取知识库，`year`/`authors`/`abstract`/`keywords`/`fingerprint` 若存在同 id 的阅读记录则补齐，缺失留空 | 知识库没有书目元数据，而「分析关系」的召回与「统计」都吃这些字段；纯知识库投影会让它们明显退化 |
| 删除方向 | **单边**：只有知识库能删；图谱只反映，不提供删除按钮，只给「去知识库」指路 | 破坏性动作只保留一个入口；级联方向本来就是知识库 → 图谱 |
| 旧数据迁移 | **立即清理、静默**：不在知识库中的图谱记录在加载时直接级联删除，状态栏报数，不弹确认框 | 当前为测试版本、无真实用户数据，一次性告知/导出闸门属于多余的一次性代码 |
| 排除名单 | **退休** `excludedPapers` | 知识库为准之后，「不在图谱」= 「不在知识库」，排除名单是同一件事的第二种表达；两套机制并存正是误导的来源 |

**明确确认过的语义**：只打开 PDF、没有点「添加到知识库」→ 图谱里就没有它。`addKnowledgeDocument()` 成功写入知识库才是进入图谱的唯一条件。

### 12.3 行为变化（验收时逐条对照）

1. 「添加到知识库」成为进入图谱的唯一门票；阅读记录不再有决定成员进出的权力，降级为**书目元数据缓存**。
2. 知识库移出文档 → 图谱文献、实体、边、抽取任务一并删除，**重新同步与重开页面都不会复活**（这是本次改动的核心修复点）。
3. 图谱的 100 篇上限消失（不再是 `searchPapers({ limit: 100 })`；知识库是 localStorage 数组，可全量读）。
4. 「文献」按钮从「移除/恢复」改为**只读对照表**：知识库全部文档 + `indexStatus` + 关系数（含「还没有任何关系，所以画布上没有它的节点」）+ 「删除请在知识库页操作」的指路。保留它的理由不变：画布上没有节点的文献，只有这个列表能看见。

### 12.4 实现结构

- **join 规则**落在一个纯函数文件 `modules/knowledge-graph/application/paper-source.ts`，可脱离存储单测；读取知识库只在组合根 `modules/knowledge-graph/public.ts` 里发生（`import { listKnowledgeDocuments } from '../../knowledge/public'`）。跨模块方向是 knowledge-graph → knowledge，`modules/knowledge` 目前零引用 knowledge-graph，不会成环。
- **三条入口统一**：`openKnowledgeGraph`、`regenerateKeywordLayer`、`pruneRemovedGraphPapers` 全部改为「知识库成员 + join → 投影 → 清理不在知识库中的 paperId」，复用既有 `pruneGraphPapers()`（一条 `deletePaperCascade` 事务 + `deleteJobsForPaper`，与交互式清理同形）。
- **顺手修掉一个潜伏 bug**：`refreshGraphProjection` 原本会对自己发现的「已消失文献」直接 `deletePaper`，而纸行一旦删掉，`pruneGraphPapers` 就找不到它（它按已有纸行过滤），于是**实体与边被留成孤儿**。现在投影函数不再删任何东西（`GraphPersistencePort` 里的裸 `deletePaper` 一并移除，避免再次诱使调用方绕过级联），删除只有 `pruneGraphPapers` 一条路。
- **进入页面即对账**：`renderKnowledgeGraph()` 从「已加载就只重绘」改为「每次进入都走 `loadAndRender(!loaded)`」。否则在知识库页删掉一篇、回到图谱页看到的还是内存里的旧快照——删除看起来没生效，而这正是本次要消灭的错觉。
- **投影版本号必须 bump**（`KNOWLEDGE_GRAPH_PROJECTION_VERSION` 1 → 2）：`title` 的来源变了，不 bump 就不会重写已有记录。
- **退休链路**：`KnowledgeGraphSettings.excludedPapers`、`normalizeExcludedPapers`、`paper-exclusion.ts`（`planPaperRemoval`/`planPaperRestore`/`excludedPaperIdSet`）、`removePapersFromGraph`/`restorePapersToGraph`、`papers-dialog` 的两个动作、`graph-paper-actions`、以及对应契约断言、浏览器用例与打包扩展 E2E。设置字段保留一个版本「读入即丢弃」，避免老记录抛错。
- **「文献」弹窗改为只读**：它仍然是唯一能看见「没有关系的文献」的地方（画布上没有节点），但不再有移除/恢复，只列出知识库全部文档 + 关系数 + `indexStatus`（未索引/索引中/失败原因），底部一个「去知识库」按钮。理由：如果这里也能删，就等于给「这篇文献在图谱里吗」留了两个会互相矛盾的答案。

### 12.5 验收结果（打包扩展内实测）

`scripts/` 下的临时验证脚本（跑完即删）在 `.output/edge-mv3` 上按真实 UI 走了一遍，seed 了 2 篇知识库文档（`kb-1`/`kb-2`）与 3 条阅读记录（多出的 `read-only` 只打开过、没进知识库）：

| 步骤 | 结果 |
|---|---|
| 首次加载 | 图谱 papers = `['kb-1','kb-2']`，`read-only` **不在**图谱里；计数 `2 文献 · 1 实体 · 2 边` |
| 知识库页点「移出」删掉 `kb-2` | 图谱 papers 立即变 `['kb-1']`（bridge → 级联删纸+实体+边+抽取任务） |
| 点「重新同步」 | 仍是 `['kb-1']`，计数 `1 文献 · 1 实体 · 1 边`（共享的关键词实体保留，被删文献的那条边消失）——**不复活** |
| 背着图谱页直接改知识库（localStorage 写空）后离开再回到图谱页 | papers 变 `[]` —— 进入页面即对账生效 |
| 整页重载 | papers 仍为 `[]`，状态 `已载入 0 篇文献` |

### 12.6 遗留项（本文档明确记录，不在本轮做）

1. **书目元数据缺口**：没有阅读记录的知识库文档缺少 `year`/`abstract`，「分析关系」对它的召回质量会下降。知识库存了 `overviewMarkdown` 但年份未结构化，**不从概览文本里猜元数据**——猜错比留空更糟。同理，书目补齐走 `paperLibraryTools.searchPapers`，它有 100 条上限；超出上限的知识库文档只会缺元数据，**不会掉出图谱**（`LIBRARY_ENRICHMENT_LIMIT`）。
2. **chunks 与知识库无关**：移出知识库不会删 chunks（chunks 由 `document-agent` 在打开 PDF 时写入）。所以「能不能抽取」取决于 chunks，**不取决于 `indexStatus`**；`indexStatus` 只用于显示，不当开关。

### 12.7 不动的东西

`src/viewer/core/pdf-reader`、`src/modules/document-agent`、`src/modules/memory`（`paperLibrary` 继续写，只是不再是权威）、`src/infrastructure/database/workspace-database.ts`，以及知识图谱的实体/关系/统计/导出导入/折叠/视口逻辑，均不改。

### 12.8 一条给自己留的教训

本轮排查「回到图谱页没刷新」时，我用的打包产物是上一次 `pnpm check` 留下的旧 bundle，于是一直在错误的前提上推断产品行为（先后怀疑 rAF 未触发、怀疑 `loading` 悬挂）。真相很简单：`.output/edge-mv3` 早于代码改动。**跑打包扩展验证之前必须先 `pnpm build`**，否则测的是上一版。

## 13. 真实使用中修掉的界面问题（含一处新功能）

这一节记录继 §12 之后用户报的三件事。两件是布局回归，一件是新功能；都写清根因，因为三个根因都不是「样式没调好」，而是**两个机制叠在一起**。

### 13.1 分组标题竖排（`知识库中的文献（3）` 一个字一行）

- **根因**：共享样式 `.app-confirm-dialog header` 是给「图标 + 文本 + 关闭按钮」设计的三列网格（`42px minmax(0,1fr) 32px`）。它是「一个类 + 一个元素」的选择器，**特异性高于** `.knowledge-graph-review-group-heading`（单类）的 `display: flex`，于是对话框内部所有 `header`——包括分组小标题——都变成三列网格，唯一子元素 `h3` 落进 42px 的图标列。ASCII 标题（`METHOD (30)`）不会断行所以看不出来，中文标题会按字断行，于是竖排。
- **修法**：把共享规则限定到对话框**自己的** header（`.app-confirm-dialog > header` 与 `.app-confirm-dialog-card > header`），嵌套 header 恢复各自的布局。这不是给某个对话框打补丁，而是把「对话框外壳的布局」和「正文里的标题」分开。
- **回归测试**：在 papers 对话框上量 `getComputedStyle(heading).display === 'flex'` + 标题高度 < 26px + 宽度远大于高度。竖排是布局事实，只能靠几何量测，不能靠文案断言。

### 13.2 下拉框「还是双重框」

- **根因（上一轮没修对的原因）**：应用在启动时装了一个 select 增强器（`shared-ui/select/custom-select.ts`）。它把每个 `<select>` 包进 `<div class="ui-select">`，**并把原生 select 的 className 复制给这个 div**，原生元素则被缩成 1px 的 `.ui-select-native`。真正显示的是 `.ui-select-trigger`（自带边框和箭头）。所以 `.knowledge-graph-review-type` 的 `border` 上一轮打在了 **wrapper** 上——一层框套在另一层框外面。上一轮的测试页面没有装增强器，量的是原生 select，于是「通过」了，而用户看到的仍是双框。
- **修法**：`select.knowledge-graph-review-type` 只管增强前的原生形态；`.knowledge-graph-review-type.ui-select` 明令 wrapper 无边框、无背景、无内边距；尺寸与字号打在 `.ui-select-trigger` 上。焦点态交给 `select-theme.css` 的 halo，不再自绘第二层。
- **回归测试**：测试里真的跑一遍 `installReusableSelects()`，然后断言 wrapper `borderTopWidth: 0px`、`backgroundImage: none`、trigger `1px solid`、箭头恰好 1 个、wrapper 与 trigger 同宽（差 0px）。**教训**：测「屏幕上是什么」而不是「我以为是什么元素」。

### 13.3 候选词下方显示中文释义（新功能）

抽取出来的名字是论文里的原话（`Boyar-Perralta heuristic`、`two-step process for combinational logic optimization`），而用户要对「它该不该进知识图谱」做判断——不该顺带考一次英语。所以候选名称下方给一行中文释义。

设计上的四条硬规则：

1. **只显示，不改名**。释义永远不写回实体：名称是图谱连边用的身份，把实体悄悄改成中文会让同一篇论文下次抽取时匹配不上。
2. **按需、一次请求**。默认关闭（要花 Token），勾选「显示中文释义」时对**当前可见**的候选名发起**一次**批量请求（隐藏的低置信度行不会为它花钱），上限 60 个词。
3. **按名缓存**。同名不重复付费；模型明确不译的词也按「无释义」缓存，避免每次开对话框都重问。
4. **失败只落在行内**。释义是阅读辅助，翻译失败不能连带毁掉这次审阅：行内显示「翻译失败：原因」，勾选/确认照常。

实现上分两层，因为可测性：`entity-translation-plan.ts`（无 import，含 prompt、容错解析、缓存与批量上限）与 `entity-translation.ts`（只负责把 AI 请求接上）。对话框本身不碰网络——`openEntityReviewDialog({ translate })` 由动作层注入，所以浏览器测试可以不带 API Key 跑完整交互。

请求形状：`{"items":[{"term":"原文术语","zh":"中文译名"}]}`；解析容错接受平铺 `{"term":"译名"}`，丢弃未被请求的词、空白译名、以及把原文原样回显的「假翻译」。

### 13.4 图谱页点「PDF 阅读」回不到阅读页

- **根因**：`#ai-panel-toggle`（顶部「PDF 阅读」）的处理器只写了「离开知识库」「离开单词库」两条分支，漏了图谱。于是在图谱页点它只会执行 `setCurrentApplicationView("viewer")`——阅读器工具栏（含标注工具条）显示出来，但工作区从未切回去。
- **修法**：补上 `closeKnowledgeGraphPage()` 分支；「AI 助手」按钮同样补上（它原来在图谱页上是死按钮）。
- **回归测试**：打包扩展套件里断言切换后 `#knowledge-graph-page` 变 hidden、`#reader-workspace` 可见、`workspace-stage` 里恰好一个子元素可见——并等**离开的那一页**变 hidden（过渡期间新旧两页都可见，只等新页可见会读到半完成状态）。

## 14. 实体合并：从一层信号扩到三层

真实使用暴露的具体失败：同一篇论文抽出了 `Boyar-Peralta heuristic`（0.98）和 `BP heuristic`（0.95）两个候选，它们指的是同一个东西，而系统没有任何一步能发现。

### 14.1 先量化问题（用仓库自己的函数实测）

| 名称对 | 旧的文本相似度 | 原流程结果 |
|---|---|---|
| `Boyar-Peralta heuristic` / `BP heuristic` | **0.488** | 低于 0.70 展示下限 → **合并对话框里根本不出现** |
| `graph neural network` / `GNN` | **0.076** | 不出现 |
| `Boyar-Peralta (BP) heuristic` / `BP heuristic` | 0.536 | 不出现（包含关系触发了，但基础分 < 0.62 不加分） |
| `ResNet` / `ResNeXt` | 0.790 | 列出但不预勾 |
| `Self Supervised Learing` / `…Learning` | 0.923 | 预勾（拼写错） |

结论：**不是阈值调小了，是算法对这种替换不敏感**——缩写与全称几乎不共享字符。把阈值降到 0.49 会把 `JPEG-LS`/`JPEG 2000`（0.455）也放进来。

### 14.2 现在的三层信号（每层都只产「建议」，除了第一层）

1. **归一化相等 = 事实，静默合并**（`entity-normalization.ts`）。这条线守死：`Transformer`/`Transformer模型`、连字符 vs 破折号自动合一。放宽它就会把 `BERT`/`ERNIE` 并成一体——那是数据损坏。
2. **别名（抽取时由模型给出）**（prompt `entity-extraction-2`）。模型读整段，最清楚 `Boyar-Peralta (BP) heuristic` 里 `BP` 就是那个缩写。候选带 `aliases` 落库，并且**匹配时也查别名**：`planPendingCandidateUpsert` 与 `planEntityConfirmation` 都是「先按归一键精确匹配，没有才查别名」，命中后把新拼写记进 `aliases`。确认对话框在名称下方显示「别名：…」，确认时别名一起带走。
3. **本地缩写规则（零 Token）**（`entity-abbreviations.ts`）。两条子规则，强度不同：
   - **文中声明**（`Boyar-Peralta ( BP ) heuristic`，正是我们**已经存在证据引文里**的那句话）→ 0.97，**可以预勾**。括号经常插在名字中间，所以长名是由「括号前的若干词 + 括号后的若干词」组合、再用宽松判定（允许尾部剩余词）验证出来的。
   - **仅首字母**（`BP heuristic` ← `Boyar-Peralta heuristic`、`GNN` ← `graph neural network`）→ 0.82，落在复核带里，**不预勾**：`BP` 也可能是 back-propagation。这层的要求是严格的：两侧 token 必须全部被消耗，否则 `ResNet`/`ResNeXt`、`JPEG-LS`/`JPEG 2000` 会被误判。
   - 两类建议都并入「合并同义实体」对话框（`buildMergeReview` 会合并两路建议，同一对只留更强的一条，并保留缩写理由）。
4. **AI 同义问询（可选，花 Token）**（`entity-synonym-plan.ts` + `entity-synonym.ts`）。确认对话框里勾「检查同义写法」才发一次请求，问「这些名字里哪些是同一个概念」，按候选名集合签名缓存。答案只是**建议**：行内出现「疑似与「X」是同一概念 ［合并为它］」，点下去等于把该行**改名**并把原拼写记进别名——没有第二条合并通道，用的就是用户本来也会做的两步操作。

### 14.3 为什么「合并为它」是改名而不是调用合并

`planEntityConfirmation` 的语义是「归一键相同就是同一个实体」，所以把两行的名字改成一致，确认时自然塌成一个实体、只写一条边、另一拼写进 `aliases`。走这条路意味着：不需要给对话框一个新的写库路径，也不会出现「对话框合并了但确认又建了一个」的竞态。

### 14.4 覆盖的测试

- 契约（`test-knowledge-graph.mjs`）：缩写的正例与反例（含 `BERT` 跳过 `from`）、括号插在名字中间的抽取、`BP` 只是「前导」而非完整缩写、声明 vs 仅首字母的分数与预勾差异、`buildMergeReview` 能把这类对送进对话框；抽取 `aliases` 的解析（去重、不重复名称）、别名匹配让 `BP heuristic` 落到既存实体、没有别名时会新建（反向对照）；同义问询的 prompt、解析（丢弃未请求名字、丢弃单例组）、按名集合缓存（同集合不重复付费、集合变了才重问）。
- 浏览器（`test-knowledge-graph-dialogs.mjs`，19 项）：别名行渲染、「检查同义写法」默认关闭且无 checker 时整块隐藏、一次请求覆盖可见行、点「合并为它」后两行同名且旧拼写进别名并标记人工修正、确认载荷携带别名。

### 14.5 已知边界（写清楚以免误以为万能）

- **别名匹配仍要求类型相同**：`BLEU` 作指标与作数据集不会被并到一起，这是刻意的。
- **只有 `BP` 一个词、且文中没有任何括号声明时不会给出建议**：`BP` 与 `Boyar-Peralta heuristic` 的 token 数差异太大，仅靠首字母不安全。这类要靠第 4 层的 AI 问询。
- **同义缓存按「候选名集合」**：多加一个候选就是新问题，宁可多花一次也不返回过期答案。
- **跨语言同义**（中英文对照）只靠第 4 层模型判断，本地规则不猜。

## 15. 抽取降噪（`entity-extraction-3`）

真实跑了几篇论文后的结论：噪声偏大（泛词多、凑数词多），且经常把 Introduction 里提到的背景方法当成论文自己的贡献。三处改动，一处比一处更靠工程。

### 15.1 prompt 重写：把配额从提示里拿掉

旧 prompt 的致命句是「每个片段最多 12 个候选」——模型会把它读成**目标**而不是**上限**，这正是凑数词的来源。新 prompt（`entity-extraction-3`）：

- 用「宁缺毋滥」+「如果某个片段全是废话或背景介绍，请返回空数组 []」把「少」明确为合法答案；
- 给正例（`Transformer` / `WMT 2014 English-to-German` / `28.4 BLEU` 这类带具体对象的 Claim）和反例（`Deep Learning`、`Neural Network`、`Model`、`Method`、`Data`，以及 `The experimental results show that` 这类描述性短语）；
- 六类实体各自带「不要抽什么」的界定，Claim 明确要求「有具体对象和结果」；
- **不再出现任何数字配额**，上限改由代码兜底（见 15.4）。

契约测试直接断言 prompt 里**没有** `最多 N 个`（防止配额悄悄回来），并断言正例/反例段落与「返回空数组」存在。

### 15.2 Abstract 注入：让模型知道这篇论文在做什么

一次调用只看 3 个 chunk，所以 Introduction 里提到的 GNN 与方法一章里提出的方法在模型眼里没有区别。现在每条 user message 都以「论文标题 → 论文摘要 → 文档 → 正文片段」开头。

**一个必须说清的实现细节**：本地 PDF 的 `PaperLibraryRecord.abstract` 实际上几乎总是空的（阅读记录只写标题与页数）。所以「拼 Abstract」如果只读那个字段，对你手上这些论文等于什么都没做。因此加了降级链（`graph-extraction-repository.getPaperSummary`）：

1. 书目 abstract（有则用）；
2. 否则用知识库的 **PDF 概览**（`getDocumentOverviewMarkdown`），由 `overviewLeadAsAbstract()` 去掉 Markdown 记号、压成一段、截到 600 字；
3. 都没有 → 不发送该字段（而不是发一个空的「论文摘要：」引导模型编造）。

### 15.3 低置信度硬过滤

`MIN_PENDING_CONFIDENCE = 0.4`：低于它的候选**不进 pending 列表**。理由：复核对话框本来就默认不勾选低置信度行、还要开开关才看得见，留在这里只是让用户去「找」它再否定。被丢弃的数量会计入 `droppedLowConfidence` 并出现在完成提示里（「抽取完成：N 个候选（M 个置信度过低已忽略）」）——不报出来的过滤等于把问题藏起来。

### 15.4 配额改由代码兜底

`extractionMaxCandidatesPerChunk`（默认 12）**保留**，但语义从「提示模型最多抽几个」变成「一次响应最多保留几个」：`parseEntityCandidates` 按 `confidence` 降序截断，被截掉的写进 `rejected` 并带原因。这样既有上限，又不给模型任何「凑到 N 个」的暗示。

### 15.5 重抽不再累加旧候选（这条是重跑的必需品）

`planPendingCandidateUpsert` 只增不删，所以「换个 prompt 再抽一次」会把**上一轮的噪声候选**留在列表里，新旧混在一起——这会让任何 prompt 改动都无法被评估。现在一次**从头开始**的抽取（`startBatch === 0`）会先删掉本篇论文自己的未确认候选，规则刻意收窄：

- 只删 `status === 'pending'`（用户确认过的一律不动，那是人的决定）；
- 只删**全部证据都来自本篇论文**的（别的论文也贡献过证据的 pending 实体保留，否则会抹掉那篇论文的线索）。

被替换的数量计入 `replacedPending`。`entity-extraction-3` 的版本号提升也让「正文未变化就跳过」的指纹失效——重抽会真的重跑。

### 15.6 验证

- 契约测试（`test-entity-extraction-pipeline.mjs`）：prompt 无配额、正例/反例/空数组规则齐备；user message 的字段顺序与「无 abstract 时整块省略」；`overviewLeadAsAbstract` 去 Markdown + 截断到词边界 + 截断标记；配额按置信度截断并把被截的记进 `rejected`。
- 契约测试（`test-extraction-runner.mjs`）：每批请求都带上 summary、无 summary 时不发该字段；重抽替换本篇 pending 且计数、**确认实体不被删除**（反向保护）。
- 契约测试（`test-knowledge-graph.mjs`）：`MIN_PENDING_CONFIDENCE = 0.4`，0.4 保留 / 0.39 丢弃 / 丢弃计数。
- **模型实际输出质量无法在仓库里验证**：全仓库没有测试会发起真实模型调用（会花用户 Token、依赖网络与密钥）。所以这一节的结论是「机制已验证」，而不是「噪声已经下降」——后者只能由真实跑一次得到，见 15.7。

### 15.7 怎么用一次真实抽取来判断效果

1. 打开那篇 Introduction 很长的 PDF，点「抽取候选实体」（因为 prompt 版本变了，不会命中「正文未变化，已跳过」）。
2. 完成提示会直接给两个数：候选总数、以及「M 个置信度过低已忽略」。
3. 复核对话框里按类型数一遍：泛词（`Deep Learning`/`Model`/`Method`）是否还在；Introduction 里的背景方法（GNN/Attention 之类）是否还被标成 `Method`；总数比上一轮多了还是少了。

判断标准建议：**总数下降但关键 Method/Dataset/Claim 没丢**才算成功；如果关键实体也跟着消失，说明「宁缺毋滥」压得过狠，应把反例清单收窄（例如允许 `Attention` 这类领域通用概念）而不是回退配额。

## 16. 复核对话框：忽略要真的消失，垃圾名字不该进来

真实使用后又暴露两件事。第一件是**交互说谎**，第二件是**噪音还有一类工程能挡住的**。

### 16.1 点「忽略」/「不再提示」后行不消失

- **根因**：两个按钮都只做了 `row.selected = false; renderGroups();` ——行还在，只是不打勾。用户看到的是「按钮没用」，于是同一行下次还得再找一遍。
- **改法**：两个动作都把行**从本次列表移除**（记录本身不动，重开对话框仍会出现——那正是旧文案「保留记录，之后仍可确认」的意思）：「不再提示」额外写忽略名单，写失败则**保留该行**并报错（既然承诺没兑现，就不能假装它消失了）。
- **配套**：计数与表头随列表实时更新（`已选 x / y · 已忽略 N`、`共 N 个候选…；已忽略 M 个`）；全被忽略时表头写「本次的 N 个候选都已忽略」，并且确认按钮在没有任何候选时禁用。`skippedCount` 把被忽略的行也算进去，否则「确认 3 个、跳过 X 个」的数字会对不上。
- **回归测试**：浏览器套件里点「忽略」→ 行数减一、名字消失、计数变化；点「不再提示」→ 行数归零、`ignoreEntityName` 被调用、列表出现「没有符合当前筛选的候选」、表头累计到 2。

### 16.2 `XOR2` / `XOR3` / `b l cost` 这类名字

新 prompt 已经明确禁止泛词，但这些不是泛词——是**表格与图注的碎片**，没有规则挡就会一直进来。新增 `domain/entity-name-quality.ts`，两条不同性质的规则：

- **拒绝**（什么都不损失，因为本来就没有概念）：归一化后不足 3 字符（`b`、`63`）、完全没有文字、全部是单字母（`a b c`）、**多数是单字母**（`b l cost`）、表格/图号引用（`XOR2:2:1`、`Table 3`）、超过 10 词或 80 字符（是句子）。名字前的 `#`/`@` 等标记先剥掉（`# XOR2` → `XOR2`）。
- **变体折叠**（信息保留，列表不膨胀）：`全大写缩写 + 一位数字`（`XOR2`）且该缩写在当前集合里存在时，作为**别名**并入基名，不新建实体。

第二类刻意做窄，因为相邻的形状都是正经名字：`WMT14` 是两位年份、`GPT-3` 与 `ResNet-50` 是带连字符的型号，三者都**不**折叠。契约测试把这个边界钉住了（`variantBaseOf('XOR2',['XOR'])==='XOR'` 而 `('WMT14',['WMT'])===null` 等）。

两个计数分开上报（`droppedLowQuality` / `collapsedVariants`），完成提示因此能说明白「9 个候选（2 个不是概念，已丢弃）（1 个编号副本已并入同名实体）」——丢的是内容问题，折叠的是命名问题，混在一个数字里就没法判断下一步该改 prompt 还是改规则。

### 16.3 结构

对话框涨到 746 行、触发门禁，于是把两个**可选 AI 注解**（中文释义、同义建议）整体抽成 `entity-review-annotations.ts`：一次请求/失败落行内/按名缓存/「合并为它」只是改名，都是这个子系统自己的规则。对话框回到 594 行，只负责「确认什么」。

## 17. 忽略要写库：行消失只是表相

用户第二次报同一件事，这次说得更准：**行确实消失了，但「待确认」数字没变，再点进去还是那几条**。

### 17.1 三个各自成立的错误

1. **只改了界面**。旧实现里 忽略 只做 `row.selected = false`（后来改成只从本地列表移除），数据库里那条候选仍然是 `pending`。
2. **「待确认」徽标数的是 pending 记录**（`listPendingEntities()`），所以它当然不动。
3. **`loadPendingReview` 没有过滤忽略名单**。`confirmEntityCandidates` 在确认时才跳过忽略名，但复核列表照旧把它们列出来——于是「不再提示」之后重开对话框，它还在。
4. 还有一个静默的坑：`openPendingEntityReview` 在对话框返回 `null`（「稍后再说」）时**直接 return**，连 `refreshPendingCount()` 都不跑，所以哪怕状态改对了，徽标也要等到别的动作才刷新。

### 17.2 现在的语义

两个按钮都**写库**，差别只在记不记得住：

| 动作 | 写入 | 之后 |
|---|---|---|
| **忽略** | 该候选 `status: 'rejected'` | 立刻离开待确认列表与计数；**同一篇论文再次抽取**会把它重新提出（新的一次运行就是新的一次建议） |
| **不再提示** | `'rejected'` + 名字进 `ignoredEntityNames` | 之后抽取**根本不会提出**它（`planPendingCandidateUpsert` 直接跳过并计数），复核列表也再不会列出 |

`rejected` 是仓库里早已存在的状态，统计报告本来就把它算作「被拒绝的候选」，所以这不是新概念，只是终于用对了地方。已确认的实体永远不会被这条路径碰到（`dismissEntityCandidates` 明确排除 `confirmed`）。

### 17.3 配套

- `loadPendingReview` / `buildPendingReview` 过滤忽略名单（列表与计数两个口径同时收紧）。
- `planPendingCandidateUpsert` 新增 `ignoredNames` 选项与 `droppedIgnored` / `reProposed` 两个计数：前者说明「有 N 个名字你叫它别再问」，后者说明「有 M 个你之前忽略过、这次重新提出」。
- `openPendingEntityReview` 无论对话框返回什么都会 `refreshPendingCount()` + 重新读取快照。
- 文案改成分清时效：忽略 = 「这次不要……再次抽取仍可能重新提出」，不再提示 = 「永久忽略……之后抽取也不再提出」。

### 17.4 测试

- 契约：`dismissEntityCandidates` 两档语义（忽略只 reject、不再提示同时写名单）、已确认实体不被触及、忽略名单不进入复核列表、`rejected` 候选在下次抽取时回到 pending 而忽略名单里的不会。
- 浏览器：点 忽略 → 行消失 **且** 写入调用是 `{remember: false}`；点 不再提示 → `{remember: true}`；表头累计「已忽略 N 个」；全部忽略后列表说明为什么空。

### 17.5 后续：徽标与列表算法必须同源

上面改完后仍出现一次「徽标 9、弹窗 0」——因为**徽标数的是 pending 记录数，列表算的是过滤后的候选数**，两个口径。那 9 条正是早前点「不再提示」时只写了忽略名单、记录仍是 `pending` 的残留；列表把它们藏了，计数却照数。

三步收口：

1. `refreshPendingCount()` 改为调用 `loadPendingReview()` 的 `total` —— 与弹窗**同一个函数**，从此不可能再算出两个数。
2. 新增 `reconcileIgnoredPendingCandidates()`：把「名字在忽略名单里、状态还是 pending」的记录标成 `rejected`，幂等，返回处理了几条。**藏起来不等于解决**，留着 pending 就会被任何读 pending 的地方数到。
3. 计数前先做一次该对账，于是旧残留被一次清掉，两个数字从第一次刷新起就一致。

契约测试覆盖：对账把忽略名的 pending 记录标成 rejected、幂等、对账后 `loadPendingReview().total` 与列表长度一致。

## 18. `entity-extraction-4`：图表碎片与描述性长句

用户重跑后确认列表清爽了很多，剩下两类顽固形态，并明确「不要在本地硬拦句子、避免误伤」。于是分成两侧处理：prompt 让模型别产出，本地只做**降级**不做判死。

### 18.1 prompt 侧

- 反例清单新增两条，并给出具体例子：**图表碎片**（`b l cost`、`Table 3`、`Fig. 2`、`XOR2:2:1`、纯字母加编号）、**描述性长句**（`XOR3 (b2) Support for Boyar-Peralta Algorithm`、`a method based on X`、`the proposed flow achieves …`），并说明「只抽它真正的名字，抽不到合适的名字就不要抽」。
- 结尾那句从「不确定的候选宁可给低分也不要省略」改成「**不确定的候选请不要输出，绝对不要为了凑数而输出低分项**」。旧措辞字面上就是在鼓励模型把没把握的东西也吐出来——它把「不要省略」读成了「都要输出」。
- 版本号 → `entity-extraction-4`，于是「正文未变化就跳过」的指纹失效，重跑会真的重跑。

### 18.2 本地侧：降级而非删除

`assessEntityName()` 新增第三档判定 `suspect`（此前只有 usable / 拒收）：

- 命中**动作或用途短语**：`support(s) for`、`supported by`、`based on`、`propose(d)`、`achiev(e)`、`improv(e)`、`enabl(e)`、`allow(s)`、`outperform(s)`、`implement … in/with/by/using`、`using`。
- 或**数字与符号占比 > 45%**（`ΔE >> 5%` 是 67%）。

命中者 `usable: true` 但带 `suspect` 原因，`planPendingCandidateUpsert` 把它挡在复核列表之外并计入 `demotedSuspect`，完成提示写「（N 个像是描述性短语，已降级忽略）」。**它与「不是概念」的 `droppedLowQuality` 分开计数**——一个说模型在编垃圾，一个说模型把名字写成了从句，只有分开才知道下一步该改 prompt 还是改规则。

**为什么规则必须这么窄**：实测这些正经名字的符号占比是 `GPT-3`/`BLEU-4`/`WMT14` = 0.40、`ResNet-50` = 0.33，阈值取 0.45 才不伤它们；`based on` 而非 `based`，所以 `SAT-Based Optimization` 与 `Self-Attention` 都不受影响。契约测试把这份「必须活下来」的清单逐条钉住。

### 18.3 一处刻意的取舍

`Graph Convolutional Network using Attention` 会被降级（命中 `using`）。这类名字确实常是描述，但也可能真是方法名。选择降级而不是删除：它只是不进复核列表，不会污染图谱；反过来若放行，用户又要在列表里逐条否决。这条可以在 `DESCRIPTIVE_PHRASES` 里删掉一行就好，判断依据写在代码注释里。

## 19. 添加文献后抽取按钮变灰

用户加到知识库后回到图谱页：`已载入 0 篇文献`、两个抽取按钮全灰。三个原因是叠在一起的。

### 19.1 进入页面只做删除，不做新增

`renderKnowledgeGraph()` 之前对已加载过的页面走**plain load**（只 prune + 读快照）。这个决定是为了让「进入页面就对账」便宜，但它只能**删**：知识库里新增的文档永远不会被投影，必须手动点「重新同步」。而 `refreshExtractionAvailability()` 依赖快照里的 `currentPaperId()` / `listPapers()`，快照里没有那篇文献 → 两个按钮都禁用，提示「当前 PDF 尚未进入图谱」。

**改法**：进入页面一律走**完整投影**（`loadAndRender(true)`）。`refreshGraphProjection` 本身是增量的（`shouldWriteProjection`），所以知识库没变时它一个字节都不写，代价只是几次读。

### 19.2 页面开着时加文献，页面不知道

「添加到知识库」按钮就在**图谱页自己的工具栏**上。之前加完只更新知识库，图谱页毫无反应——这正是用户遇到的情形：他没有离开页面。

**改法**：`registerCorpusChangeSync()` 监听 `pdf-helper:knowledge-corpus-change`（语料写入时本来就会派发），图谱页可见时 600ms 防抖后 `resyncKnowledgeGraph()`。防抖是必须的：索引过程会连续写入进度/状态/块数，否则一次添加会触发几十次重读。

### 19.3 被拒绝的候选被当成节点计数

快照把 `listEntities()` 全量当实体，于是 `rejected`（我上一节把 9 条待确认对账成的结果）与 `merged` 墓碑都计入「未连接 N」，画布明明空着却显示 `未连接 4`。**改法**：`loadGraphSnapshot` 只保留 `pending`/`confirmed` 的实体——被拒绝的候选只属于统计报告，墓碑的名字与边都在幸存者身上。

### 19.4 空态文案自相矛盾

空态判定原本要求 `totalPapers === 0 && totalEntities === 0` 才说「知识库还是空的」，否则落到「知识库里的 **0 篇文献**之间还没有任何关系：先『抽取候选实体』…」——一句自相矛盾、还让用户去抽一个不存在的文献的提示。现在只看 `totalPapers === 0`。

### 19.5 回归测试

打包扩展套件新增一项（跑在最后，因为它会写语料）：进入图谱 → 追加一篇到知识库并派发事件 → 断言状态从 `共 1 篇` 变 `共 2 篇`、批量抽取按钮可用。这条正是用户报的路径；`test-viewer-layout.mjs` 另加「无文献但有残留实体时仍说知识库为空」的断言。

## 20. 合并建议需要一个「不是同一实体」

用户报的下一件事：合并对话框只能勾选或关掉，没有拒绝按钮，而 `s-XOR → b-XOR`（相似度 0.70）这种明显不该合并。

### 20.1 为什么必须有「记住」而不是只关掉

对齐分数是**字符串比较**：`b-XOR` / `s-XOR` 共享字母，落在 0.70 的复核带里；真正的拼写错也在同一带。没有阈值能把两者分开。所以「不是同一实体」这个判断**只能由用户给出，并且必须被记住**——否则每次打开对话框都重新提一次同样的错建议，用户就会停止打开它。

### 20.2 实现

- 设置新增 `mergeRejections: string[]`，键是 `mergePairKey(a, b)`：**与方向无关**（"这两个不是一回事"没有方向，方向键会让同一对以换边形式回来），`normalizeMergeRejections` 负责校验/去重/上限 500。
- `buildMergeReview(entities, { rejectedPairs })` 在**聚类之后**过滤——对话框呈现的是「簇 → 代表」，用户拒绝的是那个呈现出来的对，不是某条原始边。
- `loadMergeReview` 读设置后传入；`rejectMergeSuggestion()` 写设置并返回累计条数，`clearMergeRejections()` 清空。
- 界面：每行一个「不是同一实体」按钮 → 记录 + 移除该行 + 状态栏说明；表头与之同步（「（已按你的判断排除 N 条）」），底部出现 **「恢复 N 条已拒绝」**（没有拒绝时隐藏）。恢复是必需的——否则一次误点永久生效且不可见。
- 顺带修了一个同类隐患：`openEntityMergeDialog` 的打开路径原本没有 try/catch，读设置失败会让调用方的 promise 永远悬着（和候选实体对话框当初那个 bug 一模一样），现在报错并 `resolve(0)`。

### 20.3 测试

契约：键与方向无关、同实体不成对、存储值校验去重、被拒绝的对不再出现（两个方向都试）、拒绝一对接不影响其它对、记录/去重/清空。
浏览器：默认两条建议 → 点「不是同一实体」→ 写入的是 `{keep, merge}` 且行消失、表头与计数更新 → 点「恢复」→ 两条建议回来、设置清空。

## 21. 画布不再写关系名，改在右侧面板读

用户的意见：一张文献节点连着十几个实体时，每条线上都印着 `MENTIONS`，画布变成一片重复文字，而且它压在被它标注的节点之间。

### 21.1 改法

- **画布不画边上的关系文字**（删掉 `drawEdgeLabel` 与其调用）。留在画布上的是「一眼能用的编码」：颜色区分来源（AI / 规则 / 用户）、虚实线区分规则推导。
- **点某条边 → 右侧检查面板显示关系名**。原来的标题只有 `edge.type` 这个枚举值（`MENTIONS`），既然它现在是唯一的显示位置，就必须是人能读的词：改成 `提及（MENTIONS）`——中文在前，存储值在括号里便于溯源。

### 21.2 顺带把关系文案收成一份

`describeEdgeType` / `edgeTypeLabel` / `EDGE_TYPE_LABELS` 放进 `domain/edge-labels.ts`，并替换掉关系复核对话框与冲突消解对话框里各自那份 `VERDICT_LABELS`（两份内容本来就一样）。这既是去重，也是防止「面板里的词」和「对话框里的词」再次分叉。

### 21.3 测试

- 契约：遍历 `EDGE_TYPES` 断言**每一种都有标签**（漏一个就会让右侧面板显示裸枚举名，而那正是用户点开面板想看的东西），并断言 `describeEdgeType('MENTIONS') === '提及（MENTIONS）'`、未知类型原样返回。
- 渲染：既有断言只数**节点**标签（边的文字从未计入 `labelsDrawn`），所以移除后仍然成立——这也顺带证明了这次改动没有偷偷改变节点的稀疏化规则。
- 浏览器：两个对话框现在读的是真实的关系文案模块（把 `edge-labels.ts` 加入 closure 并 graft 到模块桩上），因此 `扩展（EXTENDS）` 这类断言仍然是被真实代码满足的，而不是桩里手写的字符串。

## 22. 画布视觉重做（六项）

用户对真实图谱的评价：图能画出来，但「同色、长文本互挡、太挤、橙线抢眼」。逐项落地。

### 22.1 按实体类型上色

`GraphTheme` 新增 `entityTypeColors`，`nodeFill(kind, theme, entityType)` 按类型取色：文献保持深蓝 `#1f67e8`（锚点），Method 橙 `#e8833a`、Task 紫 `#8b5cf6`、Dataset 绿 `#3aa76d`、Metric 黄 `#c99400`、Concept 灰 `#8595ab`、Claim 砖红 `#c2553f`。左侧图例同步成七项（文献 + 六类实体 + 三种线型），CSS 里的色值与主题文件保持一致——图例和画布不一致比没有图例更糟。

契约测试遍历 `ENTITY_TYPES` 断言**每种类型都有自己的颜色且互不相同**，并断言文献色 ≠ Method 色。

### 22.2 标签截断到 12 字符

`LABEL_MAX_CHARS` 18 → 12：实测相邻长名仍然互相压住，而有意义的通常就是前两个词。完整名称**悬停时**以不截断形式画在该节点下方（否则这一改就是信息丢失而不是信息分层），点击后的检查面板里也一直有。

### 22.3 标签底板

每条标签先画一块半透明圆角底板（`theme.labelPlate`，rgba 0.88）再写字。之前标签跨过连线时有一半读不出来——把力导向撑开只会让标签更落在网中央，底板才是根治。

### 22.4 力导向撑开

`DEFAULT_LAYOUT_OPTIONS`：`linkDistance` 96 → **150**，`repulsion` 5200 → **14000**，重力不变（0.022），所以是「撑开」而不是「散架」。

### 22.5 降低边的视觉权重

非选中边的透明度乘 `EDGE_QUIET_ALPHA = 0.45`，颜色同时调灰（AI `#93a6c6`、规则 `#c2cddd`、用户 `#7fb89f`）。被选中/相邻的边仍以全强度与橙色高亮——那正是需要看清的时候。

### 22.6 置信度下限默认 0.6，并且真的过滤节点

两件事：

1. `graphMinConfidence` 默认 0 → **0.6**。
2. **这个滑块以前只过滤边，不过滤节点**——它标着「置信度下限」，拖动却几乎不改变画面。现在 `filterVisibleNodes` 也按 `minConfidence` 过滤实体（文献不受影响：文档不是估计值；没有置信度字段的旧记录按通过处理）。

### 22.7 长描述性名称降级

`entity-name-quality.ts` 新增一条：**词数 ≥ 6** 的名字降级（`DESCRIPTIVE_NAME_WORD_LIMIT`）。之前 `two-step process for combinational logic optimization` 被当作合法名字保留；真实画布上它正是最长的那些标签之一，所以按用户要求改成降级。五个词的 `Bidirectional Encoder Representations from Transformers`、`Graph Convolutional Network with Attention` 仍然保留——契约测试把这条边界钉住。

### 22.8 关于 `frequency index` 与 `Frequency-first heuristic`

这两个是**语义**判断，本地字符串规则做不了：token 交集只有 `{frequency}`（Jaccard 0.25），字符相似度更低，任何放宽到能合并它们的阈值都会顺手把 `JPEG-LS`/`JPEG 2000` 也合掉。能处理的路径是已有的两条：确认对话框里的「检查同义写法」（模型判断，一次请求），或「合并同义实体」里手动合并。这一点在文档里写明，而不是假装规则能覆盖。

## 23. 四项必修：不画"无关系"、可重新判断、共享实体直连、召回失败的提示

### 23.1 `NO_RELATION` 永不绘制

`NO_RELATION` 是**缓存条目**：它存在的唯一理由是不为同一对论文重复付费。它不是关系，把它画出来会让图谱**断言它刚刚否认过的事情**——去掉边上的文字之后更糟，一条否定看起来和一条真实结论完全一样。

`domain/graph-query.ts` 新增 `isRenderableEdge(edge)`，`edgePassesFilter` 的第一句就是它，所以 `buildSubgraph` 在**所有**路径（聚焦散步与全图）都不再收进否定记录；它们也不再经由 `connectedIds` 计入「已连接」。同时给 `describeGraphView` 加了 `unrelatedPairCount`：全部配对都判成「无关系」时画布当然是空的，但原因不是「还没分析过」，现在文案分开（否则会引导用户再花一次 Token 去重新推导一个已有结论）。

**否定结论并没有因此消失**：文献检查面板新增「已判断无关系的文献（N）」一节，逐行给出对方文献与「重新判断」按钮——否则第 2 项对最可能被误判的那一类结论反而没有入口（它不画在图上，就没有边可点）。

### 23.2 边上「重新判断」

落库的结论**同时就是缓存**，所以此前一条错误结论是永久的：`collectJudgedPairKeys` 会让这一对永远不再被问。现在：

- `RecallOptions.forcePairs`：配对的缓存跳过与 `minScore` 门槛都对被点名的配对**让路**，并附加召回理由「你要求重新判断」（模型也会看到，知道这是一次复核）；
- 被强制的配对在排序时**排在最前**，因此 `maxCandidates`/Top-K 的截断永远切不掉一个直接请求；
- `previewRelationAnalysis` 在 `forcePairs` 存在时把 `selected` **收窄到这些配对**——用户点的是这一对，不是又一批候选；
- 写库走的仍是 `planRelationJudgementWrites`：先退役该对旧结论再写新结论，所以这是**替换**而不是并存；
- `graph-entity-actions.ts` 拆出 `runRelationPass()`，`analyzePaperRelations()` 与新的 `rejudgePaperRelation(left, right)` 共用它（后者把召回范围收窄到这两篇、并带上 `forcePairs`）；边检查面板与文献检查面板的按钮都接到它上面。

### 23.3 共享实体直连（派生边 `SHARED_ENTITIES`）

两篇论文共享一个已确认实体时它们在图上是**两跳**——这正是实体层的意义，但在一张十几个节点的画布上，两跳是不可见的：眼睛看到的是一个枢纽加几条辐条，而不是"这两篇在讲同一件事"。

`domain/shared-entity-bridges.ts` 的 `buildSharedEntityBridges()` 在**每次重绘时**从当前实体重新算出一条直连线，三条规则保证它不越权：

1. **派生，绝不落库**：`DERIVED_EDGE_TYPES` 标着它，任何仓储都不会见到它，导出也不会带上它，因此它不会过期也不会泄漏；
2. **只认已确认实体**（`MIN_SHARED_ENTITIES_FOR_BRIDGE = 2`）：待确认候选是建议，用建议去画结构等于替用户确认；
3. **不覆盖已判定的配对**：那一对已有更好的答案（含否定的缓存记录）。

样式：`origin: 'rule'` 所以天然是**灰色虚线**（图例第 11 项「灰虚线 = 共享 2+ 实体」），画布上唯一的边文字就是它的 `SHARED_ENTITIES` 标签，且只在 `scale ≥ 1.1` 时画（10px 文字在 fit-to-view 下读不出来）。顺带修了 `drawEdgeCaption` 的**测量顺序**：`measureText` 用的是当前字体，而它原来在 `context.font = LABEL_FONT` **之前**调用，底板宽度取的是上一次绘制残留的字体。

### 23.4 召回失败时给出下一步

"没有召回任何值得判断的论文对（缺少共享实体、同文件夹或向量相似等线索）"是实话，但没有下一步：共享实体是最强的召回信号，而**只有已确认的实体参与召回**——一份塞满待确认候选的语料召回结果必然是空的，用户看到的却像"这些论文就是没关系"。

`runRelationAnalysis` 新增 `pendingEntityCount`，为空召回的原因追加「提示：图谱中有未确认的实体，确认它们可以提升关系召回率。」（`PENDING_ENTITY_HINT`，无待确认项时不追加——没东西可确认时给建议只会让人白跑一趟）。

### 23.5 测试

- 契约（`test-knowledge-graph.mjs`）：`NO_RELATION` 不可渲染；`buildSubgraph` 的三条路径（聚焦、仅否定、全图）都不含它且不把它当连接；直连边的端点为排序形式、`originKey` 与发现顺序无关、输入顺序反转结果相同、待确认实体不产生直连、已判定配对不产生直连、`minShared` 钳到 ≥1、`SHARED_ENTITIES` 属 `DERIVED_EDGE_TYPES` 且有中文标签。
- 契约（`test-relation-runner.mjs`）：被强制的配对确实被再次询问且只问这一对、召回理由是「你要求重新判断」、旧结论被退役（`dropOriginKeys` 含旧 `originKey`）、新结论类型正确、强制一对不会顺带放开其它已缓存配对；空召回在有/无待确认实体时的文案差别。
- 契约（`test-viewer-layout.mjs`）：`unrelatedPairCount > 0` 且无可画边时，提示说的是「无关系 / 重新判断」，而不是「还没有任何关系」。

### 23.6 验证

`pnpm check` → 全部通过（`typecheck`、43 项测试脚本、架构检查 340 个 TS 文件、元素 id 契约、`wxt build`、打包扩展 9 项浏览器烟雾测试、生产检查）。

## 24. 力导向改为「按论文归属」的差异化受力

用户的判断是对的：**图看着乱，是因为全局均等的力**。原来所有边共用一个 `linkDistance: 150`、所有节点对共用一个 `charge`，于是"只属于这篇论文的方法"和"跨四篇论文的共享方法"离论文一样远，"两篇论文"也不比"论文与它的指标"更远——画面上没有任何东西说明谁是主体、谁是细节、谁是桥梁。

### 24.1 分类依据：连了几篇**论文**，不是总度数

新增 `domain/paper-degree.ts` 的 `buildNodeRoleIndex(edges, paperIds)`：

- **私有**（`privateNodeIds`）：只被**一篇**论文连着的非文献节点；
- **共享/桥梁**（`bridgeNodeIds`）：被 **≥2 篇**（`SHARED_PAPER_DEGREE`）论文连着的非文献节点；
- 只统计 `文献 ↔ 非文献` 的边（两个方向都算），所以 Paper→Paper 的结论（含派生的 `SHARED_ENTITIES`）不会把一篇论文变成另一篇的卫星。

第一版我按**总度数**实现，很快就发现是错的：一个方法节点如果自己还挂着一个子实体，总度数是 2，但它仍然只属于一篇论文；而一个数据集只出现在两篇论文里、总度数就是 2，却已经是桥梁。**"是否共享"是图的属性，不是节点自己的属性**，所以只数论文归属。

### 24.2 每条边自己算弹簧（`springForLink`）

**布局本身也从 viewer 移到了 `domain/graph-force-layout.ts`**：它只依赖节点角色，不碰 DOM，和 `graph-render-model.ts`、`graph-culling.ts` 是同一类东西；更实际的原因是 viewer 下的文件 import 模块 barrel（无扩展名），Node 的契约测试**根本执行不到**，而这一轮的核心规则正需要被精确断言。

`computeLayout` 在迭代前一次性把每条边解析成 `{ distance, strength }`，迭代里只查表——度数不随迭代变化，这样做不是为了性能，是为了让规则**可读、可测**。优先级即设计：

| 顺序 | 条件 | 距离 | 理由 |
| --- | --- | --- | --- |
| 1 | 两端都是文献 | **260** | 文献是主体，是最该分开的东西。这条必须在共享规则之前，否则"两篇论文"会被画得和"论文与它的关键词"一样近 |
| 2 | 任一端是**共享节点** | **240 + 16×(论文数−2)** | 共享节点被从**所有**邻居那里拉开（不只是论文），于是它停在论文**之间**。论文越多需要越多空间，否则四篇论文的桥梁会被拖到其中一篇上 |
| 3 | 一端是文献、一端是**私有节点** | **62**，弹力 ×3 | 私有实体是论文的**卫星**，紧凑包围。弹力 ×3 是必需的：全局斥力会把它推回去，只改距离它仍然会飘到 80–150 |
| 4 | 私有节点与它自己的**子实体** | **77.5**（62×1.25） | 一个论文的簇要**从论文向外生长**，不能塌成一团 |
| 5 | 其它（无归属的自由节点） | 150（原值） | 两跳以内的普通关系 |

**"拉长它到所有相连节点的弹簧"这一条是按用户的原话实现的**：共享节点的子实体也会被一起拉出去（实测 254px），否则子实体会被拖进它本该撑开的空隙里。

### 24.3 文献之间的斥力 ×12

弹簧只管有边相连的节点，管不到**只共享一个实体**的两篇论文：它们之间没有弹簧，只有斥力和重力竞争。上一版实测 P2/P3 停在 79px，比通用距离还近——画面上就是贴着。

`paperRepulsionMultiplier: 12` 只乘在「文献—文献」这一对（其它配对不动，否则整张图会散开）。另外两条文献之间的 260 弹簧负责"有结论相连"的情况，两者一起构成"文献尽可能远离"。

### 24.4 连线透明度：连向共享节点的边再压 45%

"让文献的独立性突出"这件事，物理距离只解决一半——剩下的是**线本身的重量**。`buildRenderModel` 现在把 `bridgeNodeIds` 一并算出（**用画出来的边算**，所以第二篇论文被过滤掉时，那个实体在当前视图里就不再是桥梁），渲染器对任何一端是共享节点的边再乘 `BRIDGE_EDGE_ALPHA = 0.55`（即 0.45 × 0.55 ≈ 0.25），被选中/相邻时仍是全强度。

### 24.5 实测（45 节点：6 篇文献，每篇 3–4 个私有实体 + 2 个子实体，一个 2 篇桥梁、一个 4 篇桥梁）

| 画布 | 私有↔论文（中位） | 私有↔子实体 | 文献↔文献 | 桥梁↔它连接的两篇 | 桥梁偏离中点 | 4 篇桥梁 | 4 篇桥梁的子实体 | 被夹边界 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 900×620 | 77 | 93 | 最小 201 / 中位 329 | 250 / 258 | 69 | 318 | 254 | 2（两个最挤的私有卫星） |
| 1440×900 | 76 | 92 | 最小 226 / 中位 421 | 263 / 277 | 142 | 245 | 290 | 0 |

三档（私有 76 ≪ 通用 150 ≪ 桥梁 250 ≪ 文献 300+）清晰可分，桥梁确实落在两篇论文中间（偏离中点 69–142，远小于它到任一篇的距离），且常规画布上**没有节点被边界夹住**。

### 24.6 测试

`test-knowledge-graph.mjs`：

- **角色索引**：一个论文 = 私有，两篇 = 桥梁，子实体不属于任何论文，Paper→Paper 不产生私有/桥梁；
- **弹簧**（直接断言 `springForLink`，精确值，不受模拟噪声影响）：私有 62 且弹力 >1、方向对称；文献↔文献 260；桥梁→论文与桥梁→自己的子实体都是 240；4 篇桥梁 272；私有链 77.5；自由节点 150；
- **模拟**（`computeLayout`）：私有实体与子实体都停在通用距离之内，文献间距大于通用距离，共享节点到论文的距离是私有卫星的 2 倍以上，只共享桥梁的论文不会被拉到一起；
- **降级**：不传 `kind` 时仍能收敛（老调用点与既有的确定性断言都不传）；
- **渲染模型**：`bridgeNodeIds` 含两篇论文的实体、不含单篇的实体、不含文献本身。

### 24.7 验证

`pnpm check` → 全部通过（`typecheck`、43 项测试脚本、架构检查 341 个 TS 文件、元素 id 契约、`wxt build`、打包扩展 9 项浏览器烟雾测试、生产检查）。

## 25. 节点含义解释：只在用户把节点放进图谱时生成

节点标签是一个**名字**——`Boyar-Peralta`、`ΔE >> 5%`、`GPT-3`——名字本身不说明它在这个语料里是什么。右侧面板正是用户问"这是什么东西"的地方，所以答案放在那里，**存在实体记录上**而不是每次现算：模型给的句子必须能跨刷新存活，也必须每次读到的都一样。

### 25.1 三条约束

1. **只在用户选中入图时生成**。确认是把建议变成图谱一部分的那一刻，也是逐实体的主动动作。**批量抽取完全不生成**：它提出的是用户可能永远不接受的名字，为它们付费解释等于为没人要读的文字付费。
2. **结合原文**。输入包含论文摘要（知识库概览首段兜底，见 §10.15）与实体**已经存着的证据引用**（抽取时逐字摘录的那句话），提示词明确写"依据原文，判断不出就写朴素些，不要编造"。
3. **失败是静默的**。解释只是阅读辅助，不是正确性要求：没有 API Key、超时、provider 报错都必须让已确认的实体保持原样。`explainEntityDescriptions` 因此**永不抛错**，错误作为返回值交给调用方决定说多大声。

### 25.2 实现

- 契约：`GraphEntity` 新增可选 `description` 与 `descriptionUpdatedAt`（旧记录没有；生成失败也不会写入）。
- 提示词与解析：`application/entity-explanations.ts` 的 `buildEntityExplanationPrompt()`（一句中文、≤40 字、不许编造、保留英文术语）、`buildExplanationUserMessage()`（名字/类型/别名/论文/摘要/原文片段，**缺失的块直接省略**——空的「摘要：」会邀请模型编一个）、`parseEntityExplanations()`（容错三种形状：裸数组、`{explanations:[…]}`、单个裸对象；按归一化名字匹配；读不懂就当作没有）。
- 代码侧硬截断 `MAX_EXPLANATION_CHARACTERS = 60`，每次调用最多 `EXPLANATIONS_PER_CALL = 12` 个实体——上限写在代码里而不是提示词里，理由同 §10.15：写进提示词的数字会被当成指标去凑。
- 第 10 类 AI 请求 `pdf-helper:ai-explain-entities`（`ai/contracts.ts` + `isAiRuntimeRequest` 白名单 + `background/ai/entity-explanation-service.ts` + `request-handler.ts` 分支）。复用 `requestOverviewCompletion`，因此默认 `reasoning: 'disabled'`，思考型模型不会把预算全花在思考上。
- 接线：`createEntityExplanationPorts()`（60 s 超时：短请求短答案，等不到就不值得等）→ `explainConfirmedEntities()` / `regenerateEntityExplanation()`。审查对话框新增注入式 `explain(names)` 钩子，**确认写库之后调用且不 await**：对话框立刻关闭，解释稍后到达，落地时页面自己 `reload()`。
- 已有解释的实体不会重复付费（`planExplanationTargets` 跳过），`force` 只给「重新生成」用。
- 右侧面板：有解释时显示在「含义」一节并给出「重新生成解释」；没有时给出「生成解释」——否则确认时那次调用失败的用户没有任何补救入口，而这正是最需要重试的情况。这也是为什么面板里要有这个按钮：批量抽取阶段本来就**不应该**有含义，那些实体第一次入图时才会生成。
- 图谱导出/导入保留 `description`（`parseEntity` 逐字段重建，不显式带上就会被静默清空）。

### 25.3 测试

- 契约（`scripts/test-entity-explanations.mjs`，新增 1 项检查）：提示词必须锚定"这篇论文/原文"且**没有数字配额**；user message 只给有摘要的实体带摘要块；`planExplanationTargets` 只挑已确认且尚无解释的实体、引文去重并只取来源论文的、名字按归一化匹配、`force` 只豁免"已有解释"这一条而不豁免状态、单次有上限；解析容错带围栏/带前后文/裸数组/单个对象、名字大小写不敏感、符号原样保留、没问过的实体被丢弃、读不懂返回空、超长截断；`attachEntityDescriptions` 只写真正变化的记录；runner 一次请求一次写入、部分回答时报 `missed`、provider 失败不写库、transport 抛错也不冒泡、无事可做时**一个请求都不发**。
- 浏览器（`test-knowledge-graph-dialogs.mjs` 23 项）：打开对话框不触发生成；确认后回调收到的名字**恰好等于**确认载荷里的名字（不多不少）；`Esc` 关掉对话框则什么都不生成。

### 25.4 验证

`pnpm check` → 全部通过（`typecheck`、44 项测试脚本、架构检查 344 个 TS 文件、元素 id 契约、`wxt build`、打包扩展 9 项浏览器烟雾测试、生产检查）。

### 25.5 一次真实故障：「后台没有返回实体的解释结果」

第一次实测就撞到：页面在图上选中实体、点「生成解释」，弹窗说后台没有返回结果。

**原因不是这段代码，而是扩展的加载方式**：`runtime.sendMessage` 解析出 `undefined`，意味着**后台根本没有应答**。`isAiRuntimeRequest` 白名单与 `handleAiRequest` 的 if 链是两道独立的闸门，任何一道没更新，监听器就静默返回 `undefined`。而本次新加的正是一个消息类型——**刷新页面会从磁盘重新加载 viewer 的脚本，但 service worker 不会**，于是页面是新的（有「生成解释」按钮），后台还是旧的（不认识 `pdf-helper:ai-explain-entities`）。在 `edge://extensions` 重新加载扩展即可。

这一轮据此做了三处改进，而不是只让用户去刷新：

1. **不再猜**：`describeExplanationResult` 的错误文案区分"后台没响应"和"后台返回错误"，前者直接给出可执行的下一步（重新加载扩展后在节点面板点「生成解释」）。
2. **空应答重试一次**（`EXPLANATION_RETRY_DELAY_MS = 400`）：`undefined` 的另一半原因是 service worker 被挂起——这一次重试就能救回来。`ok: false` 绝不重试，那只会再失败一次并多花一次 Token。
3. **不再弹模态框**：解释是可选阅读辅助，确认或重试失败只写状态栏（`setStatus` 在 `isError` 为真时会 `showAppError`，所以这里显式不传），面板上的按钮就是重试入口。用户已经完成的确认流程不该被一个可选步骤的失败打断。

顺手补了一条防止同类问题再发生的测试：`test-connection-testing.mjs` 新增「**每个知识图谱 AI 请求类型都通过白名单并且都会被应答**」——同时断言 `isAiRuntimeRequest(message) === true` 与 `handleAiRequest(message)` 返回 `{ok:…}` 而不是 `undefined`，覆盖抽取、关系判断、实体解释三类。任何一边漏改，测试直接失败，而不是等用户点出一个空白错误。

### 25.6 面板里的「生成解释」改为流式

第二次实测暴露的是另一个问题：点击「生成解释」**毫无反应**。原因有两层：

1. 一次性请求期间界面**没有任何反馈**——按钮可点、面板不变，用户无法判断是在跑还是没跑；
2. 失败信息写进了**全局状态栏**，而用户在看右侧面板。

改成流式（用户的要求，也是这里唯一正确的做法）：

- 新端口 `AI_EXPLANATION_STREAM_PORT_NAME = 'pdf-helper:ai-explain-stream-v1'`，与聊天流分开：聊天流带着会话、Agent 工具与工具轮次，而一句话释义不该为此付 prompt 和 tool schema 的钱。协议与聊天流同形（`started` / `delta` / `done` / `error`），少掉工具部分。
- `background/ai/explanation-stream.ts` 注册端口（`bootstrap.ts` 调用），复用 `withAiRequestLifetime` 保活；`streamEntityExplanation()` 走 `adapter.stream`，并强制 `reasoning: 'disabled'`——思考型模型会把预算全花在思考上、一个 token 都流不出来，那在实时面板里看起来和坏掉一模一样。
- **单实体提示词与批量不同**：`buildStreamingExplanationPrompt()` 只要那一句话（不要 JSON、不要引号、不要前缀），因为没人能盯着 `{"explanations":[…]}` 看。`normalizeStreamingExplanation()` 仍要吞下模型的老习惯：围栏、JSON、`解释：` 前缀、多行——取第一行有意义的内容再截断。
- 界面（`graph-explanation-actions.ts`）：点击后**在第一个 await 之前**就把按钮渲染成禁用的「生成中…」，之后每个 chunk 用 `updateExplanationPreview()` 直接改那一个段落的文本（不重渲染整块面板：一秒几十次重建所有按钮不值得）。完成后写入实体并 `reload()`；失败则把原因**留在按钮旁边**（`生成失败：…`），状态栏另有一份。
- 因为这段状态机（一个在飞的流、必须禁用的按钮、必须留在原地的失败）与抽取/合并是不同的职责，而 `graph-entity-actions.ts` 已到 700 行上限，于是拆出 `graph-explanation-actions.ts`（自带 `configureExplanationActions` 上下文，与 `configureGraphActions` 同形）。

**工具层面的教训**：这一轮我用 PowerShell 的 `Get-Content`/`Set-Content` 删行，把该文件里的中文按 GBK 误解码，38 处字符变成 `�`，并且**吃掉了紧邻的引号和模板字符串里的 `$`**。反向 GBK 往返救回了大部分，但被吃掉的字节不可逆，最终只能整份重写。中文源码只能用 `edit`/`write` 工具改。

### 25.7 第三次实测：端口在打包产物里是好的，是浏览器里的后台旧

界面报出「生成失败：后台没有响应（扩展可能刚更新或被挂起）」。这次我没有再让用户去刷新一次就算完，而是**先用打包产物把事实钉住**：

`test-built-extension.mjs` 新增一项「**打包的 service worker 会应答解释流端口**」——在真实加载的打包扩展里 `chrome.runtime.connect({name:'pdf-helper:ai-explain-stream-v1'})`，发一条 `start`，断言收到 `started`（它在 provider 调用**之前**发出，所以不需要 API Key 就能验证）。**这一项通过**，说明代码与构建都没问题：出问题的是浏览器里正在跑的那份后台。

同时把这一种失败**做成可恢复的**，而不只是更好看的文案：

1. 客户端能拿到浏览器自己的断开原因（`runtime.lastError.message`，典型是 "Could not establish connection. Receiving end does not exist."），并把它带进错误里——这就是"后台没有这个端口"的铁证，不用再靠猜。
2. 断开且**一个 chunk 都没收到**时，错误名标成 `ExplanationPortUnavailable`；收到过半句则是 `ExplanationStreamInterrupted`（两种情况的处理不同）。
3. `ExplanationPortUnavailable` 时**自动退回普通消息通道**再试一次（`explainEntityDescriptions`）。消息通道是老路径，一个"比页面旧"的后台往往仍然认识它——于是功能降级为"不流式"，而不是"点了没用"。状态栏会说明「后台没有流式端口，改用普通请求生成解释…」，成功则写「解释已更新（后台没有流式端口，本次没有逐字显示）」。
4. 两条路都失败时，原因留在按钮旁边，且现在会包含浏览器给出的真实原因。

**给用户的一句话**：刷新页面只会重新加载 viewer 的脚本，**service worker 不会**；改过后台代码必须去 `edge://extensions` 点「重新加载」（或重新加载扩展列表里的这一项），否则页面是新的、后台是旧的。

**已确认**：用户在扩展管理页重载插件后，流式生成立即正常。这条结论固定下来——本轮之后凡是改了 `src/background/`（新增消息类型、新增端口、改 AI 服务）的改动，验收的第一步都是**重载扩展**，而不是刷新页面。





