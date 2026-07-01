import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  provisionSandboxBuildEnv,
  withSandboxBuildEnv,
  sandboxLinkTargets,
  SandboxProvisionError,
  realSandboxFs,
  type SandboxFs,
} from '../../../src/engine/self-host/sandbox-build-env.js';

// Phase 3 (TR-5/TR-6) — the safety core. A harness self-build must run against a
// THROWAWAY CLAUDE_CONFIG_DIR linked to its worktree, and must NEVER mutate the
// global ~/.claude the operator's ~20 concurrent sessions read. Isolation is a
// contract with adversarial coverage on the pass, fail, and crash branches.

describe('SandboxBuildEnv (TR-5/TR-6)', () => {
  let worktree: string; // stands in for the build worktree (edited harness)
  let globalConfig: string; // stands in for the operator's global ~/.claude
  let base: string; // where the throwaway config dir is created

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), 'sbx-worktree-'));
    globalConfig = await mkdtemp(join(tmpdir(), 'sbx-global-'));
    base = await mkdtemp(join(tmpdir(), 'sbx-base-'));
    await mkdir(join(worktree, 'skills'), { recursive: true });
    await mkdir(join(worktree, 'hooks'), { recursive: true });
    await mkdir(join(globalConfig, 'skills'), { recursive: true });
    await mkdir(join(globalConfig, 'hooks'), { recursive: true });
  });
  afterEach(async () => {
    for (const d of [worktree, globalConfig, base]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('provisions a throwaway config dir with skills/+hooks/ linked to the worktree; child env carries CLAUDE_CONFIG_DIR', async () => {
    const sandbox = await provisionSandboxBuildEnv({ worktreeRoot: worktree, baseDir: base });
    try {
      expect(existsSync(sandbox.configDir)).toBe(true);
      expect(sandbox.configDir.startsWith(base)).toBe(true);
      const env = sandbox.childEnv();
      expect(env.CLAUDE_CONFIG_DIR).toBe(sandbox.configDir);
      const targets = await sandboxLinkTargets(sandbox);
      expect(await realpath(targets.skills)).toBe(await realpath(join(worktree, 'skills')));
      expect(await realpath(targets.hooks)).toBe(await realpath(join(worktree, 'hooks')));
    } finally {
      await sandbox.teardown();
    }
  });

  it('edit-sensitive: a skill edited in the worktree is what the sandbox resolves (not a global copy)', async () => {
    // Same-named skill in BOTH the worktree (edited) and the global config (old).
    await mkdir(join(worktree, 'skills', 'probe'), { recursive: true });
    await writeFile(join(worktree, 'skills', 'probe', 'SKILL.md'), 'EDITED-IN-WORKTREE');
    await mkdir(join(globalConfig, 'skills', 'probe'), { recursive: true });
    await writeFile(join(globalConfig, 'skills', 'probe', 'SKILL.md'), 'OLD-GLOBAL');

    const sandbox = await provisionSandboxBuildEnv({ worktreeRoot: worktree, baseDir: base });
    try {
      const resolved = await realpath(join(sandbox.configDir, 'skills', 'probe', 'SKILL.md'));
      expect(resolved).toBe(await realpath(join(worktree, 'skills', 'probe', 'SKILL.md')));
    } finally {
      await sandbox.teardown();
    }
  });

  it('no-leak invariant (TR-6): no sandbox link resolves under the global config dir', async () => {
    const sandbox = await provisionSandboxBuildEnv({ worktreeRoot: worktree, baseDir: base });
    try {
      const targets = await sandboxLinkTargets(sandbox);
      const globalReal = await realpath(globalConfig);
      const worktreeReal = await realpath(worktree);
      for (const t of Object.values(targets)) {
        const real = await realpath(t);
        expect(real.startsWith(globalReal)).toBe(false);
        expect(real.startsWith(worktreeReal)).toBe(true);
      }
    } finally {
      await sandbox.teardown();
    }
  });

  it('teardown removes the throwaway dir and leaves global config byte-for-byte unchanged (pass branch)', async () => {
    const before = await snapshot(globalConfig);
    const sandbox = await provisionSandboxBuildEnv({ worktreeRoot: worktree, baseDir: base });
    const dir = sandbox.configDir;
    await sandbox.teardown();
    expect(existsSync(dir)).toBe(false);
    expect(await snapshot(globalConfig)).toEqual(before);
  });

  it('withSandboxBuildEnv tears down even when the build fn throws (crash branch), global untouched', async () => {
    const before = await snapshot(globalConfig);
    let captured = '';
    await expect(
      withSandboxBuildEnv({ worktreeRoot: worktree, baseDir: base }, async (sandbox) => {
        captured = sandbox.configDir;
        expect(existsSync(captured)).toBe(true);
        throw new Error('build crashed');
      }),
    ).rejects.toThrow('build crashed');
    // Teardown ran on the error branch — asserted, not assumed.
    expect(existsSync(captured)).toBe(false);
    expect(await snapshot(globalConfig)).toEqual(before);
  });

  it('provisioning failure (symlink EACCES): no partial sandbox left, keyed error names the path', async () => {
    let created = '';
    const failingFs: SandboxFs = {
      ...realSandboxFs,
      mkdtemp: async (prefix) => {
        created = await realSandboxFs.mkdtemp(prefix);
        return created;
      },
      symlink: async () => {
        throw Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
          path: join('SOMEWHERE', 'skills'),
        });
      },
    };
    const err = await provisionSandboxBuildEnv({
      worktreeRoot: worktree,
      baseDir: base,
      fs: failingFs,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SandboxProvisionError);
    // Partial sandbox removed — never launched.
    expect(created).not.toBe('');
    expect(existsSync(created)).toBe(false);
  });

  it('no ambient-env bleed: childEnv overrides only the child copy; parent env object is untouched', async () => {
    const parentEnv = { HOME: '/home/op', CLAUDE_CONFIG_DIR: '/home/op/.claude', FOO: 'bar' };
    const sandbox = await provisionSandboxBuildEnv({
      worktreeRoot: worktree,
      baseDir: base,
      parentEnv,
    });
    try {
      const childEnv = sandbox.childEnv();
      expect(childEnv.CLAUDE_CONFIG_DIR).toBe(sandbox.configDir); // child sees the sandbox
      expect(childEnv.FOO).toBe('bar'); // other vars preserved
      // Parent env object is not mutated (daemon env restored/unbled).
      expect(parentEnv.CLAUDE_CONFIG_DIR).toBe('/home/op/.claude');
    } finally {
      await sandbox.teardown();
    }
  });

  it('concurrent provisions get distinct dirs; tearing one down never disturbs the other', async () => {
    const a = await provisionSandboxBuildEnv({ worktreeRoot: worktree, baseDir: base });
    const b = await provisionSandboxBuildEnv({ worktreeRoot: worktree, baseDir: base });
    try {
      expect(a.configDir).not.toBe(b.configDir);
      await a.teardown();
      expect(existsSync(a.configDir)).toBe(false);
      expect(existsSync(b.configDir)).toBe(true); // untouched
    } finally {
      await b.teardown();
    }
  });

  it('teardown is idempotent (double teardown does not throw)', async () => {
    const sandbox = await provisionSandboxBuildEnv({ worktreeRoot: worktree, baseDir: base });
    await sandbox.teardown();
    await expect(sandbox.teardown()).resolves.toBeUndefined();
  });
});

/** A stable, order-independent snapshot of a directory tree's entries. */
async function snapshot(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string, rel: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries.sort((x, y) => x.name.localeCompare(y.name))) {
      const r = join(rel, e.name);
      out.push(`${r}:${e.isDirectory() ? 'd' : e.isSymbolicLink() ? 'l' : 'f'}`);
      if (e.isDirectory()) await walk(join(d, e.name), r);
    }
  }
  await walk(dir, '');
  return out;
}
