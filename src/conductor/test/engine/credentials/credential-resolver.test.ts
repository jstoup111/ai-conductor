// Covers: task:2
import { describe, expect, it } from 'vitest';
import { createCredentialResolver } from '../../../src/engine/credentials/credential-resolver.js';

describe('createCredentialResolver', () => {
  it('returns the supplied environment variable value for an env reference without importing otel', async () => {
    const resolver = createCredentialResolver(
      { kind: 'env', variable: 'OTLP_TOKEN' },
      { OTLP_TOKEN: 'token-value' },
    );

    await expect(resolver.resolve()).resolves.toEqual({ kind: 'value', value: 'token-value' });
  });

  it('reads the supplied environment on every resolve', async () => {
    const environment: Record<string, string | undefined> = { OTLP_TOKEN: 'first-token' };
    const resolver = createCredentialResolver({ kind: 'env', variable: 'OTLP_TOKEN' }, environment);

    await expect(resolver.resolve()).resolves.toEqual({ kind: 'value', value: 'first-token' });
    environment.OTLP_TOKEN = 'rotated-token';
    await expect(resolver.resolve()).resolves.toEqual({ kind: 'value', value: 'rotated-token' });
  });

  it('returns unavailable with the variable name for an unset environment variable without rejecting', async () => {
    const resolver = createCredentialResolver({ kind: 'env', variable: 'OTLP_TOKEN' }, {});

    await expect(resolver.resolve()).resolves.toEqual({
      kind: 'unavailable',
      reason: expect.stringContaining('OTLP_TOKEN'),
    });
  });

  it('returns unavailable with the variable name for an empty environment variable without rejecting', async () => {
    const resolver = createCredentialResolver(
      { kind: 'env', variable: 'OTLP_TOKEN' },
      { OTLP_TOKEN: '' },
    );

    await expect(resolver.resolve()).resolves.toEqual({
      kind: 'unavailable',
      reason: expect.stringContaining('OTLP_TOKEN'),
    });
  });
});
