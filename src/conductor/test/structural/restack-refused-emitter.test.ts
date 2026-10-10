// Covers: task:2
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(testDirectory, '../../src');
const restackEmitterPath = join(sourceDirectory, 'engine/restack/restack-events.ts');

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

  it('allows restack_refused construction only in the sole emitter module', async () => {
    const files = await sourceFiles(sourceDirectory);
    const violations = (await Promise.all(files.map(async (file) => ({
      file,
      constructions: refusalConstructions(await readFile(file, 'utf8'), file),
    })))).flatMap(({ file, constructions }) => file === restackEmitterPath
      ? []
      : constructions.map((construction) => ({
        file: relative(sourceDirectory, construction.file),
        line: construction.line,
      })));

    expect(violations).toEqual([]);
  });
});
