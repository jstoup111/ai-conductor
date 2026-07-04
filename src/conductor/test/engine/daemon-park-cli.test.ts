import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectDaemonParkCommand,
  dispatchDaemonPark,
  validateSlug,
} from '../../src/engine/daemon-park-cli.js';
import { isOperatorParked } from '../../src/engine/park-marker.js';

describe('engine/daemon-park-cli', () => {
  let root: string;

  const makeWorktree = async (r: string, slug: string) => {
    await mkdir(join(r, '.worktrees', slug), { recursive: true });
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'daemon-park-cli-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('detectDaemonParkCommand', () => {
    const argv = (...rest: string[]) => ['node', 'conduct', ...rest];

    it('detects `daemon park <slug>`', () => {
      expect(detectDaemonParkCommand(argv('daemon', 'park', 'my-slug'))).toEqual({
        kind: 'park',
        slug: 'my-slug',
      });
    });

    it('detects `daemon unpark <slug>`', () => {
      expect(detectDaemonParkCommand(argv('daemon', 'unpark', 'my-slug'))).toEqual({
        kind: 'unpark',
        slug: 'my-slug',
      });
    });

    it('does not match a typo\'d sub-verb', () => {
      expect(detectDaemonParkCommand(argv('daemon', 'parkk', 'my-slug'))).toBeNull();
    });

    it('does not match unrelated daemon sub-verbs', () => {
      expect(detectDaemonParkCommand(argv('daemon', 'observe'))).toBeNull();
      expect(detectDaemonParkCommand(argv('daemon', 'status'))).toBeNull();
    });

    it('returns null when the slug is missing', () => {
      expect(detectDaemonParkCommand(argv('daemon', 'park'))).toBeNull();
    });
  });

  describe('dispatchDaemonPark', () => {
    it('park writes the marker and prints a confirmation naming the slug', async () => {
      await makeWorktree(root, 'feat-widgets');
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'feat-widgets' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'feat-widgets')).toBe(true);
      const joined = out.join('\n');
      expect(joined).toContain('feat-widgets');
      expect(joined.toLowerCase()).toContain(
        'will not be dispatched or re-kicked until unparked',
      );
    });

    it('park is idempotent — re-parking an already-parked slug does not throw', async () => {
      await makeWorktree(root, 'feat-widgets');
      const out: string[] = [];
      await dispatchDaemonPark({ kind: 'park', slug: 'feat-widgets' }, { cwd: root, out: () => {} });
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'feat-widgets' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'feat-widgets')).toBe(true);
    });

    it('unpark removes the marker and prints a confirmation', async () => {
      await makeWorktree(root, 'feat-widgets');
      await dispatchDaemonPark({ kind: 'park', slug: 'feat-widgets' }, { cwd: root, out: () => {} });
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'unpark', slug: 'feat-widgets' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'feat-widgets')).toBe(false);
      expect(out.join('\n')).toContain('feat-widgets');
    });

    it('unpark on a slug that was never parked is a graceful no-op', async () => {
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'unpark', slug: 'never-parked' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'never-parked')).toBe(false);
    });

    it('reports an error gracefully instead of throwing (e.g. unreadable/missing repo root)', async () => {
      const missingRoot = join(root, 'does-not-exist', 'nested', 'deeper');
      const out: string[] = [];
      // Even a nonexistent nested root should not throw — writeOperatorPark
      // creates the directory chain, so this should actually succeed; to
      // exercise the error path we simulate a failure by pointing at a path
      // that collides with a file (not a directory), which mkdir must reject.
      const { writeFile } = await import('node:fs/promises');
      const collidingFile = join(root, 'blocker');
      await writeFile(collidingFile, 'x');
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'my-slug' },
        { cwd: collidingFile, out: (l) => out.push(l) },
      );
      expect(code).toBe(1);
      expect(out.join('\n').length).toBeGreaterThan(0);
    });

    it('rejects an unknown slug (no plan, no worktree) — exit 1, no marker written', async () => {
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'totally-unknown-slug' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(1);
      expect(out.join('\n')).toContain('not found in plans/ or worktrees/');
      expect(await isOperatorParked(root, 'totally-unknown-slug')).toBe(false);
    });

    it('parks successfully when known by plan file only (no worktree)', async () => {
      await mkdir(join(root, '.docs', 'plans'), { recursive: true });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(root, '.docs', 'plans', 'plan-only-slug.md'), '# plan\n');
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'plan-only-slug' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'plan-only-slug')).toBe(true);
    });

    it('parks successfully when known by worktree dir only (no plan)', async () => {
      await makeWorktree(root, 'worktree-only-slug');
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'worktree-only-slug' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'worktree-only-slug')).toBe(true);
    });

    it('parks successfully on a fresh checkout with no .daemon/ dir yet', async () => {
      await makeWorktree(root, 'fresh-checkout-slug');
      // no .daemon/ directory has been created in this repo root
      const out: string[] = [];
      const code = await dispatchDaemonPark(
        { kind: 'park', slug: 'fresh-checkout-slug' },
        { cwd: root, out: (l) => out.push(l) },
      );
      expect(code).toBe(0);
      expect(await isOperatorParked(root, 'fresh-checkout-slug')).toBe(true);
    });
  });

  describe('validateSlug', () => {
    it('returns false when neither plan nor worktree exists', () => {
      expect(validateSlug('nope', root)).toBe(false);
    });

    it('returns true when only the plan file exists', async () => {
      await mkdir(join(root, '.docs', 'plans'), { recursive: true });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(root, '.docs', 'plans', 'p.md'), '# p\n');
      expect(validateSlug('p', root)).toBe(true);
    });

    it('returns true when only the worktree dir exists', async () => {
      await makeWorktree(root, 'w');
      expect(validateSlug('w', root)).toBe(true);
    });
  });
});
