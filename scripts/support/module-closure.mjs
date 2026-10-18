import { access, readFile } from 'node:fs/promises';
import ts from 'typescript';

/**
 * Loading real modules into a browser page for tests.
 *
 * Browser-level suites here run the **real** feature modules against the **real**
 * markup, with a stubbed module barrel (importing the barrel would pull in the
 * persistence adapters). To do that the modules are transpiled to CommonJS here and
 * instantiated inside the page against a small `require`.
 *
 * The closure walk exists because a hand-written dependency list is exactly the kind
 * of list that goes stale: one new import in the module under test and it resolves
 * to nothing at runtime, which then looks like a bug in the module rather than in
 * the test. Two suites already hit that.
 */

/** Loads a single module as CommonJS so its dependencies can be injected. */
export async function loadModule(path, repoRoot = new URL('../../', import.meta.url)) {
  const source = await readFile(new URL(path, repoRoot), 'utf8');
  return transpile(source);
}

export function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

/** Relative specifiers a module imports, including dynamic `import()`. */
export function relativeSpecifiers(source) {
  return [...source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)]
    .map((match) => match[1]);
}

export function resolveSpecifier(fromPath, specifier) {
  const stack = fromPath.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

/**
 * Transpiles an entry module and every relative module it imports.
 *
 * The module barrel (`/public`) and the persistence adapters are deliberately not
 * followed: the page-side registry serves the barrel from a stub, which is what
 * keeps these tests free of storage. Everything else the module pulls in is loaded
 * for real.
 */
export async function loadModuleClosure(entry, repoRoot = new URL('../../', import.meta.url)) {
  const modules = new Map();
  const pending = [entry];
  while (pending.length) {
    const path = pending.pop();
    if (modules.has(path)) continue;
    const source = await readFile(new URL(path, repoRoot), 'utf8');
    modules.set(path, transpile(source));

    for (const specifier of relativeSpecifiers(source)) {
      const joined = resolveSpecifier(path, specifier);
      if (joined.endsWith('/public') || joined.includes('/adapters/')) continue;
      for (const candidate of [`${joined}.ts`, joined, `${joined}/public.ts`]) {
        if (modules.has(candidate)) break;
        try {
          await access(new URL(candidate, repoRoot));
          pending.push(candidate);
          break;
        } catch {
          // Not this candidate; try the next shape.
        }
      }
    }
  }
  return [...modules];
}
