/**
 * Knowledge-graph AI 工具的请求契约：实体抽取、关系判断、实体解释.
 *
 * Split out of `contracts.ts`, which had grown past its size limit — and the seam is honest: these three requests all
 * describe knowledge-graph work, all carry their own prompt override for testing, and none of them references any other
 * AI type, so this file depends on nothing and can be read on its own.
 *
 * Re-exported by `contracts.ts`, so `AiRuntimeRequest` and every existing importer keep working unchanged.
 */

/** One chunk of a paper, as handed to the entity extractor. */
export interface AiEntityExtractionChunk {
  chunkId: string;
  heading?: string;
  startPage: number;
  endPage: number;
  text: string;
}

/**
 * Knowledge-graph candidate entity extraction for one paper.
 *
 * Sent as a single request carrying every chunk, rather than one request per
 * chunk: the service worker is the caller and it can be torn down between
 * messages, so fewer round trips means fewer orphaned jobs. The response is plain
 * text (there is no provider JSON mode) that the caller parses defensively.
 */
export interface AiExtractEntitiesRequest {
  type: 'pdf-helper:ai-extract-entities';
  requestId: string;
  paperId: string;
  paperTitle: string;
  documentName: string;
  /**
   * The paper's abstract, when one is known.
   *
   * Sent ahead of the chunks because each call only sees three of them: without it the model reads
   * a background paragraph in the Introduction as if it were the paper's own contribution. The
   * abstract is the cheapest available statement of what the paper actually does.
   */
  abstract?: string;
  chunks: AiEntityExtractionChunk[];
  /** Hard cap on candidates kept per response; the main token-cost lever. */
  maxCandidatesPerChunk: number;
  /** Injected for testability; defaults to the built-in extraction prompt. */
  promptOverride?: string;
}

/**
 * One paper, as the relation judge sees it: title plus a verbatim excerpt.
 *
 * The excerpt is sent **once per paper** rather than per pair, because a bridge concept has to be
 * supported by a quote from each side and the quote is verified against exactly this text afterwards.
 * Sending it per pair would multiply the input by the number of pairs for no extra information.
 */
export interface AiRelationPaperExcerpt {
  paperId: string;
  title: string;
  /** Abstract, else the knowledge base overview lead. Empty when neither exists. */
  excerpt: string;
}

/** One paper pair to judge, with the context the model needs. */
export interface AiRelationCandidate {
  /** Deterministic key; echoed back by the model so answers can be matched. */
  pairKey: string;
  leftPaperId: string;
  rightPaperId: string;
  leftTitle: string;
  rightTitle: string;
  sharedEntities: string[];
  recallReasons: string[];
}

/**
 * Knowledge-graph paper-to-paper relationship judgement, plus bridge concepts.
 *
 * The candidate list is already bounded by the caller's selection or recall funnel, so this request is
 * small by construction — the token ceiling was decided before the message was built, not here.
 */
export interface AiJudgeRelationsRequest {
  type: 'pdf-helper:ai-judge-relations';
  requestId: string;
  /** Excerpts for every paper mentioned by `pairs`. */
  papers: AiRelationPaperExcerpt[];
  pairs: AiRelationCandidate[];
  /** Injected for testability; defaults to the built-in judgement prompt. */
  promptOverride?: string;
}

/** One entity the model is asked to explain, with the context it may ground the answer in. */
export interface AiEntityExplainItem {
  name: string;
  type: string;
  aliases?: string[];
  paperTitle: string;
  /** Abstract lead, when one is known: the cheapest statement of what the paper does. */
  abstract?: string;
  /** Verbatim sentences where the entity appears, already stored on the entity as evidence. */
  quotes: string[];
}

/**
 * Short per-entity glosses for entities the user just confirmed into the graph.
 *
 * Sent as one request for the whole confirmation rather than one per entity: the answers are a few
 * dozen characters each, and a round trip per name would cost more than the content.
 */
export interface AiExplainEntitiesRequest {
  type: 'pdf-helper:ai-explain-entities';
  requestId: string;
  items: AiEntityExplainItem[];
  /** Injected for testability; defaults to the built-in explanation prompt. */
  promptOverride?: string;
}
