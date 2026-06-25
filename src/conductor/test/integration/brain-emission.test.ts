import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { makeRunFeature } from '../../src/engine/daemon-runner.js';
import type { FeatureRunnerDeps, FeatureWorktree, WorktreeOutcome } from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import type { LLMProvider, InvokeResult } from '../../src/execution/llm-provider.js';

// ───────────────────────────────────────────────────────────────────────────
// RED acceptance specs for daemon brain-signal EMISSION wired into the REAL
// `makeRunFeature` (Phase 9.1, FR-1/FR-5/FR-6/FR-7).
//
// Drives the REAL `makeRunFeature` over a real tmp brain dir (via
// `$AI_CONDUCTOR_BRAIN_DIR`) and real tmp worktree/project dirs. The ONLY mock
// is the LLM provider (the `done` narrative boundary). The runner does NOT emit
// today, so each assertion ("one signal line", "narrative on disk", "repo retro
// absent", "manual = no emission") fails on its behavioral assertion — RED.
//
// `makeRunFeature` will gain emission deps (provider + daemon-mode flag) wired
// after readOutcome, before teardown. Those deps are passed here through an
// EXTENDED deps object cast to FeatureRunnerDeps so the pre-implementation type
// still compiles; the production change makes the type explicit.
// ───────────────────────────────────────────────────────────────────────────

const ITEM: BacklogItem = { slug: 'feat-x', storiesPath: 's', planPath: 'p' };
const SIGNALS_LOG = 'signals.jsonl';

function makeProvider(narrative = '# Full Retro\n\nDetailed.'): LLMProvider & { calls: number } {
  const provider = {
    calls: 0,
    async invoke(): Promise<InvokeResult> {
      provider.calls += 1;
      return { success: true, output: narrative, exitCode: 0 };
    },
    async invokeInteractive(): Promise<void> {},
  };
  return provider;
}

async function readSignalLines(brainDir: string): Promise<string[]> {
  try {
    const raw = await readFile(join(brainDir, SIGNALS_LOG), 'utf-8');
    return raw.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

describe('integration/brain-emission — makeRunFeature emits on daemon completion', () => {
  let brainDir: string;
  let worktreePath: string;
  const savedEnv = process.env.AI_CONDUCTOR_BRAIN_DIR;

  beforeEach(async () => {
    brainDir = await mkdtemp(join(tmpdir(), 'brain-emit-test-'));
    worktreePath = await mkdtemp(join(tmpdir(), 'brain-emit-wt-'));
    process.env.AI_CONDUCTOR_BRAIN_DIR = brainDir;
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.AI_CONDUCTOR_BRAIN_DIR;
    else process.env.AI_CONDUCTOR_BRAIN_DIR = savedEnv;
    await rm(brainDir, { recursive: true, force: true });
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
  // emission-related deps (provider + daemon flag) ride along in an extended
  // object cast to the current type until the production type is widened.
  function deps(
    outcome: WorktreeOutcome,
    extra: { daemon?: boolean; provider?: LLMProvider; log?: (m: string) => void; wtPath?: string } = {},
  ): FeatureRunnerDeps {
    const wt = extra.wtPath ?? worktreePath;
    const base: FeatureRunnerDeps = {
      createWorktree: async () => {
        await seedEvents(wt);
        return { path: wt, branch: `feat/${ITEM.slug}` } as FeatureWorktree;
      },
      materializeSpecs: async () => {},
      runConductor: async () => {},
      readOutcome: async () => outcome,
      teardownWorktree: async () => {},
      markProcessed: async () => {},
      log: extra.log,
    };
    return {
      ...base,
      // Emission deps the production runner will consume (daemon-only emission,
      // injected provider for the `done` narrative). Cast keeps the
      // pre-implementation FeatureRunnerDeps type satisfied.
      daemon: extra.daemon ?? true,
      provider: extra.provider ?? makeProvider(),
      // Project key for the store (production sets this to basename(projectRoot),
      // never the worktree path — FR-9).
      project: 'test-project',
    } as unknown as FeatureRunnerDeps;
  }

  // ─── FR-1 (happy): daemon done → exactly one signal line ───────────────────

  it('daemon done → appends exactly one signal line (outcome=done)', async () => {
    const run = makeRunFeature(deps({ done: true, halted: false, prUrl: 'http://pr/1' }, { daemon: true }));
    const out = await run(ITEM);
    expect(out.status).toBe('done');
    const lines = await readSignalLines(brainDir);
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
    const lines = await readSignalLines(brainDir);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).outcome).toBe('halted');
  });

  // ─── FR-1 (negative): exactly one record per completion ────────────────────

  it('a single completion appends exactly one record (no duplicate)', async () => {
    const run = makeRunFeature(deps({ done: true, halted: false }, { daemon: true }));
    await run(ITEM);
    const lines = await readSignalLines(brainDir);
    expect(lines.length).toBe(1);
  });

  // ─── FR-1 (negative): manual run → zero emission ───────────────────────────

  it('manual run (daemon=false) → NO signal emitted to the brain store', async () => {
    // Control: an identical DAEMON run MUST emit exactly one line — this proves
    // the emission machinery is wired (and fails RED until it is), so the
    // "manual = 0 lines" assertion can't pass vacuously just because nothing
    // ever emits.
    const daemonRun = makeRunFeature(deps({ done: true, halted: false }, { daemon: true }));
    await daemonRun(ITEM);
    expect(await readSignalLines(brainDir)).toHaveLength(1);

    // Now the manual run, against a clean store, must emit nothing.
    await rm(join(brainDir, SIGNALS_LOG), { force: true });
    const manualRun = makeRunFeature(deps({ done: true, halted: false }, { daemon: false }));
    const out = await manualRun(ITEM);
    expect(out.status).toBe('done');
    expect(await readSignalLines(brainDir)).toHaveLength(0);
  });

  // ─── FR-5 (happy): done → full narrative in store, narrativeRef set ────────

  it('daemon done → full retro narrative written to the store, narrativeRef set', async () => {
    const provider = makeProvider('# Full Retro\n\nThe analysis.');
    const run = makeRunFeature(deps({ done: true, halted: false }, { daemon: true, provider }));
    await run(ITEM);
    expect(provider.calls).toBe(1);
    const lines = await readSignalLines(brainDir);
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.narrativeRef).toBeTruthy();
    const narrative = await readFile(join(brainDir, rec.narrativeRef), 'utf-8');
    expect(narrative).toContain('Full Retro');
  });

  // ─── FR-5/FR-7 (negative): repo .docs/retros stays untouched ───────────────

  it('daemon done → store narrative written, repo .docs/retros/ gets NO new file', async () => {
    const run = makeRunFeature(deps({ done: true, halted: false }, { daemon: true }));
    await run(ITEM);
    // Positive sentinel: the narrative landed in the STORE (fails RED until
    // emission exists) — so the "repo retro absent" check can't pass vacuously.
    const lines = await readSignalLines(brainDir);
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.narrativeRef).toBeTruthy();
    await expect(access(join(brainDir, rec.narrativeRef))).resolves.toBeUndefined();
    // And the repo's retros dir stays empty.
    let entries: string[] = [];
    try {
      entries = await readdir(join(worktreePath, '.docs', 'retros'));
    } catch {
      entries = [];
    }
    expect(entries).toEqual([]);
  });

  // ─── FR-6 (happy): halted → short halt narrative, no LLM call ──────────────

  it('daemon halted → short halt narrative (gate+reason), no LLM call', async () => {
    const provider = makeProvider();
    const run = makeRunFeature(deps({ done: false, halted: true, reason: 'kickback cap exceeded' }, { daemon: true, provider }));
    await run(ITEM);
    expect(provider.calls).toBe(0);
    const lines = await readSignalLines(brainDir);
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.narrativeRef).toBeTruthy();
    const narrative = await readFile(join(brainDir, rec.narrativeRef), 'utf-8');
    expect(narrative).toContain('kickback cap exceeded');
  });

  // ─── FR-7 (negative): manual run still writes repo .docs/retros ────────────

  it('manual run → repo retro behavior unchanged (writes .docs/retros/), no store emission', async () => {
    // Control: an identical DAEMON run MUST emit one signal line — proves the
    // emission machinery is wired (fails RED until it is) so the manual
    // "no emission" assertion can't pass vacuously.
    const daemonRun = makeRunFeature(deps({ done: true, halted: false }, { daemon: true }));
    await daemonRun(ITEM);
    expect(await readSignalLines(brainDir)).toHaveLength(1);
    await rm(join(brainDir, SIGNALS_LOG), { force: true });

    // Manual runs are daemon=false: the runner must NOT emit to the store, and
    // must NOT suppress the in-loop retro. We simulate the in-loop retro by
    // having runConductor drop a repo retro file (what the manual loop does),
    // then assert the store stays empty AND the repo retro survives.
    const base = deps({ done: true, halted: false }, { daemon: false });
    const run = makeRunFeature({
      ...base,
      runConductor: async (wt: FeatureWorktree) => {
        const retroDir = join(wt.path, '.docs', 'retros');
        await mkdir(retroDir, { recursive: true });
        await writeFile(join(retroDir, 'feat-x.md'), '# Manual retro', 'utf-8');
      },
    } as FeatureRunnerDeps);
    await run(ITEM);
    await expect(access(join(worktreePath, '.docs', 'retros', 'feat-x.md'))).resolves.toBeUndefined();
    expect(await readSignalLines(brainDir)).toHaveLength(0);
  });

  // ─── FR-5 (negative): tier-skipped done → signal, narrativeRef absent ──────

  it('tier-skipped done → signal emitted, narrativeRef ABSENT, no error', async () => {
    // A worktree whose events show the retro step was tier-skipped → the runner
    // must still emit the structured signal but produce NO narrative.
    const run = makeRunFeature(
      deps({ done: true, halted: false }, { daemon: true, provider: makeProvider() }),
    );
    // Mark the run as tier-skipped via a tier_skip event for the retro step.
    const tierSkippedDeps = {
      ...deps({ done: true, halted: false }, { daemon: true }),
      createWorktree: async () => {
        const pipelineDir = join(worktreePath, '.pipeline');
        await mkdir(pipelineDir, { recursive: true });
        await writeFile(
          join(pipelineDir, 'events.jsonl'),
          [
            JSON.stringify({ type: 'step_completed', step: 'build', status: 'done', ts: '2026-06-25T00:00:05.000Z' }),
            JSON.stringify({ type: 'tier_skip', step: 'retro', tier: 'S', ts: '2026-06-25T00:00:06.000Z' }),
          ].join('\n') + '\n',
          'utf-8',
        );
        return { path: worktreePath, branch: 'feat/feat-x' } as FeatureWorktree;
      },
    } as unknown as FeatureRunnerDeps;
    void run; // the configured-with-tier-skip deps drive this assertion
    const tierRun = makeRunFeature(tierSkippedDeps);
    const out = await tierRun(ITEM);
    expect(out.status).toBe('done');
    const lines = await readSignalLines(brainDir);
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.narrativeRef == null).toBe(true);
  });

  // ─── FR-10 (negative): unwritable store → swallowed, outcome unaffected ────

  it('unwritable brain dir → emission swallowed (logged), FeatureOutcome unaffected, feature completes', async () => {
    // Point the brain dir at a path under a regular FILE so writes fail hard.
    const blocker = join(worktreePath, 'blocker');
    await mkdir(worktreePath, { recursive: true });
    await writeFile(blocker, 'x', 'utf-8');
    process.env.AI_CONDUCTOR_BRAIN_DIR = join(blocker, 'brain');

    const logs: string[] = [];
    const run = makeRunFeature(
      deps({ done: true, halted: false, prUrl: 'http://pr/1' }, { daemon: true, log: (m) => logs.push(m) }),
    );
    const out = await run(ITEM);
    // Feature still ships unchanged.
    expect(out.status).toBe('done');
    expect(out.prUrl).toBe('http://pr/1');
    // No line was written (the store was unwritable)…
    expect(await readSignalLines(join(blocker, 'brain'))).toHaveLength(0);
    // …and the failure was LOGGED + swallowed. This sentinel only the emission
    // path can satisfy, so the test fails RED until best-effort emission exists.
    expect(logs.some((m) => /brain|signal|emit/i.test(m))).toBe(true);
  });
});
