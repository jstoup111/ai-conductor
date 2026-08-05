// EMPIRICAL PROOF that the run-scoped TMPDIR redirect installed by
// globalSetup actually reaches the forked test workers (#1112).
//
// This is not a redundant restatement of global-setup.ts. The whole containment
// strategy rests on an assumption that is invisible in the source: vitest runs
// `globalSetup` in the main process, but every test file runs in a forked child
// (`pool: 'forks'`, vitest.config.ts). If `process.env.TMPDIR` mutated in
// globalSetup did NOT propagate into those children, the redirect would silently
// do nothing and the suite would keep filling the operator's real tmpfs while
// looking fixed. This file runs in a worker, so it observes the propagated
// value directly — if propagation ever breaks (a vitest pool change, an
// `env` override in the config), this fails instead of the leak returning.
import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { RUN_TMP_ROOT_ENV, RUN_TMP_ROOT_PREFIX } from './tmpdir-leak-guard.js';

describe('tmpdir redirect propagation into forked workers', () => {
  const runRoot = process.env[RUN_TMP_ROOT_ENV];

  it('exposes the run root to this worker process', () => {
    expect(runRoot).toBeDefined();
    expect(resolve(runRoot as string)).toContain(RUN_TMP_ROOT_PREFIX);
  });

  it('resolves os.tmpdir() to the run root, not the operator real tmpdir', () => {
    // The load-bearing assertion: os.tmpdir() reads TMPDIR at call time, so
    // this equality is what makes all ~1,426 unmodified `mkdtemp(join(
    // tmpdir(), …))` call sites land inside the run root.
    expect(resolve(tmpdir())).toBe(resolve(runRoot as string));
  });

  it('places a real mkdtemp call inside the run root', async () => {
    // Same shape as the canonical leaking call site (governor.test.ts) —
    // proving containment against the actual pattern, not just the env var.
    const dir = await mkdtemp(join(tmpdir(), 'tmpdir-propagation-probe-'));
    try {
      expect(resolve(dir).startsWith(resolve(runRoot as string))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe('git ceiling propagation', () => {
    it('keeps Git discovery inside the run root in this forked worker', async () => {
      // Git receives the worker's inherited environment. A new non-repository
      // directory below the ceiling must not search upward into this checkout.
      const fixture = await mkdtemp(join(tmpdir(), 'git-ceiling-propagation-probe-'));
      try {
        expect(process.env.GIT_CEILING_DIRECTORIES?.split(':')).toContain(runRoot);

        const result = await execa('git', ['rev-parse', '--show-toplevel'], {
          cwd: fixture,
          reject: false,
        });

        expect(result.exitCode).not.toBe(0);
      } finally {
        await rm(fixture, { recursive: true, force: true });
      }
    });
  });
});
