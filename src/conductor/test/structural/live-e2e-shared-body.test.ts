import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const structuralRoot = dirname(fileURLToPath(import.meta.url));
const sharedBodyPath = join(structuralRoot, '../fixtures/live-e2e-run-body.ts');
const liveLegsPath = join(structuralRoot, '../engine');

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

function findProviderLegShapeViolations(source: string): string[] {
  const parsed = ts.createSourceFile('daemon-e2e-live-provider.smoke.test.ts', source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  let sharedBodyCalls = 0;

  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement)) continue;

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const isAllowed = ts.isIdentifier(declaration.name) && declaration.initializer &&
          ((declaration.name.text === 'smokeCapability' && ts.isStringLiteral(declaration.initializer)) ||
            (declaration.name.text === 'provider' && ts.isElementAccessExpression(declaration.initializer) &&
              ts.isIdentifier(declaration.initializer.expression) &&
              declaration.initializer.expression.text === 'LIVE_E2E_PROVIDERS'));
        if (!isAllowed) violations.push(`unexpected declaration: ${declaration.name.getText(parsed)}`);
      }
      continue;
    }

    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
      ts.isIdentifier(statement.expression.expression) &&
      statement.expression.expression.text === 'defineLiveE2EProviderSmoke' &&
      statement.expression.arguments.length === 1 &&
      ts.isIdentifier(statement.expression.arguments[0]) && statement.expression.arguments[0].text === 'provider') {
      sharedBodyCalls += 1;
      continue;
    }

    if (ts.isExpressionStatement(statement) && ts.isVoidExpression(statement.expression) &&
      ts.isIdentifier(statement.expression.expression) && statement.expression.expression.text === 'smokeCapability') {
      continue;
    }

    violations.push(`unexpected top-level statement: ${statement.getText(parsed)}`);
  }

  if (sharedBodyCalls !== 1) violations.push(`expected exactly one shared body call, found ${sharedBodyCalls}`);
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

  it('rejects leg-local seed, provision, preflight, meter, daemon, or assertion calls', () => {
    expect(findProviderLegShapeViolations('const provider = descriptor; runDaemon();'))
      .toEqual([
        'unexpected declaration: provider',
        'unexpected top-level statement: runDaemon();',
        'expected exactly one shared body call, found 0',
      ]);
  });

  it('rejects a provider leg with more than one shared body call', () => {
    expect(findProviderLegShapeViolations(`
      const smokeCapability = 'credentialed:claude';
      const provider = LIVE_E2E_PROVIDERS[0];
      defineLiveE2EProviderSmoke(provider);
      defineLiveE2EProviderSmoke(provider);
      void smokeCapability;
    `)).toEqual(['expected exactly one shared body call, found 2']);
  });

  it('keeps every provider smoke leg to descriptor selection and the shared run body call', async () => {
    const legNames = (await readdir(liveLegsPath)).filter((name) =>
      /^daemon-e2e-live-.*\.smoke\.test\.ts$/.test(name),
    );
    const violations = await Promise.all(legNames.map(async (name) => {
      const source = await readFile(join(liveLegsPath, name), 'utf8');
      return findProviderLegShapeViolations(source).length > 0 ? name : undefined;
    }));

    expect(violations.filter((name): name is string => name !== undefined)).toEqual([]);
  });
});
