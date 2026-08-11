




export type DocumentToolName =
  | 'search_document'
  | 'read_pages'
  | 'read_section'
  | 'get_document_profile'
  | 'get_document_outline'
  | 'inspect_page_image';


export interface DocumentToolCall {
  name: DocumentToolName;
  arguments: Record<string, unknown>;
}


export interface DocumentToolResult {
  name: DocumentToolName;
  label: string;
  pages: number[];
  content: string;
}


export interface DocumentToolDecision {
  decision: 'answer' | 'use_tools';
  reason: string;
  calls: DocumentToolCall[];
}


export interface DocumentToolPlanningContext {
  question: string;
  currentPage: number;
  totalPages: number;
  selectedText?: string;
  currentPageText?: string;
  visionAvailable?: boolean;
  userImageAttached?: boolean;
  outlineTitles?: string[];
  previousResults?: DocumentToolResult[];
  round?: number;
}


export const DOCUMENT_TOOL_DESCRIPTIONS = [
  {
    name: 'search_document',
    description: 'Search the complete locally indexed document for relevant concepts, methods, evidence, or results.',
    arguments: { query: 'Search question or keywords', limit: 'Integer from 1 to 8; default 5' },
  },
  {
    name: 'read_pages',
    description: 'Read source text from a specific page range.',
    arguments: { startPage: 'First page', endPage: 'Last page; at most 8 consecutive pages' },
  },
  {
    name: 'read_section',
    description: 'Read the complete section identified by its outline title, including continuation pages until the next peer section.',
    arguments: { title: 'Section title, for example Introduction, Method, Experiments, or Conclusion' },
  },
  {
    name: 'get_document_profile',
    description: 'Read the whole-paper profile created during first-time processing.',
    arguments: {},
  },
  {
    name: 'get_document_outline',
    description: 'Read the PDF outline and section page numbers.',
    arguments: {},
  },
  {
    name: 'inspect_page_image',
    description: 'Visually inspect a PDF page when the question depends on a figure, chart, equation, table, diagram, image, or page layout that text extraction cannot preserve.',
    arguments: { pageNumber: 'Page to inspect', question: 'What visual information to inspect' },
  },
] as const;


export function buildDocumentToolPlanningPrompt(context: DocumentToolPlanningContext): string {
  const {
    question,
    currentPage,
    totalPages,
    selectedText = '',
    currentPageText = '',
    visionAvailable = false,
    userImageAttached = false,
    outlineTitles = [],
    previousResults = [],
    round = 1,
  } = context;
  const tools = visionAvailable
    ? DOCUMENT_TOOL_DESCRIPTIONS
    : DOCUMENT_TOOL_DESCRIPTIONS.filter((tool) => tool.name !== 'inspect_page_image');
  const evidence = previousResults.length
    ? previousResults.map((result, index) => [
      `Evidence ${index + 1}: ${result.label}`,
      result.pages.length ? `Pages: ${result.pages.join(', ')}` : 'Pages: document-level',
      result.content.slice(0, 3500),
    ].join('\n')).join('\n\n')
    : 'No document tools have been called yet.';
  return [
    'You are the evidence controller for a PDF reading agent. You do not answer the user directly.',
    `Planning round: ${round}.`,
    `Available tools: ${JSON.stringify(tools)}`,
    'Return JSON only in one of these forms:',
    '{"decision":"answer","reason":"why the accumulated evidence is sufficient","calls":[]}',
    '{"decision":"use_tools","reason":"what evidence is still missing","calls":[{"name":"search_document","arguments":{"query":"...","limit":5}}]}',
    'Use at most 3 calls in this round. Choose tools from the semantic scope of the question, not from a hard-coded keyword rule.',
    'First identify the evidence scope requested by the user, then compare it with the evidence actually available. Choose answer only when every material claim requested is already supported inside that evidence.',
    'If any part of the requested scope lies outside the selected text, current page, or accumulated results, choose use_tools. Never choose answer merely because you can infer or recall a plausible response from general knowledge.',
    'The final answering model will receive only the selected text, current-page text, and tool results. If the requested claim cannot be supported by that evidence, decision must be use_tools.',
    'Treat the visible page as a narrow observation. It does not automatically represent a complete section, a cross-page explanation, the whole document, or the meaning of a figure.',
    'Typical choices: search_document locates relevant evidence anywhere; read_section gathers a complete logical section; read_pages verifies exact neighboring pages; get_document_profile answers broad document-level questions; get_document_outline discovers structure; inspect_page_image resolves visual evidence lost by text extraction.',
    'After tool results are supplied, reassess them. You may request another tool round when they reveal a better page, section, term, figure, or evidence gap.',
    outlineTitles.length
      ? `Known PDF outline titles: ${JSON.stringify(outlineTitles.slice(0, 80))}`
      : 'The PDF has no usable outline titles. Locate relevant material with search_document or read_pages before assuming a section boundary.',
    userImageAttached
      ? 'The user attached an image to this chat turn. The attached image is handled outside these PDF tools. Do not call inspect_page_image unless the user explicitly refers to a figure or page inside the PDF.'
      : '',
    visionAvailable
      ? 'Use inspect_page_image only when the answer depends on a figure, chart, table, equation, diagram, screenshot, or spatial layout.'
      : 'No vision tool is configured. Do not invent visual details that are absent from extracted text.',
    `Current page: ${currentPage} / ${totalPages}.`,
    selectedText.trim()
      ? `Selected text:\n${selectedText.trim().slice(0, 5000)}`
      : 'Selected text: none.',
    currentPageText.trim()
      ? `Current-page text excerpt:\n${currentPageText.trim().slice(0, 6000)}`
      : 'Current-page text: unavailable.',
    `Accumulated tool evidence:\n${evidence}`,
    `User question: ${question}`,
  ].join('\n');
}


export function parseDocumentToolDecision(content: string): DocumentToolDecision {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) {
    return { decision: 'answer', reason: 'Planner returned no valid JSON.', calls: [] };
  }
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      decision?: unknown;
      reason?: unknown;
      calls?: unknown;
    };
    const names = new Set<DocumentToolName>([
      'search_document',
      'read_pages',
      'read_section',
      'get_document_profile',
      'get_document_outline',
      'inspect_page_image',
    ]);
    const calls = (Array.isArray(parsed.calls) ? parsed.calls : [])
      .filter((call): call is { name: DocumentToolName; arguments?: unknown } => (
        Boolean(call)
        && typeof call === 'object'
        && names.has((call as { name?: DocumentToolName }).name as DocumentToolName)
      ))
      .slice(0, 3)
      .map((call) => ({
        name: call.name,
        arguments: call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments)
          ? call.arguments as Record<string, unknown>
          : {},
      }));
    const decision = parsed.decision === 'use_tools' && calls.length ? 'use_tools' : 'answer';
    return {
      decision,
      reason: typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim()
        : decision === 'use_tools'
          ? 'More document evidence is required.'
          : 'The available evidence is sufficient.',
      calls,
    };
  } catch {
    return { decision: 'answer', reason: 'Planner returned malformed JSON.', calls: [] };
  }
}


export function parseDocumentToolPlan(content: string): DocumentToolCall[] {
  return parseDocumentToolDecision(content).calls;
}


export function formatDocumentToolResults(results: DocumentToolResult[]): string {
  return results.map((result, index) => [
    `## Tool result ${index + 1}: ${result.label}`,
    result.pages.length ? `Source pages: ${result.pages.join(', ')}` : 'Source: document profile',
    result.content,
  ].join('\n')).join('\n\n');
}
