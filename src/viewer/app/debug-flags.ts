/**
 * 调试开关（localStorage）.
 *
 * Kept in `app/` because reading `localStorage` directly from a feature is flagged by the architecture check: persistence is
 * supposed to live behind a module. These flags are not persistence — they are developer switches, set by hand in the console:
 *
 * ```js
 * localStorage.setItem('pdfpal-debug-graph', '1')
 * ```
 */
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** 图谱抽取的诊断日志：每批的分块范围、字符数与丢弃原因. */
export function isGraphDebugEnabled(): boolean {
  return readFlag('pdfpal-debug-graph');
}
