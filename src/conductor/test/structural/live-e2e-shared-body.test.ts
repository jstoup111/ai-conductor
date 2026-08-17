import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const structuralRoot = dirname(fileURLToPath(import.meta.url));
const sharedBodyPath = join(structuralRoot, '../fixtures/live-e2e-run-body.ts');
const liveLegsPath = join(structuralRoot, '../engine');

const LITERAL_PROVIDER_IDS = new Set(['claude', 'codex']);

describe('structural: shared live E2E body', () => {
  it('keeps provider selection, authentication, and diagnostics in the shared body', async () => {
    const source = await readFile(sharedBodyPath, 'utf8');
    const parsed = ts.createSourceFile(sharedBodyPath, source, ts.ScriptTarget.Latest, true);
    const providerSpecificBranches: string[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(node.operatorToken.kind)) {
        const literal = ts.isStringLiteral(node.left)
          ? node.left
          : ts.isStringLiteral(node.right)
            ? node.right
            : undefined;
        const descriptorField = ts.isPropertyAccessExpression(node.left)
          ? node.left
          : ts.isPropertyAccessExpression(node.right)
            ? node.right
            : undefined;
        if (literal && descriptorField && ts.isIdentifier(descriptorField.expression) &&
          descriptorField.expression.text === 'descriptor' &&
          (descriptorField.name.text === 'id' || descriptorField.name.text === 'providerKey') &&
          LITERAL_PROVIDER_IDS.has(literal.text)) {
          providerSpecificBranches.push(literal.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);

    expect({
      providerSpecificBranches,
      constructsProviderFromDescriptor: source.includes('createLiveProvider(\n    descriptor,\n    credential,\n  )'),
      validatesDescriptorAuthentication: source.includes('assertDescriptorAuthenticationSource(descriptor, provider)'),
      wrapsFailuresInSharedDiagnostics: source.includes('withLiveE2EFailureDiagnostics(worktreeDir, [credential ?? \'\'], async () =>'),
      dumpsDiagnosticsBeforeRethrowing: /catch \(error\) \{\s*await dumpLiveE2EFailureDiagnostics\(worktreeDir, credentialValues\);\s*throw error;/s.test(source),
    }).toEqual({
      providerSpecificBranches: [],
      constructsProviderFromDescriptor: true,
      validatesDescriptorAuthentication: true,
      wrapsFailuresInSharedDiagnostics: true,
      dumpsDiagnosticsBeforeRethrowing: true,
    });
  });

  it('keeps the real provider legs to descriptor selection and one shared body call', async () => {
    const legNames = (await readdir(liveLegsPath)).filter((name) => /^daemon-e2e-live-.*\.smoke\.test\.ts$/.test(name)).sort();

    expect(legNames).toEqual([
      'daemon-e2e-live-claude.smoke.test.ts',
      'daemon-e2e-live-codex.smoke.test.ts',
    ]);

    const providerIndexes = {
      'daemon-e2e-live-claude.smoke.test.ts': 0,
      'daemon-e2e-live-codex.smoke.test.ts': 1,
    } as const;

    await Promise.all(legNames.map(async (name) => {
      const source = await readFile(join(liveLegsPath, name), 'utf8');
      const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
      const executableStatements = parsed.statements.filter((statement) => !ts.isImportDeclaration(statement));
      const providerDeclaration = executableStatements.find((statement) => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'provider'));
      const sharedBodyCalls = executableStatements.filter((statement) => ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression) && ts.isIdentifier(statement.expression.expression) &&
        statement.expression.expression.text === 'defineLiveE2EProviderSmoke' && statement.expression.arguments.length === 1 &&
        ts.isIdentifier(statement.expression.arguments[0]) && statement.expression.arguments[0].text === 'provider').length;
      const providerInitializer = providerDeclaration !== undefined && ts.isVariableStatement(providerDeclaration)
        ? providerDeclaration.declarationList.declarations[0]?.initializer
        : undefined;
      const providerIndex = providerInitializer !== undefined && ts.isElementAccessExpression(providerInitializer) &&
        ts.isNumericLiteral(providerInitializer.argumentExpression)
        ? Number(providerInitializer.argumentExpression.text)
        : undefined;

      expect({
        statementCount: executableStatements.length,
        selectsDescriptor: providerInitializer !== undefined && ts.isElementAccessExpression(providerInitializer) &&
          ts.isIdentifier(providerInitializer.expression) && providerInitializer.expression.text === 'LIVE_E2E_PROVIDERS',
        providerIndex,
        sharedBodyCalls,
      }).toEqual({
        statementCount: 4,
        selectsDescriptor: true,
        providerIndex: providerIndexes[name as keyof typeof providerIndexes],
        sharedBodyCalls: 1,
      });
    }));
  });
});
