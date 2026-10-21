import {
  CITATION_STYLES,
  buildCitationRecord,
  citationAccessDate,
  citationWarnings,
  formatCitation,
  readDocumentMetadata,
  type CitationRecord,
  type CitationStyle,
  type KnowledgeLibraryDocument,
} from '../../../modules/knowledge/public';
import { showAnimatedDialog } from '../../shared-ui/dialog/dialog-motion';

/**
 * 「复制引用」对话框.
 *
 * 四种格式各是一个纯函数（`citation-format.ts`），这里只负责把它们摆出来、复制走。三个界面决定值得说明：
 *
 * - 默认 BibTeX：这个库的用户大多在写 LaTeX 或往文献管理软件里导。
 * - 缺项写在下面而不是藏起来：一条没有作者、没有年份的引文贴进论文就是事故，用户复制前该知道。
 * - 复制失败的提示只说「复制失败」，因为文本还在屏幕上，可以手动选中——功能没有失败。
 */

const dialog = () => document.getElementById('knowledge-citation-dialog') as HTMLDialogElement | null;
const textElement = () => document.getElementById('knowledge-citation-text');
const styleList = () => document.getElementById('knowledge-citation-styles');
const warningsElement = () => document.getElementById('knowledge-citation-warnings');
const statusElement = () => document.getElementById('knowledge-citation-status');

let current: { document: KnowledgeLibraryDocument; style: CitationStyle } | null = null;

function setStatus(message: string, isError = false): void {
  const element = statusElement();
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('is-error', isError);
}

/** 由一条库记录组装引文记录；对话框、警告与复制都走这里，保证三者说的是同一件事。 */
function buildRecord(item: KnowledgeLibraryDocument): CitationRecord {
  const metadata = readDocumentMetadata(item);
  return buildCitationRecord({
    metadataTitle: metadata.title,
    overviewMarkdown: item.overviewMarkdown,
    documentName: item.documentName,
    authors: metadata.authors,
    publishDate: metadata.publishDate,
    doi: metadata.doi,
    documentUrl: metadata.documentUrl,
    language: metadata.language,
    // 出版信息：GB/T 7714 需要刊名、卷期、页码、出版者，缺的项由格式函数自己省略。
    containerTitle: metadata.containerTitle,
    volume: metadata.volume,
    issue: metadata.issue,
    page: metadata.page,
    publisher: metadata.publisher,
    publisherPlace: metadata.publisherPlace,
    issn: metadata.issn,
    isbn: metadata.isbn,
    publicationKind: metadata.publicationKind,
  });
}

/** 当前格式下的引文文本；对话框与复制按钮共用，保证「看到的就是复制的」。 */
function currentText(): string {
  if (!current) return '';
  return formatCitation(buildRecord(current.document), current.style, {
    // 引用日期取前端当天的日期：用户复制引文的那一天，就是这次引用的日期。
    citedAt: citationAccessDate(),
  });
}

function renderStyles(): void {
  const container = styleList();
  if (!container || !current) return;
  container.replaceChildren();
  for (const style of CITATION_STYLES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'tab';
    button.dataset.citationStyle = style.id;
    const active = style.id === current.style;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.title = style.hint;
    button.textContent = style.label;
    button.addEventListener('click', () => {
      if (!current) return;
      current.style = style.id;
      setStatus('');
      render();
    });
    container.append(button);
  }
}

function renderWarnings(): void {
  const container = warningsElement();
  if (!container || !current) return;
  const record = buildRecord(current.document);
  const warnings = citationWarnings(record);
  container.replaceChildren();
  container.hidden = warnings.length === 0;
  for (const warning of warnings) {
    const line = document.createElement('p');
    line.textContent = warning;
    container.append(line);
  }
}

function render(): void {
  if (!current) return;
  const title = document.getElementById('knowledge-citation-document');
  if (title) title.textContent = current.document.documentName;
  renderStyles();
  const text = textElement();
  if (text) text.textContent = currentText();
  renderWarnings();
}

async function copy(): Promise<void> {
  const text = currentText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const label = CITATION_STYLES.find((style) => style.id === current?.style)?.label ?? '引文';
    setStatus(`已复制 ${label}。`);
  } catch {
    // The text stays on screen and stays selectable, so this is a convenience failing, not the feature failing.
    setStatus('复制失败：浏览器拒绝了剪贴板访问，可以手动选中上面的文本。', true);
  }
}

/** 打开对话框，默认 BibTeX。 */
export function openCitationDialog(document: KnowledgeLibraryDocument): void {
  current = { document, style: 'bibtex' };
  setStatus('');
  render();
  const element = dialog();
  if (element) showAnimatedDialog(element);
}

/** 绑定一次即可：关闭 / 复制 / Esc。 */
export function registerCitationDialogEvents(): void {
  const element = dialog();
  if (!element) return;
  const close = () => {
    current = null;
    element.close();
  };
  document.getElementById('knowledge-citation-close')?.addEventListener('click', close);
  document.getElementById('knowledge-citation-done')?.addEventListener('click', close);
  document.getElementById('knowledge-citation-copy')?.addEventListener('click', () => {
    void copy();
  });
  element.addEventListener('click', (event) => {
    if (event.target === element) close();
  });
}
