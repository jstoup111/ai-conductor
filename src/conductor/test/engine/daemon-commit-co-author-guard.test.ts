import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const SOURCE_ROOT = join(process.cwd(), 'src');
const LAND_SPEC = 'engine/engineer/land-spec.ts';

interface Violation { file: string; line: number; }

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }))).flat();
}

function scanCommitMessages(source: string, file: string): Violation[] {
  const violations: Violation[] = [];
  const commit = /\[\s*['"](?:commit|commit-tree)['"][\s\S]{0,500}?\]/g;
  for (const match of source.matchAll(commit)) {
    const args = match[0];
    if (!/['"](?:-m|-F)['"]|['"]commit-tree['"]/.test(args)) continue;
    // Specs are committed by the operator-facing engineer flow. This is the
    // single explicit exception; another land-spec commit shape is not exempt.
    if (file === LAND_SPEC && args.includes('composeSpecCommitMessage(')) continue;
    if (args.includes('withDaemonCoAuthorTrailer(')) continue;
    const offset = match.index ?? 0;
    violations.push({ file, line: source.slice(0, offset).split('\n').length });
  }
  return violations;
}

async function scanTree(): Promise<Violation[]> {
  const files = await sourceFiles(SOURCE_ROOT);
  return (await Promise.all(files.map(async path => scanCommitMessages(
    await readFile(path, 'utf8'), relative(SOURCE_ROOT, path),
  )))).flat();
}

describe('daemon commit co-author guard', () => {
  it('requires every daemon commit message to use the shared trailer helper', async () => {
    await expect(scanTree()).resolves.toEqual([]);
  });

  it('allows only the operator-run spec land commit', async () => {
    const source = await readFile(join(SOURCE_ROOT, LAND_SPEC), 'utf8');
    expect(source).toContain("['commit', '-m', composeSpecCommitMessage(");
    expect(source).not.toContain('withDaemonCoAuthorTrailer(');
    expect(scanCommitMessages(source, LAND_SPEC)).toEqual([]);
  });

  it('reports an unwrapped commit fixture with its file and line', () => {
    expect(scanCommitMessages("await git(['commit', '-m', 'unwrapped']);\n", 'fixture.ts'))
      .toEqual([{ file: 'fixture.ts', line: 1 }]);
    expect(scanCommitMessages("await git(['commit-tree', 'tree']);\n", 'fixture.ts'))
      .toEqual([{ file: 'fixture.ts', line: 1 }]);
  });
});
