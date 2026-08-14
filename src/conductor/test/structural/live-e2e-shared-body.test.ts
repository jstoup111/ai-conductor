import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const structuralRoot = dirname(fileURLToPath(import.meta.url));
const sharedBodyPath = join(structuralRoot, '../fixtures/live-e2e-run-body.ts');

const LITERAL_PROVIDER_IDS = new Set(['claude', 'codex']);

function isEqualityComparison(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
}

function isDescriptorProviderField(node: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'descriptor' &&
    (node.name.text === 'id' || node.name.text === 'providerKey');
}

function findProviderSpecificBranches(source: string): string[] {
  const parsed = ts.createSourceFile('live-e2e-run-body.ts', source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && isEqualityComparison(node.operatorToken.kind)) {
      const literal = ts.isStringLiteral(node.left) && isDescriptorProviderField(node.right)
        ? node.left
        : ts.isStringLiteral(node.right) && isDescriptorProviderField(node.left)
          ? node.right
          : undefined;
      if (literal && LITERAL_PROVIDER_IDS.has(literal.text)) {
        violations.push(`provider-specific branch: comparison to literal provider id \"${literal.text}\"`);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return violations;
}

describe('structural: shared live E2E body', () => {
  it('rejects a comparison to a literal provider id by name', () => {
    expect(findProviderSpecificBranches("if (descriptor.providerKey === 'claude') {}"))
      .toEqual(['provider-specific branch: comparison to literal provider id "claude"']);
  });

  it('contains no provider-specific branches', async () => {
    const source = await readFile(sharedBodyPath, 'utf8');

    expect(findProviderSpecificBranches(source)).toEqual([]);
  });
});
