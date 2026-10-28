import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { loadModule } from './support/module-closure.mjs';

/**
 * 跨页面写入不再互相覆盖.
 *
 * Both stores used to be "read the whole collection → change it in memory → write the whole collection back" under one key.
 * `browser.storage.local` has no transaction and no version check, so two Viewer pages (「新标签页打开原文」 makes that normal) read
 * the same snapshot and the later write silently discarded the other page's work.
 *
 * The fix shards the storage: one key per vocabulary card, one key per document's translation history. These tests run the **real**
 * repository modules against a fake storage port whose `get` resolves on a later tick, which is what lets two "pages" be in flight
 * at once — and is exactly the interleaving that used to lose data.
 */

let browser;
let page;

before(async () => {
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
  page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  // `page.setContent` 的文档不是安全上下文，`crypto.randomUUID` 在无头 Edge 里可能缺失；真实扩展页面有它。
  await page.evaluate(() => {
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
      let counter = 0;
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: {
          randomUUID: () => `uuid-${(counter += 1)}`,
          getRandomValues: (array) => array,
        },
      });
    }
  });
});

after(async () => { await browser?.close(); });

/** 把模块装进页面，`wxt/browser` 注入假 storage. */
async function installRepositories() {
  const vocabularyCode = await loadModule('src/viewer/features/vocabulary-library/vocabulary-repository.ts');
  const historyCode = await loadModule('src/viewer/features/translation/translation-history-repository.ts');
  await page.evaluate(([vocabularySource, historySource]) => {
    // A storage area with the semantics that matter here: `get(null)` returns everything, `get(string)` returns one key, and
    // `remove` accepts one key or a list. Every operation awaits a macrotask so two callers can interleave.
    window.makeStorage = () => {
      const data = new Map();
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
      return {
        data,
        async get(keys) {
          await tick();
          if (keys === null || keys === undefined) return Object.fromEntries(data);
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (data.has(key)) out[key] = data.get(key);
          return out;
        },
        async set(items) {
          await tick();
          for (const [key, value] of Object.entries(items)) data.set(key, value);
        },
        async remove(keys) {
          await tick();
          for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
        },
      };
    };

    // 每个「页面」拿到自己的模块实例，但共享同一个 storage —— 两个 Viewer 页面的真实关系。
    window.loadPage = (storage) => {
      const jsonStorage = {
        readJsonValue: (key, fallback) => storage.data.get(`local:${key}`) ?? fallback,
        writeJsonValue: (key, value) => storage.data.set(`local:${key}`, value),
      };
      // transpiled CommonJS 会把 `import { browser }` 变成 `require(...).browser`，所以这里要包一层。
      const wxtBrowser = { browser: { storage: { local: storage } } };
      const vocabulary = {};
      new Function('require', 'exports', vocabularySource)((name) => {
        if (name === 'wxt/browser') return wxtBrowser;
        if (name.includes('browser-json-repository')) return jsonStorage;
        throw new Error(`Unmapped dependency: ${name}`);
      }, vocabulary);
      const history = {};
      new Function('require', 'exports', historySource)((name) => {
        if (name === 'wxt/browser') return wxtBrowser;
        if (name.includes('/app/public')) {
          return {
            TRANSLATION_HISTORY_KEY_PREFIX: 'pdf-helper-translation-history-v1::',
            TRANSLATION_HISTORY_STORAGE_KEY: 'pdf-helper-translation-history-v1',
          };
        }
        throw new Error(`Unmapped dependency: ${name}`);
      }, history);
      return { vocabulary, history };
    };

    window.pageA = window.loadPage(window.makeStorage());
    window.pageB = window.pageA;
    window.sharedStorage = window.sharedStorage ?? null;
  }, [vocabularyCode, historyCode]);

  // 让两个页面共享同一个 storage（上面第二次赋值只是为了拿到同一份实例）。
  await page.evaluate(() => {
    const storage = window.makeStorage();
    window.sharedStorage = storage;
    window.pageA = window.loadPage(storage);
    window.pageB = window.loadPage(storage);
  });
}

test('对照：旧实现（整包读→整包写）在这种交错下确实会丢数据', async () => {
  // 这条不是测产品代码，而是证明上面那几条断言真的能发现回归：同样的假 storage、同样的并发，
  // 「读整包→改内存→写整包」会丢掉先完成的那一次写入。
  await installRepositories();
  const result = await page.evaluate(async () => {
    const storage = window.makeStorage();
    const KEY = 'pdf-helper-vocabulary-library-v1';
    const oldPage = () => ({
      async create(term) {
        const stored = await storage.get(KEY);
        const cards = Array.isArray(stored[KEY]) ? stored[KEY] : [];
        await storage.set({ [KEY]: [{ term }, ...cards] });
      },
      async list() {
        const stored = await storage.get(KEY);
        return (stored[KEY] ?? []).map((card) => card.term);
      },
    });
    const a = oldPage();
    const b = oldPage();
    await Promise.all([a.create('alpha'), b.create('beta')]);
    return { terms: await a.list() };
  });

  assert.equal(result.terms.length, 1, '整包写入丢掉了另一页面的卡（这正是被修复的行为）');
});

test('两个页面同时新增单词卡：两张都留得住（旧实现会丢一张）', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const { vocabulary } = window.pageA;
    const { vocabulary: other } = window.pageB;
    await Promise.all([
      vocabulary.createVocabularyCard({
        term: 'alpha', pronunciation: '', partOfSpeech: 'noun', markdown: '## A', tags: [],
        sourceText: '', documentName: 'A.pdf',
      }),
      other.createVocabularyCard({
        term: 'beta', pronunciation: '', partOfSpeech: 'verb', markdown: '## B', tags: [],
        sourceText: '', documentName: 'B.pdf',
      }),
    ]);
    const cards = await vocabulary.readVocabularyCards();
    const keys = [...window.sharedStorage.data.keys()].filter((key) => key.includes('vocabulary-card'));
    return {
      terms: cards.map((card) => card.term).sort(),
      keys,
      legacyKey: window.sharedStorage.data.has('pdf-helper-vocabulary-library-v1'),
    };
  });

  assert.deepEqual(result.terms, ['alpha', 'beta'], 'two concurrent creates both survive');
  assert.equal(result.keys.length, 2, 'each card has its own key');
  assert.equal(result.legacyKey, false);
});

test('一个页面删除、另一个页面新增：互不干扰', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const { vocabulary } = window.pageA;
    const { vocabulary: other } = window.pageB;
    const first = await vocabulary.createVocabularyCard({
      term: 'keep', pronunciation: '', partOfSpeech: '', markdown: '## K', tags: [], sourceText: '', documentName: '',
    });
    const doomed = await vocabulary.createVocabularyCard({
      term: 'delete-me', pronunciation: '', partOfSpeech: '', markdown: '## D', tags: [], sourceText: '', documentName: '',
    });
    const removed = await vocabulary.deleteVocabularyCard(doomed.id);
    await other.createVocabularyCard({
      term: 'added-later', pronunciation: '', partOfSpeech: '', markdown: '## N', tags: [], sourceText: '', documentName: '',
    });
    const cards = await vocabulary.readVocabularyCards();
    return {
      removed,
      terms: cards.map((card) => card.term).sort(),
      keptId: cards.find((card) => card.term === 'keep')?.id === first.id,
      deleteAgain: await vocabulary.deleteVocabularyCard(doomed.id),
    };
  });

  assert.equal(result.removed, true);
  assert.deepEqual(result.terms, ['added-later', 'keep']);
  assert.equal(result.keptId, true);
  assert.equal(result.deleteAgain, false, 'deleting a missing card reports false instead of writing an empty collection');
});

test('旧格式单词库：首次读取迁移成一张卡一个键，数据一条不丢', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const legacyCards = [
      { id: 'c1', term: 'legacy-one', markdown: '## 1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'c2', term: 'legacy-two', markdown: '## 2', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
      { id: 'broken', term: '', markdown: '', createdAt: '' },
    ];
    window.sharedStorage.data.set('pdf-helper-vocabulary-library-v1', legacyCards);
    const cards = await window.pageA.vocabulary.readVocabularyCards();
    return {
      terms: cards.map((card) => card.term),
      legacyGone: !window.sharedStorage.data.has('pdf-helper-vocabulary-library-v1'),
      cardKeys: [...window.sharedStorage.data.keys()].filter((key) => key.startsWith('pdf-helper-vocabulary-card-legacy-v1::')).sort(),
      liveKeys: [...window.sharedStorage.data.keys()].filter((key) => key.startsWith('pdf-helper-vocabulary-card-v1::')).sort(),
    };
  });

  // 旧数组是「新→旧」：迁移后按创建时间排，legacy-two 更新所以在前。
  assert.deepEqual(result.terms, ['legacy-two', 'legacy-one']);
  assert.equal(result.legacyGone, true, 'the migrated legacy key is removed');
  // 迁移只写自己的命名空间：用户那一侧（live 键）不参与，才不会有「检查后写入」的覆盖窗口。
  assert.deepEqual(result.cardKeys, [
    'pdf-helper-vocabulary-card-legacy-v1::c1',
    'pdf-helper-vocabulary-card-legacy-v1::c2',
  ]);
  assert.deepEqual(result.liveKeys, []);
});

test('P2-09：旧单词库键未删成功时，后续读取会继续迁移并完成清理', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const storage = window.sharedStorage;
    const legacyKey = 'pdf-helper-vocabulary-library-v1';
    storage.data.set(legacyKey, [
      { id: 'c1', term: 'legacy', markdown: '## legacy', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]);
    let rejectFirstLegacyRemove = true;
    const interrupted = {
      get: (keys) => storage.get(keys),
      set: (items) => storage.set(items),
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        if (rejectFirstLegacyRemove && list.includes(legacyKey)) {
          rejectFirstLegacyRemove = false;
          throw new Error('simulated interruption after import write');
        }
        return storage.remove(keys);
      },
    };
    const vocabulary = window.loadPage(interrupted).vocabulary;
    const first = await vocabulary.readVocabularyCards();
    const retainedAfterFirst = storage.data.has(legacyKey);
    const second = await vocabulary.readVocabularyCards();
    return {
      first: first.map((card) => card.id),
      second: second.map((card) => card.id),
      retainedAfterFirst,
      legacyGoneAfterRetry: !storage.data.has(legacyKey),
    };
  });

  assert.deepEqual(result.first, ['c1']);
  assert.deepEqual(result.second, ['c1']);
  assert.equal(result.retainedAfterFirst, true, 'the first interruption keeps the only old copy');
  assert.equal(result.legacyGoneAfterRetry, true, 'a later read retries even though an imported card is already visible');
});

test('P1-03：迁移的检查之后、写入之前另一页面编辑了同一张卡（旧实现会覆盖这次编辑）', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const storage = window.sharedStorage;
    storage.data.set('pdf-helper-vocabulary-library-v1', [
      { id: 'c1', term: 'original', markdown: '## 1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]);
    const pageB = window.loadPage(storage).vocabulary;
    // A 的迁移：读取之后、写入之前，让 B 先迁移再编辑 c1。
    let interleaved = false;
    const hooked = {
      async get(keys) {
        const value = await storage.get(keys);
        if (!interleaved && keys === 'pdf-helper-vocabulary-library-v1') {
          interleaved = true;
          await pageB.readVocabularyCards();
          await pageB.updateVocabularyCard('c1', {
            term: 'edited-by-B', pronunciation: '', partOfSpeech: '', markdown: '## 1', tags: [],
          });
        }
        return value;
      },
      set: (items) => storage.set(items),
      remove: (keys) => storage.remove(keys),
    };
    // A 用一个「迁移里能看到」的端口跑一次迁移：直接调用其内部路径不可行，所以复制旧键让 A 的 read 触发迁移。
    const cards = await window.loadPage(hooked).vocabulary.readVocabularyCards();
    // A 的迁移若把旧快照写到 live 键，B 的编辑就被覆盖；正确实现只写 import 键，读回来仍是 B 的编辑。
    const after = await window.pageB.vocabulary.readVocabularyCards();
    return {
      fromMigration: cards.map((card) => card.term).sort(),
      after: after.map((card) => card.term).sort(),
      liveKeys: [...storage.data.keys()].filter((key) => key.startsWith('pdf-helper-vocabulary-card-v1::')),
    };
  });

  assert.deepEqual(result.after, ['edited-by-B'], 'B 的编辑必须活下来：迁移的旧快照不能落在 live 键上');
  assert.equal(result.liveKeys.length, 1);
});

test('两个页面同时写不同文献的学习历史：两份都留得住（旧实现会互相覆盖）', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const { history } = window.pageA;
    const { history: other } = window.pageB;
    const entry = (id) => ({ id, sourceText: id, pageNumber: 1, result: { kind: 'sentence', translation: 't' }, updatedAt: 1 });
    await Promise.all([
      history.writeDocumentHistory('doc-a', [entry('a1')]),
      other.writeDocumentHistory('doc-b', [entry('b1')]),
    ]);
    return {
      a: (await history.readDocumentHistory('doc-a')).map((item) => item.id),
      b: (await other.readDocumentHistory('doc-b')).map((item) => item.id),
      keys: [...window.sharedStorage.data.keys()]
        .filter((key) => key.startsWith('pdf-helper-translation-history-v1::')).sort(),
    };
  });

  assert.deepEqual(result.a, ['a1'], 'the other page did not wipe document A history');
  assert.deepEqual(result.b, ['b1']);
  assert.deepEqual(result.keys, [
    'pdf-helper-translation-history-v1::doc-a',
    'pdf-helper-translation-history-v1::doc-b',
  ]);
});

test('清空一篇文献的历史只删它自己的键', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const { history } = window.pageA;
    const entry = (id) => ({ id, sourceText: id, pageNumber: 1, result: { kind: 'sentence', translation: 't' }, updatedAt: 1 });
    await history.writeDocumentHistory('doc-a', [entry('a1')]);
    await history.writeDocumentHistory('doc-b', [entry('b1')]);
    await history.writeDocumentHistory('doc-a', []);
    return {
      a: await history.readDocumentHistory('doc-a'),
      b: (await history.readDocumentHistory('doc-b')).map((item) => item.id),
      hasAKey: window.sharedStorage.data.has('pdf-helper-translation-history-v1::doc-a'),
    };
  });

  assert.equal(result.a, undefined, 'an empty list removes the key rather than storing []');
  assert.equal(result.hasAKey, false);
  assert.deepEqual(result.b, ['b1']);
});

test('清空迁移进来的历史后不能又被快照「复活」', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const entry = (id) => ({ id, sourceText: id, pageNumber: 1, result: { kind: 'sentence', translation: 't' }, updatedAt: 1 });
    const storage = window.sharedStorage;
    storage.data.set('pdf-helper-translation-history-v1', { 'doc-a': [entry('a1')] });
    const { history } = window.pageA;
    await history.migrateLegacyHistory();
    const beforeClear = (await history.readDocumentHistory('doc-a'))?.length;
    // 用户点了「清空当前 PDF 的历史」。
    await history.writeDocumentHistory('doc-a', []);
    return {
      beforeClear,
      afterClear: await history.readDocumentHistory('doc-a'),
      importKeyGone: !storage.data.has('pdf-helper-translation-history-v1::legacy::doc-a'),
    };
  });

  assert.equal(result.beforeClear, 1, '迁移进来的历史能读到');
  assert.equal(result.afterClear, undefined, '清空之后连迁移快照也要删，否则会被重新读出来');
  assert.equal(result.importKeyGone, true);
});

test('P1-04：清空发生在另一页面迁移写入旧快照前，历史不能复活', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const entry = (id) => ({ id, sourceText: id, pageNumber: 1, result: { kind: 'sentence', translation: 't' }, updatedAt: 1 });
    const storage = window.sharedStorage;
    const legacyKey = 'pdf-helper-translation-history-v1';
    storage.data.set(legacyKey, { 'doc-a': [entry('stale')] });
    const pageB = window.loadPage(storage).history;
    let interleaved = false;
    const hookedA = {
      get: (keys) => storage.get(keys),
      async set(items) {
        if (!interleaved) {
          interleaved = true;
          await pageB.writeDocumentHistory('doc-a', []);
        }
        return storage.set(items);
      },
      remove: (keys) => storage.remove(keys),
    };
    await window.loadPage(storage).history.migrateLegacyHistory(hookedA);
    return {
      visible: await pageB.readDocumentHistory('doc-a'),
      importWasWritten: storage.data.has('pdf-helper-translation-history-v1::legacy::doc-a'),
      tombstone: storage.data.has('pdf-helper-translation-history-v1::deleted::doc-a'),
    };
  });

  assert.equal(result.visible, undefined, 'clear must win even if the stale import lands afterwards');
  assert.equal(result.importWasWritten, true, 'the test forces the stale migration write');
  assert.equal(result.tombstone, true);
});

test('P1-05：迁移后只能采用可回读的数据，不能退回被墓碑遮蔽的旧快照', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const entry = (id) => ({ id, sourceText: id, pageNumber: 1, result: { kind: 'sentence', translation: 't' }, updatedAt: 1 });
    const storage = window.sharedStorage;
    storage.data.set('pdf-helper-translation-history-v1', { 'doc-a': [entry('stale')] });
    const pageB = window.loadPage(storage).history;
    let interleaved = false;
    const hookedA = {
      get: (keys) => storage.get(keys),
      async set(items) {
        if (!interleaved) {
          interleaved = true;
          await pageB.writeDocumentHistory('doc-a', []);
        }
        return storage.set(items);
      },
      remove: (keys) => storage.remove(keys),
    };
    const legacySnapshot = await window.loadPage(storage).history.migrateLegacyHistory(hookedA);
    const readableAfterMigration = await pageB.readDocumentHistory('doc-a');
    return {
      legacyIds: legacySnapshot?.['doc-a']?.map((item) => item.id),
      readableAfterMigration,
    };
  });

  assert.deepEqual(result.legacyIds, ['stale'], 'the migrator still holds the old in-memory snapshot');
  assert.equal(result.readableAfterMigration, undefined, 'a consumer must use this read-back result, not the snapshot');
});

test('P1-06：清空晚于已开始的保存时，旧保存不能擦除墓碑；清空后的新保存仍可生效', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const entry = (id) => ({ id, sourceText: id, pageNumber: 1, result: { kind: 'sentence', translation: 't' }, updatedAt: 1 });
    const storage = window.sharedStorage;
    const pageB = window.loadPage(storage).history;
    let interleaved = false;
    const delayedA = {
      get: (keys) => storage.get(keys),
      async set(items) {
        if (!interleaved) {
          interleaved = true;
          await pageB.writeDocumentHistory('doc-a', [], undefined, 200);
        }
        return storage.set(items);
      },
      remove: (keys) => storage.remove(keys),
    };
    // A's mutation began first, but its storage write reaches the service after B cleared the document.
    await window.loadPage(storage).history.writeDocumentHistory('doc-a', [entry('stale')], delayedA, 100);
    const afterOldSave = await pageB.readDocumentHistory('doc-a');
    // A genuinely new action after the clear may create a new history, but it must not bring stale entries back.
    await pageB.writeDocumentHistory('doc-a', [entry('fresh')], undefined, 300);
    const afterFreshSave = await pageB.readDocumentHistory('doc-a');
    return {
      afterOldSave,
      afterFreshSave: afterFreshSave?.map((item) => item.id),
      tombstone: storage.data.get('pdf-helper-translation-history-v1::deleted::doc-a'),
      marker: storage.data.get('pdf-helper-translation-history-write-v1::doc-a'),
    };
  });

  assert.equal(result.afterOldSave, undefined, 'the stale write remains hidden by the newer clear');
  assert.deepEqual(result.afterFreshSave, ['fresh']);
  assert.equal(result.tombstone, 200, 'the tombstone stays durable rather than being removed by saves');
  assert.equal(result.marker, 300);
});

test('P1-04：删除发生在另一页面迁移写入旧快照前，单词卡不能复活', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const storage = window.sharedStorage;
    storage.data.set('pdf-helper-vocabulary-library-v1', [
      { id: 'c1', term: 'stale', markdown: '## stale', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]);
    const pageB = window.loadPage(storage).vocabulary;
    let interleaved = false;
    const hookedA = {
      get: (keys) => storage.get(keys),
      async set(items) {
        if (!interleaved) {
          interleaved = true;
          await pageB.readVocabularyCards();
          await pageB.deleteVocabularyCard('c1');
        }
        return storage.set(items);
      },
      remove: (keys) => storage.remove(keys),
    };
    const visibleToA = await window.loadPage(hookedA).vocabulary.readVocabularyCards();
    const visibleToB = await pageB.readVocabularyCards();
    return {
      visibleToA: visibleToA.map((card) => card.id),
      visibleToB: visibleToB.map((card) => card.id),
      importWasWritten: storage.data.has('pdf-helper-vocabulary-card-legacy-v1::c1'),
      tombstone: storage.data.has('pdf-helper-vocabulary-card-deleted-v1::c1'),
    };
  });

  assert.deepEqual(result.visibleToA, [], 'the migrating page must not briefly render the deleted card');
  assert.deepEqual(result.visibleToB, []);
  assert.equal(result.importWasWritten, true, 'the test forces the stale migration write');
  assert.equal(result.tombstone, true);
});

test('旧格式学习历史：整包迁移成一篇文献一个键', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const entry = (id) => ({ id, sourceText: id, pageNumber: 1, result: { kind: 'sentence', translation: 't' }, updatedAt: 1 });
    window.sharedStorage.data.set('pdf-helper-translation-history-v1', {
      'doc-a': [entry('a1')],
      'doc-b': [entry('b1'), entry('b2')],
      'doc-empty': [],
    });
    const migrated = await window.pageA.history.migrateLegacyHistory();
    return {
      migratedKeys: Object.keys(migrated).sort(),
      legacyGone: !window.sharedStorage.data.has('pdf-helper-translation-history-v1'),
      // 迁移只写自己的命名空间（`legacy::`），live 键留给用户自己的保存。
      importKeys: [...window.sharedStorage.data.keys()]
        .filter((key) => key.startsWith('pdf-helper-translation-history-v1::legacy::')).sort(),
      liveKeys: [...window.sharedStorage.data.keys()]
        .filter((key) => key.startsWith('pdf-helper-translation-history-v1::')
          && !key.includes('::legacy::')).sort(),
      bCount: (await window.pageA.history.readDocumentHistory('doc-b')).length,
    };
  });

  assert.deepEqual(result.migratedKeys, ['doc-a', 'doc-b', 'doc-empty']);
  assert.equal(result.legacyGone, true);
  // 空列表不建键：没有历史与「有一条空历史」在界面上要区分开。
  assert.deepEqual(result.importKeys, [
    'pdf-helper-translation-history-v1::legacy::doc-a',
    'pdf-helper-translation-history-v1::legacy::doc-b',
  ]);
  assert.deepEqual(result.liveKeys, [], '迁移不碰用户正在使用的键');
  assert.equal(result.bCount, 2, '读取方仍能读到迁移进来的历史');
});

test('迁移不能覆盖另一个页面刚保存的新历史（旧实现会把新记录回退成旧快照）', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const entry = (id) => ({ id, sourceText: id, pageNumber: 1, result: { kind: 'sentence', translation: 't' }, updatedAt: 1 });
    const legacyKey = 'pdf-helper-translation-history-v1';
    const docKey = 'pdf-helper-translation-history-v1::doc-a';
    window.sharedStorage.data.set(legacyKey, { 'doc-a': [entry('stale')] });
    const storage = window.sharedStorage;

    // 页面 B：先完成迁移，然后为 doc-a 保存了一条更新的历史。
    const pageB = window.loadPage(storage).history;
    // 页面 A：读到旧整包之后才轮到它写。用一层端口把「B 在 A 的读取期间完成迁移并保存」这个顺序固定下来。
    let interleaved = false;
    const slowA = {
      async get(keys) {
        const value = await storage.get(keys);
        if (!interleaved && keys === legacyKey) {
          interleaved = true;
          await pageB.migrateLegacyHistory();
          await pageB.writeDocumentHistory('doc-a', [entry('fresh'), entry('stale')]);
        }
        return value;
      },
      set: (items) => storage.set(items),
      remove: (keys) => storage.remove(keys),
    };
    await window.loadPage(storage).history.migrateLegacyHistory(slowA);
    return {
      ids: (await pageB.readDocumentHistory('doc-a')).map((item) => item.id),
      legacyGone: !storage.data.has(legacyKey),
      docKeyHasFresh: (storage.data.get(docKey) ?? []).some((item) => item.id === 'fresh'),
    };
  });

  // 关键断言：A 的旧快照绝不能把 B 刚写的 fresh 覆盖掉。
  assert.deepEqual(result.ids, ['fresh', 'stale']);
  assert.equal(result.docKeyHasFresh, true);
  assert.equal(result.legacyGone, true);
});

test('P1-02：检查之后、写入之前另一页面保存了同一篇文献（旧实现会覆盖这条新记录）', async () => {
  // 这条正是复审指出的交错顺序：A 的目标键检查已经返回、A 还没 set，B 在这期间写入。
  // 「只写不存在的键」堵不住它（检查与写入不是原子的）；不共享键才堵得住。
  await installRepositories();
  const result = await page.evaluate(async () => {
    const entry = (id) => ({ id, sourceText: id, pageNumber: 1, result: { kind: 'sentence', translation: 't' }, updatedAt: 1 });
    const legacyKey = 'pdf-helper-translation-history-v1';
    const storage = window.sharedStorage;
    storage.data.set(legacyKey, { 'doc-a': [entry('stale')] });
    const pageB = window.loadPage(storage).history;

    let interleaved = false;
    const hookedA = {
      get: (keys) => storage.get(keys),
      async set(items) {
        if (!interleaved) {
          interleaved = true;
          // B 在 A 检查完之后、写入之前把 doc-a 保存成最新内容。
          await pageB.writeDocumentHistory('doc-a', [entry('fresh'), entry('stale')]);
        }
        return storage.set(items);
      },
      remove: (keys) => storage.remove(keys),
    };
    await window.loadPage(storage).history.migrateLegacyHistory(hookedA);
    return {
      ids: (await pageB.readDocumentHistory('doc-a')).map((item) => item.id),
      legacyGone: !storage.data.has(legacyKey),
      liveValue: (storage.data.get('pdf-helper-translation-history-v1::doc-a') ?? []).map((item) => item.id),
    };
  });

  assert.deepEqual(result.ids, ['fresh', 'stale'], 'B 的写入必须活下来');
  assert.deepEqual(result.liveValue, ['fresh', 'stale'], 'live 键不能被迁移快照覆盖');
  assert.equal(result.legacyGone, true);
});

test('旧整包还没迁完时，绝不能先删掉旧键', async () => {
  await installRepositories();
  const result = await page.evaluate(async () => {
    const entry = (id) => ({ id, sourceText: id, pageNumber: 1, result: { kind: 'sentence', translation: 't' }, updatedAt: 1 });
    const legacyKey = 'pdf-helper-translation-history-v1';
    const storage = window.sharedStorage;
    storage.data.set(legacyKey, { 'doc-a': [entry('a1')], 'doc-b': [entry('b1')] });
    // 写这次迁移时故意让 doc-b 的写入静默失败，模拟部分失败。
    const failing = {
      get: (keys) => storage.get(keys),
      async set(items) {
        const patch = { ...items };
        delete patch['pdf-helper-translation-history-v1::legacy::doc-b'];
        await storage.set(patch);
      },
      remove: (keys) => storage.remove(keys),
    };
    await window.pageA.history.migrateLegacyHistory(failing);
    return {
      legacyGone: !storage.data.has(legacyKey),
      keys: [...storage.data.keys()]
        .filter((key) => key.startsWith('pdf-helper-translation-history-v1::legacy::')).sort(),
    };
  });

  assert.equal(result.legacyGone, false, '有文献没写成功时旧数据必须留着，否则那篇的历史就永久丢了');
  assert.deepEqual(result.keys, ['pdf-helper-translation-history-v1::legacy::doc-a']);
});
