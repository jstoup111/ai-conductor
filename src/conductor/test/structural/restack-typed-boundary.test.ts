// Covers: task:1
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const restackDirectory = join(testDirectory, '../../src/engine/restack');
const protectedNames = /(?:Sha|Tip|Ref)$/;

interface TypedBoundaryViolation {
  readonly name: string;
  readonly line: number;
}

function isProtectedName(name: string): boolean {
  return protectedNames.test(name) || name === 'cause' || name === 'state';
}

function isBareString(type: ts.TypeNode | undefined): boolean {
  return type?.kind === ts.SyntaxKind.StringKeyword;
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
}

function typedBoundaryViolations(source: string, fileName = 'fixture.ts'): TypedBoundaryViolation[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: TypedBoundaryViolation[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      for (const parameter of statement.parameters) {
        if (ts.isIdentifier(parameter.name) && isProtectedName(parameter.name.text) && isBareString(parameter.type)) {
          violations.push({
            name: parameter.name.text,
            line: sourceFile.getLineAndCharacterOfPosition(parameter.getStart(sourceFile)).line + 1,
          });
        }
      }
    }

    if (ts.isInterfaceDeclaration(statement) && isExported(statement)) {
      for (const member of statement.members) {
        if (
          ts.isPropertySignature(member)
          && member.name !== undefined
          && ts.isIdentifier(member.name)
          && isProtectedName(member.name.text)
          && isBareString(member.type)
        ) {
          violations.push({
            name: member.name.text,
            line: sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1,
          });
        }
      }
    }
  }

  return violations;
}

async function restackSourceFiles(): Promise<string[]> {
  const entries = await readdir(restackDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(restackDirectory, entry.name))
    .sort();
}

describe('restack typed boundary', () => {
  it('rejects bare strings in protected exported boundary positions', () => {
    const violations = typedBoundaryViolations([
      'export function f(oldSha: string): void {}',
      'export interface Journal { readonly newTip: string; readonly cause: string; }',
    ].join('\n'));

    expect(violations.map((violation) => violation.name)).toEqual(['oldSha', 'newTip', 'cause']);
  });

  it('allows branded values at protected exported boundary positions', () => {
    expect(typedBoundaryViolations([
      'type CommitSha = string & { readonly __brand: \'CommitSha\' };',
      'export function f(oldSha: CommitSha): void {}',
      'export interface Journal { readonly newTip: CommitSha; }',
    ].join('\n'))).toEqual([]);
  });

  it('keeps every exported restack boundary free of bare strings', async () => {
    const files = await restackSourceFiles();
    const violations = (await Promise.all(files.map(async (file) => ({
      file,
      violations: typedBoundaryViolations(await readFile(file, 'utf8'), file),
    })))).flatMap(({ file, violations }) => violations.map((violation) => ({
      file,
      ...violation,
    })));

    expect(violations).toEqual([]);
  });
});
