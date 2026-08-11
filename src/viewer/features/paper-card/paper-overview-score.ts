







import type { PaperOverviewApiResponse } from "../../core/pdf-reader/public";



export function normalizePaperOverviewField(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "原文未明确出现";
}

export function parsePaperScore(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.trim())
        : Number.NaN;

  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 10
    ? numeric
    : null;
}

export function hasUsefulPaperField(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return Boolean(
    normalized &&
    normalized !== "原文未明确出现" &&
    normalized !== "未明确" &&
    normalized !== "无",
  );
}

export function computePaperReadingValueScore(
  payload: PaperOverviewApiResponse,
): string {
  const components = [
    {
      value: parsePaperScore(payload.relevance_score),
      weight: 0.35,
    },
    {
      value: parsePaperScore(payload.novelty_score),
      weight: 0.25,
    },
    {
      value: parsePaperScore(payload.evidence_score),
      weight: 0.25,
    },
    {
      value: parsePaperScore(payload.method_clarity_score),
      weight: 0.15,
    },
  ].filter(
    (component): component is { value: number; weight: number } =>
      component.value !== null,
  );

  if (components.length >= 3) {
    const totalWeight = components.reduce(
      (sum, component) => sum + component.weight,
      0,
    );
    const weightedScore = components.reduce(
      (sum, component) =>
        sum + component.value * component.weight,
      0,
    ) / totalWeight;

    return Math.min(9.8, Math.max(1, weightedScore)).toFixed(1);
  }

  const modelScore = parsePaperScore(payload.reading_value_score);
  const neutralModelScore = modelScore !== null && Math.abs(modelScore - 8.5) < 0.001;
  let score = neutralModelScore ? 5.8 : (modelScore ?? 5.8);

  const relevance = normalizePaperOverviewField(payload.suitable_stages);
  if (relevance === "高") score += 1.0;
  else if (relevance === "中") score += 0.25;
  else if (relevance === "低") score -= 1.0;

  const recommendation = normalizePaperOverviewField(
    payload.recommend_deep_reading,
  );
  if (recommendation === "建议精读") score += 0.9;
  else if (recommendation === "建议按需精读") score += 0.2;
  else if (recommendation === "暂不建议精读") score -= 1.1;

  const difficulty = normalizePaperOverviewField(payload.reading_difficulty);
  if (difficulty === "较难") score -= 0.15;

  if (hasUsefulPaperField(payload.core_innovation)) score += 0.45;
  else score -= 0.6;

  if (hasUsefulPaperField(payload.main_findings)) score += 0.35;
  else score -= 0.35;

  if (hasUsefulPaperField(payload.strongest_evidence)) score += 0.3;
  else score -= 0.3;

  if (hasUsefulPaperField(payload.research_connection)) score += 0.25;
  if (hasUsefulPaperField(payload.citation_points)) score += 0.15;

  return Math.min(9.8, Math.max(1, score)).toFixed(1);
}
