// Covers: task:2, task:39
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseChildId } from '../../src/engine/child-context.js';
import { emitRestackRefused } from '../../src/engine/restack/restack-events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(testDirectory, '../../src');

interface RefusalConstruction {
  readonly file: string;
  readonly line: number;
}

function hasRestackRefusedType(node: ts.ObjectLiteralExpression): boolean {
  return node.properties.some((property) => ts.isPropertyAssignment(property)
    && ts.isIdentifier(property.name)
    && property.name.text === 'type'
    && ts.isStringLiteral(property.initializer)
    && property.initializer.text === 'restack_refused');
}

function refusalConstructions(source: string, file: string): RefusalConstruction[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const constructions: RefusalConstruction[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && hasRestackRefusedType(node)) {
      constructions.push({
        file,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return constructions;
}

function callsNamed(node: ts.Node, name: string): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === name) {
      found = true;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function namedFunctionCalls(source: string, functionName: string, calleeName: string): boolean {
  const sourceFile = ts.createSourceFile(functionName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return sourceFile.statements.some((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === functionName
    && callsNamed(statement, calleeName));
}

function callsHaltForReason(source: string, reason: string): boolean {
  const sourceFile = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'haltRestack'
      && ts.isStringLiteral(node.arguments[1])
      && node.arguments[1].text === reason
    ) found = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return files.flat();
}

describe('restack refused emitter', () => {
  it('detects restack_refused construction in an in-memory non-emitter fixture', () => {
    expect(refusalConstructions(
      "export const refusal = { type: 'restack_refused', reason: 'dirty-overlap' };",
      'engine/not-restack-events.ts',
    )).toEqual([{ file: 'engine/not-restack-events.ts', line: 1 }]);
  });

  it('routes every restack refusal construction and known refusal site through the sole emitter', async () => {
    const files = await sourceFiles(sourceDirectory);
    const constructions = (await Promise.all(files.map(async (file) => ({
      file,
      constructions: refusalConstructions(await readFile(file, 'utf8'), file),
    })))).flatMap(({ constructions }) => constructions.map((construction) => ({
        file: relative(sourceDirectory, construction.file),
        line: construction.line,
      })));

    expect(constructions.map(({ file }) => file)).toEqual(['engine/restack/restack-events.ts']);

    const sources = new Map(await Promise.all(files.map(async (file) => [
      relative(sourceDirectory, file),
      await readFile(file, 'utf8'),
    ] as const)));
    const source = (file: string): string => {
      const contents = sources.get(file);
      if (contents === undefined) throw new Error(`missing source fixture: ${file}`);
      return contents;
    };

    expect(namedFunctionCalls(source('engine/restack/restack-move.ts'), 'haltRestack', 'emitRestackRefused')).toBe(true);
    expect(namedFunctionCalls(source('engine/restack/restack-journal.ts'), 'createRestackJournal', 'emitRestackRefused')).toBe(true);
    expect(namedFunctionCalls(source('engine/restack/stack-preflight.ts'), 'deferredBaseRefresh', 'emitRestackRefused')).toBe(true);
    expect(namedFunctionCalls(source('engine/autoresolve.ts'), 'resolveConflictingPr', 'emitRestackRefused')).toBe(true);
    expect(callsHaltForReason(source('engine/restack/restack-executor.ts'), 'cascade-cap')).toBe(true);
  });

  it('emits named and unnamed refusals with their optional event fields intact', async () => {
    const events = new ConductorEventEmitter();
    const recorded: unknown[] = [];
    const child = parseChildId(2)!;
    events.on('restack_refused', (event) => { recorded.push(event); });

    await events.emit(emitRestackRefused({ reason: 'cascade-cap', child, detail: '2/2' }));
    await events.emit(emitRestackRefused({ reason: 'published-stack', detail: '#2945' }));

    expect(recorded).toEqual([
      { type: 'restack_refused', reason: 'cascade-cap', child, detail: '2/2' },
      { type: 'restack_refused', reason: 'published-stack', detail: '#2945' },
    ]);
  });
});
