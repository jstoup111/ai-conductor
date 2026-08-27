import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { makeRunFeature } from '../../src/engine/daemon-runner.js';
import type { FeatureRunnerDeps, FeatureWorktree, WorktreeOutcome } from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';

// ───────────────────────────────────────────────────────────────────────────
// Engineer-signal emission coverage wired into the real `makeRunFeature`.
//
// Drives the REAL `makeRunFeature` over a real tmp engineer dir (via
// `$AI_CONDUCTOR_ENGINEER_DIR`) and real tmp worktree/project dirs. The runner
// does NOT emit today, so each assertion ("one signal line", "no completion
// narrative", "manual = no emission") fails on its behavioral assertion — RED.
//
// `makeRunFeature` will gain emission deps (daemon-mode flag) wired
// after readOutcome, before teardown. Those deps are passed here through an
// EXTENDED deps object cast to FeatureRunnerDeps so the pre-implementation type
// still compiles; the production change makes the type explicit.
// ───────────────────────────────────────────────────────────────────────────

const ITEM: BacklogItem = { slug: 'feat-x' };
const SIGNALS_LOG = 'signals.jsonl';

async function readSignalLines(engineerDir: string): Promise<string[]> {
  try {
    const raw = await readFile(join(engineerDir, SIGNALS_LOG), 'utf-8');
    return raw.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

describe('integration/engineer-emission — makeRunFeature emits on daemon completion', () => {
  let engineerDir: string;
  let worktreePath: string;
  const savedEnv = process.env.AI_CONDUCTOR_ENGINEER_DIR;

  beforeEach(async () => {
    engineerDir = await mkdtemp(join(tmpdir(), 'engineer-emit-test-'));
    worktreePath = await mkdtemp(join(tmpdir(), 'engineer-emit-wt-'));
    process.env.AI_CONDUCTOR_ENGINEER_DIR = engineerDir;
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.AI_CONDUCTOR_ENGINEER_DIR;
    else process.env.AI_CONDUCTOR_ENGINEER_DIR = savedEnv;
    await rm(engineerDir, { recursive: true, force: true });
    await rm(worktreePath, { recursive: true, force: true });
  });

  // Seed the worktree the runner builds with a real `.pipeline/events.jsonl`
  // so signal assembly has real material.
  async function seedEvents(wtPath: string): Promise<void> {
    const pipelineDir = join(wtPath, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    const lines = [
      { type: 'step_started', step: 'build', index: 0, ts: '2026-06-25T00:00:00.000Z' },
      { type: 'step_completed', step: 'build', status: 'done', ts: '2026-06-25T00:00:05.000Z', tokenUsage: { input: 100, output: 50 } },
      { type: 'kickback', from: 'build', to: 'plan', count: 1, ts: '2026-06-25T00:00:02.000Z' },
    ];
    await writeFile(join(pipelineDir, 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  }

  // Build a runner deps object whose createWorktree returns a real on-disk
  // worktree (seeded with events) and whose readOutcome returns `outcome`. The
  // emission-related deps (daemon flag) ride along in an extended
  // object cast to the current type until the production type is widened.
  function deps(
    outcome: WorktreeOutcome,
    extra: { daemon?: boolean; log?: (m: string) => void; wtPath?: string } = {},
  ): FeatureRunnerDeps {
    const wt = extra.wtPath ?? worktreePath;
    const base: Omit<FeatureRunnerDeps, 'daemon' | 'project'> = {
      createWorktree: async () => {
        await seedEvents(wt);
        return { path: wt, branch: `feat/${ITEM.slug}` } as FeatureWorktree;
      },
      runConductor: async () => {},
      readOutcome: async () => outcome,
      shipmentEvidence: async (input) => ({
        kind: 'valid',
        slug: input.slug,
        pr: input.implementationPr,
        recordPath: `.docs/shipped/${input.slug}.md`,
        hash: 'fixture-hash',
        commit: input.candidateCommit,
      }),
      teardownWorktree: async () => {},
      markProcessed: async () => {},
      log: extra.log,
    };
    return {
      ...base,
      // Emission deps the production runner will consume. Cast keeps the
      // pre-implementation FeatureRunnerDeps type satisfied.
      daemon: extra.daemon ?? true,
      // Project key for the store (production sets this to basename(projectRoot),
      // never the worktree path — FR-9).
      project: 'test-project',
    } as unknown as FeatureRunnerDeps;
  }

  // ─── FR-1 (happy): daemon done → exactly one signal line ───────────────────

  it('daemon done → appends exactly one signal line (outcome=done)', async () => {
    const run = makeRunFeature(deps({ done: true, halted: false, finishChoice: 'pr', prUrl: 'http://pr/1' }, { daemon: true }));
    const out = await run(ITEM);
    expect(out.status).toBe('done');
    const lines = await readSignalLines(engineerDir);
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.outcome).toBe('done');
    expect(rec.feature).toBe('feat-x');
    // FR-9: the emitted project key comes from deps.project (basename of the
    // project root in production), NOT the worktree path (which would be
    // '.worktrees' for every project).
    expect(rec.project).toBe('test-project');
  });

  // ─── FR-1 (happy): daemon halted → one line, outcome=halted ────────────────

  it('daemon halted → appends one signal line (outcome=halted)', async () => {
    const run = makeRunFeature(deps({ done: false, halted: true, reason: 'kickback cap exceeded' }, { daemon: true }));
    const out = await run(ITEM);
    expect(out.status).toBe('halted');
    const lines = await readSignalLines(engineerDir);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).outcome).toBe('halted');
  });

  // ─── FR-1 (negative): exactly one record per completion ────────────────────

  it('a single completion appends exactly one record (no duplicate)', async () => {
    const run = makeRunFeature(deps({ done: true, halted: false, finishChoice: 'pr', prUrl: 'http://pr/1' }, { daemon: true }));
    await run(ITEM);
    const lines = await readSignalLines(engineerDir);
    expect(lines.length).toBe(1);
  });

  // ─── FR-1 (negative): manual run → zero emission ───────────────────────────

  it('manual run (daemon=false) → NO signal emitted to the engineer store', async () => {
    // Control: an identical DAEMON run MUST emit exactly one line — this proves
    // the emission machinery is wired (and fails RED until it is), so the
    // "manual = 0 lines" assertion can't pass vacuously just because nothing
    // ever emits.
    const daemonRun = makeRunFeature(deps({ done: true, halted: false, finishChoice: 'pr', prUrl: 'http://pr/1' }, { daemon: true }));
    await daemonRun(ITEM);
    expect(await readSignalLines(engineerDir)).toHaveLength(1);

    // Now the manual run, against a clean store, must emit nothing.
    await rm(join(engineerDir, SIGNALS_LOG), { force: true });
    const manualRun = makeRunFeature(deps({ done: true, halted: false, finishChoice: 'pr', prUrl: 'http://pr/1' }, { daemon: false }));
    const out = await manualRun(ITEM);
    expect(out.status).toBe('done');
    expect(await readSignalLines(engineerDir)).toHaveLength(0);
  });

  // ─── FR-5 (happy): done → structured signal, no narrativeRef ──────────────

  it('daemon done → structured signal written without narrativeRef', async () => {
    const run = makeRunFeature(deps({ done: true, halted: false, finishChoice: 'pr', prUrl: 'http://pr/1' }, { daemon: true }));
    await run(ITEM);
    const lines = await readSignalLines(engineerDir);
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.narrativeRef).toBeUndefined();
  });

  // ─── FR-6 (happy): halted → short halt narrative, no LLM call ──────────────

  it('daemon halted → short halt narrative (gate+reason), no LLM call', async () => {
    const run = makeRunFeature(deps({ done: false, halted: true, reason: 'kickback cap exceeded' }, { daemon: true }));
    await run(ITEM);
    const lines = await readSignalLines(engineerDir);
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.narrativeRef).toBeTruthy();
    const narrative = await readFile(join(engineerDir, rec.narrativeRef), 'utf-8');
    expect(narrative).toContain('kickback cap exceeded');
  });

  // ─── FR-10 (negative): unwritable store → swallowed, outcome unaffected ────

  it('unwritable engineer dir → emission swallowed (logged), FeatureOutcome unaffected, feature completes', async () => {
    // Point the engineer dir at a path under a regular FILE so writes fail hard.
    const blocker = join(worktreePath, 'blocker');
    await mkdir(worktreePath, { recursive: true });
    await writeFile(blocker, 'x', 'utf-8');
    process.env.AI_CONDUCTOR_ENGINEER_DIR = join(blocker, 'engineer');

    const logs: string[] = [];
    const run = makeRunFeature(
      deps(
        { done: true, halted: false, finishChoice: 'pr', prUrl: 'http://pr/1' },
        { daemon: true, log: (m) => logs.push(m) },
      ),
    );
    const out = await run(ITEM);
    // Feature still ships unchanged.
    expect(out.status).toBe('done');
    expect(out.prUrl).toBe('http://pr/1');
    // No line was written (the store was unwritable)…
    expect(await readSignalLines(join(blocker, 'engineer'))).toHaveLength(0);
    // …and the failure was LOGGED + swallowed. This sentinel only the emission
    // path can satisfy, so the test fails RED until best-effort emission exists.
    expect(logs.some((m) => /engineer|signal|emit/i.test(m))).toBe(true);
  });

  it('routes the engineer-signal persistence failure diagnostic through the feature-scoped logger', async () => {
    const blocker = join(worktreePath, 'feature-logger-blocker');
    await mkdir(worktreePath, { recursive: true });
    await writeFile(blocker, 'x', 'utf-8');
    process.env.AI_CONDUCTOR_ENGINEER_DIR = join(blocker, 'engineer');

    const featureLogs: string[] = [];
    const featureDeps = deps(
      { done: true, halted: false, finishChoice: 'pr', prUrl: 'http://pr/1' },
      { daemon: true },
    );
    featureDeps.beginFeatureRun = () => ({
      events: undefined as never,
      providerExecution: undefined as never,
      log: (message) => featureLogs.push(message),
      stop: () => {},
    });

    await makeRunFeature(featureDeps)(ITEM);

    expect(featureLogs).toContainEqual(expect.stringMatching(/engineer: signal emission failed/));
  });
});
