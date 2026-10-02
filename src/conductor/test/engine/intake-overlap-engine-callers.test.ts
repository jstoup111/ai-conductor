// Covers: task:17
import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function files(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]))).flat();
}

describe('engine-internal intake filings', () => {
  it('keeps overlap wiring exclusive to the CLI', async () => {
    const engine = await files(new URL('../../src/engine/', import.meta.url).pathname);
    const callers = (await Promise.all(engine.filter((path) => path.endsWith('.ts')).map(async (path) => ({ path, source: await readFile(path, 'utf8') })))).filter(({ source }) => source.includes('fileIntakeIssue('));
    expect(callers.length).toBeGreaterThanOrEqual(2);
    expect(callers.every(({ source }) => !/\boverlap\s*:/.test(source))).toBe(true);
    const cli = await readFile(new URL('../../src/intake-file-cli.ts', import.meta.url), 'utf8');
    expect(cli).toMatch(/\boverlap\s*:/);
  });
});
