// Covers: task:8
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { BUILT_IN_PROVIDERS } from '../../src/execution/provider-catalog.js';

const testRoot = dirname(fileURLToPath(import.meta.url));
const conductorRoot = join(testRoot, '../..');
const sourceRoot = join(conductorRoot, 'src');
const catalogModule = 'execution/provider-catalog.ts';

interface ProviderLiteralFinding {
  readonly file: string;
  readonly line: number;
  readonly value: string;
}

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

function declaredAdapterModules(): ReadonlySet<string> {
  return new Set(BUILT_IN_PROVIDERS.map(({ adapterModule }) => adapterModule));
}

function findProviderLiterals(
  module: string,
  source: ts.SourceFile,
  adapterModules = declaredAdapterModules(),
): readonly ProviderLiteralFinding[] {
  if (module === catalogModule || adapterModules.has(module)) return [];

  const forbiddenLiterals = new Set<string>(BUILT_IN_PROVIDERS.flatMap(
    ({ id, displayName }) => [id, displayName],
  ));
  const findings: ProviderLiteralFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && forbiddenLiterals.has(node.text)) {
      findings.push({
        file: module,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        value: node.text,
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return findings;
}

async function productionProviderLiteralFindings(): Promise<readonly ProviderLiteralFinding[]> {
  const files = await sourceFiles(sourceRoot);
  const findings = await Promise.all(files.map(async (path) => {
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
    return findProviderLiterals(relative(sourceRoot, path), source);
  }));
  return findings.flat();
}

describe('structural: built-in provider literals', () => {
  it('reports a fixture provider id literal with its file and line', () => {
    const source = ts.createSourceFile('fixtures/provider-id-literal.ts', "const provider = 'codex';", ts.ScriptTarget.Latest, true);

    expect(findProviderLiterals('fixtures/provider-id-literal.ts', source, new Set())).toEqual([
      { file: 'fixtures/provider-id-literal.ts', line: 1, value: 'codex' },
    ]);
  });

  it('reports a fixture provider display literal with its file and line', () => {
    const source = ts.createSourceFile('fixtures/provider-display-literal.ts', "const displayName = 'Codex';", ts.ScriptTarget.Latest, true);

    expect(findProviderLiterals('fixtures/provider-display-literal.ts', source, new Set())).toEqual([
      { file: 'fixtures/provider-display-literal.ts', line: 1, value: 'Codex' },
    ]);
  });

  it('has no built-in provider ids or display names outside the catalog and declared adapters', async () => {
    expect(await productionProviderLiteralFindings()).toEqual([]);
  });
});
