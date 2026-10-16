// Covers: Task 201
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = join(root, 'src/engine');
const routeStore = join(engineRoot, 'routing/route-record-store.ts');

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return entry.isFile() && entry.name.endsWith('.ts') ? [file] : [];
  }))).flat();
}

function protectedRoutingRefWrites(source: string, fileName = 'fixture.ts'): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const writes: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.some((argument) => ts.isArrayLiteralExpression(argument)
      && argument.elements.some((element) => ts.isStringLiteral(element)
        && (element.text === 'update-ref' || element.text === 'symbolic-ref')))) {
      const text = node.getText(file);
      if (/refs\/conductor\/[^'"`]+\/(?:routes\/|repairing\b)/.test(text)) writes.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return writes;
}

describe('routing ref writer fence', () => {
  it('rejects a fixture source file that writes a route record or repairing marker directly', () => {
    const source = "await git(['update-ref', 'refs/conductor/demo/routes/r1', next]);\nawait git(['update-ref', 'refs/conductor/demo/repairing', next]);";
    expect(protectedRoutingRefWrites(source, 'fixture-direct-routing-write.ts')).toHaveLength(2);
  });

  it('allows the bounded teardown deletion through routingTeardownRefNames', async () => {
    const teardown = await readFile(join(engineRoot, 'restack/restack-refs-cleanup.ts'), 'utf8');
    expect(teardown).toContain('routingTeardownRefNames(slug)');
    expect(teardown).toContain('delete ${ref} ${oid}');
    expect(protectedRoutingRefWrites(teardown, 'restack-refs-cleanup.ts')).toEqual([]);
  });

  it('keeps all route-record and repairing writes in the fenced route store', async () => {
    const files = await sourceFiles(engineRoot);
    const violations = (await Promise.all(files.map(async (file) => ({
      file,
      writes: protectedRoutingRefWrites(await readFile(file, 'utf8'), file),
    })))).flatMap(({ file, writes }) => writes.length > 0 && file !== routeStore
      ? [relative(engineRoot, file).replaceAll('\\', '/')]
      : []);

    expect(violations.sort()).toEqual([]);
  });
});
