import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const workspace = process.cwd();
const sourceRoots = ['entrypoints', 'src', 'shared'].map((item) => path.join(workspace, item));
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

function relative(file) {
  return path.relative(workspace, file).replaceAll('\\', '/');
}

async function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next supported TypeScript resolution shape.
    }
  }
  return null;
}

const allFiles = (await Promise.all(sourceRoots.map(filesUnder))).flat();
const typeScriptFiles = allFiles.filter((file) => file.endsWith('.ts'));
const maintainedSourceFiles = allFiles.filter((file) => /\.(?:ts|css|html)$/.test(file));

for (const file of maintainedSourceFiles) {
  const fileName = relative(file);
  const source = await readFile(file, 'utf8');
  const lineCount = source.split(/\r?\n/).length;
  if (lineCount > 700) {
    errors.push(`${fileName}: ${lineCount} lines; split this file by functional responsibility.`);
  }
  if (/\b(v\d+|final|legacy)\b/i.test(path.basename(fileName))) {
    errors.push(`${fileName}: implementation filenames must describe behavior, not versions.`);
  }
}

const viewerHtmlFiles = maintainedSourceFiles.filter((file) =>
  file.endsWith('.html') && relative(file).match(/^(?:entrypoints\/viewer|src\/viewer\/templates)\//),
);
for (const templateFile of viewerHtmlFiles.filter((file) => relative(file).startsWith('src/viewer/templates/'))) {
  const template = await readFile(templateFile, 'utf8');
  const openedDivs = template.match(/<div\b/g)?.length ?? 0;
  const closedDivs = template.match(/<\/div>/g)?.length ?? 0;
  if (openedDivs !== closedDivs) {
    errors.push(`${relative(templateFile)}: unbalanced div elements (${openedDivs} open, ${closedDivs} close).`);
  }
}
const viewerMarkup = (await Promise.all(viewerHtmlFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const markupIds = new Map();
for (const match of viewerMarkup.matchAll(/\bid=["']([^"']+)["']/g)) {
  markupIds.set(match[1], (markupIds.get(match[1]) ?? 0) + 1);
}
for (const [id, count] of markupIds) {
  if (count > 1) errors.push(`viewer templates: duplicate DOM id "${id}" appears ${count} times.`);
}
const requiredElementIds = new Set();
for (const file of typeScriptFiles.filter((item) => relative(item).startsWith('src/viewer/'))) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/\brequiredElement(?:<[^>]+>)?\(\s*["']([^"']+)["']/g)) {
    requiredElementIds.add(match[1]);
  }
}
for (const id of requiredElementIds) {
  if (!markupIds.has(id)) errors.push(`viewer templates: required DOM id "${id}" is missing.`);
}

const viewerEntrySource = await readFile(path.join(workspace, 'entrypoints/viewer/main.ts'), 'utf8');
const requiredViewerStyleImports = [
  'pdfjs-dist/web/pdf_viewer.css',
  'katex/dist/katex.min.css',
  './style.css',
];
let previousStyleImportIndex = -1;
for (const styleImport of requiredViewerStyleImports) {
  const importIndex = viewerEntrySource.indexOf(`import "${styleImport}"`);
  const alternateImportIndex = viewerEntrySource.indexOf(`import '${styleImport}'`);
  const resolvedIndex = Math.max(importIndex, alternateImportIndex);
  if (resolvedIndex < 0) {
    errors.push(`entrypoints/viewer/main.ts: required base style import "${styleImport}" is missing.`);
  } else if (resolvedIndex < previousStyleImportIndex) {
    errors.push(`entrypoints/viewer/main.ts: base style imports are out of order at "${styleImport}".`);
  }
  previousStyleImportIndex = resolvedIndex;
}

for (const file of typeScriptFiles) {
  const fileName = relative(file);
  const source = await readFile(file, 'utf8');
  const lineCount = source.split(/\r?\n/).length;

  if (fileName.startsWith('entrypoints/') && lineCount > 25 && fileName.endsWith('.ts')) {
    errors.push(`${fileName}: entrypoint contains ${lineCount} lines; move behavior to a runtime bootstrap.`);
  }
  const importPattern = /\b(?:from\s*|import\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const target = await resolveImport(file, match[1]);
    if (!target) continue;
    const targetName = relative(target);

    const sourceFeature = fileName.match(/^src\/viewer\/features\/([^/]+)/)?.[1];
    const targetFeature = targetName.match(/^src\/viewer\/features\/([^/]+)/)?.[1];
    if (sourceFeature && targetFeature && sourceFeature !== targetFeature && path.basename(target) !== 'public.ts') {
      errors.push(`${fileName}: import ${match[1]} bypasses the ${targetFeature} feature public API.`);
    }

    const sourceModule = fileName.match(/^src\/modules\/([^/]+)/)?.[1];
    const targetModule = targetName.match(/^src\/modules\/([^/]+)/)?.[1];
    const isBackgroundComposition = fileName.startsWith('src/background/');
    if (targetModule && sourceModule !== targetModule && path.basename(target) !== 'public.ts' && !isBackgroundComposition) {
      errors.push(`${fileName}: import ${match[1]} bypasses the ${targetModule} module public API.`);
    }
  }

  const ownsPersistence = /repository|database|storage|migration|persistence/i.test(fileName);
  if (!ownsPersistence && /\b(?:localStorage|indexedDB)\b/.test(source)) {
    warnings.push(`${fileName}: accesses browser persistence directly; move new persistence work behind a repository.`);
  }
}

const requiredAgentFiles = [
  'src/background/AGENTS.md',
  'src/platform/AGENTS.md',
  'src/viewer/AGENTS.md',
  'src/modules/ai/AGENTS.md',
  'src/modules/knowledge/AGENTS.md',
  'src/modules/document-agent/AGENTS.md',
  'src/modules/memory/AGENTS.md',
  'src/modules/research/AGENTS.md',
  'src/viewer/core/pdf-reader/AGENTS.md',
  'src/viewer/features/assistant/AGENTS.md',
  'src/viewer/features/annotations/AGENTS.md',
  'src/viewer/features/translation/AGENTS.md',
  'src/viewer/features/paper-card/AGENTS.md',
  'src/viewer/features/knowledge-base/AGENTS.md',
  'src/viewer/features/reading-journal/AGENTS.md',
];
for (const agentFile of requiredAgentFiles) {
  try {
    await stat(path.join(workspace, agentFile));
  } catch {
    errors.push(`${agentFile}: required module guidance is missing.`);
  }
}

for (const warning of warnings) console.warn(`architecture warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`architecture error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture check passed (${typeScriptFiles.length} TypeScript files).`);
}
