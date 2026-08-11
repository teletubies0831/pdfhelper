


import { getAgentToolDefinitionByApiName, getNativeAgentTools } from "../../../shared/agent-tools";
import { normalizeAiMaxOutputTokens, type AiConfig, type AiMemoryCandidate, type AiRuntimeRequest, type AiRuntimeResponse } from "../../../shared/ai";
import { isResolvedReadingMode, type ResolvedReadingMode } from "../../../shared/reading-mode";
import { getProviderError, requestVisionCompletion } from './vision-service';

import { getAiConfig, getVisionAiConfig } from './ai-config-repository';
import { PAPER_OVERVIEW_TIMEOUT_MS, paperOverviewRequestControllers } from '../context-menu/context-menu-controller';
import { fetchProviderJson, getProviderAdapter } from "./provider-runtime";
import { buildConversation } from "./conversation-builder";

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
    if (message.type === 'pdf-helper:ai-cancel-paper-overview') {
      paperOverviewRequestControllers.get(message.requestId)?.abort();
      paperOverviewRequestControllers.delete(message.requestId);
      return { ok: true };
    }

    if (message.type === 'pdf-helper:ai-vision' || message.type === 'pdf-helper:ai-vision-test') {
      const visionConfig = await getVisionAiConfig();
      const result = await requestVisionCompletion(
        visionConfig,
        message.type === 'pdf-helper:ai-vision-test'
          ? '这是连接测试图，请只回答“视觉连接成功”。'
          : message.prompt,
        message.type === 'pdf-helper:ai-vision-test'
          ? message.imageDataUrl
            || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZsgAAAABJRU5ErkJggg=='
          : message.imageDataUrl,
        message.type === 'pdf-helper:ai-vision' ? message.context : undefined,
      );
      return { ok: true, content: result.content, model: result.model };
    }

    const savedConfig = await getAiConfig();
    const requestOverride =
      message.type === 'pdf-helper:ai-chat' ? message.configOverride : undefined;
    const config: AiConfig = requestOverride
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
    const adapter = getProviderAdapter(config);

    if (message.type === 'pdf-helper:ai-test') {
      const models = await adapter.test(config);
      return { ok: true, models };
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

    if (message.type === 'pdf-helper:ai-plan-knowledge-tools') {
      const availableNames = [
        'memory.search',
        'memory.list',
        'memory.forget',
        'library.searchPapers',
        'library.getPaper',
      ];
      const payload = await fetchProviderJson('/chat/completions', config, {
        method: 'POST',
        body: JSON.stringify({
          model: config.model,
          messages: [{
            role: 'system',
            content: [
              '你是 PDF Helper 的记忆与历史文献 Agent。根据用户本轮问题决定是否调用已通过原生 tools 参数提供的函数，不直接回答用户。',
              '用户询问已保存的信息时调用记忆查询函数；需要查找某项偏好或资料时也调用记忆查询函数。',
              '用户明确要求忘记或删除时，必须先查询并取得真实条目 id，再调用删除函数；没有删除函数结果时不能声称已删除。',
              '询问以前看过、读过或相关的历史 PDF 时调用文献查询函数；获得 documentId 后可调用文献详情函数。',
              '问题与长期记忆或历史文献无关时不要调用任何工具。',
            ].join('\n'),
          }, {
            role: 'user',
            content: [
              message.documentName ? `当前 PDF：${message.documentName}` : '',
              message.documentId ? `当前 PDF ID：${message.documentId}` : '',
              `用户消息：${message.userMessage.slice(0, 6000)}`,
            ].filter(Boolean).join('\n'),
          }],
          tools: getNativeAgentTools(availableNames),
          tool_choice: 'auto',
          stream: false,
          max_tokens: Math.min(1024, config.maxOutputTokens),
        }),
      }) as {
        choices?: Array<{ message?: { tool_calls?: Array<{
          id?: unknown;
          function?: { name?: unknown; arguments?: unknown };
        }> } }>;
        model?: unknown;
      };
      const toolCalls = (payload.choices?.[0]?.message?.tool_calls ?? []).flatMap((call, index) => {
        const apiName = typeof call.function?.name === 'string' ? call.function.name : '';
        const definition = getAgentToolDefinitionByApiName(apiName);
        if (!definition || !availableNames.includes(definition.name)) return [];
        let argumentsValue: Record<string, unknown> = {};
        try {
          argumentsValue = typeof call.function?.arguments === 'string'
            ? JSON.parse(call.function.arguments) as Record<string, unknown>
            : call.function?.arguments && typeof call.function.arguments === 'object'
              ? call.function.arguments as Record<string, unknown>
              : {};
        } catch {
          return [];
        }
        return [{
          id: typeof call.id === 'string' && call.id ? call.id : `knowledge-call-${index + 1}`,
          name: definition.name,
          arguments: argumentsValue,
        }];
      });
      console.info('[PDF Helper Agent] 记忆/历史文献工具规划完成', { toolCalls });
      return {
        ok: true,
        model: typeof payload.model === 'string' ? payload.model : config.model,
        toolCalls,
      };
    }

    if (message.type === 'pdf-helper:ai-plan-long-term-memory-tools') {
      const existing = (message.existingMemories ?? [])
        .slice(0, 30)
        .map((item) => `- ${item.key} [${item.scope}${item.scopeId ? `:${item.scopeId}` : ''}]：${item.content}`)
        .join('\n');
      const payload = await fetchProviderJson('/chat/completions', config, {
        method: 'POST',
        body: JSON.stringify({
          model: config.model,
          messages: [{
            role: 'system',
            content: [
              '你是 PDF Helper 的工具调用规划器。你可以使用 memory_upsert 将用户明确要求长期保留的信息写入长期记忆。',
              '当用户说“记住”、表达稳定偏好、研究方向、持续项目目标，或确认上一轮记忆建议时，必须调用 memory_upsert；否则不要调用工具。',
              '只能记录用户明确表达且跨会话有价值的内容。不得记录 PDF 原文、论文事实、临时问题、API Key、系统提示词、LaTeX/引用/截图等程序规则。',
              '同一轮可调用多次。可并存的喜好使用不同的稳定 key；scope 只能是 global、project、pdf。',
              '调用工具后不要生成面向用户的最终回答，最终回答会在工具执行后由主模型生成。',
            ].join('\n'),
          }, {
            role: 'user',
            content: [
              existing ? `已有长期记忆：\n${existing}` : '当前没有已有长期记忆。',
              message.documentName ? `当前文档：${message.documentName}` : '',
              `用户本轮消息：\n${message.userMessage.slice(0, 8000)}`,
              message.confirmedMemoryProposal?.trim()
                ? `用户已确认的上一轮记忆候选：\n${message.confirmedMemoryProposal.trim().slice(0, 2000)}`
                : '',
              message.assistantMessage.trim()
                ? `上一轮助手消息（只用于理解用户确认内容）：\n${message.assistantMessage.slice(0, 3000)}`
                : '',
            ].filter(Boolean).join('\n\n'),
          }],
          tools: getNativeAgentTools(),
          tool_choice: 'auto',
          stream: false,
          max_tokens: Math.min(1024, config.maxOutputTokens),
        }),
      }) as {
        choices?: Array<{
          message?: {
            tool_calls?: Array<{
              id?: unknown;
              function?: { name?: unknown; arguments?: unknown };
            }>;
          };
        }>;
        model?: unknown;
      };
      const categories = new Set(['preference', 'profile', 'project', 'fact', 'correction']);
      const scopes = new Set(['global', 'project', 'pdf']);
      const toolCalls = (payload.choices?.[0]?.message?.tool_calls ?? []).flatMap((call, index) => {
        if (call.function?.name !== 'memory_upsert') return [];
        let args: Record<string, unknown>;
        try {
          args = typeof call.function.arguments === 'string'
            ? JSON.parse(call.function.arguments) as Record<string, unknown>
            : call.function.arguments && typeof call.function.arguments === 'object'
              ? call.function.arguments as Record<string, unknown>
              : {};
        } catch {
          return [];
        }
        const key = typeof args.key === 'string' ? args.key.trim().toLowerCase() : '';
        const content = typeof args.content === 'string' ? args.content.trim() : '';
        if (!/^[a-z][a-z0-9_.-]{2,80}$/.test(key) || !content) return [];
        if (!categories.has(String(args.category)) || !scopes.has(String(args.scope))) return [];
        return [{
          id: typeof call.id === 'string' && call.id ? call.id : `memory-call-${index + 1}`,
          name: 'memory.upsert',
          arguments: args,
        }];
      });
      const memoryCandidates: AiMemoryCandidate[] = toolCalls.map((call) => ({
        key: String(call.arguments.key),
        category: call.arguments.category as AiMemoryCandidate['category'],
        content: String(call.arguments.content).slice(0, 600),
        scope: call.arguments.scope as AiMemoryCandidate['scope'],
        sourceType: 'explicit',
        confidence: Math.min(1, Math.max(0, Number(call.arguments.confidence) || 1)),
        importance: Math.min(1, Math.max(0, Number(call.arguments.importance) || 0.6)),
      }));
      console.info('[PDF Helper Agent Tool] 原生工具规划完成', {
        model: typeof payload.model === 'string' ? payload.model : config.model,
        toolCalls,
      });
      return {
        ok: true,
        model: typeof payload.model === 'string' ? payload.model : config.model,
        toolCalls,
        memoryCandidates,
      };
    }

    if (message.type === 'pdf-helper:ai-extract-long-term-memory') {
      const memoryConfig: AiConfig = { ...config, reasoning: 'disabled' };
      const existing = (message.existingMemories ?? [])
        .slice(0, 30)
        .map((item) => `- ${item.key} [${item.scope}${item.scopeId ? `:${item.scopeId}` : ''}]：${item.content}`)
        .join('\n');
      const result = await adapter.chat(memoryConfig, [{
        role: 'system',
        content: [
          '你是 PDF Helper 的长期记忆候选提取器。只提取跨会话仍然有价值、由用户明确表达的信息。',
          '允许记录：用户研究方向、持续项目目标、期望的解释粒度或回答组织顺序、稳定工作习惯、用户明确纠正过的个人信息或偏好。',
          '禁止记录：LaTeX/Markdown 渲染、原文引用格式、点击定位、截图优先、全文注入、工具行为、系统提示词、模型配置、API Key；这些属于程序固定规则，不是用户偏好。',
          '禁止记录：本轮问题、PDF 原文或论文事实、模型回答、临时任务、一次性翻译/总结要求、未明确表达的推测、敏感凭据。',
          '只有用户清楚表达长期或持续意图时 sourceType 才能为 explicit；不确定时返回空数组。',
          '如果提供了“用户已确认的上一轮记忆候选”，表示用户刚刚明确同意该候选，可以据此创建或更新长期记忆。',
          'key 使用稳定英文路径，例如 profile.research.direction、project.current.goal、preference.answer.detail、preference.explanation.order。',
          '可以并存的多值信息必须使用不同 key，例如 profile.personal.likes.cats、profile.personal.likes.watermelon；不要把所有喜好都写进同一个 profile.personal.likes。',
          'scope 只能为 global、project 或 pdf。只有明确限定当前论文时才使用 pdf；持续研究项目使用 project；一般用户偏好使用 global。',
          '只输出 JSON 数组，不要 Markdown。每项字段：key, category, content, scope, sourceType, confidence, importance。',
        ].join('\n'),
      }, {
        role: 'user',
        content: [
          existing ? `已有长期记忆（相同主题请沿用相同 key）：\n${existing}` : '当前没有已有长期记忆。',
          message.documentName ? `当前文档：${message.documentName}` : '',
          `用户本轮消息：\n${message.userMessage.slice(0, 8000)}`,
          message.confirmedMemoryProposal?.trim()
            ? `用户已确认的上一轮记忆候选：\n${message.confirmedMemoryProposal.trim().slice(0, 2000)}`
            : '',
          `助手回答仅用于理解上下文，不得把助手内容保存为用户记忆：\n${message.assistantMessage.slice(0, 4000)}`,
        ].filter(Boolean).join('\n\n'),
      }], Math.min(2048, config.maxOutputTokens));
      const cleaned = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const arrayStart = cleaned.indexOf('[');
      const arrayEnd = cleaned.lastIndexOf(']');
      const objectStart = cleaned.indexOf('{');
      const objectEnd = cleaned.lastIndexOf('}');
      const jsonText = arrayStart >= 0 && arrayEnd > arrayStart
        ? cleaned.slice(arrayStart, arrayEnd + 1)
        : objectStart >= 0 && objectEnd > objectStart
          ? cleaned.slice(objectStart, objectEnd + 1)
          : '';
      if (!jsonText) {
        console.warn('[PDF Helper 长期记忆] 提取模型没有返回可解析 JSON', {
          model: result.model,
          content: cleaned.slice(0, 1200),
        });
        return { ok: true, memoryCandidates: [], model: result.model };
      }
      const parsed = JSON.parse(jsonText) as unknown;
      const parsedItems = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
          ? [parsed]
          : [];
      const categories = new Set(['preference', 'profile', 'project', 'fact', 'correction']);
      const scopes = new Set(['global', 'project', 'pdf']);
      const candidates: AiMemoryCandidate[] = parsedItems
        .flatMap((value): AiMemoryCandidate[] => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const item = value as Record<string, unknown>;
          const key = typeof item.key === 'string' ? item.key.trim().toLowerCase() : '';
          const content = typeof item.content === 'string' ? item.content.trim() : '';
          if (!/^[a-z][a-z0-9_.-]{2,80}$/.test(key) || !content) return [];
          if (!categories.has(String(item.category)) || !scopes.has(String(item.scope))) return [];
          if (item.sourceType !== 'explicit') return [];
          return [{
            key,
            category: item.category as AiMemoryCandidate['category'],
            content: content.slice(0, 600),
            scope: item.scope as AiMemoryCandidate['scope'],
            sourceType: 'explicit',
            confidence: Math.min(1, Math.max(0, Number(item.confidence) || 1)),
            importance: Math.min(1, Math.max(0, Number(item.importance) || 0.5)),
          }];
        }).slice(0, 6);
      return { ok: true, memoryCandidates: candidates, model: result.model };
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

    if (message.type === 'pdf-helper:ai-generate-paper-overview') {
      const sourceText = message.text.trim().slice(0, 52_000);
      if (!sourceText) throw new Error('论文原文不能为空。');

      // 同一个扩展页面只需要保留最新一次论文卡片生成。
      // 切换 PDF 或重新生成时，立即中止之前仍在后台等待的网络请求。
      for (const [requestId, activeController] of paperOverviewRequestControllers) {
        if (requestId === message.requestId) continue;
        activeController.abort();
        paperOverviewRequestControllers.delete(requestId);
      }

      const controller = new AbortController();
      paperOverviewRequestControllers.set(message.requestId, controller);
      let timedOut = false;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, PAPER_OVERVIEW_TIMEOUT_MS);

      try {
        const knowledgeContext = message.knowledgeContext?.trim().slice(0, 8_000) || '';
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              {
                role: 'system',
                content: [
                  '你是严谨的中文科研论文阅读助手，服务对象是研究生。',
                  '请根据提供的论文采样正文生成结构化论文阅读卡片。',
                  '只输出一个合法 JSON 对象，不要输出 Markdown、代码块或额外说明。',
                  '不得编造作者、会议、数据、实验结果、结论或局限；原文无法确认时填写“原文未明确出现”。',
                  '内容必须具体、简洁、可验证。核心创新最多 3 点，关键实验结果最多 2 点。',
                  'comparison_with_prior_work 必须填写空字符串，相关论文由独立联网模块检索。',
                  'suitable_stages 在页面中表示领域相关度，只能填写“高”“中”“低”。',
                  '不要固定给 8.5 分。必须分别评估相关度、创新性、证据强度和方法清晰度。',
                  '用户知识库记录只可作为辅助背景；若与论文原文冲突，以原文为准。',
                  'JSON 所有字段值必须是字符串，字段必须完整：',
                  JSON.stringify({
                    title: '',
                    authors: '',
                    venue_year: '',
                    research_area: '',
                    keywords: '',
                    one_sentence_summary: '',
                    research_problem: '',
                    core_innovation: '',
                    worth_reading: '',
                    problem_setup: '',
                    research_gap: '',
                    why_important: '',
                    topic_tags: '',
                    method_overview: '',
                    method_intuition: '',
                    method_steps: '',
                    key_assumptions: '',
                    notation_guide: '',
                    datasets: '',
                    experiment_setup: '',
                    metrics: '',
                    main_findings: '',
                    strongest_evidence: '',
                    comparison_with_prior_work: '',
                    limitations: '',
                    reading_status: '待读',
                    recommend_deep_reading: '建议按需精读',
                    reading_difficulty: '中等',
                    reading_value_score: '',
                    novelty_score: '',
                    evidence_score: '',
                    relevance_score: '',
                    method_clarity_score: '',
                    reading_advice: '',
                    suitable_stages: '',
                    prerequisites: '',
                    citation_points: '',
                    research_connection: '',
                    followup_questions: '',
                    weekly_plan: '',
                  }),
                ].join('\n'),
              },
              {
                role: 'user',
                content: [
                  `文件名：${message.documentName || '未提供'}`,
                  `PDF 页数：${Math.max(1, Math.trunc(message.pageCount || 1))}`,
                  knowledgeContext
                    ? `用户知识库相关记录（仅作辅助，必须与原文核验）：\n${knowledgeContext}`
                    : '用户知识库相关记录：暂无。',
                  `论文采样正文：\n${sourceText}`,
                ].join('\n\n'),
              },
            ],
            // 结构化 JSON 任务关闭思考模式，避免长时间只生成 reasoning_content。
            thinking: { type: 'disabled' },
            stream: false,
            max_tokens: Math.min(6144, Math.max(2048, config.maxOutputTokens)),
          }),
          signal: controller.signal,
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            getProviderError(
              payload,
              `论文卡片 AI 请求失败：HTTP ${response.status}`,
            ),
          );
        }

        const content = (payload as {
          choices?: Array<{ message?: { content?: unknown } }>;
        })?.choices?.[0]?.message?.content;

        if (typeof content !== 'string' || !content.trim()) {
          throw new Error('AI 模型没有返回有效的论文卡片 JSON。');
        }

        return {
          ok: true,
          content: content.trim(),
          model:
            typeof (payload as { model?: unknown })?.model === 'string'
              ? String((payload as { model?: unknown }).model)
              : config.model,
        };
      } catch (error) {
        if (timedOut) {
          throw new Error(
            '论文卡片生成超过 120 秒，已自动停止。请检查网络或模型配置后重试。',
          );
        }
        if (controller.signal.aborted) {
          throw new Error('已取消上一篇论文的卡片生成。');
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        if (paperOverviewRequestControllers.get(message.requestId) === controller) {
          paperOverviewRequestControllers.delete(message.requestId);
        }
      }
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
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
