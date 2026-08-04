import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const conductorRoot = join(testDirectory, '..', '..');
const sourceRoot = join(conductorRoot, 'src');
const filesystemStore = 'engine/filesystem-conduct-state-store.ts';
const STATE_FILE = 'conduct-state.json';
const PERSISTENCE_CALLS = new Set([
  'appendFile',
  'appendFileSync',
  'rename',
  'renameSync',
  'writeFile',
  'writeFileSync',
]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

function staticPath(expression: ts.Expression, bindings: ReadonlyMap<string, ts.Expression>): string | undefined {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isIdentifier(expression)) {
    const bound = bindings.get(expression.text);
    return bound ? staticPath(bound, bindings) : undefined;
  }
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'join') {
    const parts = expression.arguments.map((argument) => staticPath(argument, bindings));
    const knownParts = parts.filter((part): part is string => part !== undefined);
    return knownParts.length > 0 ? knownParts.join('/') : undefined;
  }
  return undefined;
}

function isPersistenceCall(node: ts.CallExpression): boolean {
  const callee = ts.isIdentifier(node.expression)
    ? node.expression.text
    : ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : undefined;
  return callee !== undefined && PERSISTENCE_CALLS.has(callee);
}

function auditSource(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, ts.Expression>();
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }
    if (ts.isImportSpecifier(node) && node.name.text === 'writeState') {
      violations.push(`${path}: imports test-only whole-state fixture helper`);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'writeState') {
      violations.push(`${path}: calls test-only whole-state fixture helper`);
    }
    if (ts.isCallExpression(node) && isPersistenceCall(node)) {
      const target = node.arguments[0] && ts.isExpression(node.arguments[0])
        ? staticPath(node.arguments[0], bindings)
        : undefined;
      if (target?.includes(STATE_FILE)) violations.push(`${path}: raw persistence to ${STATE_FILE}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

async function auditProductionSource(): Promise<string[]> {
  const files = await sourceFiles(sourceRoot);
  return (await Promise.all(files.map(async (path) => {
    const rel = relative(sourceRoot, path);
    if (rel === filesystemStore) return [];
    return auditSource(rel, await readFile(path, 'utf8'));
  }))).flat();
}

describe('conduct-state writer boundary', () => {
  it('permits raw conduct-state persistence only in the filesystem state-store adapter', async () => {
    expect(await auditProductionSource()).toEqual([]);
  });

  it('rejects an isolated raw writer fixture while allowing read-only state consumers', () => {
    const bypass = auditSource(
      'engine/bypass.ts',
      "import { writeFile } from 'node:fs/promises'; import { join } from 'node:path'; const statePath = join(root, '.pipeline', 'conduct-state.json'); await writeFile(statePath, '{}');",
    );
    const reader = auditSource(
      'engine/reader.ts',
      "import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; const statePath = join(root, '.pipeline', 'conduct-state.json'); await readFile(statePath, 'utf8');",
    );

    expect(bypass).toEqual(['engine/bypass.ts: raw persistence to conduct-state.json']);
    expect(reader).toEqual([]);
  });
});
