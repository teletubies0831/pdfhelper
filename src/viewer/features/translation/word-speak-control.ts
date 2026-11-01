import {
  WORD_ACCENT_LABEL,
  isWordSpeechAvailable,
  speakWord,
  stopWordSpeech,
  type WordAccent,
} from "../../shared-ui/speech/word-speech";

/**
 * 词条朗读控件：一个喇叭按钮 + 一个「英 / 美」口音开关.
 *
 * 分工严格分开：
 *
 * - **喇叭**：用当前口音朗读 / 重播——只有它会发声；
 * - **英 / 美**：点一下只在两种口音之间来回切，**不朗读**。切完之后点喇叭，就用新口音读。
 *
 * 斜杠只是分隔符，不是按钮。选中的口音深色加粗，另一个变灰。
 *
 * 语音能力缺失时返回 `null`：留一个点不动的喇叭比没有更糟。
 */

export interface WordSpeakControlOptions {
  /** 要朗读的词条。 */
  text: string;
  /** 初始口音；卡片只给 `(BrE)` 时传 `GB`。 */
  accent?: WordAccent;
  /** 只在真正失败时回调一次（音色缺失、引擎报错）。 */
  onError?: (reason: string) => void;
}

/** 显示顺序：英在左、美在右，与卡片音标的顺序一致。 */
const ACCENT_ORDER: readonly WordAccent[] = ["GB", "US"];

/** 喇叭图标：内联 SVG，比 emoji 稳定（不受字体/平台着色影响）。 */
function createSpeakerIcon(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const cone = document.createElementNS(namespace, "path");
  cone.setAttribute("d", "M2.6 6.2h2.1L7.4 3.6v8.8L4.7 9.8H2.6z");
  cone.setAttribute("fill", "currentColor");
  const inner = document.createElementNS(namespace, "path");
  inner.setAttribute("d", "M9.6 5.5a3.1 3.1 0 0 1 0 5");
  const outer = document.createElementNS(namespace, "path");
  outer.setAttribute("d", "M11.5 3.4a5.6 5.6 0 0 1 0 9.2");
  for (const wave of [inner, outer]) {
    wave.setAttribute("fill", "none");
    wave.setAttribute("stroke", "currentColor");
    wave.setAttribute("stroke-width", "1.2");
    wave.setAttribute("stroke-linecap", "round");
  }
  svg.append(cone, inner, outer);
  return svg;
}

export function createWordSpeakControl(options: WordSpeakControlOptions): HTMLElement | null {
  const text = options.text.trim();
  if (!text || !isWordSpeechAvailable()) return null;

  let accent: WordAccent = options.accent ?? "US";
  let errorReported = false;
  /** 每次朗读递增：只有最新一次朗读的 onEnd 允许清掉「正在朗读」。 */
  let generation = 0;

  const root = document.createElement("span");
  root.className = "word-speak";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "朗读单词");

  const play = document.createElement("button");
  play.type = "button";
  play.className = "word-speak-play";
  play.append(createSpeakerIcon());

  const accentButton = document.createElement("button");
  accentButton.type = "button";
  accentButton.className = "word-speak-accent";
  const labels = new Map<WordAccent, HTMLSpanElement>();
  ACCENT_ORDER.forEach((option, index) => {
    if (index > 0) accentButton.append(createSlash());
    const label = document.createElement("span");
    label.className = "word-speak-option";
    label.dataset.accent = option;
    label.textContent = WORD_ACCENT_LABEL[option];
    labels.set(option, label);
    accentButton.append(label);
  });

  root.append(play, accentButton);

  function createSlash(): HTMLSpanElement {
    const slash = document.createElement("span");
    slash.className = "word-speak-slash";
    slash.textContent = "/";
    slash.setAttribute("aria-hidden", "true");
    return slash;
  }

  function syncAccent(): void {
    for (const [option, label] of labels) {
      label.classList.toggle("is-active", option === accent);
    }
    const name = WORD_ACCENT_LABEL[accent];
    play.setAttribute("aria-label", `朗读（${name}式）`);
    play.title = `朗读（${name}式）`;
    accentButton.setAttribute("aria-label", `切换口音（当前${name}式）`);
    accentButton.title = `切换口音（当前${name}式）`;
  }

  async function speak(): Promise<void> {
    const current = (generation += 1);
    root.classList.add("is-speaking");
    const started = await speakWord(text, {
      accent,
      onEnd: () => {
        if (current === generation) root.classList.remove("is-speaking");
      },
      onError: (reason) => {
        if (current === generation) root.classList.remove("is-speaking");
        if (errorReported) return;
        errorReported = true;
        options.onError?.(reason);
      },
    });
    if (!started) root.classList.remove("is-speaking");
  }

  // 喇叭：用当前口音朗读/重播，是唯一会发声的入口。
  play.addEventListener("click", () => {
    void speak();
  });

  // 英/美：只切换口音，不朗读。切完之后点喇叭才用新口音读。
  accentButton.addEventListener("click", () => {
    accent = accent === "GB" ? "US" : "GB";
    syncAccent();
  });

  syncAccent();
  return root;
}

/** 切文档/重渲染前调用：否则上一张卡片的单词会继续读。 */
export function stopWordSpeakControls(): void {
  stopWordSpeech();
}
