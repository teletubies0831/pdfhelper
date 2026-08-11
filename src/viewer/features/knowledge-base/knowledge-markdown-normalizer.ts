
















export function normalizeKnowledgeEditorSections(content: string): string {
  const sectionNames = new Set([
    "原文",
    "原文内容",
    "原文证据",
    "翻译",
    "原句翻译",
    "句子翻译",
    "中文翻译",
    "重点词汇",
    "重点词汇解析",
    "词汇解析",
    "语法解析",
    "语法分析",
    "核心观点",
    "核心结论",
    "我的判断",
    "研究价值",
    "下一步",
    "下一步行动",
    "复现计划",
  ]);

  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim().replace(/[：:]$/, "");
      if (
        trimmed &&
        sectionNames.has(trimmed) &&
        !line.trimStart().startsWith("#")
      ) {
        return `## ${trimmed}`;
      }
      return line;
    })
    .join("\n");
}

export function normalizeKnowledgeEditorMathIndex(value: string): string {
  const normalized = value.trim();
  if (/^[0-9]+$/.test(normalized)) return normalized;
  return normalized.toLocaleLowerCase("en-US");
}

export function normalizeKnowledgeEditorMathOperator(value: string): string {
  return {
    "≤": "\\le",
    "≥": "\\ge",
    "≠": "\\ne",
    "!=": "\\ne",
    "∈": "\\in",
    "∉": "\\notin",
    "⊆": "\\subseteq",
    "⊂": "\\subset",
    "∪": "\\cup",
    "∩": "\\cap",
  }[value] || value;
}

export function normalizeKnowledgeEditorFormulaArguments(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[⋯…]|(?:\.\s*){3}/g, String.raw`\ldots `)
    .replace(/·\s*·\s*·/g, String.raw`\ldots `)
    .replace(/\b([A-Za-z])\s*_?\s*([0-9]+)\b/g, "$1_{$2}")
    .replace(
      /\b([qQxXyYmMkKuUvV])\s*_?\s*([iIjJkKnNmMuUvVbB])\b/g,
      "$1_{$2}",
    )
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

export function normalizeKnowledgeEditorMathExpression(value: string): string {
  let expression = value
    .replace(/[“”]/g, '"')
    .replace(/[⋯…]|(?:\.\s*){3}/g, String.raw`\ldots `)
    .replace(/·\s*·\s*·/g, String.raw`\ldots `)
    .replace(/\bfor\s+all\b/gi, String.raw`\forall `)
    .replace(/∀/g, String.raw`\forall `)
    .replace(/∈/g, String.raw`\in `)
    .replace(/∉/g, String.raw`\notin `)
    .replace(/⊆/g, String.raw`\subseteq `)
    .replace(/⊂/g, String.raw`\subset `)
    .replace(/∪/g, String.raw`\cup `)
    .replace(/∩/g, String.raw`\cap `);

  // PDF 文本抽取常把 F_k(x_i) 拆成 F k (x i)。
  expression = expression.replace(
    /\b([A-Z])\s+(key|hint|oprf|prf|[a-z])\s*\(\s*([^()\n]{1,180})\s*\)/gi,
    (_match, fn: string, subscript: string, args: string) =>
      `${fn}_{${subscript.toLocaleLowerCase("en-US")}}(${normalizeKnowledgeEditorFormulaArguments(args)})`,
  );

  // F opr f 这类被拆开的多字母下标。
  expression = expression.replace(
    /\bF\s+opr\s*f\b/gi,
    String.raw`F_{\mathrm{oprf}}`,
  );

  // F(·)(·) 与普通 F(x)。
  expression = expression.replace(
    /\b([A-Z])\s*\(\s*[·.]\s*\)\s*\(\s*[·.]\s*\)/g,
    (_match, fn: string) => `${fn}(\\cdot)(\\cdot)`,
  );
  expression = expression.replace(
    /\b([A-Z][A-Za-z0-9]*)\s*\(\s*([^()\n]{1,180})\s*\)/g,
    (_match, fn: string, args: string) =>
      `${fn}(${normalizeKnowledgeEditorFormulaArguments(args)})`,
  );

  // 连写或带空格的下标变量：x1、x i、q_v、y u。
  expression = expression.replace(
    /\b([qQxXyYmMkKuUvV])\s*_?\s*([0-9]+|[iIjJkKnNmMuUvVbB])\b/g,
    (_match, variable: string, index: string) =>
      `${variable.toLocaleLowerCase("en-US")}_{${normalizeKnowledgeEditorMathIndex(index)}}`,
  );

  // 数学区间和集合。
  expression = expression
    .replace(/\[\s*([0-9A-Za-z]+)\s*,\s*([0-9A-Za-z]+)\s*\]/g, "[$1,$2]")
    .replace(/\{\s*/g, String.raw`\{`)
    .replace(/\s*\}/g, String.raw`\}`)
    .replace(/\s*\|\s*/g, String.raw`\mid `);

  // 统一运算符周围空格。
  expression = expression
    .replace(/\s*(=|≤|≥|≠|!=|<|>)\s*/g, (_match, operator: string) =>
      normalizeKnowledgeEditorMathOperator(operator),
    )
    .replace(/\s*\\in\s*/g, String.raw`\in `)
    .replace(/\s*\\notin\s*/g, String.raw`\notin `)
    .replace(/\s*\\forall\s*/g, String.raw`\forall `)
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  return expression;
}

export function looksLikeKnowledgeEditorMath(value: string): boolean {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return false;

  const hasMathSymbol =
    /[=<>≤≥≠∈∉∀∩∪{}[\]|⋯…]/.test(compact) ||
    /(?:\.\s*){3}/.test(compact);
  const hasIndexedVariable =
    /\b[qQxXyYmMkKuUvV]\s*_?\s*(?:[0-9]+|[iIjJkKnNmMuUvVbB])\b/.test(
      compact,
    );
  const hasFunction =
    /\b[A-Z]\s+(?:key|hint|oprf|prf|[a-z])\s*\(/i.test(compact) ||
    /\b[A-Z][A-Za-z0-9]*\s*\(/.test(compact);

  return hasMathSymbol || hasIndexedVariable || hasFunction;
}

export function normalizeKnowledgeEditorBareMath(content: string): string {
  const preserved: string[] = [];
  const preserve = (value: string): string => {
    const index = preserved.push(value) - 1;
    return `PDFHELPERKEEPMATH${index}END`;
  };
  const preserveInline = (expression: string): string =>
    preserve(`$${expression.trim()}$`);

  let normalized = content
    .replace(/\$\$[\s\S]+?\$\$/g, preserve)
    .replace(/\\\[[\s\S]+?\\\]/g, preserve)
    .replace(/\\\([\s\S]+?\\\)/g, preserve)
    .replace(/(^|[^\\$])\$[^$\r\n]+?\$/g, (match) => preserve(match));

  // 1. 先处理完整赋值和集合构造式：
  // V = {F_k(y_i) | ∀ y_i ∈ Y}
  // I = {x | F_k(x_i) ∈ V, ∀ i ∈ [m]}
  normalized = normalized.replace(
    /\b([A-Z])\s*=\s*(\{[^{}\n]{2,520}\})/g,
    (match) =>
      looksLikeKnowledgeEditorMath(match)
        ? preserveInline(normalizeKnowledgeEditorMathExpression(match))
        : match,
  );

  // 2. 单独出现的集合和点序列。
  normalized = normalized.replace(
    /\{[^{}\n]{2,520}\}/g,
    (match) =>
      looksLikeKnowledgeEditorMath(match)
        ? preserveInline(normalizeKnowledgeEditorMathExpression(match))
        : match,
  );

  // 3. 量词和成员关系：
  // x_i, ∀i∈[m]
  // ∀ y_i ∈ Y \ I
  normalized = normalized.replace(
    /(?:\b[qQxXyYmMuUvV]\s*_?\s*[iIjJkKnNmMuUvV]\s*,?\s*)?(?:∀|for\s+all)\s*[iIjJkKnNmMuUvV]\s*(?:∈|\\in|\bin\b)\s*(?:\[[^\]\n]{1,60}\]|[A-Z](?:\s*[\\\-]\s*[A-Z])?)/gi,
    (match) =>
      preserveInline(normalizeKnowledgeEditorMathExpression(match)),
  );

  // 4. 带索引范围：
  // x_i, i∈[1,u]
  normalized = normalized.replace(
    /\b([qQxXyYmMuUvV])\s*_?\s*([iIjJkKnNmMuUvV])\s*,\s*\2\s*(?:∈|\\in|\bin\b)\s*\[\s*([0-9A-Za-z]+)\s*,\s*([0-9A-Za-z]+)\s*\]/g,
    (match) =>
      preserveInline(normalizeKnowledgeEditorMathExpression(match)),
  );

  // 5. 函数序列：
  // F k (x1), F k (x2), ..., F k (xm)
  normalized = normalized.replace(
    /\b[A-Z]\s+(?:key|hint|oprf|prf|[a-z])\s*\([^()\n]{1,80}\)(?:\s*,\s*(?:\.\s*){3}\s*,\s*[A-Z]\s+(?:key|hint|oprf|prf|[a-z])\s*\([^()\n]{1,80}\)|(?:\s*,\s*[A-Z]\s+(?:key|hint|oprf|prf|[a-z])\s*\([^()\n]{1,80}\)){1,8})/gi,
    (match) =>
      preserveInline(normalizeKnowledgeEditorMathExpression(match)),
  );

  // 6. 单个带下标函数：
  // F k(x_i)、F hint(q_i)、F_key(x)
  normalized = normalized.replace(
    /\b([A-Z])\s+(key|hint|oprf|prf|[a-z])\s*\(\s*([^()\n]{1,180})\s*\)/gi,
    (match) =>
      preserveInline(normalizeKnowledgeEditorMathExpression(match)),
  );

  // 7. 普通函数，但排除 e.g. 和纯参考文献括号。
  normalized = normalized.replace(
    /\b([A-Z][A-Za-z0-9]*)\s*\(\s*([^()\n]{1,180})\s*\)/g,
    (match, _functionName: string, args: string) => {
      if (/\be\.?\s*g\.?\b/i.test(args) || /^\s*\d+(?:\s*,\s*\d+)*\s*$/.test(args)) {
        return match;
      }
      return looksLikeKnowledgeEditorMath(match)
        ? preserveInline(normalizeKnowledgeEditorMathExpression(match))
        : match;
    },
  );

  // 8. 同一变量序列：
  // x1, x2, ..., xm
  normalized = normalized.replace(
    /\b([qQxXyYmMuUvV])\s*_?\s*([0-9]+|[iIjJkKnNmMuUvV])(?:\s*,\s*\1\s*_?\s*([0-9]+|[iIjJkKnNmMuUvV]))?\s*,?\s*(?:\.\s*){3}\s*,?\s*\1\s*_?\s*([0-9]+|[iIjJkKnNmMuUvV])\b/g,
    (match) =>
      preserveInline(normalizeKnowledgeEditorMathExpression(match)),
  );

  // 9. 索引变量相等、成员关系和简单赋值。
  normalized = normalized.replace(
    /\b[qQxXyYmMuUvV]\s*_?\s*(?:[0-9]+|[iIjJkKnNmMuUvV])\s*(?:=|equals?|∈|∉|\\in|\\notin)\s*(?:[qQxXyYmMuUvV]\s*_?\s*(?:[0-9]+|[iIjJkKnNmMuUvV])|[A-Z]|\[[^\]\n]{1,50}\])/gi,
    (match) =>
      preserveInline(normalizeKnowledgeEditorMathExpression(match)),
  );

  normalized = normalized.replace(
    /\b([a-zA-Z])\s*(=|≤|≥|<|>|!=|≠)\s*([0-9]+|[a-zA-Z])\b/g,
    (match) =>
      preserveInline(normalizeKnowledgeEditorMathExpression(match)),
  );

  // 10. 剩余单独索引变量。
  normalized = normalized.replace(
    /\b([qQxXyYmMkKuUvV])\s*_?\s*([0-9]+|[iIjJkKnNmMuUvVbB])\b/g,
    (match) =>
      preserveInline(normalizeKnowledgeEditorMathExpression(match)),
  );

  return normalized.replace(
    /PDFHELPERKEEPMATH(\d+)END/g,
    (_match, index: string) => preserved[Number(index)] || "",
  );
}

export function prepareKnowledgeEditorMarkdown(content: string): string {
  return normalizeKnowledgeEditorBareMath(
    normalizeKnowledgeEditorSections(content),
  );
}
