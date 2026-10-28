# 画布交互、全局任务栏与长文档抽取

这一轮改动的设计说明：为什么这么改、边界在哪、以及长文档要怎么继续演进。

## 一、画布拖拽与缩放

### 现象与根因

拖拽、滚轮缩放其实早就接上了（`graph-canvas-interaction.ts`），真正的两个缺陷是：

1. **窗口一变化就重新取景。** `window.resize` 的处理器调用的是 `fitKnowledgeGraph()`，每次都会按新的画布尺寸重新算缩放和平移 →
   视觉上就是「图跟着窗口缩放」，用户手动拖出来的位置也被丢掉。
2. **布局跑在屏幕坐标里。** 力导向布局把画布的 `width/height` 当世界尺寸，并对画布中心施加引力。窗口越宽，同一张图的节点铺得越
   开——同一份数据在不同窗口下是两张不同的图。

### 改法

- 布局改在**世界坐标**里跑：`layoutWorldSize(nodeCount)`（在 `graph-viewport.ts`，纯函数）只由节点数决定世界大小，
  与画布无关。画布尺寸只用于把世界映射到屏幕（视口变换）。
- **内容没变就不重排**：`graph-layout-runner.ts` 用节点 id + 边端点算一个签名，签名相同就复用上次的坐标。窗口缩放、悬停、
  过滤、重新加载（内容相同）都不再移动任何节点。
- **resize 只重新测量并重绘**：`layoutRunner.resize()` → `renderer.syncSize(); renderer.render()`，不 fit、不重排。
- **平移/缩放重绘按帧合并**：`graph-viewport-controller.set()` 变成一个 `requestAnimationFrame` 一次，指针移动期间不再每帧
  同步重绘（大图上这是「拖起来卡住」的另一半原因）。最后一次的值胜出，正好是要画的那一帧。

### 交互约定

| 手势 | 行为 |
|---|---|
| 按住拖动 | 平移（位移 < 4px 仍按点击处理，节点可点选） |
| 滚轮 | 以光标为锚点缩放，0.15×–4× |
| 适应画布按钮 | 显式 fit，任何时候都生效 |
| 窗口缩放 | 只改变「看到世界的多少」，不动节点、不动视口 |

## 二、全局任务栏（IDEA 风格）

`src/viewer/shared-ui/tasks/task-center.ts` + `task-center.css`，挂在 `document.body` 上而不是任何工作区里——这正是它要解决的问题：
抽取是异步任务，切到阅读页后旧实现只有一个页面内的 toast，进度和「怎么停」一起消失了。

- `startTask({ title, detail, total, cancelable, onCancel })` 返回句柄：`update()` / `advance()` / `finish(status, detail)`。
- 折叠态一行：标题、`N/M`、百分比、进度条；展开态列出全部任务，每行带自己的停止按钮。
- 全部结束后 6 秒自动收起（展开状态不自动消失）；只收起的任务不会被静默取消——那是「停止」的职责。
- 组件不含业务逻辑：抽取、关系判定都只是调用方。

### 真正能停下来的取消链路

`runtime.sendMessage` 没有 signal 可传，所以取消是**第二条消息**：

1. 后台 `request-handler.ts` 给每批抽取请求建一个 `AbortController`，按 `requestId` 存在 `activeAiRequests`；
2. 视图侧「停止」→ 中止本地 runner 的 `AbortSignal`（批次之间立刻停）+ 发
   `{ type: 'pdf-helper:ai-cancel-request', requestIdPrefix: 'extract:' }`；
3. 后台 `cancelAiRequestsByPrefix()` 中止在飞的 provider 请求 → 该批直接失败，不再等网络超时；
4. runner 在批间检查 `signal.aborted`，把 job 标成「用户取消」，已提交批次全部保留，游标可续跑。

用前缀而不是精确 id：抽取每批一个 `extract:<paperId>:<chunkId>`，视图侧不留 id，前缀正好表达「这篇的全部在飞请求」。

## 三、长文档（200 页以上）

### 为什么会长

论文策略每块 9 000 字符、块间重叠 500，一批 3 块（≤30 000 字符）。一本 200 页的书按 1 800–2 200 字符/页估算约 36–44 万字符：

| 规模 | 正文字符 | 分块 | 模型调用 |
|---|---|---|---|
| 20 页论文 | ~6 万 | ~7 | 3 |
| 200 页书 | ~40 万 | ~47 | 16 |
| 800 页书 | ~160 万 | ~190 | 64 |

时间和费用都随调用的次数线性增长，而且书里的参考文献、索引、附录本身几乎没有实体密度——这些调用基本是纯浪费。

### 这一轮的实现

- **分块级进度**：`ExtractionProgress` 增加 `completedChunks/totalChunks/sampled`，文案变成
  `正在抽取候选实体：27/54 块 · 第 9/18 批`。批是 3 块一跳，只有分块数才是用户看得懂的刻度。
- **单篇分块预算**：`selectExtractionChunks()`（`MAX_EXTRACTION_CHUNKS_PER_PAPER = 96`，开头 `EXTRACTION_LEAD_CHUNKS = 12`
  块必留，其余均匀取样）。200 页的书从 ~47 块降到 ≤96 块以内不触发；800 页的书被压到 96 块 ≈ 32 次调用，并明确告知
  「长文档，已从 N 块中取样 M 块」。
- **确定性**：抽样没有随机数，job 指纹由选中的 chunk id 构成 —— 同一份文档永远得到同一个选择，重跑才能被正确跳过。

### 还能继续做的（架构方向）

1. **按页范围限流**：把「附录 / 参考文献 / 索引」识别出来整段跳过（页脚页码、`References` 标题、连排书目格式都可以高置信判断）。
2. **分层抽取**：先对每块抽「这是什么」，只让被判定为「有实体密度的块」进入第二层细抽；代价是多一次廉价调用，收益是长文档的
   主体调用大幅下降。
3. **并发自适**：现在批内并发 2 且固定。可按时延反馈调整（连续成功 → 3，出现 429/超时 → 1），并把当前并发显示在任务栏。
4. **预算前置告知**：开始前用 `⌈分块/3⌉` 估算调用次数与费用，写进确认对话框。现在只有进度，没有「这次大概多少钱」。

## 四、阅读位置记忆

**根因**：打开原文时把 `page` 当成「明确要求跳到这里」。`openSourcePdfInNewTab` 永远写 `page=1`，`app-ui` 里
`requestedSourcePage` 默认也是 1，于是 `restoreStartupSourcePageAfterPagesInit()` 用「跳到第 1 页」把已保存的阅读位置覆盖掉了。

改法（`page <= 1` 一律表示「没有指定」）：

- `app-ui.ts`：`page` 缺省/非法 → `0`；只有 > 1 才当作跳转请求。
- `openSourcePdfInNewTab`：只在 `pageNumber > 1` 时写 URL 参数。
- `openRecentFileById(id, page = 0)`：`<= 1` 时把跳转请求清空，让 `pendingReadingPosition` 的恢复流程跑起来。
- 同标签页打开（持久文件句柄路径）没有 URL 可带页码，新增 `requestSourcePageAfterOpen(page)` 把请求寄存，由 pages-init 消费。
- 保存侧不变：`pagechanging` / `scalechanging` / 滚动都会 `scheduleReadingPositionSave()`，写进最近文件记录并镜像到知识库记录。

## 五、抽取不准的排查手段

「感觉不对」有四种完全不同的成因，必须先用数据分开，再改代码：

| 怀疑 | 怎么确认 | 指标 |
|---|---|---|
| 分块切断了语义 | 看 `__pdfpalExtraction()` 里每批的页范围与字符数；对比块边界处的原文 | 页范围跳变、字符数远低于 9 000 |
| 长文档被抽样 | 进度文案里的「已从 N 块中取样 M 块」 | `sampled: true` |
| 模型没按提示词输出 | 看 `parsedCandidates` 与 `droppedLowQuality` 的比例 | 解析出 0 条 / 候选全是短语 |
| 前端映射错了 | 检查候选 `type`、`evidence.pageNumber`、归一化名与显示名 | 节点名变成去分隔符后的串、页码全为 1 |

已加的日志：

- 每批一条 `ExtractionBatchDiagnostics`（分块 id、首页/末页、字符数、候选数、四类丢弃计数），存在内存里；
- 控制台 `__pdfpalExtraction()` 打印成表；
- `localStorage.setItem('pdfpal-debug-graph', '1')` 后每批再打一条 `console.info`（开关在 `app/debug-flags.ts`）。
