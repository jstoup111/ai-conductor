// Covers: task:2
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const conductorRoot = join(testDirectory, '../..');
const sourceRoot = join(conductorRoot, 'src');
const engineRoot = join(sourceRoot, 'engine');
const routingRoot = join(engineRoot, 'routing');
const childCursor = join(engineRoot, 'child-cursor.ts');
const routingUnionNames = new Set(['HostState', 'RoundPhase', 'RouteKind']);

interface SwitchViolation {
  readonly file: string;
  readonly line: number;
  readonly reason: 'default-clause' | 'missing-assert-never';
}

function compilerOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    noLib: true,
    strict: true,
  };
}

function inMemoryProgram(sources: ReadonlyMap<string, string>): ts.Program {
  const options = compilerOptions();
  const host = ts.createCompilerHost(options, true);
  const sourceFile = (fileName: string): ts.SourceFile | undefined => {
    const contents = sources.get(fileName);
    return contents === undefined ? undefined : ts.createSourceFile(fileName, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  };
  host.fileExists = (fileName) => sources.has(fileName);
  host.readFile = (fileName) => sources.get(fileName);
  host.getSourceFile = (fileName) => sourceFile(fileName);
  host.getDefaultLibFileName = () => 'lib.d.ts';
  host.getCurrentDirectory = () => '';
  return ts.createProgram({ rootNames: [...sources.keys()], options, host });
}

function typeHasName(type: ts.Type, name: string): boolean {
  return type.aliasSymbol?.getName() === name || type.getSymbol()?.getName() === name;
}

function readsProperty(node: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if ((ts.isPropertyAccessExpression(current) || ts.isPropertyAccessChain(current)) && names.has(current.name.text)) found = true;
    if (ts.isElementAccessExpression(current) && ts.isStringLiteral(current.argumentExpression) && names.has(current.argumentExpression.text)) found = true;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function isExecutionChildResolutionSource(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'source') return false;
  return typeHasName(checker.getTypeAtLocation(expression.expression), 'ExecutionChildResolution');
}

function isRoutingDiscriminant(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  const type = checker.getTypeAtLocation(expression);
  return [...routingUnionNames].some((name) => typeHasName(type, name))
    || isExecutionChildResolutionSource(expression, checker)
    || readsProperty(expression, new Set(['routedRepair', 'revalidating']));
}

function callsAssertNever(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === 'assertNever') found = true;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function hasAssertNeverAfterSwitch(statement: ts.SwitchStatement): boolean {
  const parent = statement.parent;
  const statements = ts.isBlock(parent) || ts.isSourceFile(parent)
    ? parent.statements
    : ts.isCaseClause(parent) || ts.isDefaultClause(parent)
      ? parent.statements
      : undefined;
  if (statements === undefined) return false;
  const index = statements.indexOf(statement);
  return index >= 0 && statements[index + 1] !== undefined && callsAssertNever(statements[index + 1]);
}

function routingSwitchViolationsInProgram(program: ts.Program, fileNames: readonly string[]): SwitchViolation[] {
  const checker = program.getTypeChecker();
  const violations: SwitchViolation[] = [];

  for (const fileName of fileNames) {
    const sourceFile = program.getSourceFile(fileName);
    if (sourceFile === undefined) throw new Error(`missing source file: ${fileName}`);
    const visit = (node: ts.Node): void => {
      if (ts.isSwitchStatement(node) && isRoutingDiscriminant(node.expression, checker)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        if (node.caseBlock.clauses.some(ts.isDefaultClause)) violations.push({ file: fileName, line, reason: 'default-clause' });
        if (!hasAssertNeverAfterSwitch(node)) violations.push({ file: fileName, line, reason: 'missing-assert-never' });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return violations;
}

function routingSwitchViolations(sources: ReadonlyMap<string, string>): SwitchViolation[] {
  const program = inMemoryProgram(sources);
  return routingSwitchViolationsInProgram(program, [...sources.keys()]);
}

function importsRoutingTypes(source: ts.SourceFile): boolean {
  return source.statements.some((statement) => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && (statement.moduleSpecifier.text.endsWith('routing/route-types.js')
      || statement.moduleSpecifier.text.endsWith('routing/execution-child.js')));
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return paths.flat();
}

async function guardedSourceFiles(): Promise<string[]> {
  const files = await sourceFiles(sourceRoot);
  const importers = await Promise.all(files.map(async (file) => {
    const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return importsRoutingTypes(source) ? [file] : [];
  }));
  return [...new Set([
    ...files.filter((file) => dirname(file) === routingRoot),
    childCursor,
    ...importers.flat(),
  ])].sort();
}

async function realRoutingSwitchViolations(): Promise<SwitchViolation[]> {
  const files = await guardedSourceFiles();
  const program = ts.createProgram({ rootNames: files, options: { ...compilerOptions(), noLib: false, skipLibCheck: true } });
  return routingSwitchViolationsInProgram(program, files).map((violation) => ({
    ...violation,
    file: relative(conductorRoot, violation.file),
  }));
}

describe('routing exhaustive switch guard', () => {
  it('rejects a HostState switch with a default clause, naming the file and line', () => {
    const violations = routingSwitchViolations(new Map([['fixture.ts', [
      "type HostState = 'pending' | 'done'; declare const state: HostState;",
      "switch (state) { case 'pending': break; default: break; }",
    ].join('\n')]]));

    expect(violations).toEqual([
      { file: 'fixture.ts', line: 2, reason: 'default-clause' },
      { file: 'fixture.ts', line: 2, reason: 'missing-assert-never' },
    ]);
  });

  it("rejects a RouteKind switch that omits 'revalidate' without assertNever", () => {
    const violations = routingSwitchViolations(new Map([['route-kind.fixture.ts', [
      "type RouteKind = 'audit' | 'revalidate'; declare const kind: RouteKind;",
      "switch (kind) { case 'audit': break; }",
    ].join('\n')]]));

    expect(violations).toEqual([
      { file: 'route-kind.fixture.ts', line: 2, reason: 'missing-assert-never' },
    ]);
  });

  it('allows an exhaustive routing switch followed by assertNever', () => {
    expect(routingSwitchViolations(new Map([['complete.fixture.ts', [
      "type RouteKind = 'audit' | 'revalidate'; declare const kind: RouteKind;",
      "function assertNever(value: never): never { throw new Error(String(value)); }",
      "switch (kind) { case 'audit': break; case 'revalidate': break; }",
      'assertNever(kind);',
    ].join('\n')]]))).toEqual([]);
  });

  it('allows a nested exhaustive routing switch followed by assertNever in its case clause', () => {
    expect(routingSwitchViolations(new Map([['nested.fixture.ts', [
      "type HostState = 'pending' | 'done'; type RouteKind = 'audit' | 'revalidate';",
      'declare const state: HostState; declare const kind: RouteKind;',
      'function assertNever(value: never): never { throw new Error(String(value)); }',
      "switch (state) { case 'pending': switch (kind) { case 'audit': break; case 'revalidate': break; } assertNever(kind); break; case 'done': break; }",
      'assertNever(state);',
    ].join('\n')]]))).toEqual([]);
  });

  it('passes on real routing modules and child-cursor.ts', async () => {
    await expect(realRoutingSwitchViolations()).resolves.toEqual([]);
  });
});
