import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { emitRestackRefused } from '../../src/engine/restack/restack-events.js';
import type { RestackRefusalReason } from '../../src/engine/restack/restack-types.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(testDirectory, '../../src');
function hasRestackRefusedType(node: ts.ObjectLiteralExpression): boolean {
  return node.properties.some((property) => ts.isPropertyAssignment(property)
    && ts.isIdentifier(property.name)
    && property.name.text === 'type'
    && ts.isStringLiteral(property.initializer)
    && property.initializer.text === 'restack_refused');
}
function refusalConstructions(source: string, file: string): { readonly file: string; readonly line: number }[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const constructions: { file: string; line: number }[] = [];
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

const REASONS: readonly RestackRefusalReason[] = [
  'cascade-cap', 'dirty-overlap', 'sync-collision', 'checked-out-elsewhere', 'stack-ref-changed',
  'lock-unavailable', 'verification-failed', 'replay-mismatch', 'range-not-ancestor',
  'closed-child-rewritten', 'flatten_refused', 'restack-outstanding', 'published-stack', 'deferred-base-refresh',
];

describe('restack_refused sole emitter (sweep G1)', () => {
  // Covers: task:2
  it('tags every named child on emitRestackRefused and rejects a restack_refused literal outside restack-events.ts', async () => {
    const child = parseChildId(3)!;
    for (const reason of REASONS) {
      expect(emitRestackRefused({ reason, child })).toEqual({ type: 'restack_refused', reason, child });
      expect(emitRestackRefused({ reason, child, detail: 'named' })).toEqual({ type: 'restack_refused', reason, child, detail: 'named' });
      expect(emitRestackRefused({ reason })).not.toHaveProperty('child');
    }

    const fixtureFile = join(sourceDirectory, 'engine', 'restack', 'restack-move.ts');
    const fixture = refusalConstructions(
      "export function refuse() { return { type: 'restack_refused', reason: 'lock-unavailable' }; }",
      fixtureFile,
    );
    expect(fixture.map(({ file }) => relative(sourceDirectory, file))).toEqual(['engine/restack/restack-move.ts']);

    const files = await sourceFiles(sourceDirectory);
    const constructions = (await Promise.all(files.map(async (file) => refusalConstructions(await readFile(file, 'utf8'), file)))).flat();
    expect([...new Set(constructions.map(({ file }) => relative(sourceDirectory, file)))]).toEqual(['engine/restack/restack-events.ts']);
  });
});
