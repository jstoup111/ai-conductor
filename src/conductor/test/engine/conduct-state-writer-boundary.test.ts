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
const FILESYSTEM_MODULES = new Set(['fs', 'fs/promises', 'node:fs', 'node:fs/promises']);

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
  if (ts.isTemplateExpression(expression)) {
    return expression.head.text + expression.templateSpans.map((span) =>
      `${staticPath(span.expression, bindings) ?? ''}${span.literal.text}`,
    ).join('');
  }
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

function rootIdentifier(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return rootIdentifier(expression.expression);
  return undefined;
}

function collectWriterImports(source: ts.SourceFile): {
  persistenceAliases: ReadonlySet<string>;
  filesystemNamespaces: ReadonlySet<string>;
  writeStateAliases: ReadonlySet<string>;
} {
  const persistenceAliases = new Set<string>();
  const filesystemNamespaces = new Set<string>();
  const writeStateAliases = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings) && FILESYSTEM_MODULES.has(statement.moduleSpecifier.text)) {
      filesystemNamespaces.add(bindings.name.text);
    }
    if (!ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = (specifier.propertyName ?? specifier.name).text;
      if (FILESYSTEM_MODULES.has(statement.moduleSpecifier.text) && PERSISTENCE_CALLS.has(imported)) {
        persistenceAliases.add(specifier.name.text);
      }
      if (imported === 'writeState') writeStateAliases.add(specifier.name.text);
    }
  }

  return { persistenceAliases, filesystemNamespaces, writeStateAliases };
}

function isPersistenceCall(
  node: ts.CallExpression,
  imports: ReturnType<typeof collectWriterImports>,
): boolean {
  if (ts.isIdentifier(node.expression)) return imports.persistenceAliases.has(node.expression.text);
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  return PERSISTENCE_CALLS.has(node.expression.name.text) &&
    imports.filesystemNamespaces.has(rootIdentifier(node.expression.expression) ?? '');
}

function auditSource(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, ts.Expression>();
  const imports = collectWriterImports(source);
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
    }
    if (ts.isImportSpecifier(node) && imports.writeStateAliases.has(node.name.text)) {
      violations.push(`${path}: imports test-only whole-state fixture helper`);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && imports.writeStateAliases.has(node.expression.text)) {
      violations.push(`${path}: calls test-only whole-state fixture helper`);
    }
    if (ts.isCallExpression(node) && isPersistenceCall(node, imports)) {
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

  it('rejects aliased raw conduct-state persistence', () => {
    const bypass = auditSource(
      'engine/aliased-bypass.ts',
      "import { writeFile as persist } from 'node:fs/promises'; import { join } from 'node:path'; await persist(join(root, '.pipeline', 'conduct-state.json'), '{}');",
    );

    expect(bypass).toEqual(['engine/aliased-bypass.ts: raw persistence to conduct-state.json']);
  });

  it('rejects an alias through a template-derived state path', () => {
    const bypass = auditSource(
      'engine/template-path-bypass.ts',
      "import { writeFile as persist } from 'node:fs/promises'; import { join } from 'node:path'; const stateFile = 'conduct-state.json'; await persist(join(root, `.pipeline/${stateFile}`), '{}');",
    );

    expect(bypass).toEqual(['engine/template-path-bypass.ts: raw persistence to conduct-state.json']);
  });

  it('rejects namespace persistence while permitting namespace readers', () => {
    const writer = auditSource(
      'engine/namespace-writer.ts',
      "import * as fs from 'node:fs/promises'; await fs.writeFile('/tmp/conduct-state.json', '{}');",
    );
    const reader = auditSource(
      'engine/namespace-reader.ts',
      "import * as fs from 'node:fs/promises'; await fs.readFile('/tmp/conduct-state.json', 'utf8');",
    );

    expect({ writer, reader }).toEqual({
      writer: ['engine/namespace-writer.ts: raw persistence to conduct-state.json'],
      reader: [],
    });
  });

  it('rejects an aliased whole-state helper call', () => {
    const bypass = auditSource(
      'engine/aliased-whole-state-bypass.ts',
      "import { writeState as persistState } from './state.js'; await persistState('/tmp/conduct-state.json', {});",
    );

    expect(bypass).toEqual([
      'engine/aliased-whole-state-bypass.ts: imports test-only whole-state fixture helper',
      'engine/aliased-whole-state-bypass.ts: calls test-only whole-state fixture helper',
    ]);
  });
});
