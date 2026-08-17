# PDFPal

一个基于 WXT、TypeScript 和 PDF.js 的 AI PDF 阅读助手。

## 功能

- PDF 阅读、目录、查找、缩放和阅读位置恢复
- 划词翻译、原句翻译、解释、总结和引用定位
- 高亮、文本、画笔、批注备注和带批注 PDF 导出
- AI 对话、图片理解、长期记忆和文档检索工具
- 阅读卡片、论文总览、阅读日志和相关论文检索
- 统一知识库检索、筛选、编辑、删除、导入和研究工作区
- 可注册的 AI 厂商适配器与相互隔离的数据仓储

## 开发

要求 Node.js 20 或更高版本以及 pnpm。

```powershell
pnpm install
pnpm dev
```

构建 Edge 扩展：

```powershell
pnpm build
```

完整检查：

```powershell
pnpm check
```

`pnpm check` 会依次执行类型检查、架构边界检查和生产构建。

## 代码导航

- `entrypoints/`：只负责启动各扩展页面或后台运行时
- `src/background/`：后台消息、上下文菜单、AI 请求编排
- `src/modules/`：与界面无关的 AI、知识库、文档代理、记忆和研究模块
- `src/platform/`：浏览器存储与数据库适配器
- `src/viewer/`：阅读器应用、功能切片、模板和样式
- `shared/`：旧导入路径的兼容出口；新代码应使用模块的 `public.ts`

完整目录职责、依赖方向和扩展方式见 [ARCHITECTURE.md](./ARCHITECTURE.md)。每个重要模块中的 `AGENTS.md` 是后续人工或 AI 修改代码时必须遵循的局部规则。
