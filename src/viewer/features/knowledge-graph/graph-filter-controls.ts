import {
  graphFocusHops,
  graphFocusMode,
  graphMinConfidence,
  graphSearchQuery,
  graphSelectedEdgeId,
  graphShowEntities,
  graphShowOriginAi,
  graphShowOriginRule,
  graphShowOriginUser,
  graphShowPapers,
} from '../../app/public';
import {
  knowledgeGraphFilterConfidenceInput,
  knowledgeGraphFilterConfidenceValue,
  knowledgeGraphFilterEntityInput,
  knowledgeGraphFilterOriginAiInput,
  knowledgeGraphFilterOriginRuleInput,
  knowledgeGraphFilterOriginUserInput,
  knowledgeGraphFilterPaperInput,
  knowledgeGraphFocusAllButton,
  knowledgeGraphFocusCurrentButton,
  knowledgeGraphFocusHopsInput,
  knowledgeGraphFocusHopsValue,
  knowledgeGraphSearchInput,
} from '../../app/viewer-elements';

/**
 * Pushes the current filter state into the controls.
 *
 * A control and the canvas are two views of one state, so they have to be re-synced together: without
 * this the 全局图谱 / 当前论文 buttons kept the highlight of the previously selected one while the canvas
 * already showed the new lens. Kept beside the page rather than inside it because it is entirely
 * mechanical — every line maps a state cell onto one element — and the page has enough to do.
 */
export function syncFilterControls(): void {
  knowledgeGraphFilterPaperInput.checked = graphShowPapers.value;
  knowledgeGraphFilterEntityInput.checked = graphShowEntities.value;
  knowledgeGraphFilterOriginAiInput.checked = graphShowOriginAi.value;
  knowledgeGraphFilterOriginRuleInput.checked = graphShowOriginRule.value;
  knowledgeGraphFilterOriginUserInput.checked = graphShowOriginUser.value;
  knowledgeGraphFilterConfidenceInput.value = String(graphMinConfidence.value);
  knowledgeGraphFilterConfidenceValue.value = graphMinConfidence.value.toFixed(2);
  knowledgeGraphSearchInput.value = graphSearchQuery.value;
  knowledgeGraphFocusHopsInput.value = String(graphFocusHops.value);
  knowledgeGraphFocusHopsValue.value = String(graphFocusHops.value);
  knowledgeGraphFocusAllButton.classList.toggle('is-active', graphFocusMode.value === 'all');
  knowledgeGraphFocusCurrentButton.classList.toggle(
    'is-active',
    graphFocusMode.value === 'current',
  );
}

/** Clears the selection cells the search box resets when the query changes. */
export function clearEdgeSelection(): void {
  graphSelectedEdgeId.value = '';
}
