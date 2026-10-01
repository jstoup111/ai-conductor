// Covers: task:10
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(import.meta.dirname, '../../src');
const launchSeamImport = /from\s+['"][^'"]*execution\/interactive-launch(?:\.js)?['"]/;

// New importers require an explicit review of the foreground-only authority boundary.
const permittedImporters: readonly string[] = ['engine/engineer-cli.ts', 'engine/monitor/session.ts'];

async function sourcePaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourcePaths(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return paths.flat();
}

describe('interactive launch reachability', () => {
  it('permits only explicitly reviewed foreground importers of the launch seam', async () => {
    const importers = (await Promise.all((await sourcePaths(sourceRoot)).map(async (path) => ({
      path: relative(sourceRoot, path),
      source: await readFile(path, 'utf8'),
    })))).filter(({ source }) => launchSeamImport.test(source)).map(({ path }) => path).sort();

    expect(importers).toEqual(permittedImporters);
  });
});
