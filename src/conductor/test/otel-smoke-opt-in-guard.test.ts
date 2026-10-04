// Covers: task:9
import { readFile, readdir, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import smokeConfig from '../vitest.smoke.config.js';
import defaultConfig from '../vitest.config.js';

const optIn = 'AI_CONDUCTOR_OTEL_' + 'SMOKE';
const exemptions = new Set([
  'test/engine/otel/export-refusal.test.ts',
  'test/engine/otel/transport.test.ts',
]);

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory()
    ? files(join(root, entry.name))
    : [join(root, entry.name)]))).flat();
}

async function offenders(root: string): Promise<string[]> {
  const testRoot = await stat(join(root, 'test')).then(() => join(root, 'test')).catch(() => root);
  const all = await files(testRoot);
  const smokeIncludes = (smokeConfig.test?.include ?? []).join('|').replaceAll('**', '');
  return (await Promise.all(all.filter((file) => file.endsWith('.test.ts')).map(async (file) => {
    const path = `${testRoot === root ? '' : 'test/'}${relative(testRoot, file).replaceAll('\\', '/')}`;
    if (exemptions.has(path) || path.includes(smokeIncludes.replaceAll('*', ''))) return null;
    return (await readFile(file, 'utf8')).includes(optIn) ? path : null;
  }))).filter((path): path is string => path !== null);
}

describe('OTel smoke opt-in guard', () => {
  it('allows only the reviewed non-smoke references', async () => {
    await expect(offenders(process.cwd())).resolves.toEqual([]);
    expect(exemptions).toEqual(new Set([
      'test/engine/otel/export-refusal.test.ts',
      'test/engine/otel/transport.test.ts',
    ]));
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
    expect(defaultConfig.test?.include).toContain('test/**/*.test.ts');
    expect(defaultConfig.test?.exclude ?? []).not.toContain('test/otel-smoke-opt-in-guard.test.ts');
  });
});
