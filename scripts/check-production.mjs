import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outputDir = path.join(root, '.output', 'edge-mv3');
const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
if (manifest.version !== '1.0.0') {
  throw new Error(`Production manifest version must be 1.0.0; received ${manifest.version ?? 'missing'}.`);
}

await readFile(path.join(outputDir, 'privacy-policy.html'), 'utf8');
await readFile(path.join(root, 'PRIVACY_POLICY.md'), 'utf8');

async function collectJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJavaScript(absolutePath));
    else if (/\.(?:js|mjs)$/.test(entry.name) && !entry.name.startsWith('pdf.worker-')) {
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

console.log('Production check passed: version, privacy policy, and bundle hygiene verified.');
