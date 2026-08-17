import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  it('captures the real Claude authentication source at provider construction', () => {
    const priorToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

    try {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'live-claude-token';
      const oauthProvider = new ClaudeProvider();
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      const missingProvider = new ClaudeProvider();

      expect([oauthProvider.authenticationSource(), missingProvider.authenticationSource()]).toEqual([
        'oauth-token',
        'missing',
      ]);
    } finally {
      if (priorToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = priorToken;
    }
  });

  it('declares the complete Codex live-leg descriptor and verifies its credential guard', async () => {
    const codex = LIVE_E2E_PROVIDERS.find(({ id }) => id === 'codex');
    const priorHome = process.env.CODEX_HOME;
    const codexHome = await mkdtemp(join(tmpdir(), 'live-e2e-codex-auth-'));

    expect(codex).toMatchObject({
      id: 'codex',
      binaryName: 'codex',
      credentialEnvVar: 'CODEX_API_KEY',
      selfHostExecutable: 'codex',
      providerKey: 'codex',
      expectedAuthenticationSource: 'api-key',
    });
    expect(codex?.createProvider()).toBeInstanceOf(CodexProvider);
    expect(codex).toBeDefined();

    try {
      // Isolate every branch from an operator's cached login so removing the
      // API-key short circuit cannot silently pass against ~/.codex/auth.json.
      process.env.CODEX_HOME = codexHome;
      expect(codex!.assertCredentialAvailable('present-codex-key')).toBeUndefined();

      await writeFile(join(codexHome, 'auth.json'), '{}');
      expect(codex!.assertCredentialAvailable(undefined)).toBeUndefined();

      await rm(join(codexHome, 'auth.json'));
      expect(() => codex!.assertCredentialAvailable(undefined)).toThrow(
        `Missing Codex credential: set CODEX_API_KEY or sign in at ${join(codexHome, 'auth.json')}`,
      );
    } finally {
      if (priorHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = priorHome;
      await rm(codexHome, { recursive: true, force: true });
    }
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
