/**
 * 续读与待读队列（B3）.
 *
 * 两个很小的判定，但因为「上次读到哪」会出现在列表、右栏、卡片三个地方，而且要和分页数对齐，所以单独放一个纯模块：
 *
 * 1. **续读点**：记录里存的页码可能与当前文件不再匹配（重存过的 PDF 少了页、换了版本），超出的页码要夹住，而不是打开
 *    一份不存在的第 900 页。
 * 2. **待读队列**：待读按入库先后排——最早加进来的先读，这是队列唯一有意义的顺序。
 */

/** 续读所需的最小记录形状，避免这个模块依赖整个库记录类型。 */
export interface ResumeSource {
  documentName: string;
  pageCount: number;
  lastReadPage?: number;
  lastReadAt?: string;
}

export interface ResumePoint {
  /** 夹到 `1..pageCount` 之后的页码。 */
  pageNumber: number;
  /** ISO 时间；没有就空。 */
  lastReadAt: string;
  /** 是否因为超出页数而被夹住（提示语会说明「文件可能变短了」）。 */
  clamped: boolean;
}

/** 从记录里读出续读点；没读过就返回 `null`。 */
export function resumePointOf(document: ResumeSource): ResumePoint | null {
  const stored = Number(document.lastReadPage);
  if (!Number.isFinite(stored) || stored < 1) return null;
  const total = Number(document.pageCount) || 0;
  const maximum = total > 0 ? total : stored;
  const pageNumber = Math.min(Math.round(stored), maximum);
  return {
    pageNumber,
    lastReadAt: document.lastReadAt ?? '',
    clamped: pageNumber !== Math.round(stored),
  };
}

/** 表格/卡片里的一行文字：`第 12 页`、`第 12 / 34 页`，没读过时是空串（由调用方决定显示破折号）。 */
export function resumeLabel(document: ResumeSource): string {
  const point = resumePointOf(document);
  if (!point) return '';
  const total = Number(document.pageCount) || 0;
  return total > 0 ? `第 ${point.pageNumber} / ${total} 页` : `第 ${point.pageNumber} 页`;
}

/** 「继续阅读」按钮的文字；读完了就直说。 */
export function resumeActionLabel(document: ResumeSource): string {
  const point = resumePointOf(document);
  if (!point) return '打开原文';
  const total = Number(document.pageCount) || 0;
  if (total > 0 && point.pageNumber >= total) return `重读结尾（第 ${total} 页）`;
  return `继续阅读（第 ${point.pageNumber} 页）`;
}

/** 待读队列：按入库时间升序，最早加入的排最前。没有日期的排在最后（未知不等于最早）。 */
export function sortPendingQueue<T extends { addedAt?: string }>(documents: readonly T[]): T[] {
  const timeOf = (item: { addedAt?: string }): number => {
    const parsed = Date.parse(item.addedAt ?? '');
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  };
  return [...documents].sort((left, right) => timeOf(left) - timeOf(right));
}

/** 待读队列的说明文字，放在列表上方，免得用户以为排序坏了。 */
export const PENDING_QUEUE_NOTE = '待读队列：按入库先后排列，最早加入的排在最前。';
