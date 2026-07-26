from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI(title="PDF Helper AI API")

# Local development: allow the browser extension page to access this backend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)
    target_language: str = Field(default="简体中文", min_length=1, max_length=50)


class TranslateResponse(BaseModel):
    translation: str


class ExplainRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)


class ExplainResponse(BaseModel):
    explanation: list[str]


class SummarizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)
    scope: str = Field(default="当前选中文本", max_length=50)
    source: str = Field(default="", max_length=100)
    position: str = Field(default="", max_length=200)


class SummarizeResponse(BaseModel):
    summary: list[str]


class GenerateCardRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)
    card_type: str = Field(default="方法", min_length=1, max_length=20)
    document_title: str = Field(default="", max_length=300)
    page_number: int = Field(default=1, ge=1, le=100_000)
    position: str = Field(default="", max_length=300)


class GenerateCardResponse(BaseModel):
    title: str
    explanation: str
    key_points: list[str]
    purpose: str
    understanding: str


class GeneratePaperOverviewRequest(BaseModel):
    text: str = Field(min_length=1, max_length=60_000)
    document_name: str = Field(default="", max_length=300)
    page_count: int = Field(default=1, ge=1, le=100_000)


class GeneratePaperOverviewResponse(BaseModel):
    title: str
    authors: str
    venue_year: str
    research_area: str
    keywords: str
    one_sentence_summary: str
    research_problem: str
    core_innovation: str
    worth_reading: str
    problem_setup: str
    research_gap: str
    why_important: str
    topic_tags: str
    method_overview: str
    method_intuition: str
    method_steps: str
    key_assumptions: str
    notation_guide: str
    datasets: str
    experiment_setup: str
    metrics: str
    main_findings: str
    strongest_evidence: str
    comparison_with_prior_work: str
    limitations: str
    reading_status: str
    recommend_deep_reading: str
    reading_difficulty: str
    reading_value_score: str
    reading_advice: str
    suitable_stages: str
    prerequisites: str
    citation_points: str
    research_connection: str
    followup_questions: str
    weekly_plan: str


def get_required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise HTTPException(status_code=500, detail=f"服务器缺少环境变量：{name}")
    return value


def chat_completions_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


async def request_llm(
    messages: list[dict[str, str]],
    temperature: float = 0.1,
) -> str:
    api_key = get_required_env("LLM_API_KEY")
    base_url = get_required_env("LLM_BASE_URL")
    model = get_required_env("LLM_MODEL")

    payload: dict[str, Any] = {
        "model": model,
        "temperature": temperature,
        "messages": messages,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                chat_completions_url(base_url),
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"无法连接模型服务：{exc}",
        ) from exc

    if response.is_error:
        detail = response.text[:500]
        raise HTTPException(
            status_code=502,
            detail=f"模型服务返回错误 {response.status_code}：{detail}",
        )

    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail="模型服务返回的数据格式不正确。",
        ) from exc

    if not content:
        raise HTTPException(status_code=502, detail="模型没有返回内容。")

    return content


def parse_explanation_points(content: str) -> list[str]:
    cleaned = content.strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(
            r"^```(?:json)?\s*",
            "",
            cleaned,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        parsed = None

    if isinstance(parsed, list):
        points = [
            str(item).strip()
            for item in parsed
            if str(item).strip()
        ]
        if points:
            return points[:6]

    points: list[str] = []
    for line in cleaned.splitlines():
        point = re.sub(
            r"^\s*(?:[-*•]|\d+[.)、])\s*",
            "",
            line,
        ).strip()
        if point:
            points.append(point)

    return points[:6]


def parse_card_content(content: str) -> dict[str, Any]:
    cleaned = content.strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    candidates = [cleaned]
    object_match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if object_match and object_match.group(0) != cleaned:
        candidates.append(object_match.group(0))

    parsed: Any = None
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            break
        except json.JSONDecodeError:
            continue

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="模型没有返回有效的卡片 JSON。")

    title = str(parsed.get("title", "")).strip()
    explanation = str(parsed.get("explanation", "")).strip()
    purpose = str(parsed.get("purpose", "")).strip()
    understanding = str(parsed.get("understanding", "")).strip()
    raw_points = parsed.get("key_points", [])
    key_points = (
        [str(item).strip() for item in raw_points if str(item).strip()]
        if isinstance(raw_points, list)
        else []
    )

    if not all([title, explanation, purpose, understanding]) or not key_points:
        raise HTTPException(status_code=502, detail="模型返回的卡片字段不完整。")

    return {
        "title": title[:120],
        "explanation": explanation[:1200],
        "key_points": key_points[:5],
        "purpose": purpose[:1200],
        "understanding": understanding[:1200],
    }


def parse_paper_overview_content(content: str) -> dict[str, str]:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    candidates = [cleaned]
    object_match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if object_match and object_match.group(0) != cleaned:
        candidates.append(object_match.group(0))

    parsed: Any = None
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            break
        except json.JSONDecodeError:
            continue

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="模型没有返回有效的论文卡片 JSON。")

    keys = [
        "title",
        "authors",
        "venue_year",
        "research_area",
        "keywords",
        "one_sentence_summary",
        "research_problem",
        "core_innovation",
        "worth_reading",
        "problem_setup",
        "research_gap",
        "why_important",
        "topic_tags",
        "method_overview",
        "method_intuition",
        "method_steps",
        "key_assumptions",
        "notation_guide",
        "datasets",
        "experiment_setup",
        "metrics",
        "main_findings",
        "strongest_evidence",
        "comparison_with_prior_work",
        "limitations",
        "reading_status",
        "recommend_deep_reading",
        "reading_difficulty",
        "reading_value_score",
        "reading_advice",
        "suitable_stages",
        "prerequisites",
        "citation_points",
        "research_connection",
        "followup_questions",
        "weekly_plan",
    ]
    result: dict[str, str] = {}
    for key in keys:
        value = str(parsed.get(key, "")).strip()
        result[key] = value if value else "原文未明确出现"

    return result


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/translate", response_model=TranslateResponse)
async def translate(request: TranslateRequest) -> TranslateResponse:
    source_text = request.text.strip()
    if not source_text:
        raise HTTPException(status_code=400, detail="翻译文本不能为空。")

    translation = await request_llm(
        [
            {
                "role": "system",
                "content": (
                    "你是一名严谨的学术翻译。将用户提供的内容翻译成"
                    f"{request.target_language}。保留公式、变量名、引用编号、"
                    "专有名词和段落结构；不要添加解释、标题、总结或原文，"
                    "只返回译文。"
                ),
            },
            {
                "role": "user",
                "content": source_text,
            },
        ],
        temperature=0.1,
    )

    return TranslateResponse(translation=translation)


@app.post("/api/explain", response_model=ExplainResponse)
async def explain(request: ExplainRequest) -> ExplainResponse:
    source_text = request.text.strip()
    if not source_text:
        raise HTTPException(status_code=400, detail="解释文本不能为空。")

    content = await request_llm(
        [
            {
                "role": "system",
                "content": (
                    "你是一名擅长讲解计算机科学论文的中文导师。"
                    "请根据用户选中的英文原文，用简体中文生成3到5条解释要点。"
                    "重点说明核心概念、这段话在论文中的作用、关键技术或因果关系，"
                    "以及初学者容易困惑的地方。不要只重复翻译，"
                    "不要编造原文没有的信息。"
                    "只返回JSON字符串数组，例如："
                    '["核心概念是……","作者在这里强调……","需要注意……"]'
                ),
            },
            {
                "role": "user",
                "content": source_text,
            },
        ],
        temperature=0.2,
    )

    points = parse_explanation_points(content)
    if not points:
        raise HTTPException(
            status_code=502,
            detail="模型没有返回可解析的解释要点。",
        )

    return ExplainResponse(explanation=points)

@app.post("/api/summarize", response_model=SummarizeResponse)
async def summarize(request: SummarizeRequest) -> SummarizeResponse:
    source_text = request.text.strip()
    if not source_text:
        raise HTTPException(status_code=400, detail="总结文本不能为空。")

    context = "；".join(
        part
        for part in [
            f"范围：{request.scope.strip()}" if request.scope.strip() else "",
            f"来源：{request.source.strip()}" if request.source.strip() else "",
            f"位置：{request.position.strip()}" if request.position.strip() else "",
        ]
        if part
    )

    content = await request_llm(
        [
            {
                "role": "system",
                "content": (
                    "你是一名严谨的中文论文阅读助手。请根据用户提供的论文原文，"
                    "提炼3到5条核心要点。每条要点应是完整、简洁的中文句子，"
                    "优先覆盖研究背景或问题、作者的关键判断或方法、"
                    "以及与研究贡献或后续设计相关的信息。"
                    "不要逐句翻译，不要加入原文没有的事实，不要输出标题或说明。"
                    "只返回JSON字符串数组，例如："
                    '["本段介绍了研究背景与问题动机。",'
                    '"作者指出现有方法存在限制，因此提出新的思路。"]'
                ),
            },
            {
                "role": "user",
                "content": f"{context}\n\n论文原文：\n{source_text}" if context else source_text,
            },
        ],
        temperature=0.2,
    )

    points = parse_explanation_points(content)
    if not points:
        raise HTTPException(
            status_code=502,
            detail="模型没有返回可解析的总结要点。",
        )

    return SummarizeResponse(summary=points[:5])

@app.post("/api/generate-card", response_model=GenerateCardResponse)
async def generate_card(request: GenerateCardRequest) -> GenerateCardResponse:
    source_text = request.text.strip()
    if not source_text:
        raise HTTPException(status_code=400, detail="卡片原文不能为空。")

    context = "；".join(
        part
        for part in [
            f"卡片类型：{request.card_type.strip()}",
            (
                f"论文标题：{request.document_title.strip()}"
                if request.document_title.strip()
                else ""
            ),
            f"页码：第 {request.page_number} 页",
            f"位置：{request.position.strip()}" if request.position.strip() else "",
        ]
        if part
    )

    content = await request_llm(
        [
            {
                "role": "system",
                "content": (
                    "你是一名严谨的中文论文阅读助手。请把用户选中的论文原文制作成"
                    "结构化学习卡片。卡片必须忠于原文，不得编造数据、结论或因果关系。"
                    "根据卡片类型调整重点：概念卡说明定义、边界和关键属性；"
                    "方法卡说明机制、步骤和适用场景；实验卡说明设置、指标和结果；"
                    "观点卡说明作者判断、依据和意义。只返回一个 JSON 对象，不要使用"
                    "Markdown，不要添加额外说明。JSON 格式必须是："
                    '{"title":"简洁标题","explanation":"1到2句核心解释",'
                    '"key_points":["要点1","要点2","要点3"],'
                    '"purpose":"该内容的作用或解决的问题",'
                    '"understanding":"适合作为阅读笔记的一句通俗理解"}'
                ),
            },
            {
                "role": "user",
                "content": f"{context}\n\n论文原文：\n{source_text}",
            },
        ],
        temperature=0.2,
    )

    card = parse_card_content(content)
    return GenerateCardResponse(**card)

@app.post("/api/generate-paper-card", response_model=GeneratePaperOverviewResponse)
async def generate_paper_overview(
    request: GeneratePaperOverviewRequest,
) -> GeneratePaperOverviewResponse:
    source_text = request.text.strip()
    if not source_text:
        raise HTTPException(status_code=400, detail="论文原文不能为空。")

    content = await request_llm(
        [
            {
                "role": "system",
                "content": (
                    "你是一名严谨的中文论文阅读助手，服务对象是研究生论文阅读。请根据用户提供的整篇论文或论文采样文本，"
                    "生成一张更适合研究生使用的结构化论文卡片。事实类信息必须忠于原文，不能编造作者、数据集、指标、"
                    "实验结果、局限性、会议等级等；原文没有明确说明的字段必须填写‘原文未明确出现’。"
                    "标题和作者尽量从论文首页识别；年份、会议或期刊只有明确出现时才填写。"
                    "keywords、topic_tags 可以根据原文标题、摘要与正文关键词概括。"
                    "reading_status 固定填写‘略读完成’；recommend_deep_reading 只能填写"
                    "‘建议精读’、‘建议按需精读’或‘暂不建议精读’之一；reading_difficulty 只能填写"
                    "‘较易’、‘中等’或‘较难’；reading_value_score 填 0 到 10 的数字，可以带 1 位小数，它是阅读辅助判断。"
                    "worth_reading、reading_advice、suitable_stages、prerequisites、research_connection、followup_questions、weekly_plan"
                    " 属于研究生阅读辅助建议，可以基于论文内容给出简洁、具体、可执行的判断。"
                    "method_steps 尽量写成 1/2/3/4 结构；citation_points 应概括最值得在后续写作中引用的1到3个观点，并说明其用途。"
                    "只返回一个 JSON 对象，不要使用 Markdown，不要添加解释。JSON 字段必须是："
                    '{"title":"","authors":"","venue_year":"","research_area":"","keywords":"",'
                    '"one_sentence_summary":"","research_problem":"","core_innovation":"","worth_reading":"",'
                    '"problem_setup":"","research_gap":"","why_important":"","topic_tags":"",'
                    '"method_overview":"","method_intuition":"","method_steps":"","key_assumptions":"",'
                    '"notation_guide":"","datasets":"","experiment_setup":"","metrics":"","main_findings":"",'
                    '"strongest_evidence":"","comparison_with_prior_work":"","limitations":"",'
                    '"reading_status":"略读完成","recommend_deep_reading":"建议按需精读",'
                    '"reading_difficulty":"中等","reading_value_score":"8.0","reading_advice":"",'
                    '"suitable_stages":"","prerequisites":"","citation_points":"","research_connection":"",'
                    '"followup_questions":"","weekly_plan":""}'
                ),
            },
            {
                "role": "user",
                "content": (
                    f"文件名：{request.document_name or '未提供'}\n"
                    f"PDF页数：{request.page_count}\n\n"
                    f"论文原文：\n{source_text}"
                ),
            },
        ],
        temperature=0.15,
    )

    overview = parse_paper_overview_content(content)
    if overview["title"] == "原文未明确出现" and request.document_name.strip():
        overview["title"] = request.document_name.strip().removesuffix(".pdf")
    return GeneratePaperOverviewResponse(**overview)
