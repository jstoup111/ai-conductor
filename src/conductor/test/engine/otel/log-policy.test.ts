// Covers: task:3, task:11, task:12
import { describe, expect, it } from 'vitest';
import { authorizeLogDestination, logDestinationId, readLogPolicy } from '../../../src/engine/otel/log-policy.js';

const merged = { otel: { exporter: 'otlp', endpoint: 'https://logs.example/base', logs: { enabled: true, headers: { Authorization: { env: 'LOG_TOKEN' } } } } };

describe('canonical log policy', () => {
  it('uses only the canonical root merged policy and keeps identity secret-free', async () => {
    const policy = await readLogPolicy('/linked-worktree', {
      resolveRoot: async () => '/main', loadConfig: async () => ({ ok: true, config: merged }),
    });
    expect(policy).toMatchObject({ sendable: true, root: '/main' });
    if (!policy.sendable) throw new Error('expected policy');
    expect(policy.destinationId).toBe(logDestinationId(policy.config));
    expect(policy.destinationId).toContain('$LOG_TOKEN');
    expect(policy.destinationId).not.toContain('secret-value');
  });

  it('fails closed for missing canonical roots and mismatched retained destinations', async () => {
    await expect(readLogPolicy('/outside', { resolveRoot: async () => null })).resolves.toMatchObject({ sendable: false });
    await expect(authorizeLogDestination('/worktree', 'different', {
      resolveRoot: async () => '/main', loadConfig: async () => ({ ok: true, config: merged }),
    })).resolves.toBeUndefined();
  });
});
