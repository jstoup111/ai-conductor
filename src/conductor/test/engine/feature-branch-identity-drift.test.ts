// Covers: task:29
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type ProductionSource = { path: string; source: string };

const ENGINE_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));
const DAEMON_PREFIX_OWNER = join('engine', 'feature-branch-identity.ts');
const PARK_RECONCILIATION = join('engine', 'park-reconciliation.ts');

const MIGRATED_CONSUMERS = [
  join('engine', 'finish-record-cli.ts'),
  join('engine', 'halt-pr-reconciliation.ts'),
  join('engine', 'daemon-halt-pr-operations.ts'),
  join('engine', 'github-operations-cli.ts'),
  join('engine', 'engineer', 'intake', 'overlap-sources.ts'),
  PARK_RECONCILIATION,
];

async function productionSources(): Promise<ProductionSource[]> {
  const paths = (await readdir(ENGINE_ROOT, { recursive: true })).filter((path) => path.endsWith('.ts'));
  return Promise.all(paths.map(async (path) => ({ path, source: await readFile(join(ENGINE_ROOT, path), 'utf8') })));
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
}

function filesContaining(sources: readonly ProductionSource[], pattern: RegExp | string): string[] {
  return sources
    .filter(({ source }) => (typeof pattern === 'string' ? withoutComments(source).includes(pattern) : pattern.test(withoutComments(source))))
    .map(({ path }) => path)
    .sort();
}

describe('feature branch identity drift', () => {
  it('keeps branch-shape ownership and migrated consumers in the identity module', async () => {
    const sources = await productionSources();

    expect(filesContaining(sources, 'feat/daemon-')).toEqual([DAEMON_PREFIX_OWNER]);

    for (const path of MIGRATED_CONSUMERS) {
      const source = sources.find((candidate) => candidate.path === path)?.source;
      expect(source, `missing production source: ${path}`).toBeDefined();
      expect(withoutComments(source!)).not.toMatch(/(?:spec|feature)\//);
    }

    for (const path of [
      join('engine', 'daemon-deps.ts'),
      join('engine', 'mergeable-sweep.ts'),
      'daemon-cli.ts',
    ]) {
      const source = sources.find((candidate) => candidate.path === path)?.source;
      expect(source, `missing production source: ${path}`).toBeDefined();
      expect(withoutComments(source!)).toContain('leafBranchFor(');
    }

    const parseFeatureRefImporters = sources
      .filter(({ source }) => /import\s*\{(?=[^}]*\bparseFeatureRef\b)[^}]*\}\s*from\s*['"][^'"]*feature-branch-identity\.js['"]/.test(withoutComments(source)))
      .map(({ path }) => path)
      .sort();
    expect(parseFeatureRefImporters).toEqual([
      join('engine', 'child-cursor.ts'),
      join('engine', 'engineer', 'intake', 'overlap-sources.ts'),
      join('engine', 'step-runners.ts'),
    ]);
  });

  it('detects a reintroduced daemon branch literal in memory', async () => {
    const sources = await productionSources();
    const withReintroducedLiteral = sources.map((candidate) => (
      candidate.path === PARK_RECONCILIATION
        ? { ...candidate, source: `${candidate.source}\nbranch.startsWith('feat/daemon-');\n` }
        : candidate
    ));

    expect(filesContaining(withReintroducedLiteral, 'feat/daemon-')).toContain(PARK_RECONCILIATION);
  });
});
