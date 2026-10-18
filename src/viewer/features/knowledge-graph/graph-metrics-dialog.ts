import {
  computeGraphMetrics,
  formatGraphMetrics,
  suggestGraphImprovements,
  type GraphEdge,
  type GraphEntity,
  type GraphMetrics,
  type GraphPaper,
} from '../../../modules/knowledge-graph/public';
import { showAnimatedDialog, dismissAnimatedDialog } from '../../shared-ui/dialog/dialog-motion';
import {
  knowledgeGraphMetricsBodyElement,
  knowledgeGraphMetricsCloseButton,
  knowledgeGraphMetricsCopyButton,
  knowledgeGraphMetricsDialog,
  knowledgeGraphMetricsDoneButton,
  knowledgeGraphMetricsNoteElement,
  knowledgeGraphMetricsSummaryElement,
} from '../../app/viewer-elements';
import { setStatus } from '../../app/status-bar';

/**
 * Graph quality statistics dialog.
 *
 * The feature costs tokens, so it has to be able to show whether that spending
 * produced anything. The dialog is deliberately a read-only report: every number
 * is computed from the stored records on open, which is why there is no "refresh"
 * button — reopening it is the refresh.
 *
 * The snapshot is supplied by the controller rather than read here, because the
 * controller is the only place that knows how to build the personal layer (notes,
 * highlights, folders, tags); without it the user-origin edge counts would read
 * as zero.
 */

export interface GraphMetricsSource {
  papers: GraphPaper[];
  entities: GraphEntity[];
  edges: GraphEdge[];
}

let lastReport = '';

/** True when any rate had no sample to compute from. */
function hasUndefinedRate(metrics: GraphMetrics): boolean {
  return metrics.funnel.adoptionRate === null
    || metrics.reuse.reuseRate === null
    || metrics.edges.evidenceRate === null;
}

function buildReportText(metrics: GraphMetrics): string {
  const lines = formatGraphMetrics(metrics);
  const suggestions = suggestGraphImprovements(metrics);
  const parts = [...lines];
  if (suggestions.length) {
    parts.push('', '建议：', ...suggestions.map((line) => `- ${line}`));
  }
  return parts.join('\n');
}

function buildSection(title: string, items: string[], className: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'knowledge-graph-metrics-section';

  const heading = document.createElement('h3');
  heading.className = 'knowledge-graph-metrics-section-title';
  heading.textContent = title;
  section.append(heading);

  const list = document.createElement('ul');
  list.className = `knowledge-graph-metrics-list ${className}`;
  for (const item of items) {
    const row = document.createElement('li');
    row.className = 'knowledge-graph-metrics-row';
    row.textContent = item;
    list.append(row);
  }
  section.append(list);
  return section;
}

function render(metrics: GraphMetrics): void {
  const lines = formatGraphMetrics(metrics);
  const suggestions = suggestGraphImprovements(metrics);
  const nodes: HTMLElement[] = [buildSection('指标', lines, 'knowledge-graph-metrics-numbers')];

  if (suggestions.length) {
    nodes.push(buildSection('改进建议', suggestions, 'knowledge-graph-metrics-advice'));
  } else {
    const healthy = document.createElement('p');
    healthy.className = 'knowledge-graph-review-empty';
    // Said explicitly, because an empty advice list is otherwise ambiguous
    // between "nothing to fix" and "the check did not run".
    healthy.textContent = metrics.scale.papers
      ? '按当前指标没有需要调整的地方。'
      : '图谱还是空的：先让文献进入知识库，再回到这里看统计。';
    nodes.push(healthy);
  }

  knowledgeGraphMetricsBodyElement.replaceChildren(...nodes);

  knowledgeGraphMetricsSummaryElement.textContent = metrics.scale.papers
    ? `${metrics.scale.papers} 篇文献、${metrics.scale.entities} 个实体、${metrics.edges.total} 条边`
    : '暂无可统计的内容';
  knowledgeGraphMetricsNoteElement.textContent = hasUndefinedRate(metrics)
    ? '比例显示为「—」表示还没有样本可算，不是 0%。'
    : '';
}

export function isGraphMetricsOpen(): boolean {
  return knowledgeGraphMetricsDialog.open;
}

/** Opens the report for a snapshot. Cheap: it only reads what it is given. */
export function openGraphMetricsDialog(source: GraphMetricsSource): void {
  const metrics = computeGraphMetrics(source.papers, source.entities, source.edges);
  lastReport = buildReportText(metrics);
  render(metrics);
  showAnimatedDialog(knowledgeGraphMetricsDialog);
}

function close(): void {
  dismissAnimatedDialog(knowledgeGraphMetricsDialog);
}

async function copyReport(): Promise<void> {
  if (!lastReport) return;
  try {
    await navigator.clipboard.writeText(lastReport);
    setStatus('已复制统计报告。');
  } catch {
    // Clipboard access can be refused; the report stays on screen, so this is a
    // convenience failing, not the feature failing.
    setStatus('复制失败：浏览器拒绝了剪贴板访问。', true);
  }
}

export function registerGraphMetricsEvents(): void {
  knowledgeGraphMetricsCopyButton.addEventListener('click', () => {
    void copyReport();
  });
  knowledgeGraphMetricsDoneButton.addEventListener('click', close);
  knowledgeGraphMetricsCloseButton.addEventListener('click', close);

  knowledgeGraphMetricsDialog.addEventListener('cancel', (event) => {
    // Closing is always the whole result here, so the default escape-to-close
    // behaviour needs no interception beyond the animation.
    event.preventDefault();
    close();
  });
}
