# PDFPal 架构说明

## 目标

本项目采用“功能切片 + 端口/适配器 + 组合根”的结构。界面、业务规则、外部服务和持久化不再堆在同一个文件中；后续修改某项功能时，应从该功能目录的 `public.ts` 和 `AGENTS.md` 开始，不需要先阅读整个项目。

依赖方向固定为：

```text
entrypoints
  -> bootstrap / registrations
    -> viewer feature public APIs
      -> domain module public APIs
        -> ports
          <- browser, database and network adapters
```

同级功能不能直接导入对方内部文件，跨功能只能访问 `public.ts`。`scripts/check-architecture.mjs` 会自动检查这条规则。

## 完整功能目录

```text
entrypoints/
  background.ts                 后台组合根
  viewer/                       阅读器 HTML、脚本、样式入口与兼容出口
  helper-panel/                 辅助面板入口
  popup/                        扩展弹窗入口

src/
  background/
    bootstrap.ts                注册后台消息、连接和菜单事件
    ai/
      ai-config-repository.ts   AI 配置读取与兼容迁移
      provider-runtime.ts       Provider 注册表与适配器查找
      conversation-builder.ts   系统提示和对话上下文构建
      streaming-service.ts      流式消息与工具调用循环
      request-handler.ts        非流式 AI 用例路由
      vision-service.ts         图片模型请求
    context-menu/               右键菜单与页面打开逻辑

  modules/
    ai/
      contracts.ts              Provider 无关的请求、响应和配置契约
      providers/                Provider 接口、注册表和厂商适配器
      tools/                    AI 工具契约
      public.ts                 AI 模块唯一公共出口
    document-agent/
      contracts.ts              文档、分块、会话和检索契约
      document-chunker.ts       文档分块
      document-search.ts        文档内搜索
      document-tools.ts         文档工具定义
      application/              初始化、章节定位、检索上下文和工具执行
      adapters/indexed-db/      文档数据仓储
      public.ts                 文档代理公共出口
    knowledge/
      domain/                   统一知识记录模型
      ports/                    知识仓储接口
      application/              KnowledgeLibrary 用例服务
      adapters/                 浏览器存储实现
      public.ts                 知识模块公共出口
    memory/
      contracts.ts              长期记忆和工具契约
      adapters/indexed-db/      记忆数据仓储
      public.ts                 记忆模块公共出口
    research/
      common/                   请求、缓存和文本处理
      providers/                文献数据源适配器
      ccf/                      CCF 查询与解析
      related-papers/           相关论文服务
      browser-client.ts         阅读器侧研究客户端
      public.ts                 研究模块公共出口
    reading-mode/               阅读模式规则与策略
    selection/                  划词消息契约

  platform/
    database/workspace-database.ts       数据库建库、升级与事务基础设施
    storage/browser-json-repository.ts   JSON 浏览器存储适配器

  viewer/
    app/
      bootstrap.ts              阅读器组合根
      app-ui.ts                 应用级界面初始化
      viewer-state.ts           跨功能运行时状态
      feature-models.ts         阅读器共享视图模型
      app-view-persistence.ts   页面视图状态
      elements/                 按功能分类的 DOM 绑定
      registrations/            按功能分类的事件注册
    core/pdf-reader/            PDF.js 生命周期、导航、查找、缩放和控制器
    features/
      annotations/              批注编辑、备注、序列化、PDF 附件和恢复
      assistant/                对话、配置、流式界面、记忆和工具执行
      knowledge-base/           知识库页面、筛选、编辑、研究和兼容采集
      paper-card/               阅读卡片、论文总览、阅读日志和相关论文
      reading-journal/          阅读日志样式与公共入口
      recent-files/             最近文件、阅读位置和独立仓储
      text-selection/           选择几何、上下文和覆盖层
      translation/              翻译、学习结果、历史、总结和引用定位
    services/document-agent/    阅读器与文档代理之间的应用服务
    shared-ui/                  Markdown、几何和跨功能展示组件
    templates/                  按页面/功能拆分的 HTML 模板
    styles/                     应用壳、组件主题、滚动条和动效

  helper-panel/                 辅助面板实现
  popup/                        弹窗实现

shared/                         兼容旧路径的公共重导出
scripts/check-architecture.mjs  架构边界自动检查
```

## 采用的设计模式

- Facade：每个模块和功能通过 `public.ts` 暴露稳定接口，调用者不依赖内部文件布局。
- Strategy + Registry：AI 厂商实现统一 Provider 接口，由注册表按能力选择；界面不判断具体厂商。
- Repository：IndexedDB、localStorage 和扩展存储位于仓储/适配器中，业务函数不直接操作数据库。
- Ports and Adapters：知识库、文档代理和记忆先定义接口，再连接浏览器存储或网络实现。
- Application Service：知识库同步、文档初始化、检索、工具执行等跨实体流程由用例服务编排。
- Composition Root：`bootstrap.ts` 和 `registrations/` 只组装依赖与事件，功能实现留在各自目录。

这些模式的目的不是增加层数，而是让每个文件只有一个主要修改原因。

## AI 厂商扩展

新增厂商时，只需要：

1. 在 `src/modules/ai/providers/` 实现 Provider 接口并声明能力。
2. 在后台 `provider-runtime.ts` 注册适配器。
3. 如需新的配置字段，只修改 AI 契约和配置仓储。

聊天、翻译、总结、卡片和知识库功能仍使用统一请求，不需要为厂商复制一套功能代码。

## 统一知识库

`KnowledgeRecord` 是统一记录模型，`KnowledgeLibrary` 是唯一的领域入口。现有总结、阅读卡片、论文卡片、日志和笔记会通过兼容采集器同步到统一仓储，因此旧数据和当前功能仍然可用。

兼容采集只位于知识库边界内；其他新功能应直接调用知识模块保存记录，不能再新增独立的知识集合。这样可以逐步完成数据迁移，而不会要求用户丢弃已有内容。

## 数据库解耦

物理数据库的建库和升级集中在 `src/platform/database/`；文档、会话、记忆、最近文件和知识记录分别通过自己的仓储访问数据。业务模块依赖仓储接口，不依赖数据库名称、对象仓库名称或迁移版本。

未来更换某一类数据的数据库时，只替换该仓储适配器。其余功能不需要了解新的数据库结构。

## 保留功能的约束

本次重构保留了现有 DOM id、运行时消息、存储键、PDF 附件格式和初始化顺序。内部仍保留必要的数据兼容读取，但用户界面和功能文件不使用“新版、旧版、最终版”等实现名称。

HTML 与 CSS 也按功能拆分，并通过固定导入顺序保持原有级联结果。重要可变状态使用稳定引用对象，避免拆文件后模块重新绑定导致状态失效。

## 后续修改规则

1. 先进入目标功能目录并阅读其 `AGENTS.md`。
2. 从 `public.ts` 查找入口，不要全文搜索整个项目后跨目录修改内部实现。
3. 新增持久化必须先增加仓储方法；新增 AI 厂商必须增加 Provider。
4. 不创建带数字版本或 `final` 后缀的新实现文件。
5. 修改完成后执行 `pnpm check`。
