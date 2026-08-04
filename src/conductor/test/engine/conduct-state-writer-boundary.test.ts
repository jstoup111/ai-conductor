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
const FILE_HANDLE_PERSISTENCE_CALLS = new Set(['appendFile', 'write', 'writeFile']);
const FILESYSTEM_MODULES = new Set(['fs', 'fs/promises', 'node:fs', 'node:fs/promises']);
const PATH_MODULES = new Set(['path', 'node:path']);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

function staticPath(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, ts.Expression>,
  imports: ReturnType<typeof collectWriterImports>,
): string | undefined {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) {
    return expression.head.text + expression.templateSpans.map((span) =>
      `${staticPath(span.expression, bindings, imports) ?? ''}${span.literal.text}`,
    ).join('');
  }
  if (ts.isIdentifier(expression)) {
    const bound = bindings.get(expression.text);
    return bound ? staticPath(bound, bindings, imports) : undefined;
  }
  if (ts.isCallExpression(expression) && isPathJoinCall(expression, imports)) {
    const parts = expression.arguments.map((argument) => staticPath(argument, bindings, imports));
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

function unwrappedExpression(expression: ts.Expression): ts.Expression {
  return ts.isAwaitExpression(expression) ? unwrappedExpression(expression.expression) : expression;
}

function collectWriterImports(source: ts.SourceFile): {
  persistenceAliases: ReadonlySet<string>;
  filesystemNamespaces: ReadonlySet<string>;
  filesystemDefaultImports: ReadonlySet<string>;
  openAliases: ReadonlySet<string>;
  pathDefaultImports: ReadonlySet<string>;
  pathJoinAliases: ReadonlySet<string>;
  pathNamespaces: ReadonlySet<string>;
  renameAliases: ReadonlySet<string>;
  writeStateAliases: ReadonlySet<string>;
  stateNamespaces: ReadonlySet<string>;
} {
  const persistenceAliases = new Set<string>();
  const filesystemNamespaces = new Set<string>();
  const filesystemDefaultImports = new Set<string>();
  const openAliases = new Set<string>();
  const pathDefaultImports = new Set<string>();
  const pathJoinAliases = new Set<string>();
  const pathNamespaces = new Set<string>();
  const renameAliases = new Set<string>();
  const writeStateAliases = new Set<string>();
  const stateNamespaces = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const isFilesystemModule = FILESYSTEM_MODULES.has(moduleName);
    const isPathModule = PATH_MODULES.has(moduleName);
    const isStateHelperModule = moduleName === './state.js';
    if (isFilesystemModule && statement.importClause?.name) {
      filesystemDefaultImports.add(statement.importClause.name.text);
    }
    if (isPathModule && statement.importClause?.name) pathDefaultImports.add(statement.importClause.name.text);
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      if (isFilesystemModule) filesystemNamespaces.add(bindings.name.text);
      if (isPathModule) pathNamespaces.add(bindings.name.text);
      if (isStateHelperModule) stateNamespaces.add(bindings.name.text);
    }
    if (!ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = (specifier.propertyName ?? specifier.name).text;
      if (isFilesystemModule && PERSISTENCE_CALLS.has(imported)) {
        persistenceAliases.add(specifier.name.text);
      }
      if (isFilesystemModule && imported === 'open') openAliases.add(specifier.name.text);
      if (isFilesystemModule && (imported === 'rename' || imported === 'renameSync')) {
        renameAliases.add(specifier.name.text);
      }
      if (isPathModule && imported === 'join') pathJoinAliases.add(specifier.name.text);
      if (isStateHelperModule && imported === 'writeState') writeStateAliases.add(specifier.name.text);
    }
  }

  return {
    persistenceAliases,
    filesystemNamespaces,
    filesystemDefaultImports,
    openAliases,
    pathDefaultImports,
    pathJoinAliases,
    pathNamespaces,
    renameAliases,
    writeStateAliases,
    stateNamespaces,
  };
}

function isPathJoinCall(
  node: ts.CallExpression,
  imports: ReturnType<typeof collectWriterImports>,
): boolean {
  if (ts.isIdentifier(node.expression)) return imports.pathJoinAliases.has(node.expression.text);
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'join') return false;
  const root = rootIdentifier(node.expression.expression) ?? '';
  return imports.pathNamespaces.has(root) || imports.pathDefaultImports.has(root);
}

function isPersistenceCall(
  node: ts.CallExpression,
  imports: ReturnType<typeof collectWriterImports>,
): boolean {
  if (ts.isIdentifier(node.expression)) return imports.persistenceAliases.has(node.expression.text);
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  return PERSISTENCE_CALLS.has(node.expression.name.text) &&
    (imports.filesystemNamespaces.has(rootIdentifier(node.expression.expression) ?? '') ||
      imports.filesystemDefaultImports.has(rootIdentifier(node.expression.expression) ?? ''));
}

function isWritableStateOpen(
  node: ts.CallExpression,
  imports: ReturnType<typeof collectWriterImports>,
  bindings: ReadonlyMap<string, ts.Expression>,
): boolean {
  const opensStateFile = node.arguments[0] && ts.isExpression(node.arguments[0]) &&
    staticPath(node.arguments[0], bindings, imports)?.includes(STATE_FILE);
  const mode = node.arguments[1] && ts.isExpression(node.arguments[1])
    ? staticPath(node.arguments[1], bindings, imports)
    : undefined;
  if (!opensStateFile || !mode || !/[wa+]/.test(mode)) return false;

  if (ts.isIdentifier(node.expression)) return imports.openAliases.has(node.expression.text);
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'open') return false;
  const root = rootIdentifier(node.expression.expression) ?? '';
  return imports.filesystemNamespaces.has(root) || imports.filesystemDefaultImports.has(root);
}

function isFileHandlePersistenceCall(
  node: ts.CallExpression,
  writableStateHandles: ReadonlySet<string>,
): boolean {
  if (!ts.isPropertyAccessExpression(node.expression) ||
      !FILE_HANDLE_PERSISTENCE_CALLS.has(node.expression.name.text)) return false;
  return writableStateHandles.has(rootIdentifier(node.expression.expression) ?? '');
}

function persistenceTarget(
  node: ts.CallExpression,
  imports: ReturnType<typeof collectWriterImports>,
): ts.Expression | undefined {
  const isRename = ts.isIdentifier(node.expression)
    ? imports.renameAliases.has(node.expression.text)
    : ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'rename' || node.expression.name.text === 'renameSync');
  const target = node.arguments[isRename ? 1 : 0];
  return target && ts.isExpression(target) ? target : undefined;
}

function auditSource(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, ts.Expression>();
  const imports = collectWriterImports(source);
  const writableStateHandles = new Set<string>();
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, node.initializer);
      const initializer = unwrappedExpression(node.initializer);
      if (ts.isCallExpression(initializer) && isWritableStateOpen(initializer, imports, bindings)) {
        writableStateHandles.add(node.name.text);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)) {
      const right = unwrappedExpression(node.right);
      if (ts.isCallExpression(right) && isWritableStateOpen(right, imports, bindings)) {
        writableStateHandles.add(node.left.text);
      }
    }
    if (ts.isImportSpecifier(node) && imports.writeStateAliases.has(node.name.text)) {
      violations.push(`${path}: imports test-only whole-state fixture helper`);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && imports.writeStateAliases.has(node.expression.text)) {
      violations.push(`${path}: calls test-only whole-state fixture helper`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'writeState' &&
        imports.stateNamespaces.has(rootIdentifier(node.expression.expression) ?? '')) {
      violations.push(`${path}: calls test-only whole-state fixture helper`);
    }
    if (ts.isCallExpression(node) && isPersistenceCall(node, imports)) {
      const target = persistenceTarget(node, imports);
      if (target && staticPath(target, bindings, imports)?.includes(STATE_FILE)) {
        violations.push(`${path}: raw persistence to ${STATE_FILE}`);
      }
    }
    if (ts.isCallExpression(node) && isFileHandlePersistenceCall(node, writableStateHandles)) {
      violations.push(`${path}: raw persistence to ${STATE_FILE}`);
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

  it('rejects path.join rename destinations while allowing path-based readers', () => {
    const bypass = auditSource(
      'engine/path-join-rename-bypass.ts',
      "import { rename } from 'node:fs/promises'; import path from 'node:path'; const temporary = '/tmp/state.tmp'; await rename(temporary, path.join(root, '.pipeline', 'conduct-state.json'));",
    );
    const reader = auditSource(
      'engine/path-join-reader.ts',
      "import { readFile } from 'node:fs/promises'; import path from 'node:path'; await readFile(path.join(root, '.pipeline', 'conduct-state.json'), 'utf8');",
    );

    expect({ bypass, reader }).toEqual({
      bypass: ['engine/path-join-rename-bypass.ts: raw persistence to conduct-state.json'],
      reader: [],
    });
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

  it('rejects default filesystem writers while allowing default filesystem readers', () => {
    const writers = [
      ['engine/default-fs-writer.ts', "import fs from 'fs'; fs.writeFileSync('/tmp/conduct-state.json', '{}');"],
      ['engine/default-fs-promises-writer.ts', "import fs from 'fs/promises'; await fs.writeFile('/tmp/conduct-state.json', '{}');"],
      ['engine/default-node-fs-writer.ts', "import fs from 'node:fs'; fs.writeFileSync('/tmp/conduct-state.json', '{}');"],
      ['engine/default-node-fs-promises-writer.ts', "import fs from 'node:fs/promises'; await fs.writeFile('/tmp/conduct-state.json', '{}');"],
    ] as const;
    const reader = auditSource(
      'engine/default-reader.ts',
      "import fs from 'node:fs/promises'; await fs.readFile('/tmp/conduct-state.json', 'utf8');",
    );

    expect({
      writers: writers.map(([path, fixture]) => auditSource(path, fixture)),
      reader,
    }).toEqual({
      writers: writers.map(([path]) => [`${path}: raw persistence to conduct-state.json`]),
      reader: [],
    });
  });

  it('rejects namespace whole-state helper writers while allowing namespace readers', () => {
    const writer = auditSource(
      'engine/namespace-state-writer.ts',
      "import * as state from './state.js'; await state.writeState('/tmp/conduct-state.json', {});",
    );
    const reader = auditSource(
      'engine/namespace-state-reader.ts',
      "import * as state from './state.js'; await state.readState('/tmp/conduct-state.json');",
    );
    const unrelatedHelper = auditSource(
      'engine/unrelated-helper.ts',
      "import { writeState } from './fixture-state.js'; await writeState('/tmp/conduct-state.json', {});",
    );

    expect({ writer, reader, unrelatedHelper }).toEqual({
      writer: ['engine/namespace-state-writer.ts: calls test-only whole-state fixture helper'],
      reader: [],
      unrelatedHelper: [],
    });
  });

  it('rejects writable file handles for a state target while allowing read-only handles', () => {
    const writers = [
      ['engine/file-handle-write-file.ts', "import { open } from 'node:fs/promises'; const handle = await open('/tmp/conduct-state.json', 'w'); await handle.writeFile('{}');"],
      ['engine/file-handle-append-file.ts', "import * as fs from 'node:fs/promises'; const handle = await fs.open('/tmp/conduct-state.json', 'a'); await handle.appendFile('{}');"],
      ['engine/file-handle-write.ts', "import fs from 'fs/promises'; const handle = await fs.open('/tmp/conduct-state.json', 'r+'); await handle.write('{}');"],
    ] as const;
    const reader = auditSource(
      'engine/file-handle-reader.ts',
      "import { open } from 'node:fs/promises'; const statePath = '/tmp/conduct-state.json'; const handle = await open(statePath, 'r'); await handle.readFile('utf8');",
    );

    expect({
      writers: writers.map(([path, fixture]) => auditSource(path, fixture)),
      reader,
    }).toEqual({
      writers: writers.map(([path]) => [`${path}: raw persistence to conduct-state.json`]),
      reader: [],
    });
  });
});
