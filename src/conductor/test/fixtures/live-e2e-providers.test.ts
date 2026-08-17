import { describe, expect, it } from 'vitest';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import {
  LIVE_E2E_PROVIDERS,
  type LiveE2EProviderDescriptor,
} from './live-e2e-providers.js';

describe('LIVE_E2E_PROVIDERS', () => {
  it('declares the complete Claude live-leg descriptor', () => {
    expect(LIVE_E2E_PROVIDERS).toHaveLength(2);

    const claude = LIVE_E2E_PROVIDERS.find(({ id }) => id === 'claude');
    expect(claude).toMatchObject({
      id: 'claude',
      binaryName: 'claude',
      credentialEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
      selfHostExecutable: 'claude',
      providerKey: 'claude',
      expectedAuthenticationSource: 'oauth-token',
    });
    expect(claude?.createProvider()).toBeInstanceOf(ClaudeProvider);
    expect(claude?.assertCredentialAvailable(undefined)).toBeUndefined();
  });

  it('resolves the real Claude authentication source from its construction-time credential', async () => {
    const claude = LIVE_E2E_PROVIDERS.find(({ id }) => id === 'claude');
    const priorToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

    try {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'live-claude-token';
      const oauthProvider = claude!.createProvider();
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      const missingProvider = claude!.createProvider();

      await expect(claude!.resolveAuthenticationSource(oauthProvider)).resolves.toBe('oauth-token');
      await expect(claude!.resolveAuthenticationSource(missingProvider)).resolves.toBe('missing');
    } finally {
      if (priorToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = priorToken;
    }
  });

  it('declares the complete Codex live-leg descriptor', () => {
    const codex = LIVE_E2E_PROVIDERS.find(({ id }) => id === 'codex');

    expect(codex).toMatchObject({
      id: 'codex',
      binaryName: 'codex',
      credentialEnvVar: 'CODEX_API_KEY',
      selfHostExecutable: 'codex',
      providerKey: 'codex',
      expectedAuthenticationSource: 'api-key',
    });
    expect(codex?.createProvider()).toBeInstanceOf(CodexProvider);
    expect(codex?.assertCredentialAvailable).toBeTypeOf('function');
  });
});

// @ts-expect-error Every live leg must declare its self-host executable.
const descriptorMissingRequiredField: LiveE2EProviderDescriptor = {
  id: 'claude',
  createProvider: () => new ClaudeProvider(),
  binaryName: 'claude',
  credentialEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
  providerKey: 'claude',
  expectedAuthenticationSource: 'oauth-token',
};

void descriptorMissingRequiredField;
