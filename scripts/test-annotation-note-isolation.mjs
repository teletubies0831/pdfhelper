import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(name, dependencies) {
  const source = readFileSync(new URL(`../src/viewer/features/annotations/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)((name) => {
    assert.ok(name in dependencies, `Missing dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

function setup() {
  const state = {
    pdfDocument: { value: { numPages: 1 } },
    annotationEditor: { value: null },
    nativeAnnotationNotes: new Map(),
    restoredHelperNotesBySignature: new Map(),
    restoredHelperNotesByStorageKey: new Map(),
    restoredHighlightTextBySignature: new Map(),
    restoredHighlightTextByStorageKey: new Map(),
    selectedHighlightEditor: { value: null },
    openHighlightNoteEditor: { value: null },
  };
  const codec = load('annotation-value-codec', {
    'pdfjs-dist': { AnnotationEditorType: { HIGHLIGHT: 9 } }, '../../app/viewer-state': state,
    '../../app/document-identity': { getPdfFingerprint() { return ''; } },
  });
  const index = load('annotation-note-index', {
    '../../app/viewer-state': state, './annotation-value-codec': codec,
  });
  const content = load('annotation-comment-content', {});
  const elements = { highlightNoteText: { value: '' }, highlightNotePopover: { hidden: false } };
  const notes = load('annotation-notes', {
    '../../app/viewer-state': state, '../../app/viewer-elements': elements,
    '../../app/status-bar': { setStatus() {} },
    './annotation-persistence': { ...codec, ...index, markUnsavedChanges() {} },
    './annotation-editor': {}, './annotation-highlight-content': {},
    './annotation-highlight-index': {}, './annotation-comment-content': content,
  });
  return { state, codec, index, content, elements, notes };
}

test('a restored editor id cannot copy its old note to a new highlight', () => {
  const { index, notes } = setup();
  index.rememberHelperNote('pdfjs_internal_editor_0', '0|9|old-position', 'old note');
  const fresh = { id: 'pdfjs_internal_editor_0', serialize: () => ({ pageIndex: 0, annotationType: 9, rect: [10, 20, 30, 40] }) };
  assert.equal(notes.getHighlightNote(fresh), '');
  assert.equal(index.getRememberedHelperNote(['different-id'], '0|9|old-position'), 'old note');
});

test('legacy native ids work but geometry-free transient ids are unsafe', () => {
  const { index, codec } = setup();
  index.rememberHelperNote('42R', undefined, 'native note');
  index.rememberHelperNote('pdfjs_internal_editor_0', undefined, 'unrelated note');
  assert.equal(index.getRememberedHelperNote(['42R'], ''), 'native note');
  assert.equal(index.getRememberedHelperNote(['pdfjs_internal_editor_0'], ''), '');
  assert.equal(codec.getAnnotationGeometrySignature({ pageIndex: 0, annotationType: 9 }), '');
});

test('clearing a restored note stays empty and saves only to the popover owner', () => {
  const { state, elements, notes, codec, index, content } = setup();
  const owner = { id: 'pdfjs_internal_editor_0', pdfHelperNote: 'old',
    _initialData: { comment: 'old' },
    serialize: () => ({ pageIndex: 0, annotationType: 9, rect: [1, 2, 3, 4] }) };
  const unrelated = { pdfHelperNote: 'other' };
  index.rememberHelperNote(owner.id, codec.getAnnotationGeometrySignature(owner.serialize()), 'old');
  state.openHighlightNoteEditor.value = owner;
  state.selectedHighlightEditor.value = unrelated;
  elements.highlightNoteText.value = '';
  notes.saveHighlightNote();
  assert.equal(notes.getHighlightNote(owner), '');
  assert.equal(unrelated.pdfHelperNote, 'other');
  assert.equal(content.getAnnotationNoteFromValue({ pdfHelperNote: '', comment: 'old', contentsObj: { str: 'old' } }), '');
  assert.equal(content.getAnnotationNoteFromValue({ comment: { text: 'old', deleted: true }, contentsObj: { str: 'old' } }), '');
  assert.equal(notes.getHighlightNote({ _initialData: { pdfHelperNote: '', contentsObj: { str: 'old' } } }), '');
});

test('serialization finds matching geometry before a reused editor id', () => {
  const { state, notes } = setup();
  const target = { pageIndex: 0, annotationType: 9, rect: [1, 2, 3, 4] };
  const wrong = { id: 'pdfjs_internal_editor_0', editorType: 9, serialize: () => ({ ...target, rect: [5, 6, 7, 8] }) };
  const correct = { id: 'pdfjs_internal_editor_7', editorType: 9, serialize: () => target };
  state.annotationEditor.value = { getEditors: () => [wrong, correct] };
  assert.equal(notes.findLiveEditorForSerializedEntry(wrong.id, target), correct);
});

test('reopening an explicitly cleared note removes contradictory saved indexes', () => {
  const { state, codec, index, content } = setup();
  const restored = new Map();
  state.pdfDocument.value.annotationStorage = { setValue: (key, value) => restored.set(key, value) };
  const restoration = load('annotation-restoration', {
    '../../app/viewer-state': state, './annotations': content,
    './embedded-helper-payload': { fromJsonSafeAnnotationValue: value => value },
    './annotation-value-codec': codec, './annotation-note-index': index,
    './annotation-highlight-content': { getStoredHighlightText: () => '' },
    './annotation-highlight-index': {},
  });
  const value = { pageIndex: 0, annotationType: 9, rect: [1, 2, 3, 4], pdfHelperNote: '', comment: 'stale' };
  const signature = codec.getAnnotationGeometrySignature(value);
  restoration.restoreEmbeddedHelperPayload({
    entries: [['pdfjs_internal_editor_0', value]],
    notes: [{ key: 'pdfjs_internal_editor_0', signature, note: 'stale' }],
  });
  assert.equal(restored.get('pdf-helper-pdfjs_internal_editor_0').comment, null);
  assert.equal(index.getRememberedHelperNote(['pdfjs_internal_editor_0'], signature), '');
});

test('creating a note snapshots editors after mode restoration', async () => {
  const old = { editorType: 9, note: 'existing note' };
  const fresh = { editorType: 9 };
  let editors = [];
  const manager = {
    getEditors: () => editors, unselectAll() {},
    async updateMode() { if (!editors.length) editors = [old]; },
    highlightSelection() { editors.push(fresh); },
  };
  const page = { dataset: { pageNumber: '1' } };
  const textLayer = { closest: () => page };
  const selection = { isCollapsed: false, anchorNode: { nodeType: 1, closest: () => textLayer }, removeAllRanges() {}, addRange() {} };
  const previousWindow = globalThis.window;
  const previousNode = globalThis.Node;
  globalThis.window = { getSelection: () => selection };
  globalThis.Node = { TEXT_NODE: 3 };
  try {
    const creation = load('highlight-creation', {
      'pdfjs-dist': { AnnotationEditorType: { HIGHLIGHT: 9, NONE: 0 } },
      '../../app/viewer-elements': {},
      '../../app/viewer-state': { annotationEditor: { value: manager }, contextSelectionRanges: { value: [{}] }, contextSelectionText: { value: 'new selection' }, selectedAnnotationEditor: {}, selectedHighlightEditor: {} },
      '../../core/pdf-reader/public': {}, '../../app/status-bar': { setStatus() {} },
      './annotation-persistence': { getAnnotationGeometrySignature: () => '', getEditorSerializedValue: () => null, getEditorStorageKeys: () => [], isHighlightEditor: e => e.editorType === 9, markUnsavedChanges() {} },
      './annotation-editor': { setHighlightColor() {} },
      './annotation-highlight-content': { setHighlightEditorText: (editor, text) => editor.text = text },
      './annotation-highlight-index': { rememberHighlightText() {} },
      './annotation-notes': { clearDomSelection() {}, hideAnnotationActionBar() {}, hideSelectionContextMenu() {} },
      './annotation-tool-mode': { setEditorMode() {} },
    });
    assert.equal(await creation.createQuickHighlight('#ffff00'), fresh);
    assert.equal(old.text, undefined);
    assert.equal(fresh.text, 'new selection');
  } finally {
    globalThis.window = previousWindow;
    globalThis.Node = previousNode;
  }
});
