import { describe, expect, it } from 'vitest';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import {
  LIVE_E2E_PROVIDERS,
  type LiveE2EProviderDescriptor,
} from './live-e2e-providers.js';

describe('LIVE_E2E_PROVIDERS', () => {
  it('declares the complete Claude live-leg descriptor', () => {
    expect(LIVE_E2E_PROVIDERS).toHaveLength(1);

    const [claude] = LIVE_E2E_PROVIDERS;
    expect(claude).toMatchObject({
      id: 'claude',
      binaryName: 'claude',
      credentialEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
      selfHostExecutable: 'claude',
      providerKey: 'claude',
      expectedAuthenticationSource: 'oauth-token',
    });
    expect(claude.createProvider()).toBeInstanceOf(ClaudeProvider);
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
