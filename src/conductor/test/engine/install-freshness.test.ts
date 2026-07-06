/**
 * install-freshness guard — policy unit tests + daemon-start wiring.
 *
 * Regression for: a harness update doesn't relink skills, so a newly-added skill
 * (e.g. /rebase) is missing from ~/.claude/skills/ and daemon-dispatched skills
 * fail silently ("Unknown command" → empty output → "no parseable result" HALT).
 * The guard runs `bin/install --check` and, on drift, prompts to `--update`
 * (interactive) or fails hard (non-interactive) — never starts on a stale install.
 *
 * All collaborators are injected — no real `bin/install`, no real TTY.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ensureInstallFresh,
  relinkSkillsForSelfBuild,
  resolveInstalledHarnessRoot,
  InstallStaleError,
  type InstallRunner,
  type InstalledRootResolution,
} from '../../src/engine/install-freshness.js';
import { dispatchDaemonSupervisor } from '../../src/engine/daemon-supervisor-cli.js';
import type { Supervisor } from '../../src/engine/daemon-tmux.js';

/** A runner that returns a fixed exit code per `bin/install` arg and records calls. */
function makeRunner(codes: { check: number; update?: number }): {
  runner: InstallRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const runner: InstallRunner = async (args) => {
    calls.push(args);
    if (args[0] === '--check') return codes.check;
    if (args[0] === '--update') return codes.update ?? 0;
    return 0;
  };
  return { runner, calls };
}

const HARNESS = '/fake/harness';

describe('ensureInstallFresh — staleness policy', () => {
  it('fresh install (--check → 0): resolves, never runs --update', async () => {
    const { runner, calls } = makeRunner({ check: 0 });
    await expect(
      ensureInstallFresh({ harnessRoot: HARNESS, runner, interactive: true, log: () => {} }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([['--check']]);
  });

  it('drift + interactive + "yes": runs --update and resolves', async () => {
    const { runner, calls } = makeRunner({ check: 1, update: 0 });
    const prompt = vi.fn(async () => true);
    await expect(
      ensureInstallFresh({ harnessRoot: HARNESS, runner, interactive: true, prompt, log: () => {} }),
    ).resolves.toBeUndefined();
    expect(prompt).toHaveBeenCalledOnce();
    expect(calls).toEqual([['--check'], ['--update']]);
  });

  it('drift + interactive + "no": throws, does NOT run --update', async () => {
    const { runner, calls } = makeRunner({ check: 1 });
    const prompt = vi.fn(async () => false);
    await expect(
      ensureInstallFresh({ harnessRoot: HARNESS, runner, interactive: true, prompt, log: () => {} }),
    ).rejects.toBeInstanceOf(InstallStaleError);
    expect(calls).toEqual([['--check']]); // no --update
  });

  it('drift + non-interactive: throws WITHOUT prompting or updating', async () => {
    const { runner, calls } = makeRunner({ check: 1 });
    const prompt = vi.fn(async () => true);
    await expect(
      ensureInstallFresh({ harnessRoot: HARNESS, runner, interactive: false, prompt, log: () => {} }),
    ).rejects.toBeInstanceOf(InstallStaleError);
    expect(prompt).not.toHaveBeenCalled();
    expect(calls).toEqual([['--check']]);
  });

  it('drift + "yes" but --update fails: throws', async () => {
    const { runner } = makeRunner({ check: 1, update: 1 });
    await expect(
      ensureInstallFresh({
        harnessRoot: HARNESS,
        runner,
        interactive: true,
        prompt: async () => true,
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(InstallStaleError);
  });

  it('harness root not found (null): skips the check, resolves', async () => {
    const { runner, calls } = makeRunner({ check: 1 });
    await expect(
      ensureInstallFresh({ harnessRoot: null, runner, interactive: false, log: () => {} }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]); // runner never invoked
  });
});

describe('resolveInstalledHarnessRoot — installed-root resolution ladder (#363 / TR-2)', () => {
  // All seams injected: no real git, no real fs probing outside temp dirs, and
  // never the real ~/.ai-conductor or ~/.claude. `registryPath` points at temp
  // files only.

  /** Seam kit: a probed root, a git runner answer, and a bin/install answer. */
  function seams(over: {
    probed?: string | null;
    /** What `git rev-parse --git-common-dir` prints, or an Error to throw. */
    commonDir?: string | Error;
    /** Paths (…/bin/install) that exist. Default: everything exists. */
    installerAt?: string[] | 'all';
  }) {
    const gitCalls: Array<{ args: string[]; cwd: string }> = [];
    return {
      gitCalls,
      probeRoot: async () => (over.probed === undefined ? '/main/harness' : over.probed),
      git: async (args: string[], cwd: string) => {
        gitCalls.push({ args, cwd });
        if (over.commonDir instanceof Error) throw over.commonDir;
        return over.commonDir ?? '.git';
      },
      pathExists: async (p: string) =>
        over.installerAt === undefined || over.installerAt === 'all'
          ? true
          : over.installerAt.some((root) => p === join(root, 'bin', 'install')),
      log: () => {},
    };
  }

  it('main checkout: probe resolves a non-worktree root with bin/install → ok at that root', async () => {
    // Relative `.git` is what git prints from the main checkout's root.
    const s = seams({ probed: '/main/harness', commonDir: '.git' });
    const r = await resolveInstalledHarnessRoot(s);
    expect(r).toEqual({ status: 'ok', root: '/main/harness' });
    // Detection consulted git in the probed root.
    expect(s.gitCalls).toEqual([
      { args: ['rev-parse', '--git-common-dir'], cwd: '/main/harness' },
    ]);
  });

  it('worktree by path (/.worktrees/): derives the main checkout from the git common dir', async () => {
    const s = seams({ probed: '/main/.worktrees/x', commonDir: '/main/.git' });
    const r = await resolveInstalledHarnessRoot(s);
    expect(r).toEqual({ status: 'ok', root: '/main' });
  });

  it('linked worktree at a non-.worktrees path: common dir outside the probed root → derives main', async () => {
    const s = seams({ probed: '/elsewhere/linked-wt', commonDir: '/main/.git' });
    const r = await resolveInstalledHarnessRoot(s);
    expect(r).toEqual({ status: 'ok', root: '/main' });
  });

  it('git runner throws → rejected (resolver itself never throws), detail names the probed path', async () => {
    const s = seams({
      probed: '/main/.worktrees/x',
      commonDir: new Error('fatal: not a git repository'),
    });
    const r = await resolveInstalledHarnessRoot(s);
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') {
      expect(r.detail).toContain('/main/.worktrees/x');
    }
  });

  it('derived root lacks bin/install → rejected, detail names the derived root', async () => {
    const s = seams({
      probed: '/main/.worktrees/x',
      commonDir: '/main/.git',
      installerAt: [], // nothing has bin/install
    });
    const r = await resolveInstalledHarnessRoot(s);
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') {
      expect(r.detail).toContain('/main');
    }
  });

  it('derived root STILL under /.worktrees/ → rejected (never authorizes a worktree root)', async () => {
    const s = seams({
      probed: '/main/.worktrees/outer/.worktrees/inner',
      commonDir: '/main/.worktrees/outer/.git',
    });
    const r = await resolveInstalledHarnessRoot(s);
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') {
      expect(r.detail).toContain('/main/.worktrees/outer');
    }
  });

  it('probe finds no root at all → unresolved (parity with existing null semantics)', async () => {
    const s = seams({ probed: null });
    const r = await resolveInstalledHarnessRoot(s);
    expect(r).toEqual({ status: 'unresolved' });
    expect(s.gitCalls).toEqual([]); // no derivation attempted without a probe
  });

  describe('advisory registry cross-check (warn-only, never blocks)', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'installed-root-registry-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('registry recording a different path → result unchanged, warning logged', async () => {
      const registryPath = join(dir, 'registry.json');
      await writeFile(
        registryPath,
        JSON.stringify([
          { schemaVersion: 1, name: 'h', path: '/somewhere/else', status: 'registered', registeredAt: 'x' },
        ]),
      );
      const logs: string[] = [];
      const s = { ...seams({ probed: '/main/harness', commonDir: '.git' }), log: (m: string) => logs.push(m) };
      const r = await resolveInstalledHarnessRoot({ ...s, registryPath });
      expect(r).toEqual({ status: 'ok', root: '/main/harness' });
      expect(logs.join('\n')).toMatch(/registry/i);
    });

    it('registry missing → result unchanged, no throw', async () => {
      const s = seams({ probed: '/main/harness', commonDir: '.git' });
      const r = await resolveInstalledHarnessRoot({
        ...s,
        registryPath: join(dir, 'nope', 'registry.json'),
      });
      expect(r).toEqual({ status: 'ok', root: '/main/harness' });
    });

    it('registry unreadable (corrupt JSON) → result unchanged, no throw', async () => {
      const registryPath = join(dir, 'registry.json');
      await writeFile(registryPath, '{not json');
      const s = seams({ probed: '/main/harness', commonDir: '.git' });
      const r = await resolveInstalledHarnessRoot({ ...s, registryPath });
      expect(r).toEqual({ status: 'ok', root: '/main/harness' });
    });

    it('registry recording the resolved root → no disagreement warning', async () => {
      const registryPath = join(dir, 'registry.json');
      await writeFile(
        registryPath,
        JSON.stringify([
          { schemaVersion: 1, name: 'h', path: '/main/harness', status: 'registered', registeredAt: 'x' },
        ]),
      );
      const logs: string[] = [];
      const s = { ...seams({ probed: '/main/harness', commonDir: '.git' }), log: (m: string) => logs.push(m) };
      const r = await resolveInstalledHarnessRoot({ ...s, registryPath });
      expect(r).toEqual({ status: 'ok', root: '/main/harness' });
      expect(logs.filter((l) => /registry/i.test(l) && /warn|disagree|not recorded/i.test(l))).toEqual([]);
    });
  });
});

describe('relinkSkillsForSelfBuild — Phase 2 skill-relink preflight (TR-4)', () => {
  it('self-build: relinks via `bin/install --update` and resolves (dispatch proceeds)', async () => {
    const { runner, calls } = makeRunner({ check: 0, update: 0 });
    await expect(
      relinkSkillsForSelfBuild({ harnessRoot: HARNESS, runner, log: () => {} }),
    ).resolves.toBeUndefined();
    // Relink is a proactive --update (link the merged skill set), NOT a --check.
    expect(calls).toEqual([['--update']]);
  });

  it('already fresh: --update is idempotent (still invoked, resolves)', async () => {
    // bin/install --update re-links identical targets — a no-op when fresh.
    const { runner, calls } = makeRunner({ check: 0, update: 0 });
    await relinkSkillsForSelfBuild({ harnessRoot: HARNESS, runner, log: () => {} });
    expect(calls).toEqual([['--update']]);
  });

  it('`bin/install --update` non-zero → InstallStaleError, build NOT dispatched', async () => {
    const { runner } = makeRunner({ check: 0, update: 3 });
    await expect(
      relinkSkillsForSelfBuild({ harnessRoot: HARNESS, runner, log: () => {} }),
    ).rejects.toBeInstanceOf(InstallStaleError);
  });

  it('null harness root → no relink attempt (runner never called), reports unresolved', async () => {
    const { runner, calls } = makeRunner({ check: 0, update: 0 });
    const logs: string[] = [];
    await expect(
      relinkSkillsForSelfBuild({ harnessRoot: null, runner, log: (m) => logs.push(m) }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]); // never linked against a null root
    expect(logs.join('\n')).toMatch(/unresolved|could not|skip/i);
  });

  // ── Installed-root resolution wiring (#363 / TR-3) ─────────────────────────
  // The preflight must never run `bin/install --update` at a root the resolver
  // rejects — a worktree-rooted relink is exactly the incident this guards.

  it('resolver rejects → throws InstallStaleError naming the rejected root; runner NEVER invoked', async () => {
    const { runner, calls } = makeRunner({ check: 0, update: 0 });
    const rejected: InstalledRootResolution = {
      status: 'rejected',
      reason: 'worktree-root',
      detail: 'resolved root /main/.worktrees/x still sits under .worktrees/',
    };
    const err = await relinkSkillsForSelfBuild({
      resolveInstalledRoot: async () => rejected,
      runner,
      log: () => {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(InstallStaleError);
    expect((err as Error).message).toContain('/main/.worktrees/x');
    expect(calls).toEqual([]); // installer never ran against the rejected root
  });

  it('resolver unresolved → logs and skips without throwing, zero runner calls (null-skip preserved)', async () => {
    const { runner, calls } = makeRunner({ check: 0, update: 0 });
    const logs: string[] = [];
    await expect(
      relinkSkillsForSelfBuild({
        resolveInstalledRoot: async () => ({ status: 'unresolved' }),
        runner,
        log: (m) => logs.push(m),
      }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]);
    expect(logs.join('\n')).toMatch(/unresolved|could not|skip/i);
  });

  it('resolver ok → runner invoked once with --update at the resolved root', async () => {
    const roots: string[] = [];
    const calls: string[][] = [];
    const runner: InstallRunner = async (args, harnessRoot) => {
      calls.push(args);
      roots.push(harnessRoot);
      return 0;
    };
    await expect(
      relinkSkillsForSelfBuild({
        resolveInstalledRoot: async () => ({ status: 'ok', root: '/installed/main' }),
        runner,
        log: () => {},
      }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([['--update']]);
    expect(roots).toEqual(['/installed/main']);
  });

  it('explicit harnessRoot string override behaves as ok (existing test seam preserved)', async () => {
    const roots: string[] = [];
    const runner: InstallRunner = async (_args, harnessRoot) => {
      roots.push(harnessRoot);
      return 0;
    };
    // harnessRoot set → the resolver seam must NOT be consulted.
    const resolveInstalledRoot = vi.fn(async (): Promise<InstalledRootResolution> => ({
      status: 'rejected',
      reason: 'should-not-be-called',
      detail: 'the explicit override wins',
    }));
    await expect(
      relinkSkillsForSelfBuild({
        harnessRoot: HARNESS,
        resolveInstalledRoot,
        runner,
        log: () => {},
      }),
    ).resolves.toBeUndefined();
    expect(resolveInstalledRoot).not.toHaveBeenCalled();
    expect(roots).toEqual([HARNESS]);
  });

  it('missing bin/install → keyed error naming the installer path (not opaque spawn error)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relink-noinstaller-'));
    try {
      // No runner injected → the real installer-existence check runs.
      const err = await relinkSkillsForSelfBuild({ harnessRoot: dir, log: () => {} }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(InstallStaleError);
      expect((err as Error).message).toContain(join(dir, 'bin', 'install'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('non-executable bin/install → keyed error naming the installer path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relink-noexec-'));
    try {
      await mkdir(join(dir, 'bin'), { recursive: true });
      const installer = join(dir, 'bin', 'install');
      await writeFile(installer, '#!/usr/bin/env bash\n');
      await chmod(installer, 0o644); // present but not executable
      const err = await relinkSkillsForSelfBuild({ harnessRoot: dir, log: () => {} }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(InstallStaleError);
      expect((err as Error).message).toContain(installer);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('dispatchDaemonSupervisor — start gates on install freshness', () => {
  function spySupervisor(): { supervisor: Supervisor; started: boolean[] } {
    const started: boolean[] = [];
    const supervisor = {
      start: vi.fn(async () => {
        started.push(true);
      }),
      stop: vi.fn(async () => {}),
      restart: vi.fn(async () => {}),
      attach: vi.fn(async () => {}),
    } as unknown as Supervisor;
    return { supervisor, started };
  }

  it('stale install → start returns 1 and the supervisor is NEVER started', async () => {
    const { supervisor, started } = spySupervisor();
    const out: string[] = [];
    const code = await dispatchDaemonSupervisor(
      { verb: 'start' },
      {
        supervisor,
        cwd: '/repo',
        out: (l) => out.push(l),
        ensureFresh: async () => {
          throw new InstallStaleError('stale!');
        },
      },
    );
    expect(code).toBe(1);
    expect(started).toEqual([]); // supervisor.start NOT reached
    expect(out.join('\n')).toContain('stale!');
  });

  it('fresh install → start launches the supervisor and returns 0', async () => {
    const { supervisor, started } = spySupervisor();
    const code = await dispatchDaemonSupervisor(
      { verb: 'start' },
      { supervisor, cwd: '/repo', out: () => {}, ensureFresh: async () => {} },
    );
    expect(code).toBe(0);
    expect(started).toEqual([true]);
  });
});
