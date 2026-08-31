// Covers: task:3
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../src');
const ESM_FILE_GLOBALS = ['__dirname', '__filename'] as const;

async function sourceFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  }));
  return nested.flat();
}

function hasTopLevelBinding(source: ts.SourceFile, name: string): boolean {
  return source.statements.some((statement) =>
    ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
      ts.isIdentifier(declaration.name) && declaration.name.text === name));
}

function usesIdentifier(source: ts.SourceFile, name: string): boolean {
  let used = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) used = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return used;
}

describe('ESM source-file globals', () => {
  it('rejects unbound __dirname and __filename under src/', async () => {
    const violations = (await sourceFiles(SOURCE_ROOT)).flatMap(async (path) => {
      const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
      return ESM_FILE_GLOBALS
        .filter((name) => usesIdentifier(source, name) && !hasTopLevelBinding(source, name))
        .map((name) => `${path}: unbound ${name}`);
    });

    expect((await Promise.all(violations)).flat()).toEqual([]);
  });
});
