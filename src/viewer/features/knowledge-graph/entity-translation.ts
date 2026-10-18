import { requestAiContent } from '../../shared-ui/markdown/markdown-renderer';
import {
  createEntityTranslator as createTranslator,
  type EntityTranslator,
} from './entity-translation-plan';

/**
 * The production wiring for entity glosses: the rules live in `entity-translation-plan.ts`, and this
 * file is only the call that needs the AI layer and the extension's provider settings.
 */

export {
  buildEntityTranslationPrompt,
  createEntityTranslator as createEntityTranslatorWith,
  needsTranslation,
  parseEntityTranslations,
  MAX_TERMS_PER_REQUEST,
  TRANSLATION_CACHE_LIMIT,
  type EntityTranslator,
} from './entity-translation-plan';

async function requestGlosses(prompt: string): Promise<string> {
  return requestAiContent(
    [{ role: 'user', content: prompt }],
    { task: '知识图谱：候选实体中文释义' },
  );
}

/** A translator backed by the configured model provider. */
export function createEntityTranslator(): EntityTranslator {
  return createTranslator((prompt) => requestGlosses(prompt));
}
