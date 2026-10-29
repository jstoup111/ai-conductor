// Covers: task:7, task:8
import { describe, expect, it, vi } from 'vitest';
import { CredentialUnavailableError, createOtelHeaderProvider } from '../../../src/engine/otel/otel-header-provider.js';

describe('OTel header provider', () => {
  it('names the header and command failure without exposing command output', async () => {
    const provider = createOtelHeaderProvider({ authorization: { kind: 'command', argv: ['credential', '--token'] } }, undefined, {
      commandRunner: vi.fn().mockRejectedValue(Object.assign(new Error('failed'), {
        code: 3,
        stdout: 'SENTINEL-OUT',
        stderr: 'SENTINEL-ERR',
      })),
    });

    await expect(provider()).rejects.toBeInstanceOf(CredentialUnavailableError);
    await expect(provider()).rejects.toThrow(/authorization.*credential --token.*exit code 3/i);
    await expect(provider()).rejects.not.toThrow(/SENTINEL/);
  });

  it('reads environment credentials afresh for each delivery', async () => {
    const environment: NodeJS.ProcessEnv = { OTLP_TOKEN: 'first' };
    const provider = createOtelHeaderProvider({ authorization: { kind: 'env', variable: 'OTLP_TOKEN' } }, undefined, { environment });
    await expect(provider()).resolves.toEqual({ authorization: 'first' });
    environment.OTLP_TOKEN = 'rotated';
    await expect(provider()).resolves.toEqual({ authorization: 'rotated' });
  });
});
