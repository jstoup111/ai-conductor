// Covers: task:24
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PROVIDERS } from '../../src/execution/provider-catalog.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { createProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { registerBuiltInLlmProviders } from '../../src/engine/builtin-llm-providers.js';

const ENGINE_ROOT = new URL('../../src/engine/', import.meta.url);
const PLUGIN_LOADER = new URL('../../src/engine/plugin-loader.ts', import.meta.url);

function localImports(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  return [...source.matchAll(/(?:from\s+|import\s*\()['"](\.{1,2}\/[^'"]+)['"]/g)]
    .map((match) => match[1]);
}

function resolvedLocalImport(from: string, specifier: string): string | undefined {
  const candidate = resolve(dirname(from), specifier.replace(/\.js$/, '.ts'));
  return existsSync(candidate) ? candidate : undefined;
}

function importClosure(entry: string): Set<string> {
  const visited = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const specifier of localImports(current)) {
      const dependency = resolvedLocalImport(current, specifier);
      if (dependency) pending.push(dependency);
    }
  }
  return visited;
}

describe('registerBuiltInLlmProviders', () => {
  it('registers only installed built-ins for the provider runtime', () => {
    const registry = new PluginRegistry();
    const installed = new Set(BUILT_IN_PROVIDERS.map(({ id }) => id));

    registerBuiltInLlmProviders(registry, { installed, codexDoctorTimeoutMs: 2_500 });
    registry.markInitialized();

    expect(createProviderRuntimeSet(registry).keys()).toEqual([...installed]);
  });

  it('keeps its transitive local imports free of composition and publication modules', () => {
    const closure = importClosure(new URL('builtin-llm-providers.ts', ENGINE_ROOT).pathname);
    const relativePaths = [...closure].map((path) => path.replace(new URL('../../src/', import.meta.url).pathname, ''));

    expect(relativePaths).toEqual(expect.not.arrayContaining([
      'engine/plugin-loader.ts',
      'engine/finish-publication.ts',
    ]));
  });

  it('is delegated to by the plugin-loader composition root', () => {
    expect(readFileSync(PLUGIN_LOADER, 'utf8')).toMatch(
      /registerBuiltInLlmProviders\(registry,\s*\{ installed: installedProviders, codexDoctorTimeoutMs \}\s*\)/,
    );
  });
});
