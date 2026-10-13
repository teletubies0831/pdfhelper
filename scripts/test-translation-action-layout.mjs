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

console.log("translation action layout tests passed (2 assertions)");
