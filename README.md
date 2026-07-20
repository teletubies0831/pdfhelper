# PDF Helper

一个基于 WXT、TypeScript 和 PDF.js 的 PDF 阅读助手。

## 保留的功能

- PDF.js 增强阅读器
- 划词、解释与翻译
- 总结与知识卡片页面
- 高亮、画笔、文本批注
- 导出带批注的 PDF
- FastAPI 本地 AI 后端

## 环境要求

- Node.js 20 或更高版本
- pnpm
- Python 3.12
- Chrome 或其他 Chromium 浏览器

## 1. 启动后端

在 PyCharm 终端中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\server\start.ps1
```

第一次运行会创建 `.venv` 和 `.env`。填写 `.env`：

```env
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=你的API密钥
LLM_MODEL=deepseek-chat
```

然后重新运行启动命令。

健康检查：

```text
http://127.0.0.1:8000/health
```

## 2. 启动前端

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
- `server/`：FastAPI 后端

## 不应提交或打包的内容

以下内容会在本地自动生成，已经从源码包中删除：

- `.venv/`
- `node_modules/`
- `.output/`
- `.wxt/`
- `.idea/`
- `.git/`
- `.env`
