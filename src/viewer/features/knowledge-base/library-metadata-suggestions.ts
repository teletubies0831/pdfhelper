import type { KnowledgeLibraryDocument, MetadataCandidate } from '../../../modules/knowledge/public';
import {
  knowledgeDocMetadataOnlineButton,
  knowledgeDocMetadataSuggestionListElement,
  knowledgeDocMetadataSuggestionsElement,
  knowledgeDocMetadataSuggestionsNoteElement,
} from '../../app/elements/knowledge-elements';
import { readMetadataLookupState } from './metadata-lookup';

/**
 * 联网查找的结果列表.
 *
 * Extracted from the inspector: the panel was over its size limit, and this block answers a different question — "what
 * did the databases say, and should I take it?" — than the rest of the panel ("what does the record contain?").
 *
 * The two things it must keep doing: show accepted candidates with a 填入 button and refused ones with the reason they
 * were refused (never a button), and show the 出版信息 that will be written, because that is what a GB/T citation is
 * missing when a record has only a DOI.
 */

/** How many rows the panel shows. More than three and it stops being a panel. */
const MAX_SUGGESTIONS_SHOWN = 3;

export interface SuggestionListPorts {
  apply(documentId: string, candidate: MetadataCandidate): void;
  dismiss(documentId: string): void;
}

/** Renders the current lookup state for one document into the panel's suggestion area. */
export function renderMetadataSuggestions(item: KnowledgeLibraryDocument, ports: SuggestionListPorts): void {
  const state = readMetadataLookupState(item.documentId);
  const accepting = state.suggestions.filter((suggestion) => suggestion.accepted).slice(0, MAX_SUGGESTIONS_SHOWN);
  const refused = state.suggestions.filter((suggestion) => !suggestion.accepted).slice(0, 1);
  const visible = [...accepting, ...refused];

  knowledgeDocMetadataOnlineButton.textContent = state.running ? '查找中…' : '联网查找';
  knowledgeDocMetadataOnlineButton.disabled = state.running;
  knowledgeDocMetadataOnlineButton.title = state.running
    ? '正在向 Crossref / OpenAlex 发送标题'
    : '只在点击时联网：把标题发给 Crossref 与 OpenAlex（免费、不需要 Key）';

  knowledgeDocMetadataSuggestionsElement.hidden = !state.running && !state.lookedUp && !visible.length;
  if (knowledgeDocMetadataSuggestionsElement.hidden) {
    knowledgeDocMetadataSuggestionListElement.replaceChildren();
    return;
  }
  knowledgeDocMetadataSuggestionsNoteElement.textContent = state.running
    ? '正在查找 Crossref / OpenAlex…'
    : state.message;

  knowledgeDocMetadataSuggestionListElement.replaceChildren(...visible.map((suggestion) => {
    const row = document.createElement('li');
    row.className = 'knowledge-doc-suggestion';
    row.dataset.accepted = suggestion.accepted ? 'true' : 'false';

    const title = document.createElement('span');
    title.className = 'knowledge-doc-suggestion-title';
    title.textContent = suggestion.candidate.title;
    row.append(title);

    const meta = document.createElement('span');
    meta.className = 'knowledge-doc-suggestion-meta';
    meta.textContent = [
      suggestion.candidate.publishDate,
      suggestion.candidate.authors.slice(0, 2).join('、'),
      suggestion.candidate.source === 'crossref' ? 'Crossref' : 'OpenAlex',
      suggestion.candidate.doi,
    ].filter(Boolean).join(' · ');
    row.append(meta);

    // 出版信息单独一行：这是 GB/T 引用里最缺的部分，用户需要先看到「会填入什么」再决定点不点「填入」。
    const publication = [
      suggestion.candidate.containerTitle,
      suggestion.candidate.publishDate.slice(0, 4),
      suggestion.candidate.volume && suggestion.candidate.issue
        ? `${suggestion.candidate.volume}(${suggestion.candidate.issue})`
        : suggestion.candidate.volume || '',
      suggestion.candidate.page,
      suggestion.candidate.publisher,
    ].filter(Boolean).join(' · ');
    if (publication) {
      const source = document.createElement('span');
      source.className = 'knowledge-doc-suggestion-publication';
      source.textContent = publication;
      row.append(source);
    }

    if (!suggestion.accepted) {
      const reason = document.createElement('span');
      reason.className = 'knowledge-doc-suggestion-reason';
      reason.textContent = suggestion.reason || '无法确认是同一篇';
      row.append(reason);
      return row;
    }

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'knowledge-doc-suggestion-apply';
    apply.textContent = '填入';
    apply.title = '把这条记录的标题、作者、DOI、日期与出版信息填进文献信息（仍保留你手填的字段）';
    apply.addEventListener('click', () => ports.apply(item.documentId, suggestion.candidate));
    row.append(apply);
    return row;
  }));

  if (state.suggestions.length) {
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'knowledge-doc-suggestion-dismiss';
    dismiss.textContent = '都不对';
    dismiss.addEventListener('click', () => ports.dismiss(item.documentId));
    knowledgeDocMetadataSuggestionListElement.append(dismiss);
  }
}
