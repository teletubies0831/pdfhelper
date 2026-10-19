import {
  buildAdjacency,
  describeEdgeType,
  isRenderableEdge,
  type GraphEdge,
  type GraphEntity,
  type GraphNodeKind,
  type GraphPaper,
  type GraphSnapshot,
} from '../../../modules/knowledge-graph/public';
import { describeEdgeOrigin, describeEdgeOriginDetail } from './graph-theme';
import {
  knowledgeGraphInspectorBodyElement,
  knowledgeGraphInspectorEmptyElement,
} from '../../app/viewer-elements';

export interface InspectorActions {
  /** Opens the paper's source PDF at the given page, highlighting `quote` when given. */
  openPaperSource(paper: GraphPaper, pageNumber?: number, quote?: string): void;
  /** Focuses the graph on a node. */
  focusNode(nodeId: string, kind: 'paper' | 'entity'): void;
  /**
   * Asks the model about one existing paper pair again, replacing its conclusion.
   *
   * A stored conclusion is also the cache, so this is the only way to correct a
   * verdict. It is deliberately an explicit per-edge action rather than a side
   * effect of re-running the batch: a whole run costs tokens the user did not ask
   * for, while one pair costs almost nothing.
   */
  rejudgeRelation(leftPaperId: string, rightPaperId: string): void;
  /**
   * Asks the model for (or re-asks for) one entity's one-line meaning.
   *
   * The inspector is where a reader asks "what is this node?", so it is also where the answer is
   * missing when the confirm-time call failed or the entity predates the feature.
   */
  explainEntity(entityName: string): void;
  /**
   * Deletes one entity **and every edge that touches it**.
   *
   * Only entities: a paper node is a knowledge-base projection, so removing it here would disagree with
   * the knowledge base until the next sync put it back. The action is offered only by the entity
   * inspector, and the module refuses a paper id even if one arrives.
   */
  deleteEntity(entityId: string, entityName: string): void;
}

function appendMetaRow(
  container: HTMLElement,
  label: string,
  value: string,
): void {
  if (!value.trim()) return;
  const row = document.createElement('div');
  row.className = 'knowledge-graph-meta-row';
  const key = document.createElement('span');
  key.className = 'knowledge-graph-meta-key';
  key.textContent = label;
  const text = document.createElement('span');
  text.className = 'knowledge-graph-meta-value';
  text.textContent = value;
  row.append(key, text);
  container.append(row);
}

function appendSectionTitle(container: HTMLElement, title: string): void {
  const heading = document.createElement('h3');
  heading.className = 'knowledge-graph-inspector-heading';
  heading.textContent = title;
  container.append(heading);
}

function createActionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'knowledge-graph-action';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

export function clearInspector(): void {
  knowledgeGraphInspectorBodyElement.hidden = true;
  knowledgeGraphInspectorBodyElement.replaceChildren();
  knowledgeGraphInspectorEmptyElement.hidden = false;
}

/**
 * Replaces the meaning paragraph's text while the answer streams in.
 *
 * Patches the one node instead of re-rendering the panel: at a few chunks per second a full re-render
 * would rebuild every button in the inspector on each chunk, and a half-typed sentence is not a
 * structural change. Returns false when the paragraph is not on screen (the user moved to another
 * node mid-stream), which tells the caller to fall back to a normal refresh.
 */
export function updateExplanationPreview(text: string): boolean {
  const node = knowledgeGraphInspectorBodyElement.querySelector('[data-explanation-text]');
  if (!node) return false;
  node.textContent = text || '正在生成…';
  return true;
}

function beginInspector(): HTMLElement {
  knowledgeGraphInspectorEmptyElement.hidden = true;
  knowledgeGraphInspectorBodyElement.hidden = false;
  knowledgeGraphInspectorBodyElement.replaceChildren();
  return knowledgeGraphInspectorBodyElement;
}

/** Renders a paper node: bibliographic projection plus its graph neighbourhood. */
export function renderPaperInspector(
  paper: GraphPaper,
  snapshot: GraphSnapshot,
  actions: InspectorActions,
): void {
  const container = beginInspector();

  const title = document.createElement('h2');
  title.className = 'knowledge-graph-inspector-title';
  title.textContent = paper.title;
  container.append(title);

  const kind = document.createElement('p');
  kind.className = 'knowledge-graph-inspector-kind';
  kind.textContent = '文献节点';
  container.append(kind);

  const meta = document.createElement('div');
  meta.className = 'knowledge-graph-meta';
  appendMetaRow(meta, '年份', paper.year === null ? '' : String(paper.year));
  appendMetaRow(meta, '作者', paper.authors.join('、'));
  appendMetaRow(meta, '来源', paper.venue);
  appendMetaRow(meta, 'DOI', paper.doi);
  appendMetaRow(
    meta,
    '抽取状态',
    paper.extractionStatus === 'ready' ? '已完成' : '尚未抽取',
  );
  container.append(meta);

  if (paper.abstract.trim()) {
    appendSectionTitle(container, '摘要');
    const abstract = document.createElement('p');
    abstract.className = 'knowledge-graph-inspector-text';
    abstract.textContent = paper.abstract;
    container.append(abstract);
  }

  const adjacency = buildAdjacency(snapshot.edges);
  const connected = adjacency.get(`paper:${paper.paperId}`) ?? [];
  const entityNames = new Map(snapshot.entities.map((entity) => [entity.entityId, entity.name]));
  const papersById = new Map(snapshot.papers.map((item) => [item.paperId, item]));

  const entityLinks = connected
    .filter((edge) => edge.targetKind === 'entity' || edge.sourceKind === 'entity')
    .map((edge) => (edge.sourceKind === 'entity' ? edge.source : edge.target))
    .filter((id, index, all) => all.indexOf(id) === index);

  if (entityLinks.length) {
    appendSectionTitle(container, `关联实体（${entityLinks.length}）`);
    const list = document.createElement('ul');
    list.className = 'knowledge-graph-link-list';
    for (const entityId of entityLinks) {
      const item = document.createElement('li');
      item.append(createActionButton(
        entityNames.get(entityId) ?? entityId,
        () => actions.focusNode(entityId, 'entity'),
      ));
      list.append(item);
    }
    container.append(list);
  }

  // Papers that share an entity are two hops away; surfacing them here is the
  // visible payoff of the shared-entity mechanism.
  const indirect = connected
    .filter((edge) => edge.targetKind === 'entity' || edge.sourceKind === 'entity')
    .map((edge) => (edge.sourceKind === 'entity' ? edge.target : edge.source))
    .filter((entityId) => entityId !== paper.paperId)
    .flatMap((entityId) => adjacency.get(`entity:${entityId}`) ?? [])
    .map((edge) => (edge.sourceKind === 'paper' ? edge.source : edge.target))
    .filter((paperId) => paperId !== paper.paperId && papersById.has(paperId))
    .filter((id, index, all) => all.indexOf(id) === index);

  if (indirect.length) {
    appendSectionTitle(container, `共享实体相连的文献（${indirect.length}）`);
    const list = document.createElement('ul');
    list.className = 'knowledge-graph-link-list';
    for (const paperId of indirect) {
      const item = document.createElement('li');
      const target = papersById.get(paperId)!;
      const button = createActionButton(
        target.title,
        () => actions.focusNode(paperId, 'paper'),
      );
      button.title = target.title;
      item.append(button);
      list.append(item);
    }
    container.append(list);
  }

  // A recorded "no relation" verdict is a cache entry, so it never draws — which would leave the
  // pair unreachable and the 「重新判断」 action pointless for exactly the conclusion a user is most
  // likely to disagree with. The paper inspector is where it surfaces instead.
  const judgedUnrelated = connected
    .filter((edge) => (
      !isRenderableEdge(edge) && edge.sourceKind === 'paper' && edge.targetKind === 'paper'
    ))
    .map((edge) => (edge.source === paper.paperId ? edge.target : edge.source))
    .filter((paperId) => paperId !== paper.paperId && papersById.has(paperId))
    .filter((id, index, all) => all.indexOf(id) === index);

  if (judgedUnrelated.length) {
    appendSectionTitle(container, `已判断无关系的文献（${judgedUnrelated.length}）`);
    const note = document.createElement('p');
    note.className = 'knowledge-graph-inspector-note';
    note.textContent = '这些结论不画在图上（「无关系」不是一条关系，只是缓存的判断结果）。不同意可以重新判断。';
    container.append(note);

    const list = document.createElement('ul');
    list.className = 'knowledge-graph-link-list knowledge-graph-paper-rows';
    for (const paperId of judgedUnrelated) {
      const target = papersById.get(paperId)!;
      const item = document.createElement('li');
      item.className = 'knowledge-graph-paper-row';

      const button = createActionButton(
        target.year ? `${target.title}（${target.year}）` : target.title,
        () => actions.focusNode(paperId, 'paper'),
      );
      button.title = target.title;
      item.append(
        button,
        createActionButton('重新判断', () => actions.rejudgeRelation(paper.paperId, paperId)),
      );
      list.append(item);
    }
    container.append(list);
  }

  const actionsRow = document.createElement('div');
  actionsRow.className = 'knowledge-graph-inspector-actions';
  actionsRow.append(createActionButton('跳回原文', () => actions.openPaperSource(paper)));
  actionsRow.append(createActionButton('以此为焦点', () => actions.focusNode(paper.paperId, 'paper')));
  container.append(actionsRow);
}

/** What the inspector shows while (or after) one entity's meaning is generated. */
export interface ExplanationProgress {
  entityName: string;
  /** Text received so far. */
  text: string;
  /** True while the stream is open. */
  busy: boolean;
  /** Why the last attempt failed, if it did. */
  error?: string;
}

export function renderEntityInspector(
  entity: GraphEntity,
  snapshot: GraphSnapshot,
  actions: InspectorActions,
  progress?: ExplanationProgress | null,
): void {
  const container = beginInspector();

  const title = document.createElement('h2');
  title.className = 'knowledge-graph-inspector-title';
  title.textContent = entity.name;
  container.append(title);

  const kind = document.createElement('p');
  kind.className = 'knowledge-graph-inspector-kind';
  kind.textContent = `实体节点 · ${entity.type}`;
  container.append(kind);

  const meta = document.createElement('div');
  meta.className = 'knowledge-graph-meta';
  appendMetaRow(meta, '置信度', entity.confidence.toFixed(2));
  appendMetaRow(meta, '别名', entity.aliases.join('、'));
  appendMetaRow(meta, '状态', entity.status === 'confirmed' ? '已确认' : '待确认');
  container.append(meta);

  const adjacency = buildAdjacency(snapshot.edges);
  const connected = adjacency.get(`entity:${entity.entityId}`) ?? [];
  const papersById = new Map(snapshot.papers.map((paper) => [paper.paperId, paper]));
  const relatedPaperIds = connected
    .filter((edge) => edge.sourceKind === 'paper' || edge.targetKind === 'paper')
    .map((edge) => (edge.sourceKind === 'paper' ? edge.source : edge.target))
    .filter((id) => papersById.has(id))
    .filter((id, index, all) => all.indexOf(id) === index);

  if (relatedPaperIds.length) {
    appendSectionTitle(container, `相关论文（${relatedPaperIds.length}）`);

    // Each paper row carries its own "jump to source" action rather than only a
    // bulk button. The page an entity appears on is the whole reason a reader
    // follows this edge, so it must be one click from the row that names the
    // paper — the bulk action below only exists for the common single-paper case.
    const list = document.createElement('ul');
    list.className = 'knowledge-graph-link-list knowledge-graph-paper-rows';
    for (const paperId of relatedPaperIds) {
      const paper = papersById.get(paperId)!;
      const item = document.createElement('li');
      item.className = 'knowledge-graph-paper-row';

      const button = createActionButton(
        paper.year ? `${paper.title}（${paper.year}）` : paper.title,
        () => actions.focusNode(paperId, 'paper'),
      );
      button.title = paper.title;

      // The first page where this entity is evidenced in that paper, so the jump
      // lands on the sentence rather than on page 1.
      const evidence = entity.evidence.find((entry) => entry.paperId === paperId && entry.quote);
      const jump = createActionButton(
        evidence ? `跳回原文 第 ${evidence.pageNumber} 页` : '跳回原文',
        () => actions.openPaperSource(paper, evidence?.pageNumber),
      );

      item.append(button, jump);
      list.append(item);
    }
    container.append(list);
  }

  appendSectionTitle(container, '含义');
  const description = (entity.description ?? '').trim();
  const live = progress && progress.entityName === entity.name ? progress : null;

  if (live?.busy) {
    // Streaming: the sentence is written into this paragraph as it arrives (via
    // `updateExplanationPreview`), so the click has visible effect from the first chunk. The button
    // is disabled and relabelled — a live-looking button that quietly does nothing is exactly the
    // state this replaced.
    const text = document.createElement('p');
    text.className = 'knowledge-graph-inspector-text';
    text.dataset.explanationText = '';
    text.textContent = live.text || '正在生成…';
    const actionsRow = document.createElement('div');
    actionsRow.className = 'knowledge-graph-inspector-actions';
    const busy = createActionButton('生成中…', () => undefined);
    busy.disabled = true;
    busy.title = '正在让模型读原文，稍等片刻';
    actionsRow.append(busy);
    container.append(text, actionsRow);
  } else if (description) {
    const text = document.createElement('p');
    text.className = 'knowledge-graph-inspector-text';
    text.dataset.explanationText = '';
    text.textContent = description;
    const actionsRow = document.createElement('div');
    actionsRow.className = 'knowledge-graph-inspector-actions';
    const regenerate = createActionButton('重新生成解释', () => actions.explainEntity(entity.name));
    regenerate.title = '让模型重新读一遍原文，再写一句解释（会替换当前这句）';
    actionsRow.append(regenerate);
    container.append(text, actionsRow);
  } else {
    // No explanation yet: the entity predates the feature, the confirm-time call failed, or the last
    // attempt errored — and the failure text is shown here, next to the button that failed, because
    // the status bar is far away from where the user is looking.
    const note = document.createElement('p');
    note.className = 'knowledge-graph-inspector-note';
    note.dataset.explanationText = '';
    note.textContent = live?.error
      ? `生成失败：${live.error}`
      : '还没有解释。可以让模型结合这篇论文的原文写一句。';
    const actionsRow = document.createElement('div');
    actionsRow.className = 'knowledge-graph-inspector-actions';
    const generate = createActionButton('生成解释', () => actions.explainEntity(entity.name));
    generate.title = '用 AI 结合原文生成一句简短解释（会消耗少量 Token）';
    actionsRow.append(generate);
    container.append(note, actionsRow);
  }

  if (entity.evidence.length) {
    appendSectionTitle(container, '原文证据');
    container.append(buildEvidenceList(entity.evidence, papersById, actions));
  }

  // Deleting a node is the one destructive action in this panel, so it sits last, on its own row, in
  // the destructive style: it must be findable but never the thing the thumb lands on.
  appendSectionTitle(container, '维护');
  const danger = document.createElement('div');
  danger.className = 'knowledge-graph-inspector-actions';
  const remove = createActionButton(
    '删除这个节点',
    () => actions.deleteEntity(entity.entityId, entity.name),
  );
  remove.classList.add('knowledge-graph-action-danger');
  remove.title = '删除该实体以及它的全部连线（论文节点由知识库管理，不在这里删除）';
  danger.append(remove);
  container.append(danger);
}

export function renderEdgeInspector(
  edge: GraphEdge,
  snapshot: GraphSnapshot,
  actions: InspectorActions,
): void {
  const container = beginInspector();

  const title = document.createElement('h2');
  title.className = 'knowledge-graph-inspector-title';
  // The canvas no longer writes the relation on the line, so this is where it is read: the label
  // first, the stored value in brackets for traceability.
  title.textContent = describeEdgeType(edge.type);
  container.append(title);

  const kind = document.createElement('p');
  kind.className = 'knowledge-graph-inspector-kind';
  kind.textContent = `${describeEdgeOrigin(edge.origin)} · 置信度 ${edge.confidence.toFixed(2)}`;
  container.append(kind);

  const originNote = document.createElement('p');
  originNote.className = 'knowledge-graph-inspector-note';
  originNote.textContent = describeEdgeOriginDetail(edge.origin);
  container.append(originNote);

  const papersById = new Map(snapshot.papers.map((paper) => [paper.paperId, paper]));
  const entitiesById = new Map(snapshot.entities.map((entity) => [entity.entityId, entity]));

  /**
   * Human label for an edge endpoint.
   *
   * Personal nodes (notes, highlights, folders, tags, the user anchor) are not in
   * the snapshot's paper or entity lists, so they get a descriptive fallback
   * rather than a raw id — an edge inspector that says
   * `folder:9f2c… -> paper:1a3b…` explains nothing.
   */
  const labelOf = (kindValue: GraphNodeKind, id: string): string => {
    if (kindValue === 'paper') return papersById.get(id)?.title ?? id;
    if (kindValue === 'entity') return entitiesById.get(id)?.name ?? id;
    if (kindValue === 'user') return '我的标注';
    return id.replace(/^(note|highlight|folder|tag):/, '');
  };
  const kindLabel = (kindValue: GraphNodeKind): string => {
    switch (kindValue) {
      case 'paper': return '文献';
      case 'entity': return '实体';
      case 'note': return '笔记';
      case 'highlight': return '高亮';
      case 'folder': return '文件夹';
      case 'tag': return '标签';
      default: return '我的标注';
    }
  };

  const meta = document.createElement('div');
  meta.className = 'knowledge-graph-meta';
  appendMetaRow(meta, '起点', `${labelOf(edge.sourceKind, edge.source)}（${kindLabel(edge.sourceKind)}）`);
  appendMetaRow(meta, '终点', `${labelOf(edge.targetKind, edge.target)}（${kindLabel(edge.targetKind)}）`);
  appendMetaRow(
    meta,
    '来源论文',
    edge.sourcePaperId ? papersById.get(edge.sourcePaperId)?.title ?? edge.sourcePaperId : '（规则推导，无来源论文）',
  );
  appendMetaRow(meta, '创建时间', new Date(edge.createdAt).toLocaleString());
  if (edge.provenance.model) appendMetaRow(meta, '模型', edge.provenance.model);
  if (edge.provenance.promptVersion) {
    appendMetaRow(meta, '提示词版本', edge.provenance.promptVersion);
  }
  container.append(meta);

  // Only a paper-to-paper edge is a model verdict, so only that kind can be re-judged.
  // Shared-entity bridges are rule-derived and have nothing to re-ask about.
  if (edge.sourceKind === 'paper' && edge.targetKind === 'paper') {
    const note = document.createElement('p');
    note.className = 'knowledge-graph-inspector-note';
    note.textContent = '不满意这条结论？可以让模型重新判断这一对文献（会消耗少量 Token，新结论会替换旧结论）。';
    container.append(note);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'knowledge-graph-inspector-actions';
    const rejudge = createActionButton('重新判断', () => (
      actions.rejudgeRelation(edge.source, edge.target)
    ));
    rejudge.title = `重新判断「${labelOf('paper', edge.source)}」与「${labelOf('paper', edge.target)}」的关系`;
    actionsRow.append(rejudge);
    container.append(actionsRow);
  }

  appendSectionTitle(container, '原文证据');
  if (edge.evidence.length) {
    container.append(buildEvidenceList(edge.evidence, papersById, actions));
  } else {
    const empty = document.createElement('p');
    empty.className = 'knowledge-graph-inspector-note';
    empty.textContent = edge.origin === 'rule'
      ? '这条边由本地规则推导得出，没有原文证据。'
      : '这条边没有记录原文证据。';
    container.append(empty);
  }
}

function buildEvidenceList(
  evidence: GraphEdge['evidence'],
  papersById: Map<string, GraphPaper>,
  actions: InspectorActions,
): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'knowledge-graph-evidence-list';
  for (const item of evidence) {
    const listItem = document.createElement('li');
    const quote = document.createElement('blockquote');
    quote.className = 'knowledge-graph-evidence-quote';
    quote.textContent = item.quote;
    listItem.append(quote);

    const paper = papersById.get(item.paperId);
    // Evidence can come from an abstract or an overview rather than a page of the PDF (bridge concepts
    // are verified against the excerpt that was sent), so `pageNumber: 0` means "no page" — printing
    // 「第 0 页」 would send the reader looking for a page that cannot exist.
    const fromDocument = item.pageNumber > 0;
    const source = document.createElement('div');
    source.className = 'knowledge-graph-evidence-source';
    source.textContent = `${paper?.title ?? item.paperId} · `
      + (fromDocument ? `第 ${item.pageNumber} 页` : '摘要');
    listItem.append(source);

    if (paper) {
      const actionsRow = document.createElement('div');
      actionsRow.className = 'knowledge-graph-inspector-actions';
      actionsRow.append(createActionButton(
        fromDocument ? `跳回原文 第 ${item.pageNumber} 页` : '打开该文献',
        () => actions.openPaperSource(paper, fromDocument ? item.pageNumber : undefined, item.quote),
      ));
      listItem.append(actionsRow);
    }
    list.append(listItem);
  }
  return list;
}
