import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  replaceTranslationResultText,
} from "../src/viewer/features/translation/translation-action-layout.ts";

const events = [];
const actions = { id: "translation-primary-actions" };
const resultSection = {
  before(node) {
    assert.equal(node, actions);
    events.push("actions-preserved");
  },
};
const root = {
  querySelector(selector) {
    if (selector === "#translation-primary-actions") return actions;
    if (selector === "#translation-result-section") return resultSection;
    return null;
  },
};
const resultElement = {
  set textContent(value) {
    assert.equal(value, "正在生成单词学习卡片，请稍候…");
    events.push("result-replaced");
  },
};

replaceTranslationResultText(
  resultElement,
  "正在生成单词学习卡片，请稍候…",
  root,
);

assert.deepEqual(
  events,
  ["actions-preserved", "result-replaced"],
  "the persistent save action must move out before a sentence result is cleared",
);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const selectionContextSource = fs.readFileSync(
  path.join(
    projectRoot,
    "src/viewer/features/translation/selection-context.ts",
  ),
  "utf8",
);
assert.match(
  selectionContextSource,
  /replaceTranslationResultText\(translationResultElement, message\)/,
  "loading and error states must use the action-preserving replacement",
);

// An empty state message must not blank the panel. This channel *replaces* the result body, and the card living there
// is the output: calling it with "" after a translation finished is what made a completed card look empty until the
// panel was re-rendered from state.
let touched = 0;
const target = {
  set textContent(value) {
    touched += 1;
    void value;
  },
};
replaceTranslationResultText(target, "", root);
assert.equal(touched, 0, 'an empty message is a no-op, not "clear the card"');
replaceTranslationResultText(target, "loading...", root);
assert.equal(touched, 1, 'a real message still replaces the body');

console.log("translation action layout tests passed (4 assertions)");
