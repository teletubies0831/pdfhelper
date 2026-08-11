
import { type DocumentOutlineItem, type DocumentProfile } from "../../../../shared/document-agent";





export function uniquePages(pages: number[]): number[] {
  return Array.from(new Set(pages.filter((page) => Number.isInteger(page) && page > 0))).sort((a, b) => a - b);
}


export function normalizeSectionLookupText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}


export const SECTION_ALIASES: Array<{ patterns: RegExp[]; title: string }> = [
  { patterns: [/\bintroduction\b/i, /引言|绪论/], title: 'Introduction' },
  { patterns: [/\bbackground\b/i, /背景/], title: 'Background' },
  { patterns: [/related\s+work/i, /相关工作/], title: 'Related Work' },
  { patterns: [/\bmethod(?:ology)?\b/i, /方法(?:论)?/], title: 'Methodology' },
  { patterns: [/\bexperiment(?:s|al)?\b/i, /实验/], title: 'Experiments' },
  { patterns: [/\bresult(?:s)?\b/i, /结果/], title: 'Results' },
  { patterns: [/\bdiscussion\b/i, /讨论/], title: 'Discussion' },
  { patterns: [/\bconclusion(?:s)?\b/i, /结论/], title: 'Conclusion' },
  { patterns: [/\babstract\b/i, /摘要/], title: 'Abstract' },
];


export function detectRequestedSectionTitle(
  question: string,
  outline: DocumentOutlineItem[],
): string {
  const normalizedQuestion = normalizeSectionLookupText(question);
  const outlineMatch = [...outline]
    .filter((item) => {
      const title = normalizeSectionLookupText(item.title).replace(/^\d+(?:\.\d+)*/, '');
      return title.length >= 3 && normalizedQuestion.includes(title);
    })
    .sort((left, right) => right.title.length - left.title.length)[0];
  if (outlineMatch) return outlineMatch.title;
  return SECTION_ALIASES.find(({ patterns }) => patterns.some((pattern) => pattern.test(question)))?.title ?? '';
}


export function resolveSectionRange(
  title: string,
  outline: DocumentOutlineItem[],
  profile: DocumentProfile | undefined,
  pageCount: number,
): { title: string; startPage: number; endPage: number } | null {
  const target = normalizeSectionLookupText(title).replace(/^\d+(?:\.\d+)*/, '');
  const ordered = [...outline].sort((left, right) => left.pageNumber - right.pageNumber || left.depth - right.depth);
  const matchIndex = ordered.findIndex((item) => {
    const candidate = normalizeSectionLookupText(item.title).replace(/^\d+(?:\.\d+)*/, '');
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  });
  if (matchIndex >= 0) {
    const match = ordered[matchIndex]!;
    const nextPeer = ordered.slice(matchIndex + 1).find((item) => item.depth <= match.depth && item.pageNumber > match.pageNumber);
    return {
      title: match.title,
      startPage: Math.max(1, match.pageNumber),
      endPage: Math.min(pageCount, Math.max(match.pageNumber, (nextPeer?.pageNumber ?? pageCount + 1) - 1)),
    };
  }

  const profileMatch = profile?.sections.find((section) => {
    const candidate = normalizeSectionLookupText(section.title).replace(/^\d+(?:\.\d+)*/, '');
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  });
  if (!profileMatch) return null;
  return {
    title: profileMatch.title,
    startPage: Math.max(1, profileMatch.startPage),
    endPage: Math.min(pageCount, Math.max(profileMatch.startPage, profileMatch.endPage)),
  };
}
