import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

/**
 * The pen's colour controls.
 *
 * `ink-tool-preferences.ts` is the only place that turns a click on a swatch into something PDF.js
 * understands: an `INK_COLOR` parameter on the *editor defaults*, which is what the next stroke reads. That
 * wiring is invisible in a DOM test (the popover renders either way), so it is driven here with the real
 * `AnnotationEditorParamsType` values read out of PDF.js and stubbed browser modules.
 *
 * PDF.js itself cannot be imported in Node (its module body needs `DOMMatrix`), so the constants are read
 * from its build and handed to the stubbed module — which also proves the numbers are the real ones.
 */

const PDFJS_BUILD = readFileSync(
  new URL('../node_modules/pdfjs-dist/build/pdf.mjs', import.meta.url),
  'utf8',
);

/** The numeric values of the editor parameters this feature uses, as PDF.js defines them. */
function readEditorParamType(name) {
  const match = new RegExp(`\\b${name}: (\\d+),`).exec(PDFJS_BUILD);
  assert.ok(match, `pdf.js no longer exports ${name}; the pen wiring needs updating`);
  return Number(match[1]);
}

const AnnotationEditorParamsType = {
  INK_COLOR: readEditorParamType('INK_COLOR'),
  INK_THICKNESS: readEditorParamType('INK_THICKNESS'),
};

function fakeButton(color, index) {
  const attributes = new Map();
  return {
    dataset: { inkColor: color, inkColorIndex: String(index) },
    style: { setProperty() {} },
    listeners: new Map(),
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    click() { this.listeners.get('click')?.(); },
    pressed() { return attributes.get('aria-pressed'); },
  };
}

function loadPreferences({ stored = {}, colors = ['#000000', '#e5484d', '#1f67e8'] } = {}) {
  const source = readFileSync(
    new URL('../src/viewer/features/annotations/ink-tool-preferences.ts', import.meta.url),
    'utf8',
  );
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const updates = [];
  const selections = [];
  const closed = [];
  const persisted = new Map(Object.entries(stored));
  const buttons = colors.map(fakeButton);
  const colorInput = { value: '#000000', listeners: new Map(),
    addEventListener(type, handler) { this.listeners.set(type, handler); } };
  const thicknessInput = { value: '3', listeners: new Map(),
    addEventListener(type, handler) { this.listeners.set(type, handler); } };
  const state = {
    annotationEditor: {
      value: {
        unselectAll() { selections.push(true); },
        updateParams(type, value) { updates.push([type, value]); },
      },
    },
    pdfViewer: { currentScale: 1 },
  };
  const annotations = { inset: true };
  const elements = {
    inkColorButtons: buttons,
    inkColorInput: colorInput,
    inkThicknessControl: annotations,
    inkThicknessInput: thicknessInput,
    inkThicknessValue: { value: '' },
    viewerElement: {
      classList: { contains: (name) => name === 'pdf-helper-ink-mode' || name === 'x' },
    },
  };

  const module = {};
  const require = (name) => {
    if (name === 'pdfjs-dist') return { AnnotationEditorParamsType };
    if (name === '../../app/viewer-elements') return elements;
    if (name === '../../app/viewer-state') return state;
    if (name === './annotation-size-popover') {
      return { closeAnnotationSizePopover: (control) => closed.push(control) };
    }
    if (name === '../../../infrastructure/storage/browser-json-repository') {
      return {
        readJsonValue: (key, fallback) => persisted.get(key) ?? fallback,
        writeJsonValue: (key, value) => { persisted.set(key, value); },
      };
    }
    throw new Error(`Unexpected dependency: ${name}`);
  };
  globalThis.document ??= { addEventListener() {}, body: { append() {} }, createElement: () => ({
    style: { setProperty() {} }, classList: { add() {} }, setAttribute() {},
  }) };
  globalThis.window ??= { addEventListener() {} };
  new Function('require', 'exports', code)(require, module);

  return { module, updates, selections, closed, persisted, buttons, colorInput };
}

test('the palette is defined once, in the template, and the first swatch is the default', () => {
  // The colours and their spoken names live in the markup, so a DOM test can read them without booting
  // this module — and there is exactly one place to add a colour.
  const template = readFileSync(
    new URL('../src/viewer/templates/toolbar.html', import.meta.url),
    'utf8',
  );
  const swatches = [...template.matchAll(
    /data-ink-color-index="(\d+)" data-ink-color="(#[0-9a-f]{6})"[^>]*aria-label="([^"]+)"/gi,
  )];
  assert.ok(swatches.length >= 6, `expected a pen palette in the toolbar; found ${swatches.length}`);
  assert.equal(
    new Set(swatches.map((match) => match[2].toLowerCase())).size,
    swatches.length,
    'every preset is a distinct colour',
  );
  assert.match(template, /<input id="ink-color" type="color"/, 'a native picker covers anything else');
  assert.match(template, /画笔设置/, 'the popover is announced as the pen’s settings');
});

test('picking a colour sets the parameter PDF.js reads for the next stroke', () => {
  // The parameter has to be the ink colour *and* PDF.js has to map it onto the stroke: both halves are
  // checked, because a mapping that went missing upstream would leave the pen black with no error anywhere.
  assert.match(
    PDFJS_BUILD,
    /\[AnnotationEditorParamsType\.INK_COLOR, "stroke"\]/,
    'pdf.js maps INK_COLOR onto the drawing’s stroke property',
  );
  assert.notEqual(
    AnnotationEditorParamsType.INK_COLOR,
    AnnotationEditorParamsType.INK_THICKNESS,
    'the pen, the highlighter and free text each have their own colour parameter',
  );

  const { module, updates, selections, persisted, buttons, colorInput } = loadPreferences();

  assert.equal(module.getInkColor(), '#000000', 'the first swatch is the default pen colour');
  module.setInkColor('#1f67e8');

  assert.deepEqual(updates.at(-1), [AnnotationEditorParamsType.INK_COLOR, '#1f67e8']);
  assert.equal(selections.length > 0, true, 'nothing stays selected, so a finished stroke is not recoloured');
  assert.equal(persisted.get('pdf-helper-ink-color-v1'), '#1f67e8', 'the choice survives a restart');
  assert.equal(colorInput.value, '#1f67e8', 'the native picker shows the chosen colour');
  assert.deepEqual(
    buttons.map((button) => button.pressed()),
    ['false', 'false', 'true'],
    'exactly one swatch reads as selected',
  );
});

test('a stored colour is restored, and nonsense falls back to black', () => {
  const stored = loadPreferences({ stored: { 'pdf-helper-ink-color-v1': '#E5484D' } });
  assert.equal(stored.module.getInkColor(), '#e5484d', 'a stored colour is normalised, not trusted');

  for (const value of ['red', '#12345', '', 'rgb(0,0,0)', null]) {
    const broken = loadPreferences({ stored: { 'pdf-helper-ink-color-v1': value } });
    assert.equal(broken.module.getInkColor(), '#000000', `"${value}" is not a colour`);
  }

  // An unusable value is ignored rather than written to the picker, which would break its format.
  const { module, updates, persisted } = loadPreferences();
  module.setInkColor('chartreuse');
  assert.deepEqual(updates, [], 'an invalid colour must not reach PDF.js');
  assert.equal(persisted.has('pdf-helper-ink-color-v1'), false);
});

test('the popover wires clicks to the colour and then gets out of the way', () => {
  const { module, updates, closed, buttons, colorInput } = loadPreferences();
  module.installInkToolInteractions();

  buttons[1].click();
  assert.deepEqual(updates.at(-1), [AnnotationEditorParamsType.INK_COLOR, '#e5484d']);
  assert.equal(closed.length, 1, 'the popover closes so it does not cover the page');

  // Dragging the native picker previews the colour, and only the settled value is persisted.
  colorInput.value = '#7048e8';
  colorInput.listeners.get('input')();
  assert.deepEqual(updates.at(-1), [AnnotationEditorParamsType.INK_COLOR, '#7048e8']);
  colorInput.value = '#1a7f47';
  colorInput.listeners.get('change')();
  assert.deepEqual(updates.at(-1), [AnnotationEditorParamsType.INK_COLOR, '#1a7f47']);

  // Installing twice must not double up: one click, one update.
  const before = updates.length;
  module.installInkToolInteractions();
  buttons[2].click();
  assert.equal(updates.length, before + 1);
});
