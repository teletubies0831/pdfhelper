import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { loadModule } from './support/module-closure.mjs';

/**
 * 词条朗读控件.
 *
 * 语音引擎没法在 headless 里真的发声，所以这里注入假的 `speechSynthesis` / `SpeechSynthesisUtterance`，把**调用顺序与参数**当成
 * 可断言的行为：用哪个口音、语速多少、选的哪个音色、连点是不是只播最后一遍、失败会不会重复提示。
 *
 * 这些正是「有按钮但读不对」的所有可能：口音错了、音色选了在线音色（文本出网）、连点叠音、失败刷屏。
 */

let browser;
let page;

const controlSource = () => loadModule('src/viewer/features/translation/word-speak-control.ts');

before(async () => {
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
  page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
});

after(async () => { await browser?.close(); });

/** 装载两个模块，并把 speech 相关全局换成可观测的假实现。 */
async function install(voices) {
  const speechCode = await loadModule('src/viewer/shared-ui/speech/word-speech.ts');
  const controlCode = await controlSource();
  await page.evaluate(([speechSource, controlSourceText, voiceList]) => {
    window.calls = [];
    window.utterances = [];
    window.voiceList = voiceList;
    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = '';
        this.rate = 1;
        this.voice = null;
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
        window.utterances.push(this);
      }
    }
    // `speechSynthesis` 是 Window 上的只读访问器，直接赋值会被静默忽略（真实引擎随后报 "not of type
    // SpeechSynthesisUtterance"）；必须 defineProperty 才能真的换掉。
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      writable: true,
      value: FakeUtterance,
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => window.voiceList,
        addEventListener() {},
        removeEventListener() {},
        cancel() { window.calls.push(['cancel']); },
        speak(utterance) {
          window.calls.push(['speak', utterance.lang, utterance.rate, utterance.voice?.name ?? null, utterance.text]);
          utterance.onstart?.();
        },
      },
    });
    const speech = {};
    new Function('require', 'exports', speechSource)(() => ({}), speech);
    const control = {};
    new Function('require', 'exports', controlSourceText)((name) => {
      if (name.includes('shared-ui/speech/word-speech')) return speech;
      throw new Error(`Unmapped dependency: ${name}`);
    }, control);
    window.speech = speech;
    window.control = control;
  }, [speechCode, controlCode, voices]);
}

const VOICES = [
  { lang: 'en-US', name: 'US Local', localService: true },
  { lang: 'en-GB', name: 'GB Local', localService: true },
  { lang: 'en-US', name: 'US Online', localService: false },
];

test('「英/美」开关只切口音，不发声', async () => {
  await install(VOICES);
  const result = await page.evaluate(async () => {
    const element = window.control.createWordSpeakControl({ text: 'cauldron', accent: 'US' });
    document.body.append(element);
    const toggle = element.querySelector('.word-speak-accent');
    const [gb, us] = [...element.querySelectorAll('.word-speak-option')];
    const read = () => ({
      gb: gb.classList.contains('is-active'),
      us: us.classList.contains('is-active'),
      label: toggle.getAttribute('aria-label'),
      slash: element.querySelector('.word-speak-slash')?.textContent ?? null,
    });
    const initial = read();
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterFirst = read();
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterSecond = read();
    return {
      initial,
      afterFirst,
      afterSecond,
      calls: window.calls,
      speaking: element.classList.contains('is-speaking'),
    };
  });

  assert.equal(result.initial.us, true, '默认口音由卡片音标决定');
  assert.equal(result.initial.label, '切换口音（当前美式）');
  assert.equal(result.initial.slash, '/', '分隔符是斜杠，不是竖线');
  // 一个开关按钮：点一下就切到另一侧，而不是「点哪半个切哪半个」。
  assert.equal(result.afterFirst.gb, true, '第一次点击切到英式');
  assert.equal(result.afterFirst.us, false);
  assert.equal(result.afterFirst.label, '切换口音（当前英式）');
  assert.equal(result.afterSecond.us, true, '再点一下切回美式');
  assert.equal(result.afterSecond.gb, false);
  // 关键：开关只负责选择，朗读交给喇叭。
  assert.deepEqual(result.calls, [], '切换口音不产生任何朗读调用');
  assert.equal(result.speaking, false, '也不进入朗读态');
});

test('喇叭按钮：按当前选中的口音朗读，连点是重播', async () => {
  await install(VOICES);
  const result = await page.evaluate(async () => {
    const element = window.control.createWordSpeakControl({ text: 'cauldron', accent: 'US' });
    document.body.append(element);
    const play = element.querySelector('.word-speak-play');
    const toggle = element.querySelector('.word-speak-accent');
    play.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 切到英式，再点喇叭：应该用英式读。
    toggle.click();
    play.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      speaks: window.calls.filter((call) => call[0] === 'speak').map((call) => call[1]),
      gbActive: element.querySelector('[data-accent="GB"]').classList.contains('is-active'),
      label: play.getAttribute('aria-label'),
    };
  });

  assert.deepEqual(result.speaks, ['en-US', 'en-GB'], '喇叭跟随开关选择的那个口音');
  assert.equal(result.gbActive, true, '喇叭不改变选择');
  assert.equal(result.label, '朗读（英式）');
});

test('切口音不会打断正在朗读的音频', async () => {
  await install(VOICES);
  const result = await page.evaluate(async () => {
    const element = window.control.createWordSpeakControl({ text: 'cauldron', accent: 'GB' });
    document.body.append(element);
    element.querySelector('.word-speak-play').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const speakingBefore = element.classList.contains('is-speaking');
    // 音频还在读时切口音：只换显示，不该 cancel 当前音频。
    element.querySelector('.word-speak-accent').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      speakingBefore,
      speaks: window.calls.filter((call) => call[0] === 'speak').length,
      cancels: window.calls.filter((call) => call[0] === 'cancel').length,
      speakingAfter: element.classList.contains('is-speaking'),
    };
  });

  assert.equal(result.speakingBefore, true);
  assert.equal(result.speaks, 1, '切口音不发起新的朗读');
  assert.equal(result.cancels, 1, '也不取消正在读的那一遍');
  assert.equal(result.speakingAfter, true);
});

test('本地音色优先，在线音色只在没有本地音色时才用', async () => {
  await install(VOICES);
  const picked = await page.evaluate(async () => {
    // 初始英式，点一下切到美式——美式有本地音色也有在线音色，必须选本地那个。
    const element = window.control.createWordSpeakControl({ text: 'cauldron', accent: 'GB' });
    document.body.append(element);
    // 开关只切口音，点喇叭才发声——切到美式再点喇叭。
    element.querySelector('.word-speak-accent').click();
    element.querySelector('.word-speak-play').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return window.calls.filter((call) => call[0] === 'speak')[0][3];
  });
  assert.equal(picked, 'US Local', '本地音色让「查词不出网」这个承诺成立');
});

test('没有对应口音的音色时仍然朗读，只是交给引擎按语言标签挑', async () => {
  await install([{ lang: 'en-US', name: 'US Local', localService: true }]);
  const result = await page.evaluate(async () => {
    // 初始美式，切到英式再点喇叭——系统里没有英式音色。
    const element = window.control.createWordSpeakControl({ text: 'cauldron', accent: 'US' });
    document.body.append(element);
    element.querySelector('.word-speak-accent').click();
    element.querySelector('.word-speak-play').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return window.calls.filter((call) => call[0] === 'speak')[0];
  });
  assert.equal(result[1], 'en-GB', '语言标签仍然设成英式');
  assert.equal(result[3], null, '没有英式音色就不指定 voice，让引擎自己回退');
});

test('朗读失败只提示一次；取消导致的 error 不算失败', async () => {
  await install(VOICES);
  const result = await page.evaluate(async () => {
    const errors = [];
    const element = window.control.createWordSpeakControl({
      text: 'cauldron',
      accent: 'GB',
      onError: (reason) => errors.push(reason),
    });
    document.body.append(element);
    element.querySelector('.word-speak-play').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.utterances.at(-1).onerror?.({ error: 'interrupted' });
    const afterCancel = errors.length;
    window.utterances.at(-1).onerror?.({ error: 'network' });
    window.utterances.at(-1).onerror?.({ error: 'network' });
    return { afterCancel, errors, speaking: element.classList.contains('is-speaking') };
  });

  assert.equal(result.afterCancel, 0, 'cancel 触发的 interrupted 不是失败');
  assert.deepEqual(result.errors, ['network'], '真正的失败只报一次，不刷屏');
  assert.equal(result.speaking, false);
});

test('没有语音能力时不渲染控件', async () => {
  await install(VOICES);
  const result = await page.evaluate(() => {
    const element = window.control.createWordSpeakControl({ text: 'cauldron' });
    const available = window.speech.isWordSpeechAvailable();
    delete window.speechSynthesis;
    const withoutEngine = window.control.createWordSpeakControl({ text: 'cauldron' });
    return { available, element: element?.className ?? null, withoutEngine };
  });

  assert.equal(result.available, true);
  assert.match(String(result.element), /word-speak/);
  assert.equal(result.withoutEngine, null, '留一个点不动的按钮比没有按钮更糟');
});

test('引擎直接抛错时不产生未处理的 Promise 拒绝，只走一次错误回调', async () => {
  const speechCode = await loadModule('src/viewer/shared-ui/speech/word-speech.ts');
  const result = await page.evaluate(async (speechSource) => {
    const errors = [];
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      writable: true,
      value: class {
        constructor(text) { this.text = text; }
      },
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [{ lang: 'en-US', name: 'US Local', localService: true }],
        addEventListener() {},
        removeEventListener() {},
        cancel() {},
        speak() { throw new TypeError("parameter 1 is not of type 'SpeechSynthesisUtterance'"); },
      },
    });
    const speech = {};
    new Function('require', 'exports', speechSource)(() => ({}), speech);
    const returned = await speech.speakWord('cauldron', { onError: (reason) => errors.push(reason) });
    return { returned, errors };
  }, speechCode);

  // 真实场景：系统语音引擎损坏 / 拒绝 utterance。异常必须被吞掉并上报一次，否则点击处理器里的 `void speak()` 变成未处理拒绝。
  assert.equal(result.returned, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /SpeechSynthesisUtterance/);
});

test('音标只有一个口音时默认跟它走；去掉标点后才是要读的词', async () => {
  await install(VOICES);
  const result = await page.evaluate(() => ({
    britishOnly: window.speech.defaultAccentForPronunciation('(BrE): /ˈkɔːldrən/'),
    both: window.speech.defaultAccentForPronunciation('(BrE) /ˈkɔːldrən/ (AmE) /ˈkɔːldrən/'),
    none: window.speech.defaultAccentForPronunciation(''),
    stripped: window.speech.normalizeSpeakText('  “cauldron,”  '),
    keptHyphen: window.speech.normalizeSpeakText('state-of-the-art'),
  }));

  assert.equal(result.britishOnly, 'GB');
  assert.equal(result.both, 'US', '两种都给时以美式开头（与编辑器行为一致）');
  assert.equal(result.none, 'US');
  assert.equal(result.stripped, 'cauldron');
  assert.equal(result.keptHyphen, 'state-of-the-art', '词中间的连字符不能动');
});
