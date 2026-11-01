/**
 * 单词朗读（Web Speech API）.
 *
 * 用系统自带音色，不引第三方库、不发网络请求、不加权限：`speechSynthesis` 的本地音色完全离线，文本不出浏览器。
 * 词条朗读本来就是「听一遍」的需求，云 TTS 的按字符计费和文本出网都不值得。
 *
 * 抽成模块的直接原因：单词编辑器和翻译卡片各需要一个朗读入口，两份实现会长出「同一个词两处读法不同」的 bug。
 */

export type WordAccent = "US" | "GB";

/** 口音 → BCP-47 语言标签。 */
export const WORD_ACCENT_LANG: Record<WordAccent, string> = {
  US: "en-US",
  GB: "en-GB",
};

/** 卡片上显示的口音标签。 */
export const WORD_ACCENT_LABEL: Record<WordAccent, string> = {
  US: "美",
  GB: "英",
};

/** 朗读语速：比默认略慢，词条听得清。 */
export const WORD_SPEECH_RATE = 0.9;

/** 超过这个长度就不是「词条」了，避免误把整句读出来。 */
const MAX_SPEAK_CHARACTERS = 120;

/** 等音色列表的时长上限：`getVoices()` 首次调用通常是空的，要等 `voiceschanged`。 */
const VOICE_WAIT_MS = 600;

export interface SpeakWordOptions {
  accent?: WordAccent;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
  /** 只在真正失败时回调一次，调用方不必自己防重。 */
  onError?: (reason: string) => void;
}

export function isWordSpeechAvailable(): boolean {
  return typeof window !== "undefined"
    && "speechSynthesis" in window
    && typeof window.speechSynthesis?.speak === "function"
    && typeof SpeechSynthesisUtterance !== "undefined";
}

/**
 * 词条之外的字符（标点、多余空白）会被读成停顿或噪音。
 *
 * 只去首尾的标点，不动词中间的连字符：`state-of-the-art` 要按原样读。
 */
export function normalizeSpeakText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'“”‘’()[\]{}<>«»,.;:!?、，。；：！？]+/u, "")
    .replace(/[\s"'“”‘’()[\]{}<>«»,.;:!?、，。；：！？]+$/u, "")
    .slice(0, MAX_SPEAK_CHARACTERS);
}

let cachedVoices: SpeechSynthesisVoice[] | null = null;

function readVoices(): SpeechSynthesisVoice[] {
  if (cachedVoices && cachedVoices.length) return cachedVoices;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) cachedVoices = voices;
  return voices;
}

/** 第一次取音色列表可能是空的：等一次 `voiceschanged`，超时就按空列表继续。 */
function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  const immediate = readVoices();
  if (immediate.length) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.speechSynthesis.removeEventListener?.("voiceschanged", finish);
      resolve(readVoices());
    };
    const timer = window.setTimeout(finish, VOICE_WAIT_MS);
    window.speechSynthesis.addEventListener?.("voiceschanged", finish);
  });
}

/**
 * 选音色：只接受**口音精确匹配**的音色，本地音色优先.
 *
 * 两个决定都是有意的：
 *
 * - **不做「同一语系就凑合」**：只有 `en-US` 音色时，为「英式」请求挑一个美式音色，用户听到的是美音却被高亮成英式，比不发声更糟。
 *   返回 `null` 让引擎按 `utterance.lang` 自己回退，至少不会由我们谎报口音。
 * - **本地音色优先**：`localService` 的音色完全离线，「查词不出网」这个承诺才成立；Edge 的 `… Online (Natural)` 更好听但会把文本发给
 *   微软，所以只在没有本地音色时才用。
 */
export function pickVoice(voices: readonly SpeechSynthesisVoice[], accent: WordAccent): SpeechSynthesisVoice | null {
  const lang = WORD_ACCENT_LANG[accent].toLowerCase();
  const normalize = (value: string | undefined): string => (value ?? "").toLowerCase().replace("_", "-");
  const matches = voices.filter((voice) => normalize(voice.lang).startsWith(lang));
  if (!matches.length) return null;
  return matches.find((voice) => voice.localService) ?? matches[0] ?? null;
}

/** 停止当前朗读。切文档、重渲染卡片、面板关闭时都要调，否则切页后单词还在读。 */
export function stopWordSpeech(): void {
  if (!isWordSpeechAvailable()) return;
  window.speechSynthesis.cancel();
}

/**
 * 朗读一个词条；返回是否真的发起了朗读.
 *
 * 每次朗读都先 `cancel()`：连点只会听到最后一遍，而不是把几遍叠在一起排队。
 *
 * 引擎在真实环境里会抛错（音色损坏、utterance 被拒、系统没有可用语音），所以这里**不把异常抛给调用方**：转成 `onError` 一次并
 * 返回 `false`。否则点击处理器里的 `void speak()` 会变成未处理的 Promise 拒绝——界面上什么都不会发生，控制台里只有一条没人看的错。
 */
export async function speakWord(text: string, options: SpeakWordOptions = {}): Promise<boolean> {
  if (!isWordSpeechAvailable()) return false;
  const spoken = normalizeSpeakText(text);
  if (!spoken) return false;
  const accent = options.accent ?? "US";
  try {
    const voices = await waitForVoices();
    const voice = pickVoice(voices, accent);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = WORD_ACCENT_LANG[accent];
    utterance.rate = options.rate ?? WORD_SPEECH_RATE;
    if (voice) utterance.voice = voice;
    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => options.onEnd?.();
    utterance.onerror = (event) => {
      // `cancel()` 自身会以 interrupted/canceled 触发一次 error，那不是失败，不上报。
      const reason = String((event as SpeechSynthesisErrorEvent).error ?? "unknown");
      if (reason === "interrupted" || reason === "canceled") {
        options.onEnd?.();
        return;
      }
      options.onError?.(reason);
    };
    window.speechSynthesis.speak(utterance);
    return true;
  } catch (error) {
    options.onError?.(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * 从音标串推断默认口音.
 *
 * 卡片可能只给一种（`(BrE)` 或 `(AmE)`），两种都给时以美式开头——和现有编辑器行为一致。
 */
export function defaultAccentForPronunciation(pronunciation: string): WordAccent {
  const hasGb = /\bBrE\b|英式|英音/i.test(pronunciation);
  const hasUs = /\bAmE\b|美式|美音/i.test(pronunciation);
  if (hasGb && !hasUs) return "GB";
  return "US";
}

/** 测试用：清掉音色缓存。 */
export function resetWordSpeechCacheForTest(): void {
  cachedVoices = null;
}
