import {
  aiConnectionCatalog,
  normalizeAiToolsBaseUrl,
  normalizeWebRetrievalCount,
  normalizeWebRetrievalMaxFetches,
  type AiConnectionCatalogState,
  type AiWebRetrievalSettings,
} from '../../../modules/ai/public';
import {
  webRetrievalApiKeyInput,
  webRetrievalBaseUrlInput,
  webRetrievalCountInput,
  webRetrievalMaxFetchesInput,
} from '../../app/viewer-elements';
import { getSettingsConnectionCatalog, showSettingsStatus } from './settings-navigation';

/**
 * The 「联网检索」 form.
 *
 * Its own module because it is a different subject from routing models to tasks: these four fields belong to
 * DeepSeek's tools service, which takes no model, and keeping them apart is what stopped the settings page from
 * growing past its size limit. The catalog is read through `getSettingsConnectionCatalog()` rather than imported
 * state, so this module depends on the navigation module and not the other way round.
 */

/** Mirrors the stored settings into the form. A no-op until the catalog has been loaded once. */
export function populateWebRetrievalForm(state?: AiConnectionCatalogState): void {
  // `state` is the freshly saved catalog when a save just happened. Reading the module-level catalog instead would
  // refill the form from the *previous* state — which wiped the API key the user had just typed, because the next
  // field change then saved that empty value over it.
  const settings = (state ?? getSettingsConnectionCatalog())?.webRetrieval;
  if (!settings) return;
  webRetrievalBaseUrlInput.value = settings.baseUrl;
  webRetrievalApiKeyInput.value = settings.apiKey;
  webRetrievalCountInput.value = String(settings.count);
  webRetrievalMaxFetchesInput.value = String(settings.maxFetches);
}

/**
 * Writes the form into the catalog.
 *
 * `null` means the address did not validate — the caller reports it. Nothing is stored in that case: an invalid
 * address that reached storage would be skipped by the resolver, and the 检索 button would just go grey with no
 * explanation of why.
 */
export async function saveWebRetrievalSettings(): Promise<AiConnectionCatalogState | null> {
  let baseUrl: string;
  try {
    baseUrl = normalizeAiToolsBaseUrl(webRetrievalBaseUrlInput.value) || '';
  } catch (error) {
    showSettingsStatus(error instanceof Error ? error.message : String(error), 'error');
    return null;
  }
  const settings: AiWebRetrievalSettings = {
    baseUrl,
    apiKey: webRetrievalApiKeyInput.value.trim(),
    count: normalizeWebRetrievalCount(webRetrievalCountInput.value),
    maxFetches: normalizeWebRetrievalMaxFetches(webRetrievalMaxFetchesInput.value),
  };
  const state = await aiConnectionCatalog.saveWebRetrieval(settings);
  populateWebRetrievalForm(state);
  return state;
}
