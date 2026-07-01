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

import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ensureInstallFresh,
  relinkSkillsForSelfBuild,
  InstallStaleError,
  type InstallRunner,
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
