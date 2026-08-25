


import { AI_VISION_TEST_MARKER, AI_VISION_TEST_PROMPT, DEFAULT_AI_CONFIG, normalizeAiBaseUrl, normalizeAiMaxOutputTokens, type AiConfig, type AiRuntimeRequest, type AiRuntimeResponse } from "../../modules/ai/public";
import { isResolvedReadingMode, type ResolvedReadingMode } from "../../modules/reading-mode/public";
import { getProviderError, requestVisionCompletion } from './vision-service';

import { getAiConfig, getVisionAiConfig } from './ai-config-repository';
import { getProviderAdapter } from "./provider-runtime";
import { buildConversation } from "./conversation-builder";
import { generateDocumentOverview } from "./document-overview-service";

function assertVisionTestMarker(content: string): void {
  const normalizedContent = content.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normalizedMarker = AI_VISION_TEST_MARKER.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalizedContent.includes(normalizedMarker)) {
    throw new Error('模型返回了响应，但没有正确识别测试图片。');
  }
}

export function parseReadingModeDetection(content: string): {
  readingMode: ResolvedReadingMode;
  rationale: string;
} {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const payload = JSON.parse(cleaned) as { mode?: unknown; rationale?: unknown };
    if (isResolvedReadingMode(payload.mode)) {
      return {
        readingMode: payload.mode,
        rationale: typeof payload.rationale === 'string' ? payload.rationale.trim() : '',
      };
    }
  } catch {
    // Fall back to a strict word match for providers that wrap the JSON in prose.
  }
  const match = cleaned.match(/\b(paper|novel|general)\b/i)?.[1]?.toLowerCase();
  if (!isResolvedReadingMode(match)) throw new Error('AI 没有返回可识别的阅读模式。');
  return { readingMode: match, rationale: cleaned.slice(0, 180) };
}

export async function handleAiRequest(message: AiRuntimeRequest): Promise<AiRuntimeResponse> {
  try {
    if (message.type === 'pdf-helper:ai-vision' || message.type === 'pdf-helper:ai-vision-test') {
      const visionConfig = await getVisionAiConfig();
      const result = await requestVisionCompletion(
        visionConfig,
        message.type === 'pdf-helper:ai-vision-test'
          ? AI_VISION_TEST_PROMPT
          : message.prompt,
        message.type === 'pdf-helper:ai-vision-test'
          ? message.imageDataUrl
            || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZsgAAAABJRU5ErkJggg=='
          : message.imageDataUrl,
        message.type === 'pdf-helper:ai-vision' ? message.context : undefined,
      );
      if (message.type === 'pdf-helper:ai-vision-test') {
        assertVisionTestMarker(result.content);
      }
      return { ok: true, content: result.content, model: result.model };
    }

    let config: AiConfig;
    if (message.type === 'pdf-helper:ai-test' && message.config) {
      const providerId = message.config.providerId;
      config = {
        ...DEFAULT_AI_CONFIG,
        providerId,
        apiKey: message.config.apiKey.trim(),
        baseUrl: normalizeAiBaseUrl(message.config.baseUrl, providerId),
        model: message.config.model.trim() || DEFAULT_AI_CONFIG.model,
        translationModel: message.config.model.trim() || DEFAULT_AI_CONFIG.translationModel,
        reasoning: 'disabled',
      };
    } else {
      const savedConfig = await getAiConfig(
        message.type === 'pdf-helper:ai-chat' ? message.routeId : 'chat',
      );
      const requestOverride =
        message.type === 'pdf-helper:ai-chat' ? message.configOverride : undefined;
      config = requestOverride
        ? {
            ...savedConfig,
            ...requestOverride,
            model: requestOverride.model?.trim() || savedConfig.model,
            reasoning: requestOverride.reasoning ?? savedConfig.reasoning,
            maxOutputTokens: normalizeAiMaxOutputTokens(
              requestOverride.maxOutputTokens ?? savedConfig.maxOutputTokens,
            ),
          }
        : savedConfig;
    }
    const adapter = getProviderAdapter(config);

    if (message.type === 'pdf-helper:ai-test') {
      console.info('[PDFPal AI 连接测试] 后台开始测试', {
        mode: message.mode ?? (message.config ? 'validate' : 'discover'),
        providerId: config.providerId,
        baseUrl: config.baseUrl,
        model: config.model,
        hasApiKey: Boolean(config.apiKey),
      });
      if (message.mode === 'discover' || !message.config) {
        const models = await adapter.test(config);
        const response: AiRuntimeResponse = { ok: true, models, model: config.model };
        console.info('[PDFPal AI 连接测试] 后台返回页面', response);
        return response;
      }

      const capabilities: Array<'text' | 'vision'> = message.config.capabilities?.length
        ? Array.from(new Set(message.config.capabilities))
        : ['text'];
      if (capabilities.includes('text')) {
        await adapter.chat(
          config,
          [{ role: 'user', content: '这是连接测试，请只回复“OK”。' }],
          16,
        );
      }
      if (capabilities.includes('vision')) {
        const visionResult = await requestVisionCompletion(
          {
            mode: 'separate',
            providerId: 'openai-compatible',
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            model: config.model,
          },
          AI_VISION_TEST_PROMPT,
          message.imageDataUrl
            || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZsgAAAABJRU5ErkJggg==',
          undefined,
        );
        assertVisionTestMarker(visionResult.content);
      }
      const response: AiRuntimeResponse = { ok: true, models: [config.model], model: config.model };
      console.info('[PDFPal AI 连接测试] 后台返回页面', response);
      return response;
    }

    if (message.type === 'pdf-helper:ai-compress-conversation') {
      const transcript = message.messages
        .filter((item) => item.content.trim())
        .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content.trim().slice(0, 12000)}`)
        .join('\n\n')
        .slice(0, 80000);
      if (!transcript) throw new Error('没有可压缩的对话内容。');
      // Conversation compression is a summarization task. Reasoning mode can
      // consume the entire small output budget as reasoning_content and leave
      // message.content empty, which looks like a failed compression to the
      // viewer. Keep the user's reasoning preference for the main chat only.
      const compressionConfig: AiConfig = {
        ...config,
        reasoning: 'disabled',
      };
      const result = await adapter.chat(compressionConfig, [{
        role: 'system',
        content: [
          '你是对话记忆压缩器。请把较早的 PDF 阅读对话压缩成可供后续模型继续交流的中文长期摘要。',
          '必须保留：用户真实目标和偏好、用户纠正过的内容、重要术语与公式含义、已确认结论、关键页码或引用线索、尚未解决的问题以及后续约定。',
          '删除：寒暄、重复解释、过程性状态、冗长原文复制和已经失效的临时信息。',
          '不要补充论文或对话中没有的信息，不要回答用户当前问题，不要输出引用标记。',
          '使用紧凑的分点结构，只输出摘要正文，控制在 4000 个中文字符以内。',
        ].join('\n'),
      }, {
        role: 'user',
        content: [
          message.previousSummary?.trim()
            ? `已有长期摘要（请与新增对话合并）：\n${message.previousSummary.trim().slice(0, 12000)}`
            : '当前尚无长期摘要。',
          `需要并入摘要的新增旧对话：\n${transcript}`,
        ].join('\n\n'),
      }], Math.min(4096, config.maxOutputTokens));
      return { ok: true, content: result.content.slice(0, 12000), model: result.model };
    }

    if (message.type === 'pdf-helper:ai-generate-document-overview') {
      const result = await generateDocumentOverview(adapter, config, message);
      return { ok: true, ...result };
    }

    if (message.type === 'pdf-helper:ai-detect-reading-mode') {
      const outline = message.outlineTitles?.filter(Boolean).slice(0, 80).join(' / ') || '未提供';
      const result = await adapter.chat(config, [{
        role: 'system',
        content: [
          '你是 PDF 文档类型识别器。只判断最适合的阅读策略，不要总结文档。',
          'paper：学术论文、研究报告、包含研究问题/方法/实验/结论的文档。',
          'novel：小说、故事、戏剧或以人物和情节推进的叙事作品。',
          'general：教材、说明书、传记、普通非虚构或无法明确归类的材料。',
          '只返回 JSON：{"mode":"paper|novel|general","rationale":"不超过40字的理由"}',
        ].join('\n'),
      }, {
        role: 'user',
        content: [
          `文件名：${message.documentName}`,
          `目录：${outline}`,
          '文档样本：',
          message.sampleText.slice(0, 24000),
        ].join('\n\n'),
      }], 300);
      const detection = parseReadingModeDetection(result.content);
      return { ok: true, model: result.model, ...detection };
    }

    const result = await adapter.chat(
      config,
      buildConversation(message.messages, message.context),
      config.maxOutputTokens,
    );
    return {
      ok: true,
      content: result.content,
      model: result.model,
    };
  } catch (error) {
    if (message.type === 'pdf-helper:ai-test') {
      console.error('[PDFPal AI 连接测试] 后台测试失败', {
        mode: message.mode ?? (message.config ? 'validate' : 'discover'),
        providerId: message.config?.providerId,
        baseUrl: message.config?.baseUrl,
        model: message.config?.model,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}


