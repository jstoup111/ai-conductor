// Covers: task:4
import { describe, expect, it, vi } from 'vitest';

type DeferralKey = {
  project: string;
  feature: string;
  haltIdentity: {
    present: boolean;
    mtimeMs: number;
    size: number;
  };
};

type DeferralDeps = {
  resolveMainRoot(startCwd: string): Promise<string>;
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  writeFile(path: string, contents: string, encoding: 'utf-8'): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  readFile(path: string, encoding: 'utf-8'): Promise<string>;
  rm(path: string, options: { force: true }): Promise<void>;
};

describe('Task 4 — recorded deferrals', () => {
  it('round-trips project, feature, and halt identity as separate fields', async () => {
    const files = new Map<string, string>();
    const writeFile = vi.fn(async (path: string, contents: string) => {
      files.set(path, contents);
    });
    const resolveMainRoot = vi.fn(async () => '/projects/payments');
    const mkdir = vi.fn(async () => undefined);
    const rename = vi.fn(async (from: string, to: string) => {
      files.set(to, files.get(from) ?? '');
    });
    const deps: DeferralDeps = {
      resolveMainRoot,
      mkdir,
      writeFile,
      rename,
      readFile: vi.fn(async path => files.get(path) ?? '[]'),
      rm: vi.fn(async () => undefined),
    };
    const { recordDeferral, readDeferrals } = await import('../../../src/engine/monitor/deferrals.js') as {
      recordDeferral(startCwd: string, key: DeferralKey, deps: DeferralDeps): Promise<void>;
      readDeferrals(startCwd: string, deps: DeferralDeps): Promise<DeferralKey[]>;
    };
    const startCwd = '/projects/payments/.worktrees/release-gate';

    await recordDeferral(startCwd, {
      project: '/projects/payments',
      feature: 'release-gate',
      haltIdentity: { present: true, mtimeMs: 1_726_754_400_000, size: 86 },
    }, deps);

    expect(resolveMainRoot).toHaveBeenCalledWith(startCwd);
    expect(mkdir).toHaveBeenCalledWith('/projects/payments/.daemon', { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      '/projects/payments/.daemon/deferrals.json.tmp',
      expect.any(String),
      'utf-8',
    );
    expect(rename).toHaveBeenCalledWith(
      '/projects/payments/.daemon/deferrals.json.tmp',
      '/projects/payments/.daemon/deferrals.json',
    );

    const serialized = writeFile.mock.calls.at(-1)?.[1];
    expect(serialized).toBeTypeOf('string');
    expect(JSON.parse(serialized as string)).toEqual([
      {
        project: '/projects/payments',
        feature: 'release-gate',
        haltIdentity: { present: true, mtimeMs: 1_726_754_400_000, size: 86 },
      },
    ]);

    const [deferral] = await readDeferrals(startCwd, deps);
    expect(deferral).toBeDefined();
    expect(deferral?.project).toBe('/projects/payments');
    expect(deferral?.feature).toBe('release-gate');
    expect(deferral?.haltIdentity).toEqual({ present: true, mtimeMs: 1_726_754_400_000, size: 86 });
  });

  it('clears a worktree deferral record through the resolved project root', async () => {
    const resolveMainRoot = vi.fn(async () => '/projects/payments');
    const rm = vi.fn(async () => undefined);
    const deps: DeferralDeps = {
      resolveMainRoot,
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      readFile: vi.fn(async () => '[]'),
      rm,
    };
    const { clearDeferrals } = await import('../../../src/engine/monitor/deferrals.js') as {
      clearDeferrals(startCwd: string, deps: DeferralDeps): Promise<void>;
    };
    const startCwd = '/projects/payments/.worktrees/release-gate';

    await clearDeferrals(startCwd, deps);

    expect(resolveMainRoot).toHaveBeenCalledWith(startCwd);
    expect(rm).toHaveBeenCalledWith('/projects/payments/.daemon/deferrals.json', { force: true });
  });

  it('does not expose a final deferral record when the atomic rename crashes', async () => {
    const files = new Map<string, string>();
    const deps: DeferralDeps = {
      resolveMainRoot: vi.fn(async () => '/projects/payments'),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path, contents) => {
        files.set(path, contents);
      }),
      rename: vi.fn(async () => {
        throw new Error('simulated rename crash');
      }),
      readFile: vi.fn(async () => '[]'),
      rm: vi.fn(async () => undefined),
    };
    const { recordDeferral } = await import('../../../src/engine/monitor/deferrals.js') as {
      recordDeferral(startCwd: string, key: DeferralKey, deps: DeferralDeps): Promise<void>;
    };

    await expect(recordDeferral('/projects/payments/.worktrees/release-gate', {
      project: '/projects/payments',
      feature: 'release-gate',
      haltIdentity: { present: true, mtimeMs: 1_726_754_400_000, size: 86 },
    }, deps)).rejects.toThrow('simulated rename crash');

    expect(files.get('/projects/payments/.daemon/deferrals.json')).toBeUndefined();
    expect(files.get('/projects/payments/.daemon/deferrals.json.tmp')).toEqual(expect.any(String));
  });
});
