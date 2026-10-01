// Covers: task:4, task:5
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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
  copyFile?(from: string, to: string): Promise<void>;
  report?(message: string): void;
};

const SOURCE_ROOT = resolve(import.meta.dirname, '../../../src');
const DEFERRALS_MODULE = 'engine/monitor/deferrals.ts';
const DEFERRAL_RECORD_PATH_RE = /(?:deferrals\.json|\.daemon\/deferrals)/;

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    if (statSync(file).isDirectory()) {
      files.push(...collectTsFiles(file));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(file);
    }
  }
  return files;
}

describe('Task 4 — recorded deferrals', () => {
  it('does not apply a deferral when the current halt identity changed', async () => {
    const files = new Map<string, string>();
    const deps: DeferralDeps = {
      resolveMainRoot: vi.fn(async () => '/projects/payments'),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path: string, contents: string) => {
        files.set(path, contents);
      }),
      rename: vi.fn(async (from: string, to: string) => {
        files.set(to, files.get(from) ?? '');
      }),
      readFile: vi.fn(async path => {
        const contents = files.get(path);
        if (contents === undefined) {
          throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
        }
        return contents;
      }),
      rm: vi.fn(async () => undefined),
    };
    const { isDeferred, readDeferrals, recordDeferral } = await import('../../../src/engine/monitor/deferrals.js') as {
      isDeferred(deferrals: DeferralKey[], current: DeferralKey): boolean;
      readDeferrals(startCwd: string, deps: DeferralDeps): Promise<DeferralKey[]>;
      recordDeferral(startCwd: string, key: DeferralKey, deps: DeferralDeps): Promise<void>;
    };
    const deferred: DeferralKey = {
      project: '/projects/payments',
      feature: 'release-gate',
      haltIdentity: { present: true, mtimeMs: 1_726_754_400_000, size: 86 },
    };
    const startCwd = '/projects/payments/.worktrees/release-gate';

    await recordDeferral(startCwd, deferred, deps);
    const storedDeferrals = await readDeferrals(startCwd, deps);

    expect(isDeferred(storedDeferrals, deferred)).toBe(true);

    expect(isDeferred(storedDeferrals, {
      ...deferred,
      haltIdentity: { present: true, mtimeMs: 1_726_754_500_000, size: 92 },
    })).toBe(false);
  });

  it('does not apply a deferral when the current halt identity cannot be established', async () => {
    const { isDeferred } = await import('../../../src/engine/monitor/deferrals.js') as {
      isDeferred(deferrals: DeferralKey[], current: DeferralKey): boolean;
    };
    const deferred: DeferralKey = {
      project: '/projects/payments',
      feature: 'release-gate',
      haltIdentity: { present: true, mtimeMs: 1_726_754_400_000, size: 86 },
    };

    expect(isDeferred([deferred], {
      ...deferred,
      haltIdentity: { present: false, mtimeMs: 0, size: 0 },
    })).toBe(false);
  });

  it('copies an unparseable record aside and continues with no deferrals', async () => {
    const files = new Map([
      ['/projects/payments/.daemon/deferrals.json', '{not json'],
    ]);
    const copyFile = vi.fn(async (from: string, to: string) => {
      files.set(to, files.get(from) ?? '');
    });
    const report = vi.fn();
    const deps: DeferralDeps = {
      resolveMainRoot: vi.fn(async () => '/projects/payments'),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      readFile: vi.fn(async path => files.get(path) ?? ''),
      rm: vi.fn(async () => undefined),
      copyFile,
      report,
    };
    const { readDeferrals } = await import('../../../src/engine/monitor/deferrals.js') as {
      readDeferrals(startCwd: string, deps: DeferralDeps): Promise<DeferralKey[]>;
    };

    await expect(readDeferrals('/projects/payments/.worktrees/release-gate', deps)).resolves.toEqual([]);

    expect(copyFile).toHaveBeenCalledWith(
      '/projects/payments/.daemon/deferrals.json',
      expect.stringMatching(/deferrals\.json\.corrupt-/),
    );
    expect(files.get('/projects/payments/.daemon/deferrals.json')).toBe('{not json');
    expect(report).toHaveBeenCalledWith(expect.stringContaining('deferral record unreadable'));
  });

  it('treats an absent deferral record as empty without reporting corruption', async () => {
    const copyFile = vi.fn(async () => undefined);
    const report = vi.fn();
    const deps: DeferralDeps = {
      resolveMainRoot: vi.fn(async () => '/projects/payments'),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      readFile: vi.fn(async () => {
        throw Object.assign(new Error('missing record'), { code: 'ENOENT' });
      }),
      rm: vi.fn(async () => undefined),
      copyFile,
      report,
    };
    const { readDeferrals } = await import('../../../src/engine/monitor/deferrals.js') as {
      readDeferrals(startCwd: string, deps: DeferralDeps): Promise<DeferralKey[]>;
    };

    await expect(readDeferrals('/projects/payments/.worktrees/release-gate', deps)).resolves.toEqual([]);

    expect(copyFile).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('reports an unwritable deferral directory and leaves monitoring able to continue', async () => {
    const report = vi.fn();
    const deps: DeferralDeps = {
      resolveMainRoot: vi.fn(async () => '/projects/payments'),
      mkdir: vi.fn(async () => {
        throw new Error('permission denied');
      }),
      writeFile: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      readFile: vi.fn(async () => '[]'),
      rm: vi.fn(async () => undefined),
      report,
    };
    const { recordDeferralSafely } = await import('../../../src/engine/monitor/deferrals.js') as {
      recordDeferralSafely(startCwd: string, key: DeferralKey, deps: DeferralDeps): Promise<boolean>;
    };

    await expect(recordDeferralSafely('/projects/payments/.worktrees/release-gate', {
      project: '/projects/payments',
      feature: 'release-gate',
      haltIdentity: { present: true, mtimeMs: 1_726_754_400_000, size: 86 },
    }, deps)).resolves.toBe(false);

    expect(report).toHaveBeenCalledWith(expect.stringContaining('deferral record unavailable'));
  });

  it('atomically persists the first deferral when no record exists yet', async () => {
    const files = new Map<string, string>();
    const deps: DeferralDeps = {
      resolveMainRoot: vi.fn(async () => '/projects/payments'),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path, contents) => {
        files.set(path, contents);
      }),
      rename: vi.fn(async (from, to) => {
        files.set(to, files.get(from) ?? '');
      }),
      readFile: vi.fn(async path => {
        const contents = files.get(path);
        if (contents === undefined) {
          throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
        }
        return contents;
      }),
      rm: vi.fn(async () => undefined),
    };
    const { recordDeferral } = await import('../../../src/engine/monitor/deferrals.js') as {
      recordDeferral(startCwd: string, key: DeferralKey, deps: DeferralDeps): Promise<void>;
    };
    const firstHalt: DeferralKey = {
      project: '/projects/payments',
      feature: 'release-gate',
      haltIdentity: { present: true, mtimeMs: 1_726_754_400_000, size: 86 },
    };

    await recordDeferral('/projects/payments/.worktrees/release-gate', firstHalt, deps);

    expect(files.get('/projects/payments/.daemon/deferrals.json')).toBe(JSON.stringify([firstHalt]));
  });

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

  it('retains distinct records when the same feature halts again with a new identity', async () => {
    const files = new Map<string, string>();
    const deps: DeferralDeps = {
      resolveMainRoot: vi.fn(async () => '/projects/payments'),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path, contents) => {
        files.set(path, contents);
      }),
      rename: vi.fn(async (from, to) => {
        files.set(to, files.get(from) ?? '');
      }),
      readFile: vi.fn(async path => files.get(path) ?? '[]'),
      rm: vi.fn(async () => undefined),
    };
    const { recordDeferral, readDeferrals } = await import('../../../src/engine/monitor/deferrals.js') as {
      recordDeferral(startCwd: string, key: DeferralKey, deps: DeferralDeps): Promise<void>;
      readDeferrals(startCwd: string, deps: DeferralDeps): Promise<DeferralKey[]>;
    };
    const startCwd = '/projects/payments/.worktrees/release-gate';
    const firstHalt: DeferralKey = {
      project: '/projects/payments',
      feature: 'release-gate',
      haltIdentity: { present: true, mtimeMs: 1_726_754_400_000, size: 86 },
    };
    const rehalted: DeferralKey = {
      project: '/projects/payments',
      feature: 'release-gate',
      haltIdentity: { present: true, mtimeMs: 1_726_754_500_000, size: 92 },
    };

    await recordDeferral(startCwd, firstHalt, deps);
    await recordDeferral(startCwd, rehalted, deps);

    const records = await readDeferrals(startCwd, deps);
    expect(records).toEqual([firstHalt, rehalted]);
    expect(records[0]).not.toEqual(records[1]);
  });

  it('keeps deferral record and path literals inside the deferrals boundary module', () => {
    const owner = resolve(SOURCE_ROOT, DEFERRALS_MODULE);
    const violations: string[] = [];

    for (const file of collectTsFiles(SOURCE_ROOT)) {
      if (file === owner) continue;
      if (DEFERRAL_RECORD_PATH_RE.test(readFileSync(file, 'utf8'))) {
        violations.push(relative(SOURCE_ROOT, file).split('\\').join('/'));
      }
    }

    expect(readFileSync(owner, 'utf8')).toMatch(DEFERRAL_RECORD_PATH_RE);
    expect(violations).toEqual([]);
  });
});
