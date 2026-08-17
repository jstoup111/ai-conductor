import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import type { LLMProvider } from '../../src/execution/llm-provider.js';
import { dumpPipelineDiagnostics } from '../engine/daemon-e2e-fixture.test.js';
import { LIVE_E2E_PROVIDERS, type LiveE2EProviderDescriptor } from '../fixtures/live-e2e-providers.js';
import { runLiveE2ERunBody } from '../fixtures/live-e2e-run-body.js';

vi.mock('../engine/daemon-e2e-fixture.test.js', () => ({
  dumpPipelineDiagnostics: vi.fn(),
}));

const structuralRoot = dirname(fileURLToPath(import.meta.url));
const sharedBodyPath = join(structuralRoot, '../fixtures/live-e2e-run-body.ts');
const LITERAL_PROVIDER_IDS = new Set(['claude', 'codex']);

describe('structural: shared live E2E body', () => {
  it('has no provider-specific branch in the shared body', async () => {
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

    expect(providerSpecificBranches).toEqual([]);
  });

  it('executes every descriptor through equivalent provider selection, authentication, and diagnostics outcomes', async () => {
    const originalCredentials = new Map(
      LIVE_E2E_PROVIDERS.map((descriptor) => [descriptor.credentialEnvVar, process.env[descriptor.credentialEnvVar]]),
    );
    const selections = vi.fn();
    const authenticationChecks = vi.fn();

    try {
      vi.mocked(dumpPipelineDiagnostics).mockClear();
      vi.mocked(dumpPipelineDiagnostics).mockResolvedValue('');
      const outcomes = await Promise.all(LIVE_E2E_PROVIDERS.map(async (registeredDescriptor) => {
        process.env[registeredDescriptor.credentialEnvVar] = `${registeredDescriptor.id}-credential`;
        const provider: LLMProvider = { invoke: vi.fn(), invokeInteractive: vi.fn() };
        const descriptor: LiveE2EProviderDescriptor = {
          ...registeredDescriptor,
          createProvider: () => {
            selections(registeredDescriptor.id);
            return provider;
          },
          expectedAuthenticationSource: 'test-source',
          resolveAuthenticationSource: async (candidate) => {
            authenticationChecks(registeredDescriptor.id, candidate);
            return 'test-source';
          },
          assertCredentialAvailable: () => {},
        };

        return runLiveE2ERunBody(descriptor, 1, {
          binaryAvailable: () => true,
          provisionProviderHome: async (): Promise<never> => {
            throw new Error('equivalent injected live-provider outcome');
          },
        }).then(
          () => 'completed',
          (error: unknown) => error instanceof Error ? error.message : String(error),
        );
      }));

      expect({
        outcomes,
        selections: selections.mock.calls.map(([id]) => id),
        authenticationChecks: authenticationChecks.mock.calls.map(([id]) => id),
        diagnostics: vi.mocked(dumpPipelineDiagnostics).mock.calls.length,
      }).toEqual({
        outcomes: ['equivalent injected live-provider outcome', 'equivalent injected live-provider outcome'],
        selections: ['claude', 'codex'],
        authenticationChecks: ['claude', 'codex'],
        diagnostics: 2,
      });
    } finally {
      vi.mocked(dumpPipelineDiagnostics).mockReset();
      for (const [credentialEnvVar, credential] of originalCredentials) {
        if (credential === undefined) delete process.env[credentialEnvVar];
        else process.env[credentialEnvVar] = credential;
      }
    }
  });
});
