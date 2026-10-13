import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  chooseHighlightSelectionText,
  getHighlightEditorText,
  getStoredHighlightText,
  normalizeHighlightText,
  setHighlightEditorText,
} from "../src/viewer/features/annotations/annotation-highlight-content.ts";

const highlightCreationSource = await readFile(
  new URL(
    "../src/viewer/features/annotations/highlight-creation.ts",
    import.meta.url,
  ),
  "utf8",
);

test("highlight snapshot rejects unrelated stale reconstructed text", () => {
  assert.equal(
    chooseHighlightSelectionText(
      "the exact selected sentence",
      "unrelated text from another cached page",
    ),
    "the exact selected sentence",
  );
  assert.equal(
    chooseHighlightSelectionText(
      "helloworld",
      "hello world",
    ),
    "hello world",
  );
});

test("new highlight text is attached before PDF.js changes editor mode", () => {
  const creationSource = highlightCreationSource.slice(
    highlightCreationSource.indexOf("export async function createQuickHighlight"),
    highlightCreationSource.indexOf(
      "export async function highlightCurrentSelectionFromToolbar",
    ),
  );
  const createIndex = creationSource.indexOf(
    'annotationEditor.value.highlightSelection("context_menu")',
  );
  const attachIndex = creationSource.indexOf(
    "attachHighlightSelectionText(createdEditor, selectedText)",
  );
  const modeSwitchIndex = creationSource.indexOf(
    "SELECT_TOOL_EDITOR_BACKING_MODE",
  );
  assert.ok(createIndex >= 0);
  assert.ok(attachIndex > createIndex);
  assert.ok(modeSwitchIndex > attachIndex);
});

test("highlight source text removes PDF control noise without flattening paragraphs", () => {
  assert.equal(
    normalizeHighlightText(" \ufeffFirst\u00ad line\r\n\u0000Second line\n\nThird \u200bline "),
    "First line\nSecond line\n\nThird line",
  );
});

test("saved source text wins over a scrambled PDF.js accessibility label", () => {
  const editor = {
    pdfHelperHighlightText: "Correct selected text",
    div: {
      getAttribute(name) {
        return name === "role" ? "mark" : "wrong text from PDF.js";
      },
    },
  };
  assert.equal(getHighlightEditorText(editor), "Correct selected text");
});

test("generic restored-editor labels are never treated as highlighted source", () => {
  const editor = {
    div: {
      getAttribute(name) {
        return name === "role" ? null : "Highlight editor";
      },
    },
  };
  assert.equal(getHighlightEditorText(editor), "");
});

test("captured text is attached to the editor and remains JSON-persistable", () => {
  const attributes = new Map();
  const editor = {
    div: {
      setAttribute(name, value) {
        attributes.set(name, value);
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
    },
  };
  assert.equal(setHighlightEditorText(editor, "  selected text  "), "selected text");
  assert.equal(getHighlightEditorText(editor), "selected text");
  assert.equal(attributes.get("role"), "mark");
  assert.equal(
    getStoredHighlightText({ pdfHelperHighlightText: editor.pdfHelperHighlightText }),
    "selected text",
  );
});
