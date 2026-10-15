// Verifies the implicit DOM-id contract between viewer templates and code:
// every id referenced from TypeScript (requiredElement / getElementById) must
// exist in the injected templates, and template ids that no code reads are
// reported as warnings (possible dead markup).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const workspace = process.cwd();
const errors = [];
const warnings = [];

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(target));
    else files.push(target);
  }
  return files;
}

const relative = (file) => path.relative(workspace, file).replaceAll('\\', '/');

const viewerHtmlFiles = (await Promise.all(
  ['entrypoints/viewer', 'src/viewer/templates'].map((item) => filesUnder(path.join(workspace, item))),
)).flat().filter((file) => file.endsWith('.html'));

const markup = (await Promise.all(viewerHtmlFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const templateIds = new Set();
for (const match of markup.matchAll(/\bid=["']([^"']+)["']/g)) templateIds.add(match[1]);

const referencedIds = new Map(); // id -> files referencing it
const viewerTsFiles = (await filesUnder(path.join(workspace, 'src', 'viewer'))).filter((file) => file.endsWith('.ts'));
for (const file of viewerTsFiles) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/\b(?:requiredElement(?:<[^>]+>)?\(\s*|getElementById\(\s*)["']([^"']+)["']/g)) {
    const id = match[1];
    if (!referencedIds.has(id)) referencedIds.set(id, []);
    referencedIds.get(id).push(relative(file));
  }
}

for (const [id, files] of referencedIds) {
  if (!templateIds.has(id)) {
    errors.push(`viewer code references DOM id "${id}" that no template defines (${files.join(', ')}).`);
  }
}

for (const id of templateIds) {
  if (!referencedIds.has(id)) {
    warnings.push(`viewer template id "${id}" is not referenced by any viewer code.`);
  }
}

for (const warning of warnings) console.warn(`element contract warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`element contract error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Element id contract passed (${templateIds.size} template ids, ${referencedIds.size} referenced).`);
}
