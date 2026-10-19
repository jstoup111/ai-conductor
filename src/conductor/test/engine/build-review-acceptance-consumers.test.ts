// Covers: task:11, task:rem-prd-audit-11a
import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const engineRoot = new URL('../../src/engine/', import.meta.url);
const permittedDirectMatchers = new Set([
  'build-review-dispositions.ts',
  'build-review-acceptance-resolver.ts',
]);

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map(async (entry) => {
    const child = new URL(entry.name, directory);
    return entry.isDirectory() ? sourceFiles(new URL(`${entry.name}/`, directory)) : entry.name.endsWith('.ts') ? [child] : [];
  }));
  return children.flat();
}

describe('build-review acceptance consumers', () => {
  it('keeps direct disposition matching behind the shared acceptance resolver', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(engineRoot)) {
      if (permittedDirectMatchers.has(file.pathname.split('/').at(-1)!)) continue;
      const source = await readFile(file, 'utf8');
      if (/matchesBuildReviewDisposition\s*\(/.test(source)) offenders.push(file.pathname.split('/').at(-1)!);
    }
    expect(offenders, `direct acceptance matching must use resolveBuildReviewAcceptance: ${offenders.join(', ')}`).toEqual([]);
  });
});
