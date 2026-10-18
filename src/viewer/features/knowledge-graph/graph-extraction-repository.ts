import { browser } from 'wxt/browser';

import type { AiExplainEntitiesRequest, AiExtractEntitiesRequest, AiRuntimeResponse } from '../../../modules/ai/public';
import { getDocumentChunks } from '../../../modules/document-agent/public';
import {
  getDocumentOverviewMarkdown,
  getKnowledgeDocument,
} from '../../../modules/knowledge/public';
import {
  overviewLeadAsAbstract,
  planPaperCleanup,
  knowledgeGraphRepository,
  type EntityExplanationPorts,
  type ExtractionRunnerPorts,
  type PaperCleanupResult,
  type RelationAnalysisPorts,
} from '../../../modules/knowledge-graph/public';
import { IndexedDbExtractionJobRepository } from '../../../modules/knowledge-graph/public';

/**
 * Binds the extraction runner's ports to the real browser dependencies.
 *
 * The runner is written against injected ports precisely so its rules are
 * testable; this file is the single place that knows about IndexedDB, the
 * document-agent chunk store, and the background message transport. Keeping the
 * binding in one reviewable place also means the untestable surface is small and
 * obvious.
 */

const jobRepository = new IndexedDbExtractionJobRepository();

/**
 * Sends the extraction request to the background.
 *
 * `runtime.sendMessage` is used directly rather than the viewer's
 * `requestAiContent` helper: that helper is chat-shaped (it requires an API key
 * to be present and opens the settings panel when it is missing), while a
 * long-running extraction wants the raw envelope so it can report the failure
 * inline instead of hijacking the UI.
 *
 * The timeout matches the provider's own 120 s per-request ceiling with headroom
 * for the batched call, because a hung promise here would hold the runner's
 * concurrency slot indefinitely.
 */
async function requestEntities(
  message: AiExtractEntitiesRequest,
): Promise<AiRuntimeResponse> {
  const timeoutMs = 180_000;
  return new Promise<AiRuntimeResponse>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: '抽取请求超时，已停止本次批次。' });
    }, timeoutMs);
    void browser.runtime.sendMessage(message).then(
      (response) => {
        clearTimeout(timer);
        resolve((response ?? { ok: false, error: '后台没有返回抽取结果。' }) as AiRuntimeResponse);
      },
      (error: unknown) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  });
}

export function createGraphExtractionPorts(): ExtractionRunnerPorts {
  return {
    async loadChunks(documentId) {
      const chunks = await getDocumentChunks(documentId);
      // The runner only needs text plus page provenance; `DocumentChunk` already
      // carries both, so no re-parsing of the PDF is required here.
      return chunks
        .filter((chunk) => chunk.text.trim().length > 0)
        .map((chunk) => ({
          chunkId: chunk.id,
          heading: chunk.heading,
          startPage: chunk.startPage,
          endPage: chunk.endPage,
          text: chunk.text,
        }));
    },

    getJob: (paperId) => jobRepository.findJob(paperId, 'entity-extraction'),
    putJob: (job) => jobRepository.putJob(job),
    listEntities: () => knowledgeGraphRepository.listEntities(),
    putEntities: (entities) => knowledgeGraphRepository.putEntities([...entities]),
    deleteEntities: (entityIds) => knowledgeGraphRepository.deleteEntities([...entityIds]),

    async getPaper(paperId) {
      const papers = await knowledgeGraphRepository.listPapers();
      return papers.find((paper) => paper.paperId === paperId) ?? null;
    },

    async getPaperSummary(paperId) {
      const papers = await knowledgeGraphRepository.listPapers();
      const paper = papers.find((candidate) => candidate.paperId === paperId);
      // A real bibliographic abstract wins.
      const fromLibrary = paper?.abstract?.trim();
      if (fromLibrary) return fromLibrary;
      // Otherwise the knowledge base's generated overview: most local PDFs carry no abstract in the
      // reading-history record, so this is what makes the framing actually reach the model.
      const document = getKnowledgeDocument(paperId);
      if (!document) return '';
      return overviewLeadAsAbstract(getDocumentOverviewMarkdown(document));
    },

    async updatePaperExtraction(paperId, update) {
      const papers = await knowledgeGraphRepository.listPapers();
      const paper = papers.find((candidate) => candidate.paperId === paperId);
      // Nothing to update when the projection has not been built yet; the next
      // graph open will project it with the correct status.
      if (!paper) return;
      await knowledgeGraphRepository.putPaper({ ...paper, ...update });
    },

    readSettings: async () => {
      const settings = await knowledgeGraphRepository.readSettings();
      return {
        extractionMaxCandidatesPerChunk: settings.extractionMaxCandidatesPerChunk,
        maxConcurrentExtractionBatches: settings.maxConcurrentExtractionBatches,
        // The 不再提示 list travels with the settings so extraction can skip those names instead of
        // re-proposing them on every run.
        ignoredEntityNames: settings.ignoredEntityNames,
      };
    },

    requestEntities,
  };
}

/** Removes every extraction job for a paper, used when it leaves the graph. */
export function deleteExtractionJobsForPaper(paperId: string): Promise<number> {
  return jobRepository.deleteJobsForPaper(paperId);
}

/**
 * Removes a paper from the graph, together with the knowledge only it supported.
 *
 * Binds the pure cleanup plan to the real repositories. Jobs are dropped as part
 * of the same operation on purpose: an orphaned `done` job would make a later
 * re-add of the same paper silently skip extraction and show stale candidates.
 */
export async function removeGraphPaper(paperId: string): Promise<PaperCleanupResult> {
  const [entities, edges] = await Promise.all([
    knowledgeGraphRepository.listEntities(),
    knowledgeGraphRepository.listEdges(),
  ]);
  const plan = planPaperCleanup(paperId, entities, edges);

  // One transaction for the destructive part: an interrupted cleanup would leave
  // edges whose endpoint no longer exists, and the renderer's one hard invariant
  // is that every edge endpoint is present.
  await knowledgeGraphRepository.deletePaperCascade(
    paperId,
    plan.entityIdsToDelete,
    plan.edgeIdsToDelete,
  );
  const deletedJobCount = await deleteExtractionJobsForPaper(paperId);

  return {
    deletedPaper: true,
    deletedEntityIds: plan.entityIdsToDelete,
    deletedEdgeIds: plan.edgeIdsToDelete,
    deletedJobCount,
  };
}

export { jobRepository as extractionJobRepository };

/**
 * Binds relation analysis to the real transport and repositories.
 *
 * Same shape and same reasoning as `createGraphExtractionPorts`: the orchestrator
 * is written against injected ports so its rules (never ask when the cache
 * answers; quote before spending; never cache a truncated response) are testable,
 * and this file is the one place that knows about the message transport.
 */export function createRelationAnalysisPorts(): RelationAnalysisPorts {
  return {
    async requestJudgement(message) {
      // Same timeout reasoning as extraction: it must exceed the provider's own
      // 120 s ceiling, and a hung promise here would silently stall the run.
      const timeoutMs = 180_000;
      return new Promise<AiRuntimeResponse>((resolve) => {
        const timer = setTimeout(() => {
          resolve({ ok: false, error: '关系判断请求超时。' });
        }, timeoutMs);
        void browser.runtime.sendMessage(message).then(
          (response) => {
            clearTimeout(timer);
            resolve(
              (response ?? { ok: false, error: '后台没有返回关系判断结果。' }) as AiRuntimeResponse,
            );
          },
          (error: unknown) => {
            clearTimeout(timer);
            resolve({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        );
      });
    },

    listEdges: () => knowledgeGraphRepository.listEdges(),
    applyRelationPlan: (plan) => knowledgeGraphRepository.applyRelationPlan(plan),

    /**
     * Vectors are not produced yet: the embedding mode defaults to `off`, and
     * generating embeddings is a separate opt-in step. Returning null keeps recall
     * on its zero-cost signals rather than silently skipping them.
     */
    loadVectors: async () => null,
  };
}

/**
 * Transport for the entity explanations.
 *
 * A short request with a short answer, so the timeout is the provider's own ceiling rather than the
 * 180 s used for extraction: if this takes that long the answer is not worth waiting for, and the
 * caller only ever shows it as a reading aid.
 *
 * **An empty response is retried once.** `runtime.sendMessage` resolving with `undefined` means the
 * background never answered — a suspended or just-replaced service worker, not a provider failure —
 * and that is exactly the case a second attempt fixes. A provider error (`ok: false`) is never
 * retried: it would only fail again, and explaining an entity is not worth two paid calls.
 */
const EXPLANATION_RETRY_DELAY_MS = 400;

function sendExplanationRequest(
  message: AiExplainEntitiesRequest,
): Promise<AiRuntimeResponse | undefined> {
  return new Promise<AiRuntimeResponse | undefined>((resolve) => {
    const timeoutMs = 60_000;
    const timer = setTimeout(() => {
      resolve({ ok: false, error: '解释生成请求超时。' });
    }, timeoutMs);
    void browser.runtime.sendMessage(message).then(
      (response) => {
        clearTimeout(timer);
        resolve((response ?? undefined) as AiRuntimeResponse | undefined);
      },
      (error: unknown) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  });
}

export function createEntityExplanationPorts(): EntityExplanationPorts {
  return {
    async requestExplanations(message) {
      const first = await sendExplanationRequest(message);
      if (first) return first;
      await new Promise((resolve) => {
        setTimeout(resolve, EXPLANATION_RETRY_DELAY_MS);
      });
      const second = await sendExplanationRequest(message);
      return second ?? {
        ok: false,
        error: '后台没有响应（扩展可能刚更新或被挂起），请在扩展管理页重新加载扩展后，'
          + '在节点右侧面板点「生成解释」重试。',
      };
    },
  };
}
