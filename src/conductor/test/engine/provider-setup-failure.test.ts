import { describe, expect, it } from 'vitest';
import type { InvokeResult } from '../../src/execution/llm-provider.js';
import {
  ProviderSetupUnavailableError,
  isProviderSetupUnavailableError,
  normalizeProviderSetupUnavailable,
} from '../../src/engine/provider-setup-failure.js';

describe('provider setup failure normalization', () => {
  const unavailable = {
    provider: 'codex',
    reason: 'Missing the required isolated-home capability.',
    recoveryAction: 'Update Codex to provide isolated-home setup.',
    capability: 'isolated-home',
  };

  it('accepts a valid, provider-owned typed setup error', () => {
    const error = new ProviderSetupUnavailableError(unavailable);

    expect(isProviderSetupUnavailableError(error)).toBe(true);
    expect(normalizeProviderSetupUnavailable(error, 'codex')).toEqual(unavailable);

    const result: InvokeResult = {
      success: false,
      output: 'Provider setup exhausted.',
      exitCode: 1,
      providerSetupExhaustion: { candidates: [unavailable] },
    };
    expect(result.providerSetupExhaustion?.candidates).toEqual([unavailable]);
  });

  it('rejects unverified and invalid setup-error payloads', () => {
    const typed = new ProviderSetupUnavailableError(unavailable);
    const blankReason = new ProviderSetupUnavailableError(unavailable);
    (blankReason as { setupUnavailable: { reason: string } }).setupUnavailable.reason = '   ';

    expect(normalizeProviderSetupUnavailable(new Error(typed.message), 'codex')).toBeUndefined();
    expect(normalizeProviderSetupUnavailable({ ...typed, setupUnavailable: unavailable }, 'codex')).toBeUndefined();
    expect(normalizeProviderSetupUnavailable(blankReason, 'codex')).toBeUndefined();
    expect(normalizeProviderSetupUnavailable(typed, 'claude')).toBeUndefined();
  });
});
