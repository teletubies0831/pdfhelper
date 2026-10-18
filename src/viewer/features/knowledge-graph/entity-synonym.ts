import { requestAiContent } from '../../shared-ui/markdown/markdown-renderer';
import {
  createEntitySynonymChecker as createChecker,
  type EntitySynonymChecker,
} from './entity-synonym-plan';

/**
 * Production wiring for synonym detection: the rules live in `entity-synonym-plan.ts`, and this
 * file is only the call that needs the AI layer and the configured provider.
 */

export {
  buildEntitySynonymPrompt,
  createEntitySynonymChecker as createEntitySynonymCheckerWith,
  parseEntitySynonyms,
  MAX_TERMS_PER_SYNONYM_REQUEST,
  SYNONYM_CACHE_LIMIT,
  type EntitySynonymChecker,
} from './entity-synonym-plan';

async function requestSynonyms(prompt: string): Promise<string> {
  return requestAiContent(
    [{ role: 'user', content: prompt }],
    { task: '知识图谱：候选实体同义归并' },
  );
}

/** A synonym checker backed by the configured model provider, cached for the session. */
export function createEntitySynonymChecker(): EntitySynonymChecker {
  return createChecker((prompt) => requestSynonyms(prompt));
}
