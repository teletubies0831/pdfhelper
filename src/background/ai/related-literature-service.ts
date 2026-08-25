import type { AiConfig } from "../../modules/ai/public";
import type { AiProviderAdapter } from "./provider-runtime";

interface OpenAlexWork {
  id?: unknown;
  doi?: unknown;
  display_name?: unknown;
  publication_year?: unknown;
  cited_by_count?: unknown;
  authorships?: Array<{ author?: { display_name?: unknown } }>;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_topic?: { display_name?: unknown } | null;
}

interface RelatedWork {
  title: string;
  url: string;
  year: string;
  authors: string;
  abstract: string;
  topic: string;
  citedByCount: number;
}

function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

function restoreAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) return "";
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words.push([position, word]);
  }
  return words
    .sort((left, right) => left[0] - right[0])
    .map((item) => item[1])
    .join(" ")
    .slice(0, 1_200);
}

function mapWork(value: OpenAlexWork): RelatedWork | null {
  const title = typeof value.display_name === "string" ? value.display_name.trim() : "";
  if (!title) return null;
  const doi = typeof value.doi === "string" ? value.doi : "";
  const id = typeof value.id === "string" ? value.id : "";
  const authors = (value.authorships || [])
    .map((item) => item.author?.display_name)
    .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
    .slice(0, 4)
    .join(", ");
  return {
    title,
    url: doi || id,
    year: Number.isFinite(value.publication_year) ? String(value.publication_year) : "",
    authors,
    abstract: restoreAbstract(value.abstract_inverted_index),
    topic: typeof value.primary_topic?.display_name === "string"
      ? value.primary_topic.display_name.trim()
      : "",
    citedByCount: Math.max(0, Number(value.cited_by_count) || 0),
  };
}

async function searchOpenAlex(title: string): Promise<RelatedWork[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", title);
  url.searchParams.set("per-page", "10");
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`OpenAlex 检索失败：HTTP ${response.status}`);
  const payload = await response.json() as { results?: OpenAlexWork[] };
  const currentTitle = normalizeTitle(title);
  return (payload.results || [])
    .map(mapWork)
    .filter((work): work is RelatedWork => Boolean(work))
    .filter((work) => normalizeTitle(work.title) !== currentTitle)
    .sort((left, right) => {
      const leftEvidence = left.abstract ? 1 : 0;
      const rightEvidence = right.abstract ? 1 : 0;
      return rightEvidence - leftEvidence || right.citedByCount - left.citedByCount;
    })
    .slice(0, 7);
}

function extractDocumentMetadata(markdown: string): { type: string; title: string } {
  const type = markdown.match(/<!--\s*pdfpal-document-type:\s*([^>]+?)\s*-->/i)?.[1]?.trim().toLowerCase() || "";
  const markedTitle = markdown.match(/<!--\s*pdfpal-document-title:\s*([^>]+?)\s*-->/i)?.[1]?.trim() || "";
  const headingTitle = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
  return { type, title: markedTitle || headingTitle };
}

export async function appendRelatedLiterature(
  adapter: AiProviderAdapter,
  config: AiConfig,
  overviewMarkdown: string,
): Promise<string> {
  const metadata = extractDocumentMetadata(overviewMarkdown);
  if (metadata.type !== "paper" || !metadata.title) return overviewMarkdown.trim();
  const unavailableSection = [
    "## 相关论文",
    "",
    "> 暂时未能完成在线相关论文检索，可以稍后重新生成 PDF 概览。",
  ].join("\n");

  try {
    const works = await searchOpenAlex(metadata.title);
    if (!works.length) return `${overviewMarkdown.trim()}\n\n${unavailableSection}`;
    const result = await adapter.chat(config, [{
      role: "system",
      content: [
        "你负责为一篇论文的 PDF 概览补充相关论文。",
        "只能使用候选数据中明确提供的信息，不得发明论文、作者、结论或关系。",
        "只输出一个以“## 相关论文”开头的 Markdown 章节，不要重复当前论文概览。",
        "选择 3 至 5 篇最相关且互有区分的论文。",
        "每篇使用三级标题，若有 URL 则把准确标题写成链接，并保留年份。",
        "每篇依次写一段不超过 60 字的简介，以及一行“**与当前论文的关系：** …”。",
      ].join("\n"),
    }, {
      role: "user",
      content: [
        `当前论文标题：${metadata.title}`,
        "当前论文概览：",
        overviewMarkdown.slice(0, 12_000),
        "OpenAlex 候选论文：",
        JSON.stringify(works),
      ].join("\n\n"),
    }], 1_300);
    const section = result.content.trim();
    if (!/^##\s+相关论文/m.test(section)) {
      return `${overviewMarkdown.trim()}\n\n${unavailableSection}`;
    }
    return `${overviewMarkdown.trim()}\n\n${section}`;
  } catch {
    // Related-paper discovery is an enhancement. Keep the saved overview usable
    // when OpenAlex or the configured model is temporarily unavailable.
    return `${overviewMarkdown.trim()}\n\n${unavailableSection}`;
  }
}
