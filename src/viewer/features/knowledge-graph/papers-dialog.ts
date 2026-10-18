import { showAnimatedDialog, dismissAnimatedDialog } from '../../shared-ui/dialog/dialog-motion';
import {
  knowledgeGraphPapersCloseButton,
  knowledgeGraphPapersDialog,
  knowledgeGraphPapersGroupsElement,
  knowledgeGraphPapersLaterButton,
  knowledgeGraphPapersLibraryButton,
  knowledgeGraphPapersSelectionElement,
  knowledgeGraphPapersSummaryElement,
} from '../../app/viewer-elements';

/**
 * The knowledge base's documents as the graph sees them — **read-only**.
 *
 * This dialog exists because the canvas cannot answer this question: a document with no
 * relations has no node, so there is nowhere to click to learn that it is in the graph and
 * contributes nothing. The list is the only surface that shows every paper, connected or not.
 *
 * It holds no actions on purpose. The graph projects the knowledge base, so a paper leaves the
 * graph for exactly one reason — it left the knowledge base — and offering a second way to
 * remove it here is what produced two contradictory answers to "is this paper in the graph?".
 * The only button besides closing is a way to get to the place where deleting is legitimate.
 */

export interface PapersDialogPaper {
  paperId: string;
  title: string;
  /** Knowledge-base indexing state: an unindexed document has no chunks to extract from. */
  indexStatus?: 'pending' | 'indexing' | 'ready' | 'error';
  indexError?: string;
}

export interface PapersDialogInput {
  /** Papers currently in the graph (already exactly the knowledge base's members). */
  papers: readonly PapersDialogPaper[];
  /** Relations per paper id, so "this one contributes nothing" is visible. */
  relationCounts: ReadonlyMap<string, number>;
  /** Leaves the dialog and opens the knowledge base page. */
  openKnowledgeBase(): void;
}

const INDEX_LABELS: Record<NonNullable<PapersDialogPaper['indexStatus']>, string> = {
  pending: '索引待建立',
  indexing: '正在建立索引',
  ready: '',
  error: '索引失败',
};

function buildRow(title: string, meta: string): HTMLElement {
  const row = document.createElement('li');
  row.className = 'knowledge-graph-review-row knowledge-graph-papers-row';

  const body = document.createElement('div');
  body.className = 'knowledge-graph-review-row-body knowledge-graph-papers-body';

  const name = document.createElement('div');
  name.className = 'knowledge-graph-papers-text';
  name.textContent = title;
  body.append(name);

  if (meta) {
    const detail = document.createElement('div');
    detail.className = 'knowledge-graph-review-row-meta';
    detail.textContent = meta;
    body.append(detail);
  }

  row.append(body);
  return row;
}

/** The relation count first: it is what decides whether the paper is visible on the canvas. */
function describePaper(paper: PapersDialogPaper, relations: number): string {
  const parts = [
    relations ? `${relations} 条关系` : '还没有任何关系（所以画布上没有它的节点）',
  ];
  const indexLabel = paper.indexStatus ? INDEX_LABELS[paper.indexStatus] : '';
  if (indexLabel) {
    parts.push(paper.indexError ? `${indexLabel}：${paper.indexError}` : indexLabel);
  }
  return parts.join(' · ');
}

function buildSection(title: string, rows: HTMLElement[], emptyText: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'knowledge-graph-review-group';

  const heading = document.createElement('header');
  heading.className = 'knowledge-graph-review-group-heading';
  const text = document.createElement('h3');
  text.textContent = title;
  heading.append(text);
  section.append(heading);

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'knowledge-graph-review-empty';
    empty.textContent = emptyText;
    section.append(empty);
    return section;
  }
  const list = document.createElement('ul');
  list.className = 'knowledge-graph-review-list';
  list.append(...rows);
  section.append(list);
  return section;
}

let state: PapersDialogInput | null = null;

export function isPapersDialogOpen(): boolean {
  return knowledgeGraphPapersDialog.open;
}

function render(): void {
  if (!state) return;
  const rows = state.papers.map((paper) => buildRow(
    paper.title || '（未命名文献）',
    describePaper(paper, state?.relationCounts.get(paper.paperId) ?? 0),
  ));
  knowledgeGraphPapersGroupsElement.replaceChildren(buildSection(
    `知识库中的文献（${state.papers.length}）`,
    rows,
    '知识库还是空的：打开 PDF 后点「添加到知识库」，它才会进入图谱。',
  ));

  const unconnected = state.papers.filter(
    (paper) => (state?.relationCounts.get(paper.paperId) ?? 0) === 0,
  ).length;
  knowledgeGraphPapersSelectionElement.textContent = unconnected
    ? `${state.papers.length} 篇在图谱中，其中 ${unconnected} 篇还没有任何关系`
    : `${state.papers.length} 篇在图谱中`;
  knowledgeGraphPapersSummaryElement.textContent = state.papers.length
    ? `共 ${state.papers.length} 篇；这些就是知识库里的全部文献`
    : '图谱里还没有文献';
}

function close(): void {
  state = null;
  dismissAnimatedDialog(knowledgeGraphPapersDialog);
}

export function openPapersDialog(input: PapersDialogInput): void {
  state = input;
  render();
  showAnimatedDialog(knowledgeGraphPapersDialog);
}

export function registerPapersDialogEvents(): void {
  knowledgeGraphPapersLaterButton.addEventListener('click', close);
  knowledgeGraphPapersCloseButton.addEventListener('click', close);
  knowledgeGraphPapersLibraryButton.addEventListener('click', () => {
    const open = state?.openKnowledgeBase;
    close();
    // Closing first: the knowledge base page replaces the workspace, and a dialog left open
    // on a replaced page is a modal the user cannot reach.
    open?.();
  });
  knowledgeGraphPapersDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
}
