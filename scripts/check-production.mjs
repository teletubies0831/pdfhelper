import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outputDir = path.join(root, '.output', 'edge-mv3');
const packageMetadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
if (manifest.version !== packageMetadata.version) {
  throw new Error(
    `Production manifest version must match package.json (${packageMetadata.version}); received ${manifest.version ?? 'missing'}.`,
  );
}

await readFile(path.join(outputDir, 'privacy-policy.html'), 'utf8');

async function collectJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJavaScript(absolutePath));
    else if (/\.(?:js|mjs)$/.test(entry.name)
      && !entry.name.startsWith('pdf.worker-')
      // This owned worker bundles PDF.js, ONNX Runtime, and Transformers.js;
      // validate our source below instead of rejecting third-party diagnostics.
      && !entry.name.startsWith('knowledge-index.worker-')) {
      files.push(absolutePath);
    }
  }
  return files;
}

const forbidden = [
  'console.log(',
  'console.info(',
  'console.debug(',
  'debugger;',
  '实际发送给模型的全部上下文',
  '完整模型对话 JSON',
  'responseBody',
];
for (const file of await collectJavaScript(outputDir)) {
  const source = await readFile(file, 'utf8');
  const match = forbidden.find((value) => source.includes(value));
  if (match) throw new Error(`Production bundle contains forbidden debug output ${JSON.stringify(match)} in ${file}.`);
}

const knowledgeWorkerSource = await readFile(
  path.join(root, 'src', 'viewer', 'features', 'knowledge-base', 'knowledge-index.worker.ts'),
  'utf8',
);
const knowledgeWorkerMatch = forbidden.find((value) => knowledgeWorkerSource.includes(value));
if (knowledgeWorkerMatch) {
  throw new Error(`Knowledge index worker source contains forbidden debug output ${JSON.stringify(knowledgeWorkerMatch)}.`);
}

/**
 * 后台是 Service Worker，没有 `window` 的定时器.
 *
 * `window.clearTimeout(...)` in the background used to throw at the exact moment tool results arrived, so the promise never
 * resolved, the request lifetime stayed pinned, and the chat showed 「工具已完成 → 正在思考…」 forever with only a
 * service-worker console error to show for it.
 *
 * The rule only rejects the timer calls, because those are the ones that appear unguarded in our own code. Broader rules are
 * not usable here: the bundle legitimately contains `typeof document < 'u' ? document.createElement(...)` inside ONNX Runtime's
 * feature extractor, and tool identifiers literally start with `document.`.
 */
const backgroundSource = await readFile(path.join(outputDir, 'background.js'), 'utf8');
const domTimers = [
  'window.clearTimeout(',
  'window.setTimeout(',
  'window.setInterval(',
  'window.clearInterval(',
  'window.requestAnimationFrame(',
];
for (const pattern of domTimers) {
  const index = backgroundSource.indexOf(pattern);
  if (index >= 0) {
    throw new Error(
      `Background bundle calls ${pattern}…) at offset ${index}; a service worker has no window — use the global timer instead.`,
    );
  }
}

console.log('Production check passed: version, packaged privacy page, and bundle hygiene verified.');
