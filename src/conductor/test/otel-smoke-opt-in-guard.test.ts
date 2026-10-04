// Covers: task:9
import { globSync } from 'node:fs';
import { readFile, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { join, matchesGlob } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import smokeConfig from '../vitest.smoke.config.js';
import defaultConfig from '../vitest.config.js';

const optIn = 'AI_CONDUCTOR_OTEL_' + 'SMOKE';
const exemptions = [
  'test/engine/otel/export-refusal.test.ts',
  'test/engine/otel/transport.test.ts',
] as const;

async function offenders(root: string): Promise<string[]> {
  const testRoot = await stat(join(root, 'test')).then(() => join(root, 'test')).catch(() => root);
  const all = globSync(testRoot === root ? '**/*.ts' : 'test/**/*.ts', { cwd: root });
  const smokeIncludes = smokeConfig.test?.include ?? [];
  return (await Promise.all(all.map(async (path) => {
    if (exemptions.includes(path as typeof exemptions[number]) || smokeIncludes.some((glob) => matchesGlob(path, glob))) return null;
    return (await readFile(join(root, path), 'utf8')).includes(optIn) ? path : null;
  }))).filter((path): path is string => path !== null);
}

describe('OTel smoke opt-in guard', () => {
  it('allows only the reviewed non-smoke references', async () => {
    await expect(offenders(process.cwd())).resolves.toEqual([]);
    expect(exemptions).toEqual([
      'test/engine/otel/export-refusal.test.ts',
      'test/engine/otel/transport.test.ts',
    ]);
  });

  it('names a non-smoke test that references the opt-in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'otel-opt-in-guard-'));
    try {
      await writeFile(join(root, 'bad.test.ts'), `const value = '${optIn}';`);
      await expect(offenders(root)).resolves.toEqual(['bad.test.ts']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('is included by the default tier', () => {
    const guardPath = 'test/otel-smoke-opt-in-guard.test.ts';
    expect((defaultConfig.test?.include ?? []).some((glob) => matchesGlob(guardPath, glob))).toBe(true);
    expect((defaultConfig.test?.exclude ?? []).some((glob) => matchesGlob(guardPath, glob))).toBe(false);
  });
});
