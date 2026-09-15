import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import ts from 'typescript';

// Real browser defaults and the installed PDF.js manager, not simulated key handlers.
const fixture = `<!doctype html><html><body>
<div id="reader-workspace">
  <main class="reading-panel"><div id="pdf" tabindex="0">PDF text
    <input id="pdf-form"><div id="pdf-editor" contenteditable="true">PDF annotation</div>
  </div></main>
  <aside class="right-panel">
    <section id="assistant-chat-panel" class="assistant-panel">
      <div id="chat-messages"><p id="reply">Chat answer to copy</p></div>
      <textarea id="chat-input"></textarea>
    </section>
    <section id="translation" class="ai-tab-panel"><p>Translated text</p><textarea id="translation-input"></textarea></section>
    <section id="settings" role="dialog" aria-modal="true" hidden>
      <input id="api-url" type="url"><input id="api-key" type="password">
    </section>
  </aside>
</div>
<section id="knowledge-base-page" hidden><p>Knowledge preview</p><input id="knowledge-search" type="search"><textarea id="knowledge-editor"></textarea></section>
<section id="vocabulary-library-page" hidden><p>Vocabulary preview</p><input id="vocabulary-search" type="search"><textarea id="vocabulary-editor"></textarea></section>
<dialog id="editor-dialog"><p>Dialog preview</p><textarea id="dialog-input"></textarea></dialog>
<script type="module">
import { createInteractionBoundary } from '/boundary.js';
import { AnnotationEditorUIManager, AnnotationEditorType } from '/pdf.mjs';
const pdf = document.getElementById('pdf');
window.boundary = createInteractionBoundary(document, pdf);
if (!location.search) boundary.install();
window.pdfCalls = [];
for (const method of ['keydown', 'copy', 'cut', 'paste', 'dragOver', 'drop']) {
  const original = AnnotationEditorUIManager.prototype[method];
  AnnotationEditorUIManager.prototype[method] = function(event) {
    pdfCalls.push(method + ':' + (event.key || event.type));
    return original.call(this, event);
  };
}
window.makeManager = async () => {
  const manager = new AnnotationEditorUIManager(pdf, pdf, null, null, null, null,
    { _on() {}, dispatch() {} }, { annotationStorage: {}, filterFactory: {} });
  manager.registerEditorTypes([]);
  await manager.updateMode(AnnotationEditorType.FREETEXT);
  return manager;
};
window.manager = await makeManager();
window.ready = true;
</script></body></html>`;

let server, browser, context, page, origin;
before(async () => {
  const source = await readFile(new URL('../src/viewer/shared-ui/interaction/interaction-boundary.ts', import.meta.url), 'utf8');
  const boundary = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const pdf = await readFile(new URL('../node_modules/pdfjs-dist/build/pdf.mjs', import.meta.url));
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/boundary.js' || request.url === '/pdf.mjs'
      ? 'text/javascript' : 'text/html');
    response.end(request.url === '/boundary.js' ? boundary : request.url === '/pdf.mjs' ? pdf : fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
  context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
});
beforeEach(async () => {
  await page?.close();
  page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => window.ready);
});
after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve) ?? resolve());
});

async function selectText(selector) {
  await page.locator(selector).click();
  await page.locator(selector).evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
}
async function resetCalls() { await page.evaluate(() => { pdfCalls.length = 0; }); }
async function assertNoPdfCalls() { assert.deepEqual(await page.evaluate(() => pdfCalls), []); }

test('unprotected PDF.js reproduces textarea select-all and deletion failure', async () => {
  await page.goto(origin + '?unprotected');
  await page.waitForFunction(() => window.ready);
  await page.locator('#chat-input').fill('abc');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#chat-input').inputValue(), 'abc');
  assert.ok((await page.evaluate(() => pdfCalls)).includes('keydown:Backspace'));
});

for (const [area, fields] of [
  ['reader-workspace', ['chat-input', 'translation-input']],
  ['settings', ['api-url', 'api-key']],
  ['knowledge-base-page', ['knowledge-search', 'knowledge-editor']],
  ['vocabulary-library-page', ['vocabulary-search', 'vocabulary-editor']],
  ['editor-dialog', ['dialog-input']],
]) {
  test(`${area}: native select-all, copy, cut, paste, delete and undo stay local`, async () => {
    await page.evaluate(area => {
      if (area === 'editor-dialog') document.getElementById(area).showModal();
      else document.getElementById(area).hidden = false;
      if (area.endsWith('-page')) document.getElementById('reader-workspace').hidden = true;
    }, area);
    for (const id of fields) {
      const input = page.locator('#' + id);
      await input.fill('');
      await input.pressSequentially('test-value');
      await resetCalls();
      await page.keyboard.press('Control+a');
      assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd]), [0, 10]);
      // Browsers intentionally prohibit copying password inputs; paste/deletion still work.
      if (id !== 'api-key') {
        await page.keyboard.press('Control+c');
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'test-value');
        await page.keyboard.press('Control+x');
        assert.equal(await input.inputValue(), '');
      }
      await page.evaluate(() => navigator.clipboard.writeText('pasted-value'));
      await page.keyboard.press('Control+v');
      assert.equal(await input.inputValue(), 'pasted-value');
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      assert.equal(await input.inputValue(), '');
      await page.keyboard.press('Control+z');
      assert.equal(await input.inputValue(), 'pasted-value');
      await page.keyboard.press('Control+y');
      assert.equal(await input.inputValue(), '');
      await page.keyboard.type('abc');
      await page.keyboard.press('Backspace');
      assert.equal(await input.inputValue(), 'ab');
      await assertNoPdfCalls();
    }
  });
}

for (const selector of ['#chat-messages', '#translation', '#knowledge-base-page', '#vocabulary-library-page']) {
  test(`${selector}: ordinary text selection and Ctrl+A cannot reach PDF`, async () => {
    await page.locator(selector).evaluate(el => { el.hidden = false; });
    await selectText(selector + ' p');
    await resetCalls();
    const expected = await page.locator(selector + ' p').textContent();
    await page.keyboard.press('Control+c');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
    await page.keyboard.press('Control+a');
    assert.equal(await page.evaluate(() => getSelection().toString().trim()), expected);
    for (const key of ['Backspace', 'Delete', 'Control+z', 'Control+y', 'Control+f', 'Control+s']) {
      // Synthetic F/S avoids opening browser UI; inspect ownership used by app shortcuts.
      const owned = await page.evaluate(key => {
        const event = new KeyboardEvent('keydown', { key: key.split('+').at(-1), ctrlKey: key.includes('Control'), bubbles: true });
        document.activeElement.dispatchEvent(event);
        return boundary.ownsPdfKeyboard(event);
      }, key);
      assert.equal(owned, false);
    }
    await assertNoPdfCalls();
  });
}

test('stale PDF selection, dynamic editors, contenteditable and IME stay isolated', async () => {
  await selectText('#pdf');
  await page.evaluate(() => {
    const editor = document.createElement('div');
    editor.id = 'dynamic-editor';
    editor.contentEditable = 'true';
    editor.textContent = 'Editable text';
    document.getElementById('assistant-chat-panel').append(editor);
  });
  await page.locator('#dynamic-editor').click();
  await resetCalls();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#dynamic-editor').textContent(), '');
  const prevented = await page.locator('#chat-input').evaluate(el => {
    el.focus();
    const event = new KeyboardEvent('keydown', { key: 'Backspace', isComposing: true, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(prevented, false);
  await assertNoPdfCalls();
});

test('pointer region wins over stale PDF focus, and hidden PDF cannot reclaim shortcuts', async () => {
  await page.locator('#pdf').focus();
  await page.locator('#reply').evaluate(el => {
    el.addEventListener('mousedown', event => event.preventDefault());
  });
  await page.locator('#reply').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'pdf');
  await resetCalls();
  await page.keyboard.press('Control+a');
  assert.equal(await page.evaluate(() => getSelection().toString()), 'Chat answer to copy');
  await assertNoPdfCalls();
  await page.locator('#pdf').focus();
  await page.evaluate(() => {
    const reader = document.getElementById('reader-workspace');
    reader.inert = true;
    reader.classList.add('is-workspace-outgoing');
    document.getElementById('vocabulary-library-page').hidden = false;
  });
  await resetCalls();
  await page.keyboard.press('Control+a');
  assert.equal(await page.evaluate(() => getSelection().toString().trim()), 'Vocabulary preview');
  await page.keyboard.press('Delete');
  await assertNoPdfCalls();
});

test('PDF keyboard, annotation clipboard, form editing and manager recreation still work', async () => {
  await page.locator('#pdf').focus();
  await resetCalls();
  await page.keyboard.press('Control+a');
  assert.ok((await page.evaluate(() => pdfCalls)).includes('keydown:a'));
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.keyboard.press('Control+c');
  assert.ok((await page.evaluate(() => pdfCalls)).includes('copy:copy'));
  await page.locator('#pdf-form').fill('abc');
  await resetCalls();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#pdf-form').inputValue(), '');
  await assertNoPdfCalls();
  await page.evaluate(async () => { manager.destroy(); manager = await makeManager(); boundary.install(); });
  await page.locator('#chat-input').fill('abc');
  await resetCalls();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#chat-input').inputValue(), '');
  await assertNoPdfCalls();
});

test('modal Escape stays local even when its handler closes it and restores PDF focus', async () => {
  await page.locator('#pdf').focus();
  await page.evaluate(() => {
    const dialog = document.getElementById('editor-dialog');
    dialog.showModal();
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { dialog.close(); document.getElementById('pdf').focus(); }
    });
  });
  await resetCalls();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#editor-dialog').evaluate(el => el.open), false);
  await assertNoPdfCalls();
});

test('chat paste handler and image drops run locally; Shift releases after focus changes', async () => {
  await page.locator('#pdf').focus();
  await page.keyboard.down('Shift');
  assert.equal(await page.evaluate(() => manager.isShiftKeyDown), true);
  await page.locator('#chat-input').focus();
  await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(() => manager.isShiftKeyDown), false);
  await resetCalls();
  const result = await page.locator('#chat-input').evaluate(el => {
    let handled = 0;
    el.addEventListener('paste', event => { handled++; event.preventDefault(); });
    const data = new DataTransfer();
    data.items.add(new File(['image'], 'test.png', { type: 'image/png' }));
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
    el.dispatchEvent(paste);
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    return { handled, prevented: paste.defaultPrevented };
  });
  assert.deepEqual(result, { handled: 1, prevented: true });
  await assertNoPdfCalls();
});
