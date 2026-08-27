import toolbarTemplate from '../templates/toolbar.html?raw';
import workspaceStageTemplate from '../templates/workspace-stage.html?raw';
import knowledgeBaseTemplate from '../templates/knowledge-base.html?raw';
import vocabularyLibraryTemplate from '../templates/vocabulary-library.html?raw';
import readerWorkspaceTemplate from '../templates/reader-workspace.html?raw';
import readerOverlaysTemplate from '../templates/reader-overlays.html?raw';
import knowledgeBaseOverlaysTemplate from '../templates/knowledge-base-overlays.html?raw';
import vocabularyLibraryOverlaysTemplate from '../templates/vocabulary-library-overlays.html?raw';
import overlaysTemplate from '../templates/overlays.html?raw';

export function mountViewerShell(): void {
  const root = document.getElementById('viewer-app-root');
  if (!root) throw new Error('Viewer application root is missing.');
  const workspaceStage = workspaceStageTemplate.replace(
    '<!-- workspace-views -->',
    [
      readerWorkspaceTemplate,
      knowledgeBaseTemplate,
      vocabularyLibraryTemplate,
    ].join('\n'),
  );
  root.innerHTML = [
    '<div class="app-frame">',
    toolbarTemplate,
    workspaceStage,
    '</div>',
    readerOverlaysTemplate,
    knowledgeBaseOverlaysTemplate,
    vocabularyLibraryOverlaysTemplate,
    overlaysTemplate,
  ].join('\n');
}
