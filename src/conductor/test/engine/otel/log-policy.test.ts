// Covers: task:3, task:11, task:12
import { describe, expect, it } from 'vitest';
import { authorizeLogDestination, logDestinationId, readLogPolicy } from '../../../src/engine/otel/log-policy.js';

const merged = { otel: { exporter: 'otlp', endpoint: 'https://logs.example/base', logs: { enabled: true, headers: { Authorization: { env: 'LOG_TOKEN' } } } } };

describe('canonical log policy', () => {
  it('uses only the canonical root merged policy and keeps identity secret-free', async () => {
    const calls: string[] = [];
    const warnings: string[] = [];
    const mainConfig = merged;
    const worktreeConfig = { otel: { exporter: 'otlp', endpoint: 'https://worktree.invalid', logs: { enabled: false } } };
    const originalToken = process.env.LOG_TOKEN;
    process.env.LOG_TOKEN = 'secret-value';
    try {
    const policy = await readLogPolicy('/linked-worktree', {
      resolveRoot: async () => '/main',
      loadConfig: async (path) => {
        calls.push(path);
        return { ok: true, config: path === '/main' ? mainConfig : worktreeConfig };
      },
      warn: (message) => warnings.push(message),
    });
    expect(policy).toMatchObject({ sendable: true, root: '/main' });
    if (!policy.sendable) throw new Error('expected policy');
    expect(calls).toEqual(['/main', '/linked-worktree']);
    expect(warnings).toEqual([expect.stringContaining('/main')]);
    expect(policy.destinationId).toBe(logDestinationId(policy.config));
    expect(policy.destinationId).toContain('$LOG_TOKEN');
    expect(policy.destinationId).not.toContain('secret-value');
    expect(JSON.stringify(policy)).not.toContain('secret-value');

    process.env.LOG_TOKEN = 'rotated-secret-value';
    const rotated = await readLogPolicy('/linked-worktree', {
      resolveRoot: async () => '/main', loadConfig: async () => ({ ok: true, config: mainConfig }),
    });
    expect(rotated).toMatchObject({ sendable: true });
    if (!rotated.sendable) throw new Error('expected rotated policy');
    expect(rotated.destinationId).toBe(policy.destinationId);
    } finally {
      if (originalToken === undefined) delete process.env.LOG_TOKEN;
      else process.env.LOG_TOKEN = originalToken;
    }
  });

  it('fails closed for missing canonical roots and mismatched retained destinations', async () => {
    await expect(readLogPolicy('/outside', { resolveRoot: async () => null })).resolves.toMatchObject({ sendable: false });
    await expect(authorizeLogDestination('/worktree', 'different', {
      resolveRoot: async () => '/main', loadConfig: async () => ({ ok: true, config: merged }),
    })).resolves.toBeUndefined();
  });
});
