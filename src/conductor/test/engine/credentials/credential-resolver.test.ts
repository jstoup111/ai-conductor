// Covers: task:2
import { describe, expect, it, vi } from 'vitest';
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

  it('caches command values, refreshes at expiry, and shares a refresh', async () => {
    let now = 0;
    const runner = vi.fn()
      .mockResolvedValueOnce({ stdout: 'tok-1\n' })
      .mockResolvedValueOnce({ stdout: 'tok-2\n' });
    const resolver = createCredentialResolver({ kind: 'command', argv: ['credential'] }, {}, {
      commandRunner: runner,
      now: () => now,
    });

    await expect(resolver.resolve()).resolves.toEqual({ kind: 'value', value: 'tok-1' });
    now = 299_000;
    await expect(resolver.resolve()).resolves.toEqual({ kind: 'value', value: 'tok-1' });
    expect(runner).toHaveBeenCalledTimes(1);
    now = 300_000;
    await expect(Promise.all(Array.from({ length: 5 }, () => resolver.resolve()))).resolves.toEqual(
      Array.from({ length: 5 }, () => ({ kind: 'value', value: 'tok-2' })),
    );
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('does not cache unavailable command results', async () => {
    const runner = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('failed'), { code: 1 }))
      .mockResolvedValueOnce({ stdout: 'recovered\n' });
    const resolver = createCredentialResolver({ kind: 'command', argv: ['credential'] }, {}, { commandRunner: runner });

    await expect(resolver.resolve()).resolves.toMatchObject({ kind: 'unavailable' });
    await expect(resolver.resolve()).resolves.toEqual({ kind: 'value', value: 'recovered' });
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
