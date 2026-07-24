# PDF Helper

一个基于 WXT、TypeScript 和 PDF.js 的 PDF 阅读助手。

## 保留的功能

- PDF.js 增强阅读器
- 划词、解释与翻译
- 总结、阅读卡片与论文卡片
- 本地知识库：统一检索、筛选、编辑和定位 AI 笔记/卡片
- 高亮、画笔、文本批注
- 导出带批注的 PDF
- AI 功能由扩展后台直接调用已配置的模型 API，无需启动本地后端

## 环境要求

- Node.js 20 或更高版本
- pnpm
- Chrome 或其他 Chromium 浏览器

## 知识库

点击阅读器顶部的“知识库”即可打开。知识库会自动汇总旧版本已保存在浏览器本地的：

- 总结笔记（`pdf-helper-summary-notes-v1`）
- 阅读卡片（`pdf-helper-saved-cards-v1`）
- 论文总览卡片（`pdf-helper-paper-overviews-v1`）

新版还支持从“翻译/解释”和 AI 对话回答直接保存笔记，并提供全文搜索、类型/分类/标签筛选、排序与分组、详情预览、编辑、删除和返回原文页码定位。新建笔记保存在 `pdf-helper-knowledge-notes-v1`，对旧数据的编辑覆盖信息保存在 `pdf-helper-knowledge-item-meta-v1`，不会破坏原有数据结构。

“导入笔记”支持 JSON 数组，或包含 `notes` / `items` 数组的对象。每条数据至少包含 `title` 或 `content` 字段。

## 1. 配置 AI API

启动扩展后，在 AI 阅读助手右上角“设置”中填写 API Key、Base URL 和模型。
聊天、翻译、解释、总结、阅读卡片与论文总览卡片都会由扩展后台直接调用该 API，不需要运行 `server/start.ps1`。

## 2. 启动扩展

打开第二个 PyCharm 终端：

```powershell
pnpm install
pnpm dev
```

## 3. 构建扩展

```powershell
pnpm build
```

构建目录：

```text
.output/chrome-mv3
```

在浏览器扩展管理页面开启开发者模式，然后加载该目录。

## 项目目录

- `entrypoints/background.ts`：扩展后台逻辑
- `entrypoints/sidepanel/`：侧边栏页面
- `entrypoints/viewer/`：PDF.js 阅读器
- `shared/`：共享类型与 PDF 来源处理
- `server/`：旧版兼容后端（当前前端不再依赖，可不启动）

## 不应提交或打包的内容

以下内容会在本地自动生成，已经从源码包中删除：

- `.venv/`
- `node_modules/`
- `.output/`
- `.wxt/`
- `.idea/`
- `.git/`
- `.env`
