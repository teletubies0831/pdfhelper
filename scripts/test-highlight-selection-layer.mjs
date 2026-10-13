import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { chromium } from "@playwright/test";

const annotationCss = await readFile(
  new URL(
    "../src/viewer/features/annotations/editor-and-search.css",
    import.meta.url,
  ),
  "utf8",
);
const noteHoverSource = await readFile(
  new URL(
    "../src/viewer/features/annotations/annotation-note-hover.ts",
    import.meta.url,
  ),
  "utf8",
);

const fixture = `<!doctype html>
<html>
<head>
  <style>
    body { margin: 0; }
    .pdfViewer { padding: 40px; }
    .page { position: relative; width: 620px; height: 90px; }
    .textLayer { position: absolute; z-index: 1; inset: 0; font: 28px/1.5 serif; }
    .textLayer span { position: absolute; top: 10px; left: 10px; white-space: pre; }
    .annotationEditorLayer { position: absolute; z-index: 2; inset: 0; }
    .annotationEditorLayer .highlightEditor {
      position: absolute;
      top: 10px;
      left: 115px;
      width: 205px;
      height: 42px;
      pointer-events: none;
    }
    .annotationEditorLayer .highlightEditor .internal {
      position: absolute;
      inset: 0;
      background: rgb(255 224 0 / 45%);
      pointer-events: auto;
    }
    .pdf-helper-note-indicator {
      position: absolute;
      top: -5px;
      left: 90px;
      width: 24px;
      height: 24px;
      pointer-events: auto;
    }
    ${annotationCss}
  </style>
</head>
<body>
  <div id="viewer" class="pdfViewer pdf-helper-select-mode">
    <div class="page">
      <div class="textLayer"><span id="page-text">Alpha roadside barbecues continue through Beijing.</span></div>
      <div class="annotationEditorLayer">
        <div class="highlightEditor">
          <div class="internal"><button class="pdf-helper-note-indicator" aria-label="笔记"><span class="pdf-helper-note-preview">Saved note</span></button></div>
        </div>
      </div>
    </div>
  </div>
  <script>
    const viewer = document.querySelector('#viewer');
    const highlight = document.querySelector('.highlightEditor');
    window.coordinateHighlightClicks = 0;
    viewer.addEventListener('pointermove', event => {
      const indicator = document.querySelector('.pdf-helper-note-indicator');
      const rect = indicator.getBoundingClientRect();
      indicator.classList.toggle(
        'is-coordinate-hovered',
        event.buttons === 0 &&
          event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom,
      );
    });
    viewer.addEventListener('click', event => {
      const rect = highlight.getBoundingClientRect();
      if (
        event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom
      ) window.coordinateHighlightClicks += 1;
    });
  </script>
</body>
</html>`;

let browser;
let page;
let server;
let origin;

before(async () => {
  server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    channel: process.env.PDFPAL_TEST_BROWSER || "msedge",
    headless: true,
  });
  page = await browser.newPage();
  await page.goto(origin);
});

after(async () => {
  await page?.close();
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
});

test("existing highlight and note marker do not intercept Select-mode pointer input", async () => {
  const targets = await page.evaluate(() => {
    const highlight = document.querySelector(".highlightEditor").getBoundingClientRect();
    const note = document.querySelector(".pdf-helper-note-indicator").getBoundingClientRect();
    return [
      document.elementFromPoint(highlight.left + 12, highlight.top + 25)?.id,
      document.elementFromPoint(note.left + 12, note.top + 12)?.id,
    ];
  });
  assert.deepEqual(targets, ["page-text", "page-text"]);
});

test("a drag can start inside an existing highlight and select underlying text", async () => {
  const box = await page.locator("#page-text").boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + 130, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 470, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  const selected = await page.evaluate(() => getSelection()?.toString() || "");
  assert.ok(selected.length > 5, `expected text selection, received ${JSON.stringify(selected)}`);
});

test("simple clicks still reach coordinate-based highlight handling", async () => {
  const highlight = await page.locator(".highlightEditor").boundingBox();
  assert.ok(highlight);
  await page.mouse.click(highlight.x + 20, highlight.y + highlight.height / 2);
  assert.equal(await page.evaluate(() => window.coordinateHighlightClicks), 1);
});

test("coordinate hover restores the note preview without pointer interception", async () => {
  assert.match(noteHoverSource, /is-coordinate-hovered/);
  const note = await page.locator(".pdf-helper-note-indicator").boundingBox();
  assert.ok(note);
  await page.mouse.move(note.x + note.width / 2, note.y + note.height / 2);
  await page.waitForFunction(() =>
    document
      .querySelector(".pdf-helper-note-indicator")
      ?.classList.contains("is-coordinate-hovered"),
  );
  await page.waitForTimeout(180);
  const previewStyle = await page
    .locator(".pdf-helper-note-preview")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { opacity: style.opacity, visibility: style.visibility };
    });
  assert.deepEqual(previewStyle, { opacity: "1", visibility: "visible" });
});
