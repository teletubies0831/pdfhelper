import toolbarTemplate from '../templates/toolbar.html?raw';
import paperCardTemplate from '../templates/paper-card.html?raw';
import readingJournalTemplate from '../templates/reading-journal.html?raw';
import knowledgeBaseTemplate from '../templates/knowledge-base.html?raw';
import readerWorkspaceTemplate from '../templates/reader-workspace.html?raw';
import overlaysTemplate from '../templates/overlays.html?raw';

export function mountViewerShell(): void {
  const root = document.getElementById('viewer-app-root');
  if (!root) throw new Error('Viewer application root is missing.');
  root.innerHTML = [
    '<div class="app-frame">',
    toolbarTemplate,
    paperCardTemplate,
    readingJournalTemplate,
    knowledgeBaseTemplate,
    readerWorkspaceTemplate,
    '</div>',
    overlaysTemplate,
  ].join('\n');
}
