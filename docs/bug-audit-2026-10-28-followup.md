# PDFPal 第六轮复审：待修问题清单

复审日期：2026-10-28 22:50  
复审方式：只读代码，不改实现、不跑构建；按「上一轮修复后的当前工作树」逐条核对，测试套件状态单独确认。  
关联文档：[bug-audit-2026-10-28.md](./bug-audit-2026-10-28.md)（第一至第五轮，P1/P2 已全部闭环）。

## 结论

没有 P0/P1。上一轮 P1-02～P1-06 的存储设计（迁移写独立 `legacy::` 命名空间 + 删除墓碑 + 写入代际）站得住：
两个写入者不共享键，`storage.local` 没有 compare-and-set 也不影响正确性。`test:storage-concurrency` 现共 16 条，
其中 P1-02/03/04/05/06 都有强制交错用例，我复跑全过。

本轮发现的 **P2-06～P2-09 均已修复**。P3-02、04、05、06、08、10、11 已修复；P3-01、03 采用明确的安全保留策略；P3-07 转为工程约束，P3-09 保持未验证假设。

编号延续主文档：P2-06～P2-09、P3-01～P3-11。

---

## P2

### P2-06：抽取抛异常时，任务栏永远停在「运行中」（已修复）

- 位置：[src/viewer/features/knowledge-graph/graph-entity-actions.ts](../src/viewer/features/knowledge-graph/graph-entity-actions.ts#L226)（单篇 `try` 在 226、`finally` 在 253）、[:L376](../src/viewer/features/knowledge-graph/graph-entity-actions.ts#L376)（批量 `try` 在 376、`finally` 在 424）
- 复现条件：抽取过程中出现未捕获异常——读全文索引失败、`afterExtraction()` 里的 reload 抛错、provider 之外的程序错误。
- 原因：`task.finish(...)` / `batchTask.finish(...)` 写在 `try` 体内，`finally` 只做 `refreshExtractionAvailability()`，没有 `catch`。
- 影响：任务栏停在运行态，进度条不再动，「停止」按钮点下去也没人消费；用户会以为抽取还在跑，或在等一个永远不会到的结果。
- 修复：单篇和批量入口均增加 `catch`；任务尚未结束时明确 `finish('failed', ...)`，并向状态栏报告异常。若仅 `afterExtraction()` 等收尾 UI 在任务已成功结束后失败，则保留已完成状态而报告收尾异常，不会把完成任务误标失败。
- 来源：本轮（任务栏接线）。

### P2-07：批量抽取时任务条计数在「篇」和「块」之间来回跳（已修复）

- 位置：[src/viewer/features/knowledge-graph/graph-entity-actions.ts](../src/viewer/features/knowledge-graph/graph-entity-actions.ts#L120-L131)（`setExtractionProgress` 写 `completed/total`）、[:L399-L406](../src/viewer/features/knowledge-graph/graph-entity-actions.ts#L399-L406)（批量 `onProgress` 也写同一对字段）
- 复现条件：点「批量抽取」。
- 原因：同一个 `batchTask` 被两个生产者写：内层每篇的 `setExtractionProgress(..., batchTask)` 把 `completed/total` 设成**分块**数（如 27/54），外层按篇汇报时又设成**篇**数（如 2/9）；`detail` 也被两边互相覆盖。
- 影响：进度条在两种单位间反复横跳、百分比回退，看起来像卡住或倒退；「正在停止…」也会被下一帧进度覆盖掉。
- 修复：批量路径不再把 `batchTask` 传给内层的块级 `setExtractionProgress()`；任务条的 `completed/total` 和 `detail` 只由外层篇级进度写入。取消后冻结任务条进度，避免迟到回调覆盖“正在停止…”。
- 来源：本轮（任务栏接线）。

### P2-08：单篇抽取的「停止」会掐掉另一篇正在跑的请求（已修复）

- 位置：[src/viewer/features/knowledge-graph/graph-entity-actions.ts](../src/viewer/features/knowledge-graph/graph-entity-actions.ts#L222)（单篇）、[:L373](../src/viewer/features/knowledge-graph/graph-entity-actions.ts#L373)（批量）
- 复现条件：批量抽取与另一篇的单篇抽取同时进行（`activeRuns` 只锁同一篇，不同篇可以并跑），在任务栏里停掉单篇那个。
- 原因：`cancelExtractionRequests('extract:')` 用的前缀覆盖所有文献的在飞请求；requestId 实际是 `extract:<paperId>:<chunkId>`
  （[extraction-runner.ts:400](../src/modules/knowledge-graph/application/extraction-runner.ts#L400)）。
- 影响：另一篇的在飞批次被 abort，该批记成 failed，候选丢失（要重跑那篇才补回来）。用户只按了一个「停止」。
- 修复：单篇取消改用 `` `extract:${paperId}:` `` 前缀；批量取消保留 `extract:`，语义为停止整个批量。
- 来源：本轮（取消链路接线）。

### P2-09：单词库迁移只在「一张卡都没有」时触发，旧整包键可能永久残留（已修复）

- 位置：[src/viewer/features/vocabulary-library/vocabulary-repository.ts](../src/viewer/features/vocabulary-library/vocabulary-repository.ts#L181)
- 复现条件：迁移写入 import 键成功、但最后 `remove(旧数组键)` 失败（配额/中断），或迁移因 `missing` 分支提前返回；之后再次进入单词库。
- 原因：`readVocabularyCards()` 只要 `cards.length > 0` 就直接返回，永远不再调用 `migrateLegacyCards()`；触发条件是「零卡」而不是「旧键存在」。
- 影响：旧整包键永久残留（死重量）；若未来把迁移的批量 `set` 拆成多次（例如按卡片限流），未迁的那几张会永远看不见。
- 修复：读取已获得完整 storage 快照；只要旧整包键仍存在，就继续执行迁移并回读，哪怕 import/live 卡片已经可见。这样“写 import 成功、删旧键失败”或部分迁移会在后续读取自动收敛。
- 回归证据：`test:storage-concurrency` 新增 P2-09 用例，强制第一次删旧键失败；第二次读取仍显示卡片并完成旧键清理。
- 来源：本轮（存储重写）。

---

## P3

### P3-01：墓碑只增不减

- 位置：[vocabulary-repository.ts#L283](../src/viewer/features/vocabulary-library/vocabulary-repository.ts#L283)、[translation-history-repository.ts#L120](../src/viewer/features/translation/translation-history-repository.ts#L120)
- 单词卡 `…-card-deleted-v1::<id>` 与历史 `…deleted::<docKey>` 都没有回收路径（`writeVocabularyCards` 只清被恢复的那些 id）。
- `readVocabularyCards()` 每次 `get(null)` 会把它们全部反序列化，而 manifest 没有 `unlimitedStorage`（配额 10 MB）。
- 结论：当前量级可接受，**不应在没有额外代际协议时回收**。按 id / 文档键计数而非按删除次数增长；一万个墓碑才接近值得评估配额的量级。
- 硬约束：迁移 import 目前没有“读取旧整包时”的快照代际。删除 tombstone 后，一个被冻结页面仍可迟到写入旧 import，读取层已没有删除时间可供比较，会重新打开 P1-04。未来若需回收，必须持久保留等价的每记录失效 watermark / 迁移 epoch；仅让 import 带时间戳但删除 tombstone 本身并不能解决比较基准丢失的问题。

### P3-02：编辑撞上墓碑时静默丢弃（已修复）

- 位置：[vocabulary-repository.ts#L262](../src/viewer/features/vocabulary-library/vocabulary-repository.ts#L262) → [vocabulary-library-controller.ts#L432](../src/viewer/features/vocabulary-library/vocabulary-library-controller.ts#L432)
- `updateVocabularyCard` 遇到墓碑返回 `null`，但调用方不看返回值，照常 `closeVocabularyEditor()` + 重渲染。
- 修复：编辑返回 `null` 时显示“这张卡已在另一个页面被删除，未保存本次编辑”，并保留编辑器；不会再关闭后让用户误以为保存成功。

### P3-03：恢复顺序导致瞬时「闪隐」

- 位置：[vocabulary-repository.ts#L226-L228](../src/viewer/features/vocabulary-library/vocabulary-repository.ts#L226-L228)
- `writeVocabularyCards` 先写 live 键、后删墓碑；这中间的读者会把刚恢复的卡当作已删除。窗口是一两个微任务，但若正好触发重渲染就会看到卡片消失一下。
- 结论：P3，且不能靠调换两次调用顺序根治；顺序只会把短暂窗口移到另一侧。若未来需要消除，需为词卡 live/import 和 tombstone 建立相同的代际比较语义。

### P3-04：无历史的文档每次都尝试迁移（已修复）

- 位置：[translation-history-repository.ts#L147](../src/viewer/features/translation/translation-history-repository.ts#L147)
- `readHistoryForDocument` 在分键读取返回 `undefined` 时无条件调 `migrateLegacyHistory()`；旧整包键通常早已删除，这一趟是一次多余的 `get`。
- 修复：迁移仓储在确认旧键不存在、格式无效或旧键已成功移除后，在当前页面进程缓存“旧历史不存在”；后续打开无历史文档不再重复读取旧整包键。读取失败或迁移未完成不会写该缓存，仍会重试。

### P3-05：`migrateLegacyHistory` 有两段重复 JSDoc（已修复）

- 位置：[translation-history-repository.ts#L128](../src/viewer/features/translation/translation-history-repository.ts#L128)
- 修复：删除旧实现遗留的重复说明，仅保留当前 import/live 命名空间与删除顺序的契约。

### P3-06：`normalizePdfFileName` 会把任何含 `/` 的名字当路径（已修复）

- 位置：[source-pdf-match.ts#L20](../src/viewer/shared-ui/navigation/source-pdf-match.ts#L20)
- `/[\\/]/.test(name)` 对「记录名里带斜杠」的情况会截断到末段。正常文件名不会带斜杠（Windows/macOS），但这层兜底把假设藏进了正则。
- 修复：仅 URL、Windows 盘符路径或反斜杠路径进入路径截取；普通名称内的 `/` 不再被截断。

### 工程约束：生产检查的报错可诊断性

- 位置：[scripts/check-production.mjs](../scripts/check-production.mjs)
- 规则是「后台产物里出现 `window.setTimeout(` / `window.clearTimeout(` / `window.setInterval(` / `window.clearInterval(` / `window.requestAnimationFrame(` 就失败」。
- 我们自己的代码目前干净，但任何第三方库在 Service Worker 可达路径里带一句同样调用（哪怕走不到）都会硬失败，且报错信息只能看到偏移量。
- 结论：**不是当前缺陷**。后台产物禁止 DOM-only `window.*` 调用是正确约束，规则应保留。可选改进仅是让报错能定位到来源模块，而不是只显示产物字节偏移。

### P3-08：任务栏压在所有弹窗之上（已修复）

- 位置：[task-center.css#L8](../src/viewer/shared-ui/tasks/task-center.css#L8) `z-index: 1000030`
- 对比：通用弹窗 `1000000`、编辑器 `1000004`、搜索浮层 `1000002/1000003`、工具栏浮层 `1000025`。
- 抽取失败时 `showAppError` 弹出的错误对话框会被任务条压住底部，确认按钮可能被盖住（对话框居中、任务条固定底部 42px）。
- 修复：任务栏层级降为 `999999`，仍高于工作区、低于通用弹窗层。

### 未验证假设：重建模型与布局之间可能闪现原点节点

- 位置：[knowledge-graph-page.ts](../src/viewer/features/knowledge-graph/knowledge-graph-page.ts) 的 `redraw()`：先 `setModel`（节点坐标 0,0）再 `scheduleLayout()`（下一帧才 `applyPositions`）；`graph-layout-runner.ts` 的 `resize()` 直接 `render()`。
- 在这中间若有窗口 resize 或滚轮/拖拽触发的 `viewportController.apply → render()`，就会画一帧所有节点堆在原点，下一帧恢复。
- 这需要“模型重建同一帧内恰好有 wheel / resize”等条件；尚未复现或受控测试证明用户可见，因此不列为缺陷。若未来优化，优先在 `setModel` 时按 id 复用旧节点坐标，新节点再等待布局，作为体验稳健性改进。

### P3-10：`pointercancel` 或 `lostpointercapture` 时可能遗留拖拽状态（已修复）

- 位置：[graph-canvas-interaction.ts#L41](../src/viewer/features/knowledge-graph/graph-canvas-interaction.ts#L41) 起
- `setPointerCapture` 通常能保证指针移出窗口后仍收到 `pointerup`，所以“窗口外释放必然累积”不成立。但触屏手势被系统接管、捕获被浏览器收回或元素移除时，现有代码没有 `pointercancel` / `lostpointercapture` 清理，可能遗留 move/up 处理器或拖拽状态；多指同时按下也会重复挂载。
- 修复：抽出幂等 cleanup，监听 `pointercancel`、`lostpointercapture`，并限制同时只接受一个激活 pointer。

### P3-11：单词卡的写路径失去了 localStorage 兜底（已修复：显式失败提示）

- 位置：[vocabulary-repository.ts#L247](../src/viewer/features/vocabulary-library/vocabulary-repository.ts#L247)（create）、[vocabulary-repository.ts#L272](../src/viewer/features/vocabulary-library/vocabulary-repository.ts#L272)（update）、[vocabulary-repository.ts#L283](../src/viewer/features/vocabulary-library/vocabulary-repository.ts#L283)（delete）
- 旧实现经 `writeVocabularyCards` 写入，失败时回落到 `localStorage` 副本；改成按卡写之后这三条路径没有 try/catch，`set` 失败（配额/存储禁用）会以拒绝的 Promise 冒到调用方，而调用方（`vocabulary-library-controller.ts`）不 catch。
- 影响：`await` 拒绝后编辑器实际上不会继续关闭，但事件链没有用户可见错误提示，表现为保存无反馈。配额或存储不可用时尤其明显。
- 修复：新建、编辑、删除和“保存当前翻译”均捕获存储失败并显示明确错误；本轮**不**把按卡写重新降级到 localStorage 兜底，避免把失败数据写入与主存储不同步的影子副本。

---

## 建议修复顺序

P2-06～P2-09 与已确认的 P3-02、04、05、06、08、10、11 均已完成。P3-01、P3-03 保持现有存储语义，避免不安全的墓碑回收或仅调整恢复顺序；P3-07 是保留的工程约束，P3-09 尚待复现或受控测试，不进入修复队列。

## 未列为缺陷的观察

- `test:storage-concurrency` 17 条全部通过；`test:document-tabs`、`test:workspace-vocabulary`、`test-translation-stream-card`、`test-graph-source-jump`、`test:graph-viewport` 复跑均通过。
- 后台产物中 `window.*` 定时器调用为 0（P3-07 提的是规则过敏，不是当前违规）。
- `manifest.json` 权限为 `tabs/storage/contextMenus/sidePanel`，没有 `unlimitedStorage`——这是 P3-01、P3-11 的共同背景。
- 未把「同一张卡/同一篇文献并发编辑仍是后写覆盖」列为新问题：这是 P2-03 已写明的已知限制，需要 IndexedDB 事务才能闭环。
