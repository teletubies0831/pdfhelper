import type { DataHealthFinding, DataHealthReport } from '../../../modules/knowledge/public';
import { knowledgeDataHealthCountElement } from '../../app/viewer-elements';
import { showAnimatedDialog } from '../../shared-ui/dialog/dialog-motion';

/**
 * 数据体检对话框.
 *
 * The list is the whole feature: one row per inconsistency, each with the single action that fixes it. Deliberately no
 * 「全部修复」 button — several of these actions spend a model call or replace the file the library points at, and a bulk
 * button would hide both the cost and the choice. Rows are grouped by document because that is how the user thinks about
 * them ("this paper is broken"), and the count badge in the sidebar is the only thing that prompts opening this at all.
 */

export interface DataHealthDialogHandlers {
  /** Runs every fix except `manual`; returns the sentence to show under the row. */
  fix(finding: DataHealthFinding, chunkCount: number | null): Promise<string>;
  /** Re-runs the check after a fix, so the rows and the badge reflect reality. */
  rescan(): Promise<DataHealthReport>;
}

let handlers: DataHealthDialogHandlers | null = null;
/** The last report, so a fix knows the chunk count it measured without re-reading storage. */
let lastReport: (DataHealthReport & { chunkCounts?: ReadonlyMap<string, number | null> }) | null = null;
let busy = false;

const dialog = () => document.getElementById('knowledge-data-health-dialog') as HTMLDialogElement | null;
const list = () => document.getElementById('knowledge-data-health-list');
const summary = () => document.getElementById('knowledge-data-health-summary');
const status = () => document.getElementById('knowledge-data-health-status');

export function configureDataHealthDialog(next: DataHealthDialogHandlers): void {
  handlers = next;
}

/** Sidebar badge: hidden at zero, and never alarming — it says "there is something to look at". */
export function renderDataHealthBadge(report: DataHealthReport): void {
  knowledgeDataHealthCountElement.textContent = String(report.total);
  knowledgeDataHealthCountElement.hidden = report.total === 0;
  knowledgeDataHealthCountElement.classList.toggle('is-broken', report.broken > 0);
  knowledgeDataHealthCountElement.title = report.broken
    ? `${report.total} 处问题，其中 ${report.broken} 处会让功能不可用`
    : `${report.total} 处问题`;
}

function severityLabel(finding: DataHealthFinding): string {
  return finding.severity === 'broken' ? '不可用' : '不一致';
}

function renderRows(report: DataHealthReport): void {
  const container = list();
  if (!container) return;
  container.replaceChildren();

  if (!report.findings.length) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-data-health-empty';
    empty.textContent = '没有发现问题：文献记录、本地分块、图谱和文件关联都对得上。';
    container.append(empty);
    return;
  }

  // Grouped by document, keeping the report's own order inside each group (broken first).
  const groups = new Map<string, { name: string; findings: DataHealthFinding[] }>();
  for (const finding of report.findings) {
    const group = groups.get(finding.documentId) ?? { name: finding.documentName, findings: [] };
    group.findings.push(finding);
    groups.set(finding.documentId, group);
  }

  for (const [documentId, group] of groups) {
    const section = document.createElement('section');
    section.className = 'knowledge-data-health-group';
    const heading = document.createElement('h3');
    heading.textContent = group.name;
    heading.title = group.name;
    section.append(heading);

    for (const finding of group.findings) {
      const row = document.createElement('div');
      row.className = `knowledge-data-health-row is-${finding.severity}`;
      row.dataset.kind = finding.kind;

      const badge = document.createElement('span');
      badge.className = 'knowledge-data-health-badge';
      badge.textContent = severityLabel(finding);
      row.append(badge);

      const text = document.createElement('div');
      text.className = 'knowledge-data-health-text';
      const message = document.createElement('p');
      message.textContent = finding.message;
      text.append(message);
      const result = document.createElement('p');
      result.className = 'knowledge-data-health-result';
      result.hidden = true;
      text.append(result);
      row.append(text);

      if (finding.fix === 'manual') {
        const hint = document.createElement('span');
        hint.className = 'knowledge-data-health-hint';
        hint.textContent = finding.fixLabel;
        row.append(hint);
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'knowledge-data-health-fix';
        button.textContent = finding.costsMoney ? `${finding.fixLabel}（计费）` : finding.fixLabel;
        button.addEventListener('click', () => {
          void applyFix(finding, documentId, row, result, button);
        });
        row.append(button);
      }
      section.append(row);
    }
    container.append(section);
  }
}

async function applyFix(
  finding: DataHealthFinding,
  _documentId: string,
  row: HTMLElement,
  result: HTMLElement,
  button: HTMLButtonElement,
): Promise<void> {
  if (!handlers || busy) return;
  busy = true;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = '处理中…';
  try {
    const chunkCount = lastReport?.chunkCounts?.get(finding.documentId) ?? null;
    const message = await handlers.fix(finding, chunkCount);
    result.textContent = message;
    result.hidden = !message;
    // The finding is re-derived from storage rather than removed optimistically: a fix that did not change the
    // underlying data must come back as the same row, not vanish from the list.
    const report = await handlers.rescan();
    renderDataHealth(report);
  } catch (error) {
    result.textContent = `修复失败：${error instanceof Error ? error.message : String(error)}`;
    result.hidden = false;
    button.disabled = false;
    button.textContent = original ?? '重试';
    row.classList.add('is-failed');
  } finally {
    busy = false;
  }
}

/** Renders a report into the dialog (and the sidebar badge). */
export function renderDataHealth(report: DataHealthReport): void {
  lastReport = report;
  const summaryElement = summary();
  if (summaryElement) {
    summaryElement.textContent = report.total
      ? `发现 ${report.total} 处问题${report.broken ? `，其中 ${report.broken} 处会让功能不可用` : ''}。每一处都单独修。`
      : '没有发现问题。';
  }
  renderRows(report);
  renderDataHealthBadge(report);
}

export function hideDataHealthStatus(): void {
  const element = status();
  if (!element) return;
  element.hidden = true;
  element.textContent = '';
}

export function showDataHealthStatus(message: string, isError = false): void {
  const element = status();
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('is-error', isError);
}

/** Opens the dialog with the current report (the caller has already run the check). */
export function openDataHealthDialog(report: DataHealthReport): void {
  renderDataHealth(report);
  hideDataHealthStatus();
  const element = dialog();
  if (element) showAnimatedDialog(element);
}

export function registerDataHealthDialogEvents(onRescan: () => void): void {
  const element = dialog();
  if (!element) return;
  const close = () => element.close();
  document.getElementById('knowledge-data-health-close')?.addEventListener('click', close);
  document.getElementById('knowledge-data-health-done')?.addEventListener('click', close);
  element.addEventListener('click', (event) => {
    // Clicking the backdrop closes it, like every other dialog in this app.
    if (event.target === element) close();
  });
  document.getElementById('knowledge-data-health-rescan')?.addEventListener('click', onRescan);
}
