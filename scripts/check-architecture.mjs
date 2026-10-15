import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const workspace = process.cwd();
const sourceRoots = ['entrypoints', 'src'].map((item) => path.join(workspace, item));
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

// One TS import specifier can produce multiple match forms (`import "..."`,
// `import ... from "..."`, `export ... from "..."`). Collect them all.
const importPattern = /\b(?:from\s*|import\s*)["']([^"']+)["']/g;
function importSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(importPattern)) specifiers.push(match[1]);
  return specifiers;
}

const allFiles = (await Promise.all(sourceRoots.map(filesUnder))).flat();
const typeScriptFiles = allFiles.filter((file) => file.endsWith('.ts'));
const maintainedSourceFiles = allFiles.filter((file) => /\.(?:ts|css|html)$/.test(file));

// ---------------------------------------------------------------------------
// Build the static module dependency graph once: source -> resolved target files.
// `import type` statements are still real module edges at the bundler level, so
// they participate like any other import. Dynamic `import("...")` calls are not
// captured here on purpose: they create no initialization-time cycle.
// ---------------------------------------------------------------------------
const fileContentCache = new Map();
async function readSource(file) {
  if (!fileContentCache.has(file)) fileContentCache.set(file, await readFile(file, 'utf8'));
  return fileContentCache.get(file);
}

const dependencies = new Map(); // file -> Set<target file>
const fileSpecifiers = new Map(); // "file|specifier" -> target file
for (const file of typeScriptFiles) {
  const source = await readSource(file);
  const targets = new Set();
  for (const specifier of importSpecifiers(source)) {
    const target = await resolveImport(file, specifier);
    if (target) {
      targets.add(target);
      fileSpecifiers.set(`${file}|${specifier}`, target);
    }
  }
  dependencies.set(file, targets);
}

// ---------------------------------------------------------------------------
// Structural rules.
// ---------------------------------------------------------------------------
for (const file of maintainedSourceFiles) {
  const fileName = relative(file);
  const source = await readSource(file);
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
  const source = await readSource(file);
  for (const match of source.matchAll(/\brequiredElement(?:<[^>]+>)?\(\s*["']([^"']+)["']/g)) {
    requiredElementIds.add(match[1]);
  }
}
for (const id of requiredElementIds) {
  if (!markupIds.has(id)) errors.push(`viewer templates: required DOM id "${id}" is missing.`);
}

const viewerEntrySource = await readSource(path.join(workspace, 'entrypoints/viewer/main.ts'));
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

// ---------------------------------------------------------------------------
// Boundary rules, driven by the shared dependency graph.
// ---------------------------------------------------------------------------
// core/pdf-reader may depend on the cross-cutting viewer runtime files, but it
// must not reach the application assembly layer (feature models, persistence,
// navigation, registrations, templates).
const CORE_ALLOWED_APP_TARGETS = new Set([
  'src/viewer/app/viewer-state.ts',
  'src/viewer/app/viewer-elements.ts',
  'src/viewer/app/viewer-types.ts',
]);

for (const file of typeScriptFiles) {
  const fileName = relative(file);
  const source = await readSource(file);
  const lineCount = source.split(/\r?\n/).length;

  if (fileName.startsWith('entrypoints/') && lineCount > 25 && fileName.endsWith('.ts')) {
    errors.push(`${fileName}: entrypoint contains ${lineCount} lines; move behavior to a runtime bootstrap.`);
  }

  for (const specifier of importSpecifiers(source)) {
    const target = fileSpecifiers.get(`${file}|${specifier}`);
    if (!target) continue;
    const targetName = relative(target);

    const sourceFeature = fileName.match(/^src\/viewer\/features\/([^/]+)/)?.[1];
    const targetFeature = targetName.match(/^src\/viewer\/features\/([^/]+)/)?.[1];
    if (sourceFeature && targetFeature && sourceFeature !== targetFeature && path.basename(target) !== 'public.ts') {
      errors.push(`${fileName}: import ${specifier} bypasses the ${targetFeature} feature public API.`);
    }

    const sourceModule = fileName.match(/^src\/modules\/([^/]+)/)?.[1];
    const targetModule = targetName.match(/^src\/modules\/([^/]+)/)?.[1];
    const isBackgroundComposition = fileName.startsWith('src/background/');
    if (targetModule && sourceModule !== targetModule && path.basename(target) !== 'public.ts' && !isBackgroundComposition) {
      errors.push(`${fileName}: import ${specifier} bypasses the ${targetModule} module public API.`);
    }

    // Entrypoints are composition roots only: no code under src/ may reach into
    // them (this also bans re-export shims once they are gone).
    if (fileName.startsWith('src/') && targetName.startsWith('entrypoints/')) {
      errors.push(`${fileName}: import ${specifier} reaches entrypoint ${targetName}; entrypoints may only be imported by entrypoint code.`);
    }

    // core/pdf-reader must not depend on the app assembly layer.
    if (fileName.startsWith('src/viewer/core/') && targetName.startsWith('src/viewer/app/') && !CORE_ALLOWED_APP_TARGETS.has(targetName)) {
      errors.push(`${fileName}: import ${specifier} reaches ${targetName}; core/pdf-reader must not depend on the app assembly layer.`);
    }

    // core/pdf-reader is the PDF.js primitive layer only: it must not reach
    // into viewer features, services, or shared-ui (those import the core).
    if (fileName.startsWith('src/viewer/core/') && /^src\/viewer\/(?:features|services|shared-ui)\//.test(targetName)) {
      errors.push(`${fileName}: import ${specifier} reaches ${targetName}; core/pdf-reader must not depend on features, services, or shared-ui.`);
    }

    // Files explicitly marked @deprecated must not be imported by production code.
    if (!fileName.startsWith('entrypoints/')) {
      const targetSource = await readSource(target);
      if (/@deprecated/.test(targetSource)) {
        errors.push(`${fileName}: import ${specifier} targets deprecated ${targetName}; migrate to the replacement API.`);
      }
    }
  }

  const ownsPersistence = /repository|database|storage|migration|persistence/i.test(fileName);
  if (!ownsPersistence && /\b(?:localStorage|indexedDB)\b/.test(source)) {
    warnings.push(`${fileName}: accesses browser persistence directly; move new persistence work behind a repository.`);
  }
}

// ---------------------------------------------------------------------------
// Circular dependency detection (Tarjan SCC over the static module graph).
// Re-export chains (`export * from ...`) are module edges too, so feature
// public-barrel cycles are detected like any other cycle.
// ---------------------------------------------------------------------------
const nodes = typeScriptFiles.map((file) => relative(file));
const indexByFile = new Map(typeScriptFiles.map((file, index) => [file, index]));
const adjacency = nodes.map(() => []);
for (const [file, targets] of dependencies) {
  const fromIndex = indexByFile.get(file);
  if (fromIndex === undefined) continue;
  for (const target of targets) {
    const toIndex = indexByFile.get(target);
    if (toIndex !== undefined) adjacency[fromIndex].push(toIndex);
  }
}

function findCyclePath(startNode) {
  const cycle = [startNode];
  const visited = new Set([startNode]);
  let node = startNode;
  while (true) {
    const next = adjacency[node].find((candidate) => {
      if (candidate === startNode) return true;
      if (visited.has(candidate)) return false;
      return true;
    });
    if (next === undefined) return null;
    if (next === startNode) return cycle;
    visited.add(next);
    cycle.push(next);
    node = next;
  }
}

function groupOf(fileName) {
  const featureMatch = fileName.match(/^src\/viewer\/features\/([^/]+)/);
  if (featureMatch) return `feature:${featureMatch[1]}`;
  const moduleMatch = fileName.match(/^src\/modules\/([^/]+)/);
  if (moduleMatch) return `module:${moduleMatch[1]}`;
  const layerMatch = fileName.match(/^src\/viewer\/(app|core|services|shared-ui)\//);
  if (layerMatch) return `layer:${layerMatch[1]}`;
  const otherMatch = fileName.match(/^src\/([^/]+)\//);
  if (otherMatch) return `layer:${otherMatch[1]}`;
  return `entrypoint:${fileName}`;
}

function reportScc(members) {
  // Cycles that stay inside one feature (or one module) are implementation
  // details of that unit; only cycles crossing group boundaries are
  // architectural debt worth failing on.
  const groups = new Set(members.map((node) => groupOf(nodes[node])));
  if (groups.size === 1) return;
  const cycle = findCyclePath(members[0]);
  const pathText = cycle ? cycle.map((node) => nodes[node]).join(' -> ') : members.map((node) => nodes[node]).join(' -> ');
  errors.push(`circular dependency: ${pathText}.`);
}

{
  let indexCounter = 0;
  const indices = new Array(nodes.length).fill(-1);
  const lowlink = new Array(nodes.length).fill(0);
  const onStack = new Array(nodes.length).fill(false);
  const stack = [];
  const selfLoops = [];

  const strongConnect = (v) => {
    indices[v] = indexCounter;
    lowlink[v] = indexCounter;
    indexCounter += 1;
    stack.push(v);
    onStack[v] = true;
    for (const w of adjacency[v]) {
      if (indices[w] === -1) {
        strongConnect(w);
        lowlink[v] = Math.min(lowlink[v], lowlink[w]);
      } else if (onStack[w]) {
        lowlink[v] = Math.min(lowlink[v], indices[w]);
      }
    }
    if (lowlink[v] === indices[v]) {
      const members = [];
      while (true) {
        const w = stack.pop();
        onStack[w] = false;
        members.push(w);
        if (w === v) break;
      }
      if (members.length > 1) reportScc(members);
    }
  };

  for (let v = 0; v < nodes.length; v += 1) {
    if (indices[v] === -1) strongConnect(v);
    if (adjacency[v].includes(v)) selfLoops.push(nodes[v]);
  }
  for (const file of selfLoops) {
    errors.push(`circular dependency: ${file} imports itself.`);
  }
}

for (const warning of warnings) console.warn(`architecture warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`architecture error: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture check passed (${typeScriptFiles.length} TypeScript files).`);
}
