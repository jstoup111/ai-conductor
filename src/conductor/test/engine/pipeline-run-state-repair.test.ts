import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fsPromises from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { seedTaskStatus } from '../../src/engine/task-seed.js';
import { resolveTaskIds } from '../../src/engine/task-progress.js';
import { checkAttributionMachineryIntact } from '../../src/engine/conductor.js';

/**
 * `.pipeline/` is gitignored and lives inside the worktree, so it is destroyed
 * whenever a worktree is removed or recreated from its branch (CLAUDE.md
 * "Daemon Operations Safety" rule 3, #497) — and it was observed missing
 * `task-status.json` outright mid-build while every task carried a `Task:`
 * trailer (#1102).
 *
 * These are integration tests over a REAL local git repository, because the
 * behavior under test is git-trailer semantics. No third-party service is
 * touched: no remote is configured and the only executable spawned is `git`.
 */
const PLAN = `# Plan

## Task 1: Extract the repair primitive
Touches \`src/one.ts\`

## Task 2: Wire it into the preflight
Touches \`src/two.ts\`

## Task 3: Not started yet
Touches \`src/three.ts\`
`;

/** Irreplaceable operator/gate state — repair must never fabricate any of these. */
const IRREPLACEABLE = [
  'HALT',
  'HALT.class',
  'HALT.cleared',
  'DONE',
  'QUARANTINE',
  'halt-user-input-required',
  'finish-choice',
  'version-approval',
  'conduct-state.json',
  'build-review.json',
  'test-suite-evidence.json',
  'manual-test-results.md',
  'prd-audit.md',
  'architecture-review-as-built.md',
  'protected-artifact-seal.json',
  'gates/build.json',
];

describe('.pipeline run-state repair', () => {
  let dir: string;
  let planPath: string;

  async function git(...args: string[]): Promise<void> {
    await execa('git', args, { cwd: dir });
  }

  /** Commit an empty change carrying `Task: <id>` as a real git trailer. */
  async function commitForTask(id: string, subject: string): Promise<string> {
    await git('commit', '--allow-empty', '-m', `${subject}\n\nTask: ${id}`);
    const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    return stdout.trim();
  }

  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(join(tmpdir(), 'pipeline-repair-'));
    await execa('git', ['init', '--initial-branch=main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');

    planPath = join(dir, '.docs/plans/2026-07-27-repair.md');
    await fsPromises.mkdir(join(dir, '.docs/plans'), { recursive: true });
    await fsPromises.writeFile(planPath, PLAN);
    await git('add', '-A');
    await git('commit', '-m', 'plan');
  });

  afterEach(async () => {
    await fsPromises.rm(dir, { recursive: true, force: true });
  });

  describe('reconstruction from an empty .pipeline/', () => {
    it('rebuilds task-status.json from the plan when the directory is empty', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(
        await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'),
      );
      expect(status.tasks.map((t: { id: string }) => t.id)).toEqual(['1', '2', '3']);
    });

    it('preserves completions proven by Task: trailers instead of resetting them to pending', async () => {
      const sha1 = await commitForTask('1', 'feat: extract the repair primitive');
      const sha2 = await commitForTask('T2', 'feat: wire it into the preflight');
      // Worktree recreated from the branch: .pipeline/ exists but is empty.
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(
        await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'),
      );
      const byId = new Map(status.tasks.map((t: Record<string, unknown>) => [t.id, t]));

      expect(byId.get('1')).toMatchObject({
        status: 'completed',
        commit: sha1,
        restored_from: 'task-trailer',
      });
      // A `Task: T2` trailer restores plan task `2` via the canonical-id alias.
      expect(byId.get('2')).toMatchObject({
        status: 'completed',
        commit: sha2,
        restored_from: 'task-trailer',
      });
      // Task 3 has no committed evidence — it must stay pending, not be granted.
      expect(byId.get('3')).toMatchObject({ status: 'pending' });
      expect(byId.get('3')).not.toHaveProperty('restored_from');
    });

    it('leaves finished work resolved for the build predicate after the wipe', async () => {
      await commitForTask('1', 'feat: one');
      await commitForTask('2', 'feat: two');
      await commitForTask('3', 'feat: three');
      await fsPromises.rm(join(dir, '.pipeline'), { recursive: true, force: true });

      await seedTaskStatus(dir, planPath);

      // Row-only readers (which do NOT consult the trailer union) now agree
      // that the finished tasks are done, so nothing re-dispatches them.
      const status = JSON.parse(
        await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'),
      );
      expect(status.tasks.every((t: { status: string }) => t.status === 'completed')).toBe(true);
      expect(await resolveTaskIds(dir, ['1', '2', '3'])).toEqual(new Set(['1', '2', '3']));
    });

    it('reconstructs when the file exists but is empty', async () => {
      const sha = await commitForTask('1', 'feat: one');
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.pipeline/task-status.json'), '');

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(
        await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'),
      );
      expect(status.tasks.find((t: { id: string }) => t.id === '1')).toMatchObject({
        status: 'completed',
        commit: sha,
      });
    });

    it('degrades to plain pending rows when there is no git evidence at all', async () => {
      const bare = await fsPromises.mkdtemp(join(tmpdir(), 'pipeline-repair-nogit-'));
      try {
        await fsPromises.mkdir(join(bare, '.docs/plans'), { recursive: true });
        const barePlan = join(bare, '.docs/plans/p.md');
        await fsPromises.writeFile(barePlan, PLAN);

        await seedTaskStatus(bare, barePlan);

        const status = JSON.parse(
          await fsPromises.readFile(join(bare, '.pipeline/task-status.json'), 'utf-8'),
        );
        expect(status.tasks).toHaveLength(3);
        expect(status.tasks.every((t: { status: string }) => t.status === 'pending')).toBe(true);
      } finally {
        await fsPromises.rm(bare, { recursive: true, force: true });
      }
    });
  });

  describe('scope limits — the repair grants nothing it was not asked to', () => {
    it('does not fabricate any irreplaceable operator or gate artifact', async () => {
      await commitForTask('1', 'feat: one');
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });

      await seedTaskStatus(dir, planPath);

      for (const artifact of IRREPLACEABLE) {
        expect(
          existsSync(join(dir, '.pipeline', artifact)),
          `repair must never create .pipeline/${artifact}`,
        ).toBe(false);
      }
    });

    it('does not backfill trailers onto an existing file whose rows are deliberately pending', async () => {
      await commitForTask('1', 'feat: one');
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', name: 'Extract the repair primitive', status: 'pending' }] }),
      );

      await seedTaskStatus(dir, planPath);

      const status = JSON.parse(
        await fsPromises.readFile(join(dir, '.pipeline/task-status.json'), 'utf-8'),
      );
      const task1 = status.tasks.find((t: { id: string }) => t.id === '1');
      expect(task1.status).toBe('pending');
      expect(task1).not.toHaveProperty('restored_from');
    });
  });

  describe('a repair that cannot write fails loudly (#1088 re-stat property)', () => {
    it('throws instead of reporting a silent success when the write cannot land', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline/task-status.json'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.pipeline/task-status.json/blocker'), 'x');

      await expect(seedTaskStatus(dir, planPath)).rejects.toThrow();
    });

    it('surfaces an unusable task-status.json as a build-preflight halt reason', async () => {
      // A path that is not a regular parseable file must not satisfy the
      // preflight recheck just because it exists.
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await fsPromises.writeFile(join(dir, '.pipeline/task-status.json'), 'truncated{');

      const issue = await checkAttributionMachineryIntact(dir, {
        planResolvable: true,
        ensureHooks: async () => ({ repaired: [], failed: [] }),
      });

      expect(issue).toMatch(/could not restore \.pipeline\/task-status\.json/);
    });

    it('passes the preflight recheck once the file is a real parseable rows file', async () => {
      await fsPromises.mkdir(join(dir, '.pipeline'), { recursive: true });
      await seedTaskStatus(dir, planPath);
      // Session hooks are out of scope here (#1088 covers them); place real
      // executable stubs so this assertion isolates the task-status recheck.
      const hooksDir = join(dir, '.pipeline/session-hooks');
      await fsPromises.mkdir(hooksDir, { recursive: true });
      for (const hook of ['pre-dispatch.sh', 'post-dispatch.sh', 'mutation-gate.sh']) {
        await fsPromises.writeFile(join(hooksDir, hook), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      }

      const issue = await checkAttributionMachineryIntact(dir, {
        planResolvable: true,
        ensureHooks: async () => ({ repaired: [], failed: [] }),
      });

      expect(issue).toBeNull();
    });
  });
});
