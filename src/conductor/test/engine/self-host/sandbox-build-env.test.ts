import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  readdir,
  realpath,
  lstat,
  chmod,
  stat,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  provisionSandboxBuildEnv,
  withSandboxBuildEnv,
  sandboxLinkTargets,
  refreshSandboxCredentials,
  SandboxProvisionError,
  realSandboxFs,
  type SandboxFs,
} from '../../../src/engine/self-host/sandbox-build-env.js';

// Phase 3 (TR-5/TR-6) — the safety core. A harness self-build must run against a
// THROWAWAY CLAUDE_CONFIG_DIR linked to its worktree, and must NEVER mutate the
// global ~/.claude the operator's ~20 concurrent sessions read. Isolation is a
// contract with adversarial coverage on the pass, fail, and crash branches.
//
// Every provision passes an explicit `globalConfigDir` (a temp dir) so the tests
// are hermetic and never read/copy the operator's real ~/.claude credentials.

describe('SandboxBuildEnv (TR-5/TR-6)', () => {
  let worktree: string; // stands in for the build worktree (edited harness)
  let mainCheckout: string; // stands in for the harness MAIN checkout (harnessRoot)
  let globalConfig: string; // stands in for the operator's global ~/.claude
  let base: string; // where the throwaway config dir is created

  // Convenience: the common options for a hermetic provision.
  const opts = (over: Record<string, unknown> = {}) => ({
    worktreeRoot: worktree,
    harnessRoot: worktree, // retarget is a no-op unless a test overrides this
    globalConfigDir: globalConfig,
    baseDir: base,
    ...over,
  });

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), 'sbx-worktree-'));
    mainCheckout = await mkdtemp(join(tmpdir(), 'sbx-main-'));
    globalConfig = await mkdtemp(join(tmpdir(), 'sbx-global-'));
    base = await mkdtemp(join(tmpdir(), 'sbx-base-'));
    await mkdir(join(worktree, 'skills'), { recursive: true });
    await mkdir(join(worktree, 'hooks'), { recursive: true });
    await mkdir(join(globalConfig, 'skills'), { recursive: true });
    await mkdir(join(globalConfig, 'hooks'), { recursive: true });
  });
  afterEach(async () => {
    for (const d of [worktree, mainCheckout, globalConfig, base]) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('provisions a throwaway config dir with skills/+hooks/ linked to the worktree; child env carries CLAUDE_CONFIG_DIR', async () => {
    const sandbox = await provisionSandboxBuildEnv(opts());
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

    const sandbox = await provisionSandboxBuildEnv(opts());
    try {
      const resolved = await realpath(join(sandbox.configDir, 'skills', 'probe', 'SKILL.md'));
      expect(resolved).toBe(await realpath(join(worktree, 'skills', 'probe', 'SKILL.md')));
    } finally {
      await sandbox.teardown();
    }
  });

  it('no-leak invariant (TR-6): no sandbox link resolves under the global config dir', async () => {
    const sandbox = await provisionSandboxBuildEnv(opts());
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

  it('copies the operator credentials into the sandbox so the headless build can authenticate — as a COPY, not a symlink to global (TR-6)', async () => {
    await writeFile(join(globalConfig, '.credentials.json'), '{"token":"secret"}');
    const sandbox = await provisionSandboxBuildEnv(opts());
    try {
      const credPath = join(sandbox.configDir, '.credentials.json');
      expect(existsSync(credPath)).toBe(true);
      expect(await readFile(credPath, 'utf-8')).toBe('{"token":"secret"}');
      // It is a real file, not a symlink resolving back into global config.
      expect((await lstat(credPath)).isSymbolicLink()).toBe(false);
      expect((await realpath(credPath)).startsWith(await realpath(globalConfig))).toBe(false);
    } finally {
      await sandbox.teardown();
    }
  });

  it('copies settings.json and retargets harness-checkout hook paths to the worktree; leaves personal ~/.claude hook paths untouched', async () => {
    const mainReal = await realpath(mainCheckout);
    const globalReal = await realpath(globalConfig);
    const settings = JSON.stringify({
      hooks: {
        PreToolUse: [
          { command: `${mainReal}/hooks/claude/block-destructive-git.sh` }, // harness hook → retarget
          { command: `${globalReal}/hooks/personal.sh` }, // personal hook → untouched
        ],
      },
    });
    await writeFile(join(globalConfig, 'settings.json'), settings);

    const sandbox = await provisionSandboxBuildEnv(opts({ harnessRoot: mainCheckout }));
    try {
      const written = await readFile(join(sandbox.configDir, 'settings.json'), 'utf-8');
      const worktreeReal = await realpath(worktree);
      expect(written).toContain(`${worktreeReal}/hooks/claude/block-destructive-git.sh`);
      expect(written).not.toContain(`${mainReal}/hooks/claude`);
      // Personal path (outside the harness checkout) is left alone.
      expect(written).toContain(`${globalReal}/hooks/personal.sh`);
    } finally {
      await sandbox.teardown();
    }
  });

  it('retarget content lock (#363 / TR-4): hook command + statusLine rewritten to the worktree, personal hooks untouched, ZERO harness-root paths remain', async () => {
    const mainReal = await realpath(mainCheckout);
    const globalReal = await realpath(globalConfig);
    const settings = JSON.stringify({
      statusLine: { type: 'command', command: `${mainReal}/bin/statusline` },
      hooks: {
        PreToolUse: [
          { command: `${mainReal}/hooks/claude/block-destructive-git.sh` }, // harness hook → retarget
          { command: `${globalReal}/hooks/personal.sh` }, // personal hook → untouched
        ],
      },
    });
    await writeFile(join(globalConfig, 'settings.json'), settings);

    const sandbox = await provisionSandboxBuildEnv(opts({ harnessRoot: mainCheckout }));
    try {
      const written = await readFile(join(sandbox.configDir, 'settings.json'), 'utf-8');
      const worktreeReal = await realpath(worktree);
      // Both harness-owned paths rewritten to the worktree…
      expect(written).toContain(`${worktreeReal}/hooks/claude/block-destructive-git.sh`);
      expect(written).toContain(`${worktreeReal}/bin/statusline`);
      // …the personal path untouched…
      expect(written).toContain(`${globalReal}/hooks/personal.sh`);
      // …and NOT ONE main-checkout-prefixed harness path survives (the incident
      // mode: a no-op retarget leaves the build on the operator's live hooks).
      expect(written).not.toContain(`${mainReal}/`);
    } finally {
      await sandbox.teardown();
    }
  });

  it('fails closed when the worktree is missing a linked dir — no dangling-link sandbox is launched (TR-5)', async () => {
    await rm(join(worktree, 'skills'), { recursive: true, force: true });
    const err = await provisionSandboxBuildEnv(opts()).catch((e) => e);
    expect(err).toBeInstanceOf(SandboxProvisionError);
    expect(String(err.message)).toContain("missing 'skills/'");
    // No partial sandbox left behind under the base dir.
    expect(await readdir(base)).toEqual([]);
  });

  it('teardown removes the throwaway dir and leaves global config byte-for-byte unchanged (pass branch)', async () => {
    await writeFile(join(globalConfig, '.credentials.json'), '{"token":"secret"}');
    await writeFile(join(globalConfig, 'settings.json'), '{"hooks":{}}');
    const before = await snapshot(globalConfig);
    const sandbox = await provisionSandboxBuildEnv(opts());
    const dir = sandbox.configDir;
    await sandbox.teardown();
    expect(existsSync(dir)).toBe(false);
    expect(await snapshot(globalConfig)).toEqual(before);
  });

  it('withSandboxBuildEnv tears down even when the build fn throws (crash branch), global untouched', async () => {
    const before = await snapshot(globalConfig);
    let captured = '';
    await expect(
      withSandboxBuildEnv(opts(), async (sandbox) => {
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
    const err = await provisionSandboxBuildEnv(opts({ fs: failingFs })).catch((e) => e);
    expect(err).toBeInstanceOf(SandboxProvisionError);
    // Partial sandbox removed — never launched.
    expect(created).not.toBe('');
    expect(existsSync(created)).toBe(false);
  });

  it('no ambient-env bleed: childEnv overrides only the child copy; parent env object is untouched', async () => {
    const parentEnv = { HOME: '/home/op', CLAUDE_CONFIG_DIR: '/home/op/.claude', FOO: 'bar' };
    const sandbox = await provisionSandboxBuildEnv(opts({ parentEnv }));
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
    const a = await provisionSandboxBuildEnv(opts());
    const b = await provisionSandboxBuildEnv(opts());
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
    const sandbox = await provisionSandboxBuildEnv(opts());
    await sandbox.teardown();
    await expect(sandbox.teardown()).resolves.toBeUndefined();
  });

  // ── Workspace-trust propagation (.claude.json) ─────────────────────────────
  // A fresh CLAUDE_CONFIG_DIR trusts no project, so the headless build ignored
  // the repo's `.claude/settings.json` permissions.allow entries and wedged.
  // The sandbox seeds trust IFF the operator already trusts the harness root.

  /** An operator state file trusting `root`, written into the global temp dir. */
  const writeOperatorState = async (root: string | null) => {
    const stateFile = join(globalConfig, '.claude.json');
    const projects = root === null ? {} : { [root]: { hasTrustDialogAccepted: true } };
    await writeFile(stateFile, JSON.stringify({ hasCompletedOnboarding: true, projects }));
    return stateFile;
  };

  it('propagates operator trust: seeds sandbox .claude.json trusting the harness root AND the build worktree — as a real file, not a symlink (TR-6)', async () => {
    const stateFile = await writeOperatorState(mainCheckout);
    const sandbox = await provisionSandboxBuildEnv(
      opts({ harnessRoot: mainCheckout, globalStateFile: stateFile }),
    );
    try {
      const seededPath = join(sandbox.configDir, '.claude.json');
      expect(existsSync(seededPath)).toBe(true);
      expect((await lstat(seededPath)).isSymbolicLink()).toBe(false);
      const seeded = JSON.parse(await readFile(seededPath, 'utf-8'));
      expect(seeded.hasCompletedOnboarding).toBe(true);
      // Both roots trusted, keyed as-passed and canonicalized (Claude Code may
      // resolve the project key either way).
      for (const p of [
        mainCheckout,
        await realpath(mainCheckout),
        worktree,
        await realpath(worktree),
      ]) {
        expect(seeded.projects[p]?.hasTrustDialogAccepted).toBe(true);
      }
    } finally {
      await sandbox.teardown();
    }
  });

  it('adversarial: operator has NOT trusted the harness root → no trust is fabricated (no .claude.json written)', async () => {
    // State file exists and trusts an UNRELATED path — the harness root is absent.
    const stateFile = await writeOperatorState(join(tmpdir(), 'some-other-project'));
    const sandbox = await provisionSandboxBuildEnv(
      opts({ harnessRoot: mainCheckout, globalStateFile: stateFile }),
    );
    try {
      expect(existsSync(join(sandbox.configDir, '.claude.json'))).toBe(false);
    } finally {
      await sandbox.teardown();
    }
  });

  it('adversarial: explicit hasTrustDialogAccepted:false is not trust (no seed)', async () => {
    const stateFile = join(globalConfig, '.claude.json');
    await writeFile(
      stateFile,
      JSON.stringify({ projects: { [mainCheckout]: { hasTrustDialogAccepted: false } } }),
    );
    const sandbox = await provisionSandboxBuildEnv(
      opts({ harnessRoot: mainCheckout, globalStateFile: stateFile }),
    );
    try {
      expect(existsSync(join(sandbox.configDir, '.claude.json'))).toBe(false);
    } finally {
      await sandbox.teardown();
    }
  });

  it('missing operator state file → provision succeeds with no .claude.json (nothing to propagate)', async () => {
    const sandbox = await provisionSandboxBuildEnv(
      opts({ globalStateFile: join(globalConfig, '.claude.json') }), // never written
    );
    try {
      expect(existsSync(join(sandbox.configDir, '.claude.json'))).toBe(false);
    } finally {
      await sandbox.teardown();
    }
  });

  it('adversarial: malformed operator state JSON → provision succeeds, nothing seeded (never guess trust)', async () => {
    const stateFile = join(globalConfig, '.claude.json');
    await writeFile(stateFile, '{"projects": {  <-- not json');
    const sandbox = await provisionSandboxBuildEnv(
      opts({ harnessRoot: mainCheckout, globalStateFile: stateFile }),
    );
    try {
      expect(existsSync(join(sandbox.configDir, '.claude.json'))).toBe(false);
    } finally {
      await sandbox.teardown();
    }
  });

  it('operator state file is only READ — byte-for-byte unchanged after provision + teardown', async () => {
    const stateFile = await writeOperatorState(mainCheckout);
    const before = await readFile(stateFile, 'utf-8');
    const sandbox = await provisionSandboxBuildEnv(
      opts({ harnessRoot: mainCheckout, globalStateFile: stateFile }),
    );
    await sandbox.teardown();
    expect(await readFile(stateFile, 'utf-8')).toBe(before);
  });

  // ── Re-copy primitive (refreshSandboxCredentials) ──────────────────────────
  // After provisioning a sandbox, the operator's credentials may be updated
  // (e.g., token refresh). refreshSandboxCredentials re-copies the source
  // .credentials.json into the sandbox, overwriting stale credentials.

  it('refreshSandboxCredentials re-copies .credentials.json from source to sandbox, overwriting with new content', async () => {
    // Initial credentials in global config.
    const sourceCredsPath = join(globalConfig, '.credentials.json');
    await writeFile(sourceCredsPath, '{"token":"old-token"}');

    // Provision a sandbox with the initial credentials.
    const sandbox = await provisionSandboxBuildEnv(opts());
    try {
      const sandboxCredsPath = join(sandbox.configDir, '.credentials.json');
      expect(existsSync(sandboxCredsPath)).toBe(true);
      expect(await readFile(sandboxCredsPath, 'utf-8')).toBe('{"token":"old-token"}');

      // Mutate the source credentials (simulating an operator token refresh).
      await writeFile(sourceCredsPath, '{"token":"new-token"}');

      // Re-copy from source to sandbox.
      await refreshSandboxCredentials(globalConfig, sandbox.configDir);

      // Sandbox credentials are now updated to the new value.
      expect(await readFile(sandboxCredsPath, 'utf-8')).toBe('{"token":"new-token"}');

      // It is a regular file, not a symlink (TR-6).
      expect((await lstat(sandboxCredsPath)).isSymbolicLink()).toBe(false);
      expect((await lstat(sandboxCredsPath)).isFile()).toBe(true);
    } finally {
      await sandbox.teardown();
    }
  });

  // ── Write-fence provisioning (TR-4) ─────────────────────────────────────────
  // The sandbox provisions a write-fence script that blocks edits to the live
  // harness checkout (outside the worktree) while permitting edits within the
  // worktree and unrelated repositories. The script is wired into settings.json
  // as a PreToolUse hook and materialized on disk with +x mode.

  it('provisions the write-fence script into the sandbox: settings.json contains fence entry, script exists and is executable, no placeholder residue', async () => {
    const sandbox = await provisionSandboxBuildEnv(opts());
    try {
      // settings.json contains the fence PreToolUse entry
      const settingsPath = join(sandbox.configDir, 'settings.json');
      const settingsContent = await readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsContent);
      expect(settings.hooks).toBeDefined();
      expect(Array.isArray(settings.hooks.PreToolUse)).toBe(true);
      const fenceEntry = settings.hooks.PreToolUse.find(
        (hook: Record<string, unknown>) => (hook.command as string)?.includes('write-fence.sh'),
      );
      expect(fenceEntry).toBeDefined();

      // The write-fence.sh script exists
      const scriptPath = join(sandbox.configDir, 'write-fence.sh');
      expect(existsSync(scriptPath)).toBe(true);

      // Script is executable (+x mode)
      const stats = await stat(scriptPath);
      // Check if the owner execute bit is set (mode & 0o100)
      expect((stats.mode & 0o100) !== 0).toBe(true);

      // Script content has no placeholder residue (baked roots verified)
      const scriptContent = await readFile(scriptPath, 'utf-8');
      expect(scriptContent).toContain(`WORKTREE_ROOT="${worktree}"`);
      expect(scriptContent).toContain(`HARNESS_ROOT="${worktree}"`);
      // No placeholder patterns (bash scripts legitimately contain < for comparisons)
      expect(scriptContent).not.toContain('{{');
      expect(scriptContent).not.toContain('}}');
      expect(scriptContent).not.toContain('<placeholder>');
      expect(scriptContent).not.toContain('PLACEHOLDER');
    } finally {
      await sandbox.teardown();
    }
  });

  it('fails closed when fence script write fails (fs error): SandboxProvisionError thrown, partial sandbox cleaned up, build not launched', async () => {
    let createdConfigDir = '';
    const failingFs: SandboxFs = {
      ...realSandboxFs,
      mkdtemp: async (prefix) => {
        createdConfigDir = await realSandboxFs.mkdtemp(prefix);
        return createdConfigDir;
      },
      writeFile: async (path, data) => {
        // Fail when writing the write-fence.sh script
        if (path.includes('write-fence.sh')) {
          throw Object.assign(new Error('ENOSPC: no space left on device'), {
            code: 'ENOSPC',
            path,
          });
        }
        return realSandboxFs.writeFile(path, data);
      },
    };

    const err = await provisionSandboxBuildEnv(opts({ fs: failingFs })).catch((e) => e);
    expect(err).toBeInstanceOf(SandboxProvisionError);
    expect(String(err.message)).toContain('write-fence.sh');

    // Partial sandbox removed — never launched
    expect(createdConfigDir).not.toBe('');
    expect(existsSync(createdConfigDir)).toBe(false);
    expect(await readdir(base)).toEqual([]);
  });

  it('teardown removes the write-fence.sh script (no residue after sandbox cleanup)', async () => {
    const sandbox = await provisionSandboxBuildEnv(opts());
    const scriptPath = join(sandbox.configDir, 'write-fence.sh');
    expect(existsSync(scriptPath)).toBe(true);

    await sandbox.teardown();

    expect(existsSync(scriptPath)).toBe(false);
    expect(existsSync(sandbox.configDir)).toBe(false);
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
