// Covers: task:3, task:11, task:12
import { describe, expect, it } from 'vitest';
import { authorizeLogDestination, logDestinationId, readLogPolicy, type LogPolicyOptions } from '../../../src/engine/otel/log-policy.js';

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
    expect(warnings).toEqual(['log settings in this worktree are ignored; using canonical project policy at /main/.ai-conductor/config.yml']);
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

  it('fails closed for every canonical-policy read failure without using the worktree as a fallback', async () => {
    const failures: Array<{ name: string; options: LogPolicyOptions }> = [
      { name: 'missing root', options: { resolveRoot: async () => null } },
      { name: 'root lookup failure', options: { resolveRoot: async () => { throw new Error('do not expose this'); } } },
      { name: 'unreadable config', options: { resolveRoot: async () => '/main', loadConfig: async () => ({ ok: false as const, error: { type: 'missing' as const, message: 'do not expose this' } }) } },
      { name: 'loader failure', options: { resolveRoot: async () => '/main', loadConfig: async () => { throw new Error('do not expose this'); } } },
      {
        name: 'invalid log config',
        options: {
          resolveRoot: async () => '/main',
          loadConfig: async () => ({ ok: true as const, config: { otel: { logs: { enabled: true, endpoint: 'file:///not-a-log-endpoint' } } } }),
        },
      },
    ];
    for (const { name, options } of failures) {
      const policy = await readLogPolicy('/linked-worktree', options);
      expect(policy, name).toMatchObject({ sendable: false });
      expect(policy.reason, name).not.toContain('do not expose this');
    }
    await expect(authorizeLogDestination('/worktree', 'different', {
      resolveRoot: async () => '/main', loadConfig: async () => ({ ok: true, config: merged }),
    })).resolves.toBeUndefined();
  });

  it('does not mutate either canonical or ignored worktree configuration while comparing them', async () => {
    const mainConfig = deepFreeze({ otel: { exporter: 'otlp', endpoint: 'https://main.example', logs: { enabled: true } } });
    const worktreeConfig = deepFreeze({ otel: { exporter: 'otlp', endpoint: 'https://worktree.example', logs: { enabled: false } } });
    const policy = await readLogPolicy('/worktree', {
      resolveRoot: async () => '/main',
      loadConfig: async (path) => ({ ok: true, config: path === '/main' ? mainConfig : worktreeConfig }),
    });
    expect(policy).toMatchObject({ sendable: true, root: '/main' });
    expect(mainConfig).toEqual({ otel: { exporter: 'otlp', endpoint: 'https://main.example', logs: { enabled: true } } });
    expect(worktreeConfig).toEqual({ otel: { exporter: 'otlp', endpoint: 'https://worktree.example', logs: { enabled: false } } });
  });
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}
