import {
  readDocumentMetadata,
  type KnowledgeDocumentMetadata,
  type KnowledgeLibraryDocument,
} from '../../../modules/knowledge/public';
import {
  knowledgeDocBiblioContainerInput,
  knowledgeDocBiblioEditElement,
  knowledgeDocBiblioIssueInput,
  knowledgeDocBiblioPagesInput,
  knowledgeDocBiblioPublisherInput,
  knowledgeDocBiblioPublisherPlaceInput,
  knowledgeDocBiblioVolumeInput,
  knowledgeDocBiblioViewElement,
  knowledgeDocAuthorsInput,
  knowledgeDocDateInput,
  knowledgeDocDoiInput,
  knowledgeDocIdentifierInput,
  knowledgeDocLanguageInput,
  knowledgeDocMetadataActionsElement,
  knowledgeDocMetadataCancelButton,
  knowledgeDocMetadataEditButton,
  knowledgeDocMetadataSaveButton,
  knowledgeDocTitleInput,
  knowledgeDocUrlInput,
} from '../../app/elements/knowledge-elements';

/**
 * 文献信息的编辑表单.
 *
 * Split out of the inspector because the panel had grown past the size limit and because this is a different job: the
 * panel *shows* a record, this *collects* one. The split also keeps the one rule that matters here visible — the form
 * never invents a value, and `issn`/`isbn`/`publicationKind` are left blank because they are only ever provided by
 * Crossref; writing `''` would erase what an online lookup found.
 */

/** What the form needs from the panel: the document being shown, and somewhere to put the result. */
export interface BiblioFormPorts {
  current(): KnowledgeLibraryDocument | undefined;
  save(documentId: string, metadata: KnowledgeDocumentMetadata): void;
}

let ports: BiblioFormPorts | null = null;

/** Swaps the read-only list for the form, pre-filled from what is stored. */
export function openBiblioEditor(): void {
  const item = ports?.current();
  if (!item) return;
  const metadata = readDocumentMetadata(item);
  knowledgeDocTitleInput.value = metadata.title;
  knowledgeDocAuthorsInput.value = metadata.authors.join('、');
  knowledgeDocDateInput.value = metadata.publishDate;
  knowledgeDocLanguageInput.value = metadata.language;
  knowledgeDocDoiInput.value = metadata.doi;
  knowledgeDocUrlInput.value = metadata.documentUrl;
  knowledgeDocBiblioContainerInput.value = metadata.containerTitle;
  knowledgeDocBiblioVolumeInput.value = metadata.volume;
  knowledgeDocBiblioIssueInput.value = metadata.issue;
  knowledgeDocBiblioPagesInput.value = metadata.page;
  knowledgeDocBiblioPublisherInput.value = metadata.publisher;
  knowledgeDocBiblioPublisherPlaceInput.value = metadata.publisherPlace;
  knowledgeDocIdentifierInput.value = '';
  knowledgeDocIdentifierInput.removeAttribute('title');
  knowledgeDocBiblioViewElement.hidden = true;
  knowledgeDocBiblioEditElement.hidden = false;
  // The form has its own 保存 / 取消 pair; leaving 重新提取 and 手动填写 next to them would be four buttons for two actions.
  knowledgeDocMetadataActionsElement.hidden = true;
  window.setTimeout(() => knowledgeDocAuthorsInput.focus(), 0);
}

/** Closes the editor and restores the action row. Safe to call when it is already closed. */
export function closeBiblioEditor(): void {
  if (knowledgeDocBiblioEditElement.hidden) return;
  knowledgeDocBiblioEditElement.hidden = true;
  knowledgeDocBiblioViewElement.hidden = false;
  knowledgeDocMetadataActionsElement.hidden = false;
}

/** Reads the form into a metadata record. The module normalises it, so a sloppy paste is still accepted. */
export function readBiblioEditor(): KnowledgeDocumentMetadata {
  return {
    title: knowledgeDocTitleInput.value,
    authors: knowledgeDocAuthorsInput.value.split(/\s*(?:、|;|；|\band\b|&)\s*|\s*,\s*(?=[A-Z])/u).filter(Boolean),
    publishDate: knowledgeDocDateInput.value,
    language: knowledgeDocLanguageInput.value,
    documentUrl: knowledgeDocUrlInput.value,
    doi: knowledgeDocDoiInput.value,
    containerTitle: knowledgeDocBiblioContainerInput.value,
    volume: knowledgeDocBiblioVolumeInput.value,
    issue: knowledgeDocBiblioIssueInput.value,
    page: knowledgeDocBiblioPagesInput.value,
    publisher: knowledgeDocBiblioPublisherInput.value,
    publisherPlace: knowledgeDocBiblioPublisherPlaceInput.value,
    // ISSN/ISBN 与出版类型只由 Crossref 提供，表单不编辑；留空由写入层按字段合并，不会把它们清掉。
    issn: '',
    isbn: '',
    publicationKind: '',
  };
}

/** Binds the form's four buttons once. */
export function registerBiblioFormEvents(next: BiblioFormPorts): void {
  ports = next;
  knowledgeDocMetadataEditButton.addEventListener('click', () => {
    if (knowledgeDocBiblioEditElement.hidden) openBiblioEditor();
    else closeBiblioEditor();
  });
  knowledgeDocMetadataCancelButton.addEventListener('click', () => closeBiblioEditor());
  knowledgeDocMetadataSaveButton.addEventListener('click', () => {
    const item = ports?.current();
    if (!item) return;
    ports?.save(item.documentId, readBiblioEditor());
  });
}
