


import { AI_VISION_TEST_MARKER, AI_VISION_TEST_PROMPT, CONNECTION_TEST_PROMPT, DEFAULT_AI_CONFIG, normalizeConnectionTestSettings, normalizeAiBaseUrl, normalizeAiMaxOutputTokens, type AiConfig, type AiRuntimeRequest, type AiRuntimeResponse } from "../../modules/ai/public";
import { isResolvedReadingMode, type ResolvedReadingMode } from "../../modules/reading-mode/public";
import { getProviderError, requestVisionCompletion } from './vision-service';

import { getAiConfig, getVisionAiConfig } from './ai-config-repository';
import { getProviderAdapter } from "./provider-runtime";
import { buildConversation } from "./conversation-builder";
import { generateDocumentOverview } from "./document-overview-service";
import { extractDocumentMetadata } from "./document-metadata-service";
import { lookupBibliographicRecords } from "./bibliographic-lookup-service";
import { generateRelatedLiterature, probeWebRetrieval, searchForChat } from "./web-retrieval-service";
import { extractEntities } from "./entity-extraction-service";
import { explainEntities } from "./entity-explanation-service";
import { judgeRelations } from "./relation-judgement-service";
import type { AiDocumentOverviewProgress } from "../../modules/ai/public";

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

export async function handleAiRequest(message: AiRuntimeRequest, onOverviewProgress?: (progress: AiDocumentOverviewProgress) => Promise<void>): Promise<AiRuntimeResponse> {
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
        message.type === 'pdf-helper:ai-vision-test'
          ? normalizeConnectionTestSettings(message.testSettings).maxOutputTokens : undefined,
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
      const testSettings = normalizeConnectionTestSettings(message.testSettings);
      let content = '';
      if (capabilities.includes('text')) {
        const result = await adapter.chat(
          config,
          [{ role: 'user', content: CONNECTION_TEST_PROMPT }],
          testSettings.maxOutputTokens,
        );
        content = result.content;
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
          testSettings.maxOutputTokens,
        );
        assertVisionTestMarker(visionResult.content);
        content = visionResult.content;
      }
      const response: AiRuntimeResponse = { ok: true, content, models: [config.model], model: config.model };
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

    if (message.type === 'pdf-helper:ai-test-web-retrieval') {
      // Runs before the model is touched: this probe is about the tools endpoint, not about a model.
      return probeWebRetrieval();
    }

    if (message.type === 'pdf-helper:ai-web-search') {
      // Deliberately tolerant of a missing configuration: the caller asked for enrichment, and an answer
      // without it is still an answer.
      const found = await searchForChat({
        query: message.query,
        // The caller sends the user's own question separately; falling back to `query` (which may be a short question
        // plus the document name) is only for callers that do not.
        oriQuestion: message.oriQuestion?.trim() || message.query,
      });
      if (!found) {
        return { ok: false, error: '联网搜索还没有配置 DeepSeek API Key。' };
      }
      return { ok: true, content: '', webSearch: found };
    }

    if (message.type === 'pdf-helper:ai-related-literature') {
      const related = await generateRelatedLiterature(adapter, config, {
        documentName: message.documentName,
        overviewMarkdown: message.overviewMarkdown,
      });
      return {
        ok: true,
        content: related.markdown,
        model: config.model,
        relatedLiterature: {
          markdown: related.markdown,
          usage: related.usage,
          sources: related.sources,
          degraded: related.degraded || undefined,
        },
      };
    }

    if (message.type === 'pdf-helper:ai-generate-document-overview') {
      const result = await generateDocumentOverview(adapter, config, message, onOverviewProgress);
      return { ok: true, ...result };
    }

    if (message.type === 'pdf-helper:ai-extract-entities') {
      if (!message.chunks.length) {
        return { ok: false, error: '没有可抽取的正文片段，请先建立全文索引。' };
      }
      const result = await extractEntities(adapter, config, message);
      return {
        ok: true,
        content: result.content,
        model: config.model,
        // Raw batch metadata travels back to the caller, which owns parsing and
        // decides what to persist about a partially successful run.
        entityExtraction: {
          batchCount: result.batchCount,
          failedBatches: result.failedBatches,
          promptVersion: result.promptVersion,
        },
      };
    }

    if (message.type === 'pdf-helper:ai-judge-relations') {
      if (!message.pairs.length) {
        return { ok: false, error: '没有需要判断的论文对。' };
      }
      const result = await judgeRelations(adapter, config, message);
      return {
        ok: true,
        content: result.content,
        model: config.model,
        // One entry per batch: the caller parses each answer separately. Joined JSON is not JSON, which is exactly how a
        // six-pair run used to look like an unparseable model response.
        relationJudgement: {
          contents: result.contents,
          batchCount: result.batchCount,
          failedBatches: result.failedBatches,
        },
      };
    }

    if (message.type === 'pdf-helper:ai-explain-entities') {
      if (!message.items.length) {
        return { ok: false, error: '没有需要解释的实体。' };
      }
      const result = await explainEntities(adapter, config, message);
      return { ok: true, content: result.content, model: config.model };
    }

    if (message.type === 'pdf-helper:ai-document-metadata') {
      const metadata = await extractDocumentMetadata(adapter, config, {
        documentName: message.documentName,
        text: message.text,
      });
      return { ok: true, content: '', model: config.model, documentMetadata: metadata };
    }

    if (message.type === 'pdf-helper:lookup-bibliographic-metadata') {
      // Free reference databases only — no model call, no money. Whether any candidate is this paper is decided by the
      // viewer's gate, and written only after the user confirms.
      const result = await lookupBibliographicRecords({ title: message.title });
      return {
        ok: true,
        content: '',
        model: config.model,
        bibliographicCandidates: result.candidates,
        bibliographicLookupErrors: result.errors,
      };
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

    const chatMessage = message as Extract<AiRuntimeRequest, { type: 'pdf-helper:ai-chat' }>;
    const result = await adapter.chat(
      config,
      buildConversation(chatMessage.messages, chatMessage.context),
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
