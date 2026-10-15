# PDFPal 架构文档（v2 · 整改后）

> 本文档是架构整改完成后的**新版本**，描述 PDFPal（版本 1.0.6）当前的**实际架构**。
> v1 的 16 条混乱点已按路线图 P0→P3 逐项处理；第 10 章是整改记录，第 11 章列出**仍然存在的技术债**（有意保留、逐项说明原因）。
> 与 `README.md` 的关系：README 是"产品功能 + 快速上手"，本文档是"代码地图 + 架构规则 + 遗留清单"。

---

## 1. 系统总览

### 1.1 一句话定位

PDFPal 是一个基于 WXT + TypeScript + PDF.js 的浏览器扩展（Edge/Chrome MV3），在浏览器内提供：PDF 阅读与批注、AI 论文分析（对话/翻译/总结/论文卡片/识图）、长期记忆、个人知识库与语义检索。所有用户数据（PDF、批注、知识、对话、API Key）都存在浏览器本地。

### 1.2 运行时拓扑

```text
┌─────────────────────────── 浏览器扩展进程 ───────────────────────────┐
│  Background（entrypoints/background.ts）                              │
│    右键菜单（选区 → Selection Page）                                   │
│    AI 请求路由 + 流式端口 pdf-helper:ai-stream-v1                     │
│      ▲  runtime.sendMessage / Port                                   │
│  Viewer（entrypoints/viewer/，主阅读器标签页） ◄── 扩展图标点击        │
│    PDF.js 阅读器 / AI 助手 / 知识库 / 批注 / 翻译 / 单词库 / 论文卡片   │
│      ▲  viewer-launcher（sidepanel 负责唤醒已有 Viewer 标签页）        │
│  Sidepanel（首次安装引导入口）                                        │
│  Selection Page（entrypoints/selection-page/，选区处理页）             │
│  Tutorial（entrypoints/tutorial/，独立窗口，Provider 配置教程）        │
└──────────────────────────────────────────────────────────────────────┘
```

Popup 不存在：扩展图标的 `action` 直接打开 Viewer 标签页，Sidepanel 承担"首次运行引导 + 唤醒已有 Viewer"的角色。

### 1.3 分层与依赖规则

```text
entrypoints/              只启动运行时，不含业务逻辑
   │
   ├── src/background/        后台消息处理、右键菜单、AI 网络请求（组合根）
   ├── src/selection-page/    选区处理页
   ├── src/tutorial/          Provider 配置教程页
   ├── src/viewer-launcher/   Sidepanel 唤醒 Viewer
   │
   └── src/viewer/
         core/pdf-reader/     PDF.js 原语层：解析/挂载/查找/控件状态
         app/                 装配层：模板注入、elements、registrations、
                              orchestrators（document-open/save）、状态、hooks
         features/            按用户功能组织的界面与交互（单向依赖）
         services/            Viewer ↔ 业务模块的桥接（纯桥接）
         shared-ui/           跨功能共享 UI（不反向依赖 app 状态）
         templates/           HTML 模板（?raw 注入）
   │
   ├── src/modules/           纯业务模块（ai / document-agent / knowledge /
   │                          memory / reading-mode / selection）
   └── src/infrastructure/    浏览器 API、IndexedDB、Storage、PDF 文本抽取
```

**强制规则**（`pnpm check` 的 `check:architecture` + `check:element-ids` 执行）：

| 规则 | 状态 |
|---|---|
| 跨 feature 导入必须经过对方 `public.ts` | ✅ 强制 |
| 跨 module 导入必须经过对方 `public.ts`（background 组合根豁免） | ✅ 强制 |
| `src/**` 不得 import `entrypoints/**`（入口只允许被入口代码引用） | ✅ 强制 |
| `core/pdf-reader` 不得依赖 features / services / shared-ui（PDF 原语层） | ✅ 强制 |
| `core/pdf-reader` 只能依赖 app 的 viewer-state / viewer-elements / viewer-types | ✅ 强制 |
| 标记 `@deprecated` 的文件不得被业务代码 import | ✅ 强制 |
| **跨组循环依赖**（feature/app/core/services/shared-ui/module 之间）禁止 | ✅ 强制（同 feature 内部文件环允许） |
| 模板 DOM id 契约：代码引用的 id 必须存在于模板（`check:element-ids`） | ✅ 强制（未引用的模板 id 仅告警） |
| 入口文件 ≤ 25 行；单文件 ≤ 700 行；文件名禁 v2/final/legacy | ✅ 强制 |
| 非持久化文件名禁止直接访问 localStorage/IndexedDB | ⚠️ 告警（现有 1 条，见 §11-⑧） |

---

## 2. 构建与工程配置

- **WXT 配置**（`wxt.config.ts`）：目标 Edge/Chrome；Vite 关闭 `modulePreload`（扩展隔离世界限制）；生产构建 `dropConsole`+`dropDebugger`+`mangle`（防止 PDF 文本/prompt/API 信息残留在产物）；权限 `tabs`/`storage`/`contextMenus`；CSP `script-src 'self' 'wasm-unsafe-eval'`（onnxruntime/transformers WASM）。
- **关键依赖**：`pdfjs-dist@5.7.284`（带 1 个 pnpm patch：文本层字体度量两处修复）、`pdf-lib`（批注导出）、`@langchain/*`、`@modelcontextprotocol/client+server`（进程内 MCP）、`@huggingface/transformers`+`onnxruntime-web`（本地 embedding）、`marked`+`dompurify`+`katex`、`zod`、`wxt@0.20`、`@playwright/test`。

---

## 3. 运行时层

### 3.1 Viewer —— 详见 §5

`entrypoints/viewer/main.ts`（9 行）：同步 `mountViewerShell()` 注入模板 DOM，再动态 `import` `app/bootstrap` 执行 `bootstrapViewer()`。装配顺序是隐式约定（elements 的 `requiredElement` 依赖 DOM 先注入），见 §11-①。

### 3.2 Background（`src/background/`）

入口 3 行；逻辑在 `bootstrap.ts`（注册）与 `ai/*`（处理）。

- **注册**：`contextMenus` 三个动作（explain/translate/card，选区存 `pdfHelperSelection` 后开 Selection Page）；`action.onClicked` 首启开 Sidepanel 否则开 Viewer；`runtime.onMessage` 一次性 AI 请求；`runtime.onConnect` 流式 Port（`pdf-helper:ai-stream-v1`，Agent 工具往返最多 8 轮）。
- **AI 分派**（`request-handler.ts`，7 类）：`ai-chat` / `ai-test`（验证码图 `PDF7392` 验证视觉能力）/ `ai-detect-reading-mode` / `ai-generate-document-overview`（进度经 Port `pdf-helper:ai-document-overview-progress`，draft 由 `overview-completion.ts` 落盘）/ `ai-compress-conversation` / `ai-vision` / `ai-vision-test`。
- **Provider 契约已统一**：`provider-runtime.ts` 注册并复用 `modules/ai` 的 `AiProviderAdapter`/`ProviderMessage`/`AiProviderRequestError`；`vision-service.ts`、`conversation-builder.ts`、`streaming-service.ts`、`overview-completion.ts` 全部从 `modules/ai/public` 导入——background 侧的重复契约副本已删除。视觉请求仍为裸 fetch + OpenAI 兼容格式（产品决策：视觉走独立配置通道，见 §11-⑦）。
- 429 限流由 `modules/ai/providers/provider-rate-limit.ts` 统一处理（按 baseUrl+apiKey 分片，收到 429 才退避）。

### 3.3 Sidepanel / Selection Page / Tutorial

- Sidepanel（6 行）→ `viewer-launcher` 唤醒已有 Viewer + 首启标记 `pdfpal-sidepanel-first-run-seen-v1`。
- Selection Page：右键菜单选区处理（explain/translate/card 三动作）。PDF 文字抽取已改为复用 `infrastructure/browser/pdf-text-extraction.ts`（与 Viewer 同一实现，§5.6）。
- Tutorial：`provider-guides.ts` 的 DeepSeek/百炼配置教程，`shared-ui/navigation/tutorial-navigation.ts` 以独立窗口打开。

---

## 4. 业务模块层（`src/modules/`）

6 个模块。理想是"纯业务、不依赖 DOM、对外只走 public.ts"；整改后浏览器依赖收敛到 adapters 与 public 单例（§11）。

| 模块 | 分层 | public 组合根 | 数据存储 |
|---|---|---|---|
| ai | domain/application/ports/adapters + providers + mcp | `aiConnectionCatalog` | `browser.storage.local` `pdf-helper-ai-connection-table-v1`（+3 个遗留键） |
| document-agent | 无 ports（函数式 adapter） | 无 | IndexedDB `pdf-helper-document-agent`（documents/chunks/sessions/visionCache） |
| knowledge | domain/ports/application/adapters 完整 | `knowledgeLibrary`、`semanticKnowledgeRetriever`（**现已导出**）、`knowledgeRetrievalService` | localStorage + IndexedDB `pdfpal-knowledge-vectors` |
| memory | 扁平（接口在 contracts，实现单文件） | `memoryTools`、`paperLibraryTools`、`executeMemoryTool` | IndexedDB `longTermMemories`/`paperLibrary` |
| reading-mode / selection | 纯契约 | 无 | 常量 |

- **ai**：契约集中在 `contracts.ts`（7 类请求 + 流式协议 + `normalizeAiBaseUrl`）；`DeepSeekProviderAdapter` 唯一实现（SSE 解析、tool_calls 按 index 合并、reasoning 参数按 provider 家族拼接）；MCP 工具目录 `agent-tool-catalog.ts`（15 工具唯一来源）+ `agent-tool-server.ts`。
- **document-agent**：`document-chunker.ts`（paper/general/novel 三种策略）、`document-search.ts`（FNV 文档 ID + 拉丁词/中文 bigram 检索）、`initialize-document-knowledge.ts`（索引/建档主流程）、`section-resolver.ts`、`document-tool-executor.ts`（6 工具，novel 受当前页截断）。
- **knowledge**：关键词 + 语义双通道（`KnowledgeRetrievalService`，RRF 融合，语义失败降级）；`semanticKnowledgeRetriever` 组合根已导出并被知识索引 worker 复用（不再重复装配）；语料元数据在 `browser-document-corpus.ts`（无端口，§11-⑧）。
- **memory**：`memory-tools.ts` 单文件三合一（adapter + 工具分发）；8 种 `MemoryToolCall`；检索含 recency 衰减。

---

## 5. Viewer 应用层（`src/viewer/`）

### 5.1 启动与装配

```text
entrypoints/viewer/main.ts
  ├─ mountViewerShell()                    同步：?raw 注入 10 个模板
  └─ import('app/bootstrap') → bootstrapViewer()
       ├─ interactionBoundary.install()     键盘/剪贴板/拖拽边界
       ├─ registerPdfRuntime()               PDF.js worker + eventBus 订阅
       ├─ registerAssistantEvents()          助手面板/设置/聊天/引用跳转
       ├─ registerKnowledgeEvents()          知识库事件 + 渲染/刷新 hook 注入
       ├─ registerKnowledgeRecentEvents()    最近保存卡片
       ├─ registerReaderEvents()             阅读器（5 个子注册器，见下）
       ├─ registerTranslationEvents()        翻译/学习/总结/卡片按钮 + core hook 注入
       ├─ registerVocabularyEvents()         单词库
       ├─ registerLifecycle()                URL 恢复/打开文档/全局选区监听
       ├─ initializeResponsiveWorkspace()    断点折叠
       └─ initializeOnboardingTour()         引导
```

- **elements/**：9 个文件按 DOM 区域提供 `requiredElement<T>("id")` 惰性句柄，`viewer-elements.ts` 汇总。
- **registrations/**：`register-reader-events.ts` 拆为 5 个域文件（tab 8 / file-open 128 / navigation 68 / annotation 343 / keyboard 132 行；事件绑定总数与拆分前一致）。`register-assistant-events.ts`（594 行，未超限，拆分列入 §11-②）。
- **hooks（依赖反转）**：装配层向低层模块注入行为，避免低层依赖高层：
  - `app/assistant-state` ← `setAssistantChoreography`（取消翻译/总结/卡片、activateTab、设置面板刷新）
  - `app/application-navigation` ← `setKnowledgeRenderHandler`；`app/knowledge-refresh` ← `setKnowledgeRefreshHandler`（总是先 re-sync 模块再按需刷新页面）
  - `core/reader-controls` ← `setSelectionSurroundingTextProvider` / `setSummaryMetadataRefreshHandler`
  - `recent-files` ← `setRecentEntryOpenHandler`（打开最近文件的编排在装配层）

### 5.2 状态分层（整改后）

| 文件 | 职责 |
|---|---|
| `app/viewer-state.ts` | PDF.js 运行时单例 + 文档/批注/阅读位置状态 + `navigateToDestinationWithoutReturnHistory` |
| `app/viewer-types.ts` | 共享类型（FileHandleLike、ReadingPosition、InternalNavigationEntry） |
| `app/assistant-state.ts` | AI 配置、对话、阅读模式、助手视图、设置面板状态（`setAssistantView`/`setDeepSeekSettingsOpen` 经 choreography 注入） |
| `app/models/summary-models.ts` | 总结类型与状态 |
| `app/models/card-models.ts` | 论文卡片类型与状态 |
| `app/models/knowledge-models.ts` | 知识类型、筛选状态、选中项 |
| `app/models/learning-models.ts` | 翻译/英语学习/词汇/翻译历史 |
| `app/models/app-view-models.ts` | 视图持久化类型 |
| `app/feature-models.ts` | 上述 models/ 的**兼容桶**（新代码建议直接 import 域文件） |
| `app/app-view-persistence.ts` | 仅视图持久化（读/写/应用 sessionStorage 状态） |
| `app/status-bar.ts` | `setStatus`（所有 feature 共用） |
| `app/document-identity.ts` | `getPdfFingerprint` + `getDocumentChatId`（跨 feature 单一定义） |
| `app/knowledge-excerpt.ts` | 摘录/标签格式化（纯函数） |
| `app/app-view-restore.ts` | 刷新后恢复工作区视图（编排，可调用 features） |
| `app/state-cell.ts` | **`createStateCell<T>` 最小可订阅状态单元** |

**状态单元（P3-12）**：`createStateCell<T>(initial)` 返回 `{ value, subscribe }`。`value` 用 defineProperty getter/setter 实现——读写语法与旧 `{ value }` 容器完全兼容（因此全部 models/ 状态迁移后 200+ 调用点零改动），`subscribe` 提供写后回调。语义为"每次赋值都通知"；当前无订阅者（能力先行，§11-⑨）。

### 5.3 PDF 核心（`core/pdf-reader/`）——原语层

- `pdf-controller.ts`：**纯原语**——`parsePdfIntoViewer`（解析 + viewer-state 装配 + 批注状态复位）、`attachPdfToViewer`（setDocument 三件套）、`getDisplayFileName`、`runSearch`、`openFindBar/closeFindBar`。**不再 import 任何 feature/service/shared-ui**。
- `reader-controls.ts`：控件状态/目录渲染/选区文本工具 + `SelectionSurroundingText` 类型 + 两个 provider hook。选区环绕文本与总结元数据刷新通过 hook 由装配层注入。
- `reader-ui.ts`：仅 `export * from './reader-controls'`。**不再 re-export app 状态**；`app/public` 是应用状态的唯一门面。

### 5.4 编排器（app/）

- `app/document-open.ts`：`openPdf`/`openRemotePdf` 完整编排（确认丢弃未保存 → 前置重置 → core 解析 → 批注恢复 → 最近文件记账 → `library.recordOpen` → core 挂载 → 后置重置 → 目录渲染 → 错误路径）。所有调用方（registrations、recent-files handler）指向这里。
- `app/document-save.ts`：`saveAnnotatedPdf`（嵌入批注 + 写回/降级下载）。
- `app/document-switch-hooks.ts`：文档切换的 feature 状态重置（before/after 两个函数）。

### 5.5 服务（`services/`）——纯桥接

`services/document-agent/viewer-document-agent.ts` 只做 document-agent ↔ Viewer 桥接：`ensureDocumentKnowledge`、`inspectPdfPageWithVision`、`executeViewerDocumentTool`、`getDocumentAgentOutline`。总结逻辑已全部迁出（§5.6）。`historical-document-source-mapper.ts` 不变。

### 5.6 功能层（`src/viewer/features/`）

9 个 feature。**整改后依赖图为 DAG**（跨组循环为 0）：

| feature | 职责 | 依赖（单向） |
|---|---|---|
| annotations | 批注创建/编辑/保存/导出 | text-selection、app/status-bar、app/document-identity |
| assistant | AI 对话、设置、MCP 运行时 | ai/memory/knowledge/document-agent 模块、recent-files、translation（validatePdfCitations）、paper-card（journal）、knowledge-base（页面导航） |
| knowledge-base | 知识库双视图、编辑器、导入、遗留迁移桥 | knowledge 模块、paper-card（journal/card 格式化）、translation（章节/引用）、app hooks |
| onboarding-tour | 新手引导 | 仅 app/viewer-state |
| paper-card | 阅读卡片、论文概览、**阅读日志（存储归属）** | translation（章节上下文）、recent-files、app/document-identity、app/knowledge-excerpt、app/knowledge-refresh |
| recent-files | 最近文件、阅读位置、状态栏（re-export） | annotations（confirmDiscardUnsavedChanges）、app/document-open（经注入 handler） |
| text-selection | 选区几何 | 无 |
| translation | 翻译、英语学习、**总结生成（summary-generation.ts）**、引文定位 | recent-files、shared-ui（markdown/引用文本）、app/state；经 `setCardSourceRefreshHandler` 注入 paper-card 行为 |
| vocabulary-library | 生词本 | assistant（setCurrentApplicationView）、recent-files |

**整改后的关键变化**：
- 跨 feature 的 42 处导入全部走 public.ts（保持不变）；互依赖对全部单向化：
  - `annotations ↔ recent-files` 已断（setStatus → app/status-bar）
  - `assistant ↔ translation`、`assistant ↔ knowledge-base`、`knowledge-base ↔ paper-card`、`knowledge-base ↔ translation`、`paper-card ↔ translation` 全部单向化（getDocumentChatId / setCurrentApplicationView / 知识摘录 / 阅读日志 / 准备 Markdown / 引用文本归位）
- 总结：`features/translation/summary-generation.ts`（buildSummaryContext / scheduleSummaryGeneration / setActiveSummaryScope / generateSummary / resetSummaryState / readSavedSummaryNotes）。
- 论文身份匹配收敛到 `assistant/paper-library-reader.ts` 的 `normalizeDocumentTitle`/`documentTitleMatches`（唯一匹配规则点）。
- PDF 页文本抽取统一到 `infrastructure/browser/pdf-text-extraction.ts`（citation-and-summary、paper-library-reader、selection-page 三处共用）。
- 死代码已删：library-view 的仪表盘/卡片网格渲染、knowledge-domain 的 metric/student 面板渲染与派生评分簇（共 20 个函数；library-view 532→172 行）。
- `knowledge-base/AGENTS.md` 对照：遗留存储读取仅剩"迁移桥"一处（collectKnowledgeItems），第 5 条（外部不得 import 内部 UI）保持遵守。

### 5.7 文档标签页（`app/document-tabs.ts` + `app/document-tabs-model.ts`）

像浏览器标签页一样同时打开多份 PDF：

- **模型层**（纯函数，可单测）：`DocumentTab`（id/名称/字节/documentProxy/指纹/阅读位置/未保存标记）、`findDocumentTabByFingerprint`（同文档去重）、`neighborTabAfterRemoval`（关闭后邻居选择）。
- **运行时编排**（`document-tabs.ts`）：
  - `openPdfInTab`：每次打开 = 新标签；同一指纹的文档已打开时改为**激活既有标签**。打开不同文档不影响当前标签的未保存批注（无需确认）；去重激活路径会确认未保存批注。
  - `activateDocumentTab`：快照当前标签（阅读位置/未保存标记/最新字节）→ 换装目标文档状态 → 恢复批注 → `attachPdfToViewer`（复用保活的 proxy，不重新解析）→ 恢复阅读位置（`pendingReadingPosition` + pagesinit 机制）→ 恢复该文档的对话。
  - `closeDocumentTab`：活动标签关闭前确认未保存批注；销毁 proxy、清理该文档的知识缓存、激活邻居标签；关闭最后一个标签回到空工作区（`detachPdfFromViewer`）。
- **核心原语配套**（`core/pdf-reader`）：`parsePdfIntoViewer` 不再销毁旧文档（代理保活）；新增 `installPdfDocument`（换装状态 + 批注运行时复位）、`destroyPdfDocument`（关标签时销毁）、`detachPdfFromViewer`（空工作区）。
- **UI**：`reader-workspace.html` 顶部的标签条（`#document-tabs`）+「＋」按钮（复用打开文件选择器）+ 每标签关闭按钮；样式在 `styles/document-tabs.css`。
- 标签为会话级（刷新后不恢复）；Ctrl+Tab 等快捷键、标签跨会话持久化列入 §11。

---

## 6. 数据与持久化

### 6.1 IndexedDB（三个库）

| 数据库 | 版本 | Store | 使用者 |
|---|---|---|---|
| `pdf-helper-document-agent` | 4 | documents/chunks/sessions/visionCache/longTermMemories/paperLibrary | document-agent + memory（集中管理于 infrastructure） |
| `pdfpal-knowledge-vectors` | — | 向量 | knowledge 模块私有 |
| `pdf-helper-recent-files` | — | recent-files | recent-files feature 私有 |

### 6.2 browser.storage.local / localStorage / sessionStorage

- `pdf-helper-ai-connection-table-v1`（现行连接表）+ `pdf-helper-ai-config-v1`/`pdf-helper-vision-ai-config-v1`/`pdf-helper-deepseek-config-v1`（遗留键，`migrateLegacy` 消费）；`pdfHelperSelection`；`pdfpal-sidepanel-first-run-seen-v1`。
- localStorage：`pdf-helper-knowledge-library`（模块现行存储）；`pdf-helper-knowledge-corpus-v1`（语料）；`KNOWLEDGE_NOTES_STORAGE_KEY`/`READING_JOURNAL_STORAGE_KEY`/`KNOWLEDGE_ITEM_META_STORAGE_KEY`（**遗留，迁移桥读取**）；`SAVED_CARDS_STORAGE_KEY`/`SAVED_PAPER_OVERVIEWS_STORAGE_KEY`（paper-card）；`vocabulary-library` 与 feature 偏好键。
- sessionStorage：`pdf-helper-app-view-state-v1`（视图状态）、`pdf-helper-translation-history-v1`。

### 6.3 知识库双轨现状（整改后）

读取路径：`collectKnowledgeItems()` = 遗留（笔记/日志/总结/卡片/概览）→ `knowledgeLibrary.synchronize(mode, …)`（按阅读模式**替换式**同步，删除可传播）→ `knowledgeLibrary.list()`。所有 UI 写路径写后都会触发 render（即 re-sync）；`setKnowledgeRefreshHandler` 现在**总是先 re-sync 模块**（知识页关闭时 agent 检索也读到新数据）。遗留存储的最终退役见 §11-④。

---

## 7. 关键机制专题

### 7.1 AI 请求流（Viewer → Background → Provider）

契约集中在 `modules/ai/contracts.ts`：7 类一次性请求 + 流式 Port 协议（Viewer 发 `start`（含 MCP `tools/list` 结果）/`tool-results`，Background 发 `started`/`delta`/`reasoning-delta`/`tool-calls`/`done`/`error`，工具往返最多 8 轮）。Base URL 强制 HTTPS（仅 localhost 可 HTTP）、禁内嵌凭据；视觉能力用验证码图防止纯文本模型冒充。

### 7.2 MCP 进程内调用链

Client/Server 都在 Viewer 进程内（`InMemoryTransport`），无端口/子进程：Provider function call → Viewer MCP Client → InMemoryTransport → MCP Server → `agent-tool-handlers.ts` → 业务模块。工具目录 15 个（document 6 / memory 4 / journal 2 / library 3），三套命名（点分/下划线/snake_case）与映射表仍在 viewer 层（§11-⑤）。

### 7.3 本地语义检索

`HuggingFaceEmbeddingProvider`（transformers.js + ONNX WASM）→ `IndexedDbKnowledgeVectorRepository` → `KnowledgeRetrievalService`（keyword/semantic/hybrid，RRF）。知识索引 worker 复用模块导出的 `semanticKnowledgeRetriever` 组合根。

### 7.4 论文全文索引（document-agent）

打开 PDF → `createDocumentAgentId`（fingerprint/FNV fallback）→ 可恢复则续用 → 逐页提取 → 按阅读模式分块（paper 9000/500、general 8000/450、novel 7000/600）→ 前缀 [Page N] + 目录标题 → 落库 →（有 key）逐块 AI 摘要并合成 `DocumentProfile`。检索打分：命中词×4、完整子串+24、summary 命中+5。

### 7.5 长期记忆（memory）

IndexedDB `longTermMemories`（5 类别 × 3 范围）+ `paperLibrary`；`library.recordOpen` 在每次 openPdf 调用；`memory.search` AND 匹配 + 过滤 + recency 衰减；对话过长按 `ConversationMemoryConfig` 压缩。

---

## 8. 质量保障

### 8.1 `pnpm check` 流水线

```text
typecheck（tsc strict + noUncheckedIndexedAccess）
  → 18 个契约/行为测试（node:test / 断言脚本 / Playwright 无头 Edge）
  → check:architecture（§1.3 边界规则 + 跨组循环检测）
  → check:element-ids（模板 DOM id 契约，整改新增）
  → build（wxt build -b edge）
  → check:production（版本一致、隐私页打包、产物无调试残留）
```

### 8.2 测试矩阵（整改后）

| 类别 | 脚本 | 内容 |
|---|---|---|
| 模块契约 | test-ai-contracts / test-agent-tools / test-semantic-retrieval / test-ink-eraser | Base URL 规范化、MCP 工具目录、语义检索、橡皮擦几何 |
| | **test-state-cell（新增）** | StateCell 订阅/退订/兼容语义 |
| | **test-document-tabs（新增）** | 标签列表纯模型：去重、关闭后邻居选择、标签名格式化 |
| UI 行为 | test-translation-actions / test-highlight-content / test-annotation-notes | 布局与内容隔离（白名单加载器，已适配新 app 模块） |
| 真实浏览器 | test-interaction / test-citation-navigation / test-highlight-selection / test-workspace-vocabulary / test-toolbar-targets / test-responsive-workspace / test-connection-testing / test-document-overview / test-provider-rate-limit | 无头 Edge + 真实 PDF.js：键盘/剪贴板隔离、引用定位、性能边界、连接测试 |

---

## 9. 架构检查的新规则（P0 落地）

`scripts/check-architecture.mjs` 新增 4 类规则：
1. `src/**` 不得 import `entrypoints/**`；
2. `core/pdf-reader` 不得依赖 app 装配层（白名单：viewer-state/viewer-elements/viewer-types）与 features/services/shared-ui；
3. `@deprecated` 文件不得被业务代码 import；
4. 跨组循环依赖检测（Tarjan SCC；同 feature 内部环豁免）。

`scripts/check-element-ids.mjs`（新增）：代码中 `requiredElement`/`getElementById` 引用的每个 id 必须存在于模板；未被引用的模板 id 告警（当前 31 条，即潜在的静态占位/死标记）。

---

## 10. 整改记录（路线图 P0→P3 逐项结果）

| # | 项目 | 结果 |
|---|---|---|
| P0-1 | 检查脚本补 entrypoints 反向依赖 + core→app 规则 | ✅ 已落地并配套修复 |
| P0-2 | @deprecated 引用规则 | ✅ 已落地 |
| P0-3 | 循环依赖检查 | ✅ 已落地（跨组 SCC 报错） |
| P1-4 | 9 处 shim 引用改模块 public，删 4 个 shim | ✅ 完成 |
| P1-5 | 拆 reader-ui 击穿（app/public + 消费者改道） | ✅ 完成；进一步把 openPdf 编排移出 core |
| P1-6 | 总结逻辑移出 viewer-document-agent | ✅ 迁至 features/translation/summary-generation.ts |
| P1-7 | 合并 provider 契约 | ✅ background 全部改从 modules/ai 导入，本地副本删除 |
| （隐含） | 巨型循环依赖（94 文件 SCC） | ✅ 清零：core 不再依赖 feature；5 对 feature 互依赖单向化；viewer-state 类型依赖归位 |
| P2-8 | feature-models 拆分 + app-view-persistence 瘦身 | ✅ models/ 5 文件 + 兼容桶；assistant-state/app-view-restore 抽出 |
| P2-9 | 拆分超大 registrations + summary/card 绑定归位 | ✅ register-reader-events 725→11 行 + 4 子文件（51=51 绑定零丢失）；summary/card 绑定迁至 register-translation-events；assistant 594 行未超限保留（§11-②） |
| P2-10 | 知识库收敛 | ✅ worker 复用 semanticKnowledgeRetriever；刷新 hook 总是 re-sync 模块；遗留读取保留为迁移桥（§11-④） |
| P2-11 | 论文概念收敛 + 阅读日志归属 | ✅ 日志存储迁至 paper-card/reading-journal-storage.ts；论文身份匹配类型化收敛；三模型合并列入 §11-③ |
| P3-12 | StateCell 最小订阅 | ✅ createStateCell + 契约测试；全部 models 状态迁移（读写兼容，调用点零改动） |
| P3-13 | 模板 id 契约 | ✅ check-element-ids.mjs（0 错误）+ 接入 check 链 |
| P3-14 | 死代码清理 + selection-page 抽取去重 | ✅ 20 个死函数删除（library-view 532→172 行）；PDF 文本抽取统一到 infrastructure |

---

## 11. 遗留技术债（有意保留，逐项说明）

1. **装配时序隐式**：`mountViewerShell()` 同步 + bootstrap 动态 import 是 DOM 就绪的隐式保障；`interactionBoundary.install()` 早于 PDF.js 监听的注释要求仍靠 PDFViewer 构造期不挂监听的实现细节。→ 可引入显式 ready 握手（改动面大，未做）。
2. **register-assistant-events.ts（594 行）未拆**：低于 700 行限制，功能集中但可读性一般；拆法已由 reader 拆分示范（chrome/settings/chat/citation 四个域）。
3. **"论文"三处建模未合并**：`RecentPdfEntry`/`SavedPaperCard+Overview`/`PaperLibraryRecord` 仍并存，但匹配规则已收敛到 paper-library-reader 的两个 helper。合并为单一领域模型是下一个大工程。
4. **知识库遗留存储未退役**：`collectKnowledgeItems()` 迁移桥仍读 3 个遗留 localStorage 键（notes/journal/meta）；journal 存储虽已归属 paper-card 但键名未变。所有写路径后都有 re-sync，行为正确；最终退役需一次性迁移标记 + 写路径改直写模块 + summary/card 源改直写。
5. **工具命名三套并存**：`applicationName`（点分）/`protocolName`（下划线）/`DocumentToolName`（snake_case），映射表在 viewer 层 `APPLICATION_DOCUMENT_TOOL_NAMES`。可收敛为目录内单一命名 + 生成映射。
6. **background 组合根豁免仍宽**：background 可 import 任意 module 内部文件（规则豁免）。可收紧为 background 也只走 public.ts。
7. **视觉请求绕 provider 抽象**：`vision-service.ts` 仍为裸 fetch + OpenAI 兼容格式 + Moonshot 特判；`AI_PROVIDERS` 声明 anthropic/gemini"即将支持"但未注册。视觉是独立配置通道，短期不动。
8. **1 条持久化告警**：`modules/knowledge/adapters/browser-document-corpus.ts` 直访 localStorage（文件名不含 repository 关键词触发告警）。该文件是"语料元数据自由函数集"，无端口——可补 `KnowledgeCorpusRepository` 端口。
9. **`{ value }` 订阅能力尚未被消费**：StateCell 的 subscribe 目前无调用方（能力先行）；后续可用它替换约定式事件重查（unsaved-changes、助手视图切换等）。
10. **元素契约 31 条"未引用模板 id"告警**：部分为静态占位（目录演示按钮等）与部分 `querySelector("#id")` 引用未纳入扫描；可逐条清理或扩充扫描模式。
11. **same-feature 内部文件环**：annotations feature 内部 15 个文件存在同组环（检查豁免）；如需严格化可内部拆分。
12. **AI 配置遗留常量**：`AI_CONFIG_STORAGE_KEY`/`VISION_AI_CONFIG_STORAGE_KEY`/`LEGACY_DEEPSEEK_CONFIG_STORAGE_KEY` 仍被引用，连接表迁移后可逐步收口。
13. **文档标签页（会话级）**：标签在页面刷新后不恢复，且暂无 Ctrl+Tab / 中键关闭等浏览器习惯快捷键；标签顺序、每标签缩放/内部导航历史（internalNavigationHistory）目前切换时重置。标签模型有纯逻辑契约测试，但"打开→切换→关闭"的浏览器级自动化测试尚未覆盖。

---

## 12. 附录：目录速查

| 目录 | 一句话职责 | 入口 |
|---|---|---|
| `entrypoints/background.ts` | 后台入口 | `src/background/bootstrap.ts` |
| `entrypoints/viewer/` | 主阅读器 | `src/viewer/app/app-shell.ts` + `bootstrap.ts` |
| `entrypoints/sidepanel/` | 侧边栏引导 | `src/viewer-launcher/bootstrap.ts` |
| `entrypoints/selection-page/` | 选区处理页 | `src/selection-page/bootstrap.ts` |
| `entrypoints/tutorial/` | 配置教程 | `src/tutorial/bootstrap.ts` |
| `src/background/` | 消息路由 + AI 网络请求 | `bootstrap.ts` |
| `src/modules/*` | 6 个业务模块 | 各自 `public.ts` |
| `src/infrastructure/` | IndexedDB/Storage/PDF 文本抽取 | — |
| `src/viewer/core/pdf-reader/` | **PDF 原语层**（不依赖 features） | `public.ts` |
| `src/viewer/app/` | 装配：模板注入、elements、registrations、编排器（document-open/save、**document-tabs**）、状态、hooks | `bootstrap.ts`、`public.ts`（状态门面） |
| `src/viewer/app/models/` | 按域拆分的状态/类型（5 文件） | `feature-models.ts`（兼容桶） |
| `src/viewer/features/` | 9 个功能（单向依赖） | 各自 `public.ts` |
| `src/viewer/services/` | 模块 ↔ Viewer 桥 | — |
| `src/viewer/shared-ui/` | 共享 UI（markdown/引用文本/导航/几何/交互边界/下拉/对话框） | — |
| `src/viewer/templates/` | HTML 模板 | — |
| `scripts/` | check-architecture、check-element-ids、18 个测试 | — |
| `docs/` | 隐私政策站点源 | — |

### 大文件 TOP（整改后，均 <700）

`markdown-renderer.ts`(655) / `settings-navigation.ts`(621) / `register-assistant-events.ts`(594) / `onboarding-tour/controller.ts`(576) / `citation-and-summary.ts`(576) / `learning-view.ts`(约 560) / `vocabulary-library-controller.ts`(539) / `annotation-editor.ts`(518) / `ink-eraser.ts`(约 520) / `deepseek-provider.ts`(463)。
