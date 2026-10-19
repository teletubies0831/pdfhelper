import type { GraphViewReport } from './graph-view-report';
import { showGraphTaskNotice } from './graph-task-notice';
import { showAppError } from '../../app/error-dialog';
import {
  knowledgeGraphEmptyElement,
  knowledgeGraphEmptyHintElement,
} from '../../app/viewer-elements';

/**
 * The page's two presentation outputs: the floating task notice and the empty-canvas hint.
 *
 * There is no header status line any more. It used to duplicate every message in a 12px grey line that
 * sat at the far end of the toolbar — easy to miss, and the first thing to be ellipsised — while the
 * floating plate says the same thing where the user is actually looking and then clears itself. What
 * stays in the header is only what is still true later (the counts line) and the badges.
 */

/**
 * Reports a page-level message.
 *
 * A failure additionally opens the readable dialog: the plate is 360px wide and transient, so a reason
 * that needs reading must not depend on catching it in four seconds.
 */
export function setPageStatus(
  message: string,
  isError = false,
  state: 'active' | 'info' = 'info',
): void {
  showGraphTaskNotice({
    message,
    state: isError ? 'error' : state === 'active' ? 'active' : 'success',
  });
  if (isError) showAppError(message, { title: '知识图谱出错' });
}

/**
 * Shows or hides the empty-canvas explanation.
 *
 * The wording for each situation is decided in `graph-view-report.ts`, where it is testable: the hint
 * used to blame the filters for every empty canvas.
 */
export function updateEmptyState(report: GraphViewReport): void {
  knowledgeGraphEmptyElement.hidden = !report.empty;
  if (report.empty) knowledgeGraphEmptyHintElement.textContent = report.emptyHint;
}
