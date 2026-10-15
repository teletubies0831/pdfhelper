import { documentTabsNewButton } from "../../viewer-elements";
import { openFileButton } from "../../viewer-elements";
import { renderDocumentTabs } from "../../document-tabs";

export function registerDocumentTabEvents(): void {
  // The "+" tab opens the same file picker as the toolbar "打开文件" button;
  // document-tabs turns every pick into a new tab (or tab re-activation).
  documentTabsNewButton.addEventListener("click", () => {
    openFileButton.click();
  });
  // Initial render keeps the empty strip consistent (it stays hidden via CSS
  // until the first tab exists — renderDocumentTabs only unhides on open).
  renderDocumentTabs();
}
