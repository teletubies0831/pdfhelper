import {
  knowledgeGraphReviewSynonymField,
  knowledgeGraphReviewSynonymInput,
  knowledgeGraphReviewTranslateField,
  knowledgeGraphReviewTranslateInput,
} from '../../app/viewer-elements';

/**
 * The two optional, token-spending annotations on a candidate row: the Chinese gloss and the
 * "same concept as …" suggestion.
 *
 * Split out of the dialog because it is a self-contained subsystem with its own rules — one request
 * per turn of a switch, results cached by the caller, a failure shown in the row instead of breaking
 * the review — and because the dialog's job (what gets confirmed) is a different reason to change
 * than this one (what extra reading aids are offered).
 *
 * Both are **annotations**: a gloss never renames anything, and a synonym is only acted on through
 * the ordinary rename the user could have typed.
 */

export type AnnotationStatus = 'off' | 'loading' | 'ready' | 'error';

export interface AnnotationSlot {
  status: AnnotationStatus;
  error: string;
  /** Name → text, keyed by the *extracted* name so a rename does not lose it. */
  values: Map<string, string>;
}

function emptySlot(): AnnotationSlot {
  return { status: 'off', error: '', values: new Map() };
}

export interface AnnotationSources {
  translate?: (terms: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  findSynonyms?: (terms: readonly string[]) => Promise<ReadonlyMap<string, string>>;
}

export interface AnnotationControllerOptions extends AnnotationSources {
  /** Re-renders the list; called whenever an annotation state changes. */
  onChange(): void;
  /** Applies a synonym by renaming the row named `name` to `canonical`. */
  onApplySynonym(name: string, canonical: string): void;
}

export interface AnnotationController {
  reset(sources: AnnotationSources): void;
  /** Shows or hides the two switches, and mirrors their state. */
  updateControls(): void;
  setGlossEnabled(enabled: boolean, names: readonly string[]): Promise<void>;
  setSynonymEnabled(enabled: boolean, names: readonly string[]): Promise<void>;
  /** The gloss line for a name, or null when there is nothing to show. */
  glossLine(name: string): HTMLElement | null;
  /** The synonym suggestion line for a name, or null when there is nothing to show. */
  synonymLine(name: string): HTMLElement | null;
}

export function createAnnotationController(
  options: AnnotationControllerOptions,
): AnnotationController {
  let gloss = emptySlot();
  let synonym = emptySlot();
  let translate = options.translate ?? null;
  let findSynonyms = options.findSynonyms ?? null;

  const run = async (
    slot: AnnotationSlot,
    source: ((terms: readonly string[]) => Promise<ReadonlyMap<string, string>>) | null,
    names: readonly string[],
  ): Promise<void> => {
    if (!source) return;
    const unique = [...new Set(names.map((name) => name.trim()))].filter(Boolean);
    slot.status = 'loading';
    slot.error = '';
    options.onChange();
    try {
      const fresh = await source(unique);
      // Merged, never replaced. Turning 显示低置信度候选 on asks only about the rows that just appeared, and a
      // fresh map would drop the glosses already paid for on the rows above it.
      for (const [name, text] of fresh) slot.values.set(name, text);
      slot.status = 'ready';
    } catch (error) {
      slot.status = 'error';
      slot.error = error instanceof Error ? error.message : String(error);
    }
    options.onChange();
  };

  const messageLine = (slot: AnnotationSlot, className: string): HTMLElement | null => {
    if (slot.status !== 'loading' && slot.status !== 'error') return null;
    const line = document.createElement('div');
    line.className = className;
    line.textContent = slot.status === 'loading'
      ? (className.includes('synonym') ? '正在检查同义写法…' : '翻译中…')
      : `${className.includes('synonym') ? '同义检查' : '翻译'}失败：${slot.error}`;
    line.classList.add(slot.status === 'loading' ? 'is-pending' : 'is-error');
    return line;
  };

  return {
    reset(sources) {
      gloss = emptySlot();
      synonym = emptySlot();
      translate = sources.translate ?? null;
      findSynonyms = sources.findSynonyms ?? null;
      this.updateControls();
    },

    updateControls() {
      // No source means no control: a checkbox that cannot do anything is worse than no checkbox.
      knowledgeGraphReviewTranslateField.hidden = !translate;
      knowledgeGraphReviewTranslateInput.checked = gloss.status !== 'off';
      knowledgeGraphReviewTranslateInput.disabled = !translate;
      knowledgeGraphReviewSynonymField.hidden = !findSynonyms;
      knowledgeGraphReviewSynonymInput.checked = synonym.status !== 'off';
      knowledgeGraphReviewSynonymInput.disabled = !findSynonyms;
    },

    async setGlossEnabled(enabled, names) {
      if (!enabled) {
        gloss.status = 'off';
        this.updateControls();
        options.onChange();
        return;
      }
      this.updateControls();
      await run(gloss, translate, names);
      this.updateControls();
    },

    async setSynonymEnabled(enabled, names) {
      if (!enabled) {
        synonym.status = 'off';
        this.updateControls();
        options.onChange();
        return;
      }
      this.updateControls();
      await run(synonym, findSynonyms, names);
      this.updateControls();
    },

    glossLine(name) {
      const pending = messageLine(gloss, 'knowledge-graph-review-translation');
      if (pending) return pending;
      if (gloss.status !== 'ready') return null;
      const text = gloss.values.get(name.trim());
      if (!text) return null;
      const line = document.createElement('div');
      line.className = 'knowledge-graph-review-translation';
      line.textContent = text;
      line.title = `“${name}”的中文释义`;
      return line;
    },

    synonymLine(name) {
      const pending = messageLine(synonym, 'knowledge-graph-review-synonym');
      if (pending) return pending;
      if (synonym.status !== 'ready') return null;
      const canonical = synonym.values.get(name.trim());
      if (!canonical) return null;

      const line = document.createElement('div');
      line.className = 'knowledge-graph-review-synonym';
      line.textContent = `疑似与「${canonical}」是同一概念 `;

      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'knowledge-graph-action knowledge-graph-review-synonym-apply';
      apply.textContent = '合并为它';
      apply.title = '把这一条改名为该写法，确认后两者会合并成同一个实体';
      apply.addEventListener('click', () => { options.onApplySynonym(name.trim(), canonical); });
      line.append(apply);
      return line;
    },
  };
}
