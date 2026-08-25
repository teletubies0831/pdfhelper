# PDFPal

PDFPal 是一个基于 WXT、TypeScript 和 PDF.js 的浏览器扩展，用于阅读 PDF、调用 AI 分析论文、管理阅读记录和检索个人知识库。

## 主要功能

- PDF 阅读、目录、搜索、缩放和阅读位置恢复
- 划词翻译、解释、总结和原文引用定位
- 高亮、文本、画笔、批注备注和带批注 PDF 导出
- AI 对话、图片理解、长期记忆和论文全文检索
- 论文总览、阅读卡片、阅读日志和相关论文检索
- 知识库检索、编辑、导入和研究工作区
- 进程内 MCP 工具注册、发现和调用

## 项目目录

```text
pdfReadHelper/
├── entrypoints/                 WXT 构建入口，只负责启动对应运行时
│   ├── background.ts            浏览器扩展后台入口
│   ├── popup/                   点击扩展图标时显示的标准 Popup 入口
│   ├── selection-page/          右键选中文字后打开的选区处理页面入口
│   └── viewer/                  PDFPal 主阅读器入口及入口级桥接文件
├── src/
│   ├── background/              后台消息、右键菜单和模型流式请求
│   ├── infrastructure/          浏览器 API、IndexedDB 和存储的具体实现
│   ├── modules/                 不依赖具体界面的业务模块
│   ├── selection-page/          选区处理页面的界面和行为
│   ├── viewer-launcher/         Popup 用来打开或激活主阅读器的逻辑
│   └── viewer/                  主 PDF 阅读器应用
├── scripts/                     契约测试、架构检查和生产产物检查
├── public/                      图标、本地化和静态资源
├── package.json                 命令与依赖
├── pnpm-workspace.yaml          pnpm 工作区配置
└── wxt.config.ts                WXT 和浏览器扩展 Manifest 配置
```

## 运行环境

项目不是一个单体网页，而是由几个浏览器扩展运行环境组成：

```text
Popup
  只负责打开 Viewer

Selection Page
  接收浏览器右键菜单保存的选中文字

Viewer
  显示 PDF、聊天、知识库、批注和论文工具

Background
  持有后台消息处理和模型网络请求
```

`entrypoints/` 是 WXT 识别的构建入口，`src/` 存放真正实现。入口文件应保持很薄，只导入一个对应的启动文件。

## Modules 业务模块

```text
src/modules/
├── ai/                          AI 配置、Provider 注册和 MCP 工具协议
├── document-agent/              PDF 分块、全文搜索、章节定位和论文档案
├── knowledge/                   知识记录、关键词与向量检索
├── memory/                      长期记忆和历史论文记录
├── reading-mode/                阅读模式及对应策略
├── research/                    CCF 查询和相关论文检索
└── selection/                   跨页面选区请求的数据契约
```

每个模块通过自己的 `public.ts` 向外提供能力。模块外代码不应导入另一个模块的内部文件。

## Viewer 目录

```text
src/viewer/
├── app/                         应用启动、全局状态、DOM 元素和事件装配
├── core/pdf-reader/             PDF.js 阅读器核心控制
├── features/                    按用户功能组织的界面和交互
├── services/                    Viewer 与业务模块之间的运行时编排
├── shared-ui/                   多个 Viewer 功能共同使用的界面代码
├── styles/                      应用级公共样式
└── templates/                   主阅读器 HTML 模板
```

`shared-ui` 只表示 Viewer 内多个功能共同使用的界面能力，例如 Markdown 渲染、选区几何合并和 PDF 来源导航；它不是旧模块兼容层。

## Infrastructure 基础设施

```text
src/infrastructure/
├── browser/                     浏览器地址和 PDF 来源处理
├── database/                    IndexedDB 数据库创建、升级和公共事务工具
└── storage/                     浏览器 Storage 的 JSON Repository
```

业务模块描述“需要保存或读取什么”，基础设施负责“在浏览器里具体怎么保存”。界面代码不应绕过 Repository 直接操作 IndexedDB。

## MCP 工具调用

MCP Client 和 MCP Server 都在 Viewer 进程内运行，通过内存 Transport 连接，不需要额外服务、端口或子进程。

```text
模型 Provider function call
  → Viewer MCP Client
  → InMemoryTransport
  → MCP Server
  → Agent Tool Handler
  → 现有业务模块
```

相关源码：

```text
src/modules/ai/mcp/agent-tool-catalog.ts
  工具名称、说明、参数 Schema 和 annotations 的唯一来源

src/modules/ai/mcp/agent-tool-server.ts
  将工具目录注册到 MCP Server

src/viewer/features/assistant/mcp/embedded-agent-tool-runtime.ts
  MCP Client、内存连接、tools/list 和 tools/call

src/viewer/features/assistant/mcp/agent-tool-handlers.ts
  将 MCP 调用转交给现有业务模块
```

## 依赖方向

- `entrypoints` 只启动运行时，不承载业务逻辑。
- `viewer/features` 可以调用模块的 `public.ts` 和 Viewer 公共 UI。
- `src/modules/*` 对外只能通过该模块的 `public.ts` 使用。
- 领域逻辑不依赖 DOM、WXT、IndexedDB 或具体网络适配器。
- 一个 Viewer 功能不能直接导入另一个功能的内部文件。
- 存储键、数据库版本和迁移逻辑属于基础设施。
- 同一种行为只保留一套实现，不创建 `v2`、`final` 或覆盖式实现。

## 常用命令

要求 Node.js 20 或更高版本以及 pnpm。

```powershell
pnpm install
pnpm dev
```

构建 Edge 扩展：

```powershell
pnpm build
```

运行类型检查、契约测试、架构检查和生产构建：

```powershell
pnpm check
```

## 修改代码时从哪里开始

- 修改模型调用或 MCP 工具：从 `src/modules/ai/` 和 `src/viewer/features/assistant/` 开始。
- 修改 PDF 阅读行为：从 `src/viewer/core/pdf-reader/` 开始。
- 修改论文全文检索：从 `src/modules/document-agent/` 开始。
- 修改知识库检索：从 `src/modules/knowledge/` 开始。
- 修改长期记忆或历史论文：从 `src/modules/memory/` 开始。
- 修改某个界面功能：先进入 `src/viewer/features/` 下对应功能目录。
- 修改浏览器存储或数据库：从 `src/infrastructure/` 开始。
