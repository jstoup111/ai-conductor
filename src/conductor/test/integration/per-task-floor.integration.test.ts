/**
 * Acceptance spec for `.docs/stories/per-task-work-happened-floor.md` (Task 5
 * of `.docs/plans/per-task-work-happened-floor.md`) — the deterministic,
 * non-blocking "did work happen at all" advisory computed inside the
 * `build_review` step (jstoup111/ai-conductor#781, follow-up to #773).
 *
 * WHY ACCEPTANCE-LEVEL (not unit): the story's completion claim only holds if
 * the floor is actually WIRED into `DefaultStepRunner.run('build_review', ...)`
 * — the real production entry point the daemon build loop invokes — not just
 * that a standalone `runPerTaskCommitFloor` function computes the right
 * report in isolation (that pure-function behavior, including the fail-soft
 * git/plan-error branches, is unit-covered by
 * `test/engine/per-task-commit-floor.test.ts`, written under `/tdd`). A test
 * that calls the new module directly cannot observe whether `runBuildReview`
 * actually calls it, writes `.pipeline/per-task-floor.json`, or prepends the
 * advisory lines to the step's output — only a real `DefaultStepRunner.run()`
 * pass (the same entry point `build-review-plan-resolution.test.ts` drives)
 * proves the wiring.
 *
 * PRE-IMPLEMENTATION (RED): none of `per-task-commit-floor.ts`'s wiring into
 * `step-runners.ts`, the `build_review.perTaskFloor` config field, or the
 * `.pipeline/per-task-floor.json` artifact exist yet. Every test below must
 * fail for that reason (no artifact written / no advisory line emitted),
 * never for a syntax or setup error.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import type { LLMProvider, InvokeOptions, InvokeResult } from '../../src/execution/llm-provider.js';
import type { ConductState } from '../../src/types/index.js';
import type { HarnessConfig } from '../../src/types/config.js';

const execFileAsync = promisify(execFile);
const FLOOR_ARTIFACT_RELATIVE = '.pipeline/per-task-floor.json';

interface PlanTaskSpec {
  id: string;
  title: string;
  verifyOnly?: boolean;
  type?: string;
}

interface FloorReport {
  satisfied: boolean;
  gaps: string[];
  coveredTasks: string[];
  markedTasks: string[];
  skipNotes: string[];
}

function planBody(tasks: PlanTaskSpec[]): string {
  return tasks
    .map((t) => {
      let block = `## Task ${t.id} — ${t.title}\n\n**Files:** src/${t.id}.ts\n`;
      if (t.verifyOnly) block += `**Verify-only:** yes\n`;
      if (t.type) block += `**Type:** ${t.type}\n`;
      return block;
    })
    .join('\n');
}

/** Canned provider that always reports the grader as PASS — the floor's
 * wiring must never change this outcome (non-blocking disposition). */
function passingProvider(): { provider: LLMProvider; invokeCalls: InvokeOptions[] } {
  const invokeCalls: InvokeOptions[] = [];
  const provider: LLMProvider = {
    invoke: async (opts: InvokeOptions): Promise<InvokeResult> => {
      invokeCalls.push(opts);
      return { success: true, output: 'PASS', exitCode: 0 };
    },
    invokeInteractive: async (): Promise<void> => {},
  };
  return { provider, invokeCalls };
}

describe('acceptance: per-task "work happened at all" floor wired into build_review (#781)', () => {
  let dir: string;

  function realGit(): GitRunner {
    return async (args: string[]) => {
      try {
        const { stdout, stderr } = await execFileAsync('git', ['-C', dir, ...args]);
        return { exitCode: 0, stdout, stderr };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
      }
    };
  }

  async function git(...args: string[]): Promise<void> {
    await execFileAsync('git', ['-C', dir, ...args]);
  }

  /** Base repo with an origin/main ref, matching listCommitsWithTrailers'
   * merge-base-derivation convention (mirrors build-review-plan-resolution.test.ts). */
  async function initRepo(): Promise<void> {
    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(dir, 'base.txt'), 'base\n');
    await git('add', '.');
    await git('commit', '-m', 'base');
    await git('update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    await git('checkout', '-b', 'feature/per-task-floor');
  }

  /** Commit a trivial file change carrying the given Task: trailer (or no
   * trailer at all, for the folded-work no-wedge fixture). */
  async function commitWithTrailer(fileName: string, taskTrailer: string | null): Promise<void> {
    await writeFile(join(dir, fileName), `${fileName} content\n`);
    await git('add', fileName);
    const message = taskTrailer ? `feat: ${fileName}\n\nTask: ${taskTrailer}` : `feat: ${fileName}`;
    await git('commit', '-m', message);
  }

  async function writePlan(slug: string, tasks: PlanTaskSpec[]): Promise<void> {
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await writeFile(
      join(dir, '.docs', 'plans', `${slug}.md`),
      `# Implementation Plan: ${slug}\n\n${planBody(tasks)}`,
      'utf-8',
    );
  }

  function makeRunner(featureDesc: string, config?: HarnessConfig) {
    const { provider, invokeCalls } = passingProvider();
    const runner = new DefaultStepRunner(provider, 'session-1', dir, {
      featureDesc,
      gitRunner: realGit(),
      modelOverride: 'fable',
      config: (config ?? { model_fallback_ladder: ['fable'] }) as HarnessConfig,
    });
    return { runner, invokeCalls };
  }

  async function readFloorArtifact(): Promise<FloorReport | null> {
    try {
      const raw = await readFile(join(dir, FLOOR_ARTIFACT_RELATIVE), 'utf-8');
      return JSON.parse(raw) as FloorReport;
    } catch {
      return null;
    }
  }

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  // ── Story 1 — zero-commit unmarked task is surfaced before ship ──────────
  it('flags an uncovered, unmarked task as a gap, writes the artifact, and emits a WARNING advisory before ship', async () => {
    dir = await mkdtemp(join(tmpdir(), 'per-task-floor-s1-'));
    await initRepo();
    const slug = 'per-task-floor-s1';
    await writePlan(slug, [
      { id: '1', title: 'First' },
      { id: '2', title: 'Second' },
      { id: '3', title: 'Third (never committed)' },
    ]);
    await commitWithTrailer('t1.txt', '1');
    await commitWithTrailer('t2.txt', '2');

    const { runner, invokeCalls } = makeRunner(slug);
    const result = await runner.run('build_review', { feature_desc: slug } as ConductState);

    // Non-blocking: the grader still dispatched and PASSed normally.
    expect(invokeCalls.length).toBeGreaterThan(0);
    expect(result.success).toBe(true);

    // The advisory line names the uncovered task and appears in the step's
    // own output (surfaced before ship), not injected into the grader prompt.
    expect(result.output ?? '').toMatch(
      /Advisory: task 3 produced no commit carrying its Task: trailer and no verify-only\/skip marker/,
    );
    const graderPrompt = invokeCalls[0]?.prompt ?? '';
    expect(graderPrompt).not.toMatch(/Advisory: task 3/);

    const report = await readFloorArtifact();
    expect(report).not.toBeNull();
    expect(report?.satisfied).toBe(false);
    expect(report?.gaps).toEqual(['3']);
  });

  // ── Story 2 — every task covered by a trailer: floor is silent ──────────
  it('is silent (satisfied, no advisory) when every planned task has a trailered commit', async () => {
    dir = await mkdtemp(join(tmpdir(), 'per-task-floor-s2-'));
    await initRepo();
    const slug = 'per-task-floor-s2';
    await writePlan(slug, [
      { id: '1', title: 'First' },
      { id: '2', title: 'Second' },
    ]);
    // Written with the T-prefixed grammar to prove canonicalTaskId folding.
    await commitWithTrailer('t1.txt', 'T1');
    await commitWithTrailer('t2.txt', '2');

    const { runner } = makeRunner(slug);
    const result = await runner.run('build_review', { feature_desc: slug } as ConductState);

    expect(result.success).toBe(true);
    expect(result.output ?? '').not.toMatch(/Advisory:/);

    const report = await readFloorArtifact();
    expect(report).not.toBeNull();
    expect(report?.satisfied).toBe(true);
    expect(report?.gaps).toEqual([]);
  });

  // ── Story 3 — verify-only / skipped task does NOT trip the floor ────────
  it('does not flag a **Verify-only:** marked task or a task-status "skipped" row', async () => {
    dir = await mkdtemp(join(tmpdir(), 'per-task-floor-s3-'));
    await initRepo();
    const slug = 'per-task-floor-s3';
    await writePlan(slug, [
      { id: '1', title: 'First' },
      { id: '4', title: 'Verify-only', verifyOnly: true },
      { id: '5', title: 'Skipped in status' },
    ]);
    await commitWithTrailer('t1.txt', '1');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '5', status: 'skipped' }] }),
    );

    const { runner } = makeRunner(slug);
    const result = await runner.run('build_review', { feature_desc: slug } as ConductState);

    expect(result.success).toBe(true);
    expect(result.output ?? '').not.toMatch(/Advisory:/);

    const report = await readFloorArtifact();
    expect(report).not.toBeNull();
    expect(report?.satisfied).toBe(true);
    expect(report?.gaps).toEqual([]);
    expect(report?.markedTasks.sort()).toEqual(['4', '5']);
  });

  // ── Story 4 — folded-work task is flagged but NEVER wedges (#773) ───────
  it('flags a folded-work task as an advisory gap without blocking the step (#773 no-wedge guarantee)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'per-task-floor-s4-'));
    await initRepo();
    const slug = 'per-task-floor-s4';
    await writePlan(slug, [
      { id: '6', title: 'Folded into task 7 commit' },
      { id: '7', title: 'Carries the only trailer' },
    ]);
    // Reproduces the real #773 shape: a single commit trailered `Task: 7`
    // only — task 6's paired work folded in with no `Task: 6` trailer.
    await commitWithTrailer('t7.txt', '7');

    const { runner, invokeCalls } = makeRunner(slug);
    const result = await runner.run('build_review', { feature_desc: slug } as ConductState);

    // The step is NOT blocked: the grader still dispatched and PASSed —
    // proving determinism without a false halt.
    expect(invokeCalls.length).toBeGreaterThan(0);
    expect(result.success).toBe(true);
    expect(result.output ?? '').toMatch(
      /confirm its work shipped inside another task's commit or add a \*\*Verify-only:\*\* marker/,
    );

    const report = await readFloorArtifact();
    expect(report).not.toBeNull();
    expect(report?.gaps).toEqual(['6']);
    expect(report?.satisfied).toBe(false);
  });

  // ── Story 5 — fail-soft: a malformed task-status.json never fails the step ──
  it('never fails or throws the build_review step when task-status.json is malformed (fail-soft)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'per-task-floor-s5-'));
    await initRepo();
    const slug = 'per-task-floor-s5';
    await writePlan(slug, [{ id: '1', title: 'First' }]);
    await commitWithTrailer('t1.txt', '1');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline', 'task-status.json'), '{ not valid json');

    const { runner } = makeRunner(slug);
    await expect(
      runner.run('build_review', { feature_desc: slug } as ConductState),
    ).resolves.toMatchObject({ success: true });
  });

  // ── Story 6 — kill-switch disables emission entirely ────────────────────
  it('emits nothing and writes no artifact when build_review.perTaskFloor is false, even with a real gap', async () => {
    dir = await mkdtemp(join(tmpdir(), 'per-task-floor-s6-'));
    await initRepo();
    const slug = 'per-task-floor-s6';
    await writePlan(slug, [
      { id: '1', title: 'First' },
      { id: '2', title: 'Never committed' },
    ]);
    await commitWithTrailer('t1.txt', '1');

    const { runner } = makeRunner(slug, {
      model_fallback_ladder: ['fable'],
      build_review: { perTaskFloor: false },
    } as HarnessConfig);
    const result = await runner.run('build_review', { feature_desc: slug } as ConductState);

    expect(result.success).toBe(true);
    expect(result.output ?? '').not.toMatch(/Advisory:/);
    const report = await readFloorArtifact();
    expect(report).toBeNull();
  });
});
