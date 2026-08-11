

import { type AiConversationMessage, type AiMemoryCandidate } from "../../../../shared/ai";











export function findConfirmedMemoryProposal(
  messages: AiConversationMessage[],
  userMessageIndex: number,
): string {
  if (userMessageIndex < 1) return "";
  const confirmation = messages[userMessageIndex]?.content.trim() ?? "";
  if (!/^(?:是的|是|确认|可以|好的?|对|没错|就这样|记住吧|请记住)[。.!！?？]*$/i.test(confirmation)) {
    return "";
  }
  const previousAssistant = [...messages.slice(0, userMessageIndex)]
    .reverse()
    .find((message) => message.role === "assistant");
  const text = previousAssistant?.content.trim() ?? "";
  if (!/(?:长期记忆|永久记住|记住|保存).{0,30}(?:吗|？|\?|候选|偏好)|(?:确认|同意).{0,30}(?:更新|写入|记住)/i.test(text)) {
    return "";
  }
  const proposalLines = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•>|]+|\d+[.)、])\s*/, "").trim())
    .filter(Boolean)
    .filter((line) =>
      /^(?:用户|偏好|项目|研究方向|回答时|以后|今后)/.test(line)
      && !/[吗？?]$/.test(line)
      && !/(?:确认的话|回复|回答“|回答「|我就更新|是否)/.test(line),
    );
  return proposalLines.join(" ").slice(0, 1200);
}

export function createLocalExplicitMemoryCandidates(
  userMessage: string,
): AiMemoryCandidate[] {
  const content = userMessage.trim().replace(/\s+/g, " ").slice(0, 600);
  if (!content) return [];

  const candidates: AiMemoryCandidate[] = [];
  const responseStyleSignal =
    /(?:记住|以后|今后|每次|一直|默认|需要你|请你|我希望).{0,160}(?:回答|回复|称呼|语气|口吻|开头|结尾|格式)|(?:回答|回复).{0,160}(?:每次|以后|都要|不要|改为)|用户(?:明确)?要求.{0,160}(?:回答|回复|称呼|语气|口吻|开头|结尾|格式)/i;
  if (responseStyleSignal.test(content)) {
    candidates.push({
      key: "preference.response.style",
      category: "preference",
      content: `用户明确要求长期遵循以下回答偏好：${content}`,
      scope: "global",
      sourceType: "explicit",
      confidence: 1,
      importance: 0.9,
    });
  }

  const likesMatch = content.match(/我(?:很|更|最)?喜欢([^，。！？;；\n]{1,80})/i);
  if (likesMatch?.[1]) {
    const likedThing = likesMatch[1].trim();
    candidates.push({
      key: `profile.personal.likes.${createStableMemoryKeySuffix(likedThing)}`,
      category: "profile",
      content: `用户明确表示喜欢${likedThing}。`,
      scope: "global",
      sourceType: "explicit",
      confidence: 1,
      importance: 0.65,
    });
  }

  const rememberMatch = content.match(
    /(?:^|[，。！？;；\s])(?:请)?记住[:：]?\s*([^。！？;；\n]{2,220})/i,
  );
  if (rememberMatch?.[1] && candidates.length === 0) {
    const rememberedFact = rememberMatch[1].trim();
    candidates.push({
      key: `fact.explicit.${createStableMemoryKeySuffix(rememberedFact)}`,
      category: "fact",
      content: `用户明确要求长期记住：${rememberedFact}。`,
      scope: "global",
      sourceType: "explicit",
      confidence: 1,
      importance: 0.75,
    });
  }

  return candidates;
}

export function createStableMemoryKeySuffix(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value.normalize("NFKC").toLocaleLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
