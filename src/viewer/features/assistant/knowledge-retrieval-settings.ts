import {
  EMBEDDING_MODEL_PRESETS,
  knowledgeLibrary,
  knowledgeRetrievalService,
  resolveEmbeddingModel,
  type KnowledgeRetrievalMode,
} from '../../../modules/knowledge/public';
import {
  applyKnowledgeRetrievalSettingsButton,
  knowledgeCustomEmbeddingModelField,
  knowledgeCustomEmbeddingModelInput,
  knowledgeEmbeddingActiveStatus,
  knowledgeEmbeddingModelSelect,
  knowledgeEmbeddingProgress,
  knowledgeEmbeddingProgressLabel,
  knowledgeRetrievalModeSelect,
} from '../../app/viewer-elements';
import { showSettingsStatus } from './settings-navigation';
import { listHistoricalDocumentSemanticSources } from './historical-document-sources';

const CUSTOM_MODEL_VALUE = '__custom__';

function formatBytes(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return '';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function selectedModelId(): string {
  return knowledgeEmbeddingModelSelect.value === CUSTOM_MODEL_VALUE
    ? knowledgeCustomEmbeddingModelInput.value.trim()
    : knowledgeEmbeddingModelSelect.value;
}

function syncCustomModelField(): void {
  knowledgeCustomEmbeddingModelField.hidden =
    knowledgeEmbeddingModelSelect.value !== CUSTOM_MODEL_VALUE;
}

function renderEmbeddingStatus(): void {
  const settings = knowledgeRetrievalService.getSettings();
  const model = resolveEmbeddingModel(settings.modelId);
  const loadedModelId = knowledgeRetrievalService.getLoadedModelId();
  const modeLabel: Record<KnowledgeRetrievalMode, string> = {
    keyword: '关键词与元数据',
    semantic: '本地语义',
    hybrid: '关键词 + 本地语义',
  };
  knowledgeEmbeddingActiveStatus.textContent = settings.mode === 'keyword'
    ? `当前启用：${modeLabel[settings.mode]}；embedding 未启动`
    : `当前启用：${modeLabel[settings.mode]} · ${model.label}（${loadedModelId === model.id ? '已加载到内存' : '按需加载'}）`;
}

export function initializeKnowledgeRetrievalSettings(): void {
  if (!knowledgeEmbeddingModelSelect.options.length) {
    for (const model of EMBEDDING_MODEL_PRESETS) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = `${model.label} · ${model.approximateSizeMb ?? '?'} MB`;
      knowledgeEmbeddingModelSelect.append(option);
    }
    const customOption = document.createElement('option');
    customOption.value = CUSTOM_MODEL_VALUE;
    customOption.textContent = '自定义 Hugging Face 模型…';
    knowledgeEmbeddingModelSelect.append(customOption);
  }

  const settings = knowledgeRetrievalService.getSettings();
  knowledgeRetrievalModeSelect.value = settings.mode;
  const preset = EMBEDDING_MODEL_PRESETS.some((model) => model.id === settings.modelId);
  knowledgeEmbeddingModelSelect.value = preset ? settings.modelId : CUSTOM_MODEL_VALUE;
  knowledgeCustomEmbeddingModelInput.value = preset ? '' : settings.modelId;
  syncCustomModelField();
  knowledgeEmbeddingProgress.hidden = true;
  knowledgeEmbeddingProgressLabel.textContent = '';
  renderEmbeddingStatus();
}

export function handleKnowledgeEmbeddingModelSelection(): void {
  syncCustomModelField();
}

export async function applyKnowledgeRetrievalSettings(): Promise<void> {
  const current = knowledgeRetrievalService.getSettings();
  const mode = knowledgeRetrievalModeSelect.value as KnowledgeRetrievalMode;
  const modelId = selectedModelId();
  if (!modelId) {
    showSettingsStatus('请输入有效的 Hugging Face Model ID。', 'error');
    knowledgeCustomEmbeddingModelInput.focus();
    return;
  }

  if (mode === 'keyword') {
    await knowledgeRetrievalService.unloadModel();
    knowledgeRetrievalService.saveSettings({ mode, modelId });
    renderEmbeddingStatus();
    showSettingsStatus('已启用关键词与元数据检索，不会加载 embedding 模型。', 'success');
    return;
  }

  const model = resolveEmbeddingModel(modelId);
  const switchingModel = current.modelId !== modelId;
  const enablingEmbedding = current.mode === 'keyword';
  const sizeLabel = model.approximateSizeMb
    ? `，需要下载约 ${model.approximateSizeMb} MB`
    : '';
  const confirmation = switchingModel
    ? `切换到“${model.label}”后，旧模型生成的向量不能继续使用，需要为知识库和历史 PDF 全文重建索引${sizeLabel}。是否继续？`
    : enablingEmbedding
      ? `启用“${model.label}”后需要加载本地模型，并为知识库和历史 PDF 全文建立向量索引${sizeLabel}。是否继续？`
      : `将加载“${model.label}”并确认当前向量索引可用。是否继续？`;
  if (!window.confirm(confirmation)) {
    initializeKnowledgeRetrievalSettings();
    return;
  }

  applyKnowledgeRetrievalSettingsButton.disabled = true;
  knowledgeRetrievalModeSelect.disabled = true;
  knowledgeEmbeddingModelSelect.disabled = true;
  knowledgeCustomEmbeddingModelInput.disabled = true;
  knowledgeEmbeddingProgress.hidden = false;
  knowledgeEmbeddingProgress.value = 0;
  showSettingsStatus('正在加载本地 embedding 模型…', 'progress');

  try {
    const updateDownloadProgress = (progress: {
      status: 'loading' | 'ready';
      file?: string;
      progress?: number;
      loaded?: number;
      total?: number;
    }) => {
      const percent = Math.max(0, Math.min(100, progress.progress ?? 0));
      knowledgeEmbeddingProgress.value = percent;
      const transferred = progress.total
        ? `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
        : '';
      const file = progress.file?.split('/').at(-1) ?? '';
      knowledgeEmbeddingProgressLabel.textContent = progress.status === 'ready'
        ? '模型已加载，正在准备向量索引…'
        : [`下载 ${Math.round(percent)}%`, transferred, file].filter(Boolean).join(' · ');
    };

    await knowledgeRetrievalService.loadModel(modelId, updateDownloadProgress);
    if (switchingModel || enablingEmbedding) {
      const records = [
        ...knowledgeLibrary.list(),
        ...await listHistoricalDocumentSemanticSources(),
      ];
      await knowledgeRetrievalService.rebuildIndex(records, modelId, {
        onModelProgress: updateDownloadProgress,
        onProgress: (message) => {
          knowledgeEmbeddingProgressLabel.textContent = message;
        },
      });
    }
    knowledgeRetrievalService.saveSettings({ mode, modelId });
    knowledgeEmbeddingProgress.value = 100;
    knowledgeEmbeddingProgressLabel.textContent = '模型已加载，向量索引已准备完成。';
    renderEmbeddingStatus();
    showSettingsStatus(`已启用“${model.label}”。`, 'success');
  } catch (error) {
    showSettingsStatus(
      `本地 embedding 启用失败：${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    initializeKnowledgeRetrievalSettings();
  } finally {
    applyKnowledgeRetrievalSettingsButton.disabled = false;
    knowledgeRetrievalModeSelect.disabled = false;
    knowledgeEmbeddingModelSelect.disabled = false;
    knowledgeCustomEmbeddingModelInput.disabled = false;
  }
}
