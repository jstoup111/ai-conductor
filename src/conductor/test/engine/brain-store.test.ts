import { describe, it, expect, beforeEach, afterEach, assert } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import type { FeatureOutcome } from '../../src/engine/daemon.js';
import type { LLMProvider, InvokeResult } from '../../src/execution/llm-provider.js';

// ───────────────────────────────────────────────────────────────────────────
// RED acceptance specs for the not-yet-built brain-store module (Phase 9.1).
//
// `src/engine/brain-store.ts` does NOT exist yet. Each test dynamically imports
// the module and the symbol it needs INSIDE the test body, so a missing module
// or missing export surfaces as that test's own failure (RED) rather than a
// whole-file collection crash that skips every test. Every assertion encodes a
// behavior from `.docs/stories/phase-9.1-retro-signal-brain-memory.md`; until
// the module is implemented each fails on its behavioral assertion.
//
// Real fs throughout (a tmp brain dir via `$AI_CONDUCTOR_BRAIN_DIR`, a tmp
// project dir). The ONLY mock is the LLM provider (third-party boundary) used
// for the `done` narrative.
// ───────────────────────────────────────────────────────────────────────────

const MODULE = '../../src/engine/brain-store.js';

// Load the brain-store module; on failure (module/symbol absent) we let the
// rejection propagate so the test fails with a descriptive reason naming the
// missing surface. Tests that assert on emitted files therefore fail at the
// behavioral assertion once the module exists but mis-behaves, and fail with
// "module not implemented" while it does not — both are right-reason RED for a
// pre-implementation module.
async function loadBrainStore(): Promise<Record<string, unknown>> {
  try {
    return (await import(/* @vite-ignore */ MODULE)) as unknown as Record<string, unknown>;
  } catch (err) {
    // The module is not implemented yet. Surface this as a per-test ASSERTION
    // failure (not a collection crash) so each test fails RED on a behavioral
    // statement naming the missing contract, and every test still runs.
    assert.fail(
      `src/engine/brain-store.ts is not implemented yet — expected it to export ` +
        `resolveBrainDir/assembleSignal/serializeSignal/appendSignal/produceNarrative/` +
        `writeNarrative/emitBrainSignal (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  expect(typeof fn, `brain-store must export ${name}()`).toBe('function');
  return fn as (...args: any[]) => any;
}

// A scriptable fake provider: records the prompt it was invoked with and
// returns a canned narrative. Lets us assert the `done` path calls the LLM and
// the `halted`/tier-skip paths do NOT.
function makeProvider(narrative = '# Retro\n\nWent fine.'): LLMProvider & { calls: number } {
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

const SIGNALS_LOG = 'signals.jsonl';

async function readSignalLines(brainDir: string): Promise<string[]> {
  const raw = await readFile(join(brainDir, SIGNALS_LOG), 'utf-8');
  return raw.split('\n').map((l) => l.trim()).filter(Boolean);
}

describe('engine/brain-store', () => {
  let brainDir: string;
  let projectDir: string;
  const savedEnv = process.env.AI_CONDUCTOR_BRAIN_DIR;

  beforeEach(async () => {
    brainDir = await mkdtemp(join(tmpdir(), 'brain-store-test-'));
    projectDir = await mkdtemp(join(tmpdir(), 'brain-project-test-'));
    process.env.AI_CONDUCTOR_BRAIN_DIR = brainDir;
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.AI_CONDUCTOR_BRAIN_DIR;
    else process.env.AI_CONDUCTOR_BRAIN_DIR = savedEnv;
    await rm(brainDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  // Write a representative feature events.jsonl with kickbacks, a halt, retries,
  // token spend, and step durations so assembly has real material to aggregate.
  async function writeEvents(dir: string): Promise<string> {
    const lines = [
      { type: 'step_started', step: 'build', index: 0, ts: '2026-06-25T00:00:00.000Z' },
      { type: 'step_completed', step: 'build', status: 'done', ts: '2026-06-25T00:00:05.000Z', tokenUsage: { input: 100, output: 50, cacheRead: 10, cacheCreation: 5 } },
      { type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'flaky test', ts: '2026-06-25T00:00:02.000Z' },
      { type: 'kickback', from: 'build', to: 'plan', evidence: 'plan gap', count: 1, ts: '2026-06-25T00:00:03.000Z' },
      { type: 'loop_halt', reason: 'kickback cap exceeded', ts: '2026-06-25T00:00:06.000Z' },
    ];
    const eventsPath = join(dir, 'events.jsonl');
    await writeFile(eventsPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
    return eventsPath;
  }

  // ─── FR-2: location, override, creation, outside-the-repo ──────────────────

  describe('FR-2: resolveBrainDir — path, override, auto-create', () => {
    it('defaults to ~/.ai-conductor/brain when no override is set', async () => {
      const mod = await loadBrainStore();
      const resolveBrainDir = requireFn(mod, 'resolveBrainDir');
      const resolved = resolveBrainDir({ home: '/home/someone', env: {} });
      expect(resolved).toBe(join('/home/someone', '.ai-conductor', 'brain'));
    });

    it('honors the $AI_CONDUCTOR_BRAIN_DIR override', async () => {
      const mod = await loadBrainStore();
      const resolveBrainDir = requireFn(mod, 'resolveBrainDir');
      const resolved = resolveBrainDir({
        home: '/home/someone',
        env: { AI_CONDUCTOR_BRAIN_DIR: brainDir },
      });
      expect(resolved).toBe(brainDir);
    });

    it('resolves a path OUTSIDE the project root in all cases', async () => {
      const mod = await loadBrainStore();
      const resolveBrainDir = requireFn(mod, 'resolveBrainDir');
      const defaultResolved = resolveBrainDir({ home: homedir(), env: {} });
      const overrideResolved = resolveBrainDir({ home: homedir(), env: { AI_CONDUCTOR_BRAIN_DIR: brainDir } });
      expect(defaultResolved.startsWith(projectDir)).toBe(false);
      expect(overrideResolved.startsWith(projectDir)).toBe(false);
    });

    it('auto-creates the brain dir when it does not exist (via appendSignal)', async () => {
      const mod = await loadBrainStore();
      const appendSignal = requireFn(mod, 'appendSignal');
      const fresh = join(brainDir, 'nested', 'created');
      await appendSignal(fresh, { schemaVersion: 1, ts: 't', project: 'p', feature: 'f', runId: 'r', outcome: 'done', kickbacks: [], halts: [], retryHotspots: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, durationByStep: {} });
      await expect(access(join(fresh, SIGNALS_LOG))).resolves.toBeUndefined();
    });
  });

  // ─── FR-3: the record schema ───────────────────────────────────────────────

  describe('FR-3: BrainSignal schema + serialization', () => {
    it('serializes to ONE valid JSON line carrying every schema field', async () => {
      const mod = await loadBrainStore();
      const serializeSignal = requireFn(mod, 'serializeSignal');
      const sig = {
        schemaVersion: 1,
        ts: '2026-06-25T00:00:00.000Z',
        project: 'proj',
        feature: 'feat-x',
        runId: 'run-1',
        outcome: 'done',
        kickbacks: [{ from: 'build', to: 'plan', count: 1 }],
        halts: [],
        retryHotspots: [{ step: 'build', count: 1, topReason: 'flaky test' }],
        tokens: { input: 100, output: 50, cacheRead: 10, cacheCreation: 5 },
        durationByStep: { build: 5000 },
        narrativeRef: 'narratives/proj/feat-x-run-1.md',
      };
      const line = serializeSignal(sig);
      expect(line).not.toContain('\n');
      const parsed = JSON.parse(line);
      for (const key of ['schemaVersion', 'ts', 'project', 'feature', 'runId', 'outcome', 'kickbacks', 'halts', 'retryHotspots', 'tokens', 'durationByStep']) {
        expect(parsed).toHaveProperty(key);
      }
      expect(parsed.schemaVersion).toBeGreaterThanOrEqual(1);
      expect(parsed.tokens).toMatchObject({ input: 100, output: 50, cacheRead: 10, cacheCreation: 5 });
    });

    it('serializes empty kickbacks/halts/retries as [] (not missing/null)', async () => {
      const mod = await loadBrainStore();
      const serializeSignal = requireFn(mod, 'serializeSignal');
      const sig = {
        schemaVersion: 1,
        ts: 't',
        project: 'proj',
        feature: 'feat-y',
        runId: 'run-1',
        outcome: 'done',
        kickbacks: [],
        halts: [],
        retryHotspots: [],
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        durationByStep: {},
      };
      const parsed = JSON.parse(serializeSignal(sig));
      expect(parsed.kickbacks).toEqual([]);
      expect(parsed.halts).toEqual([]);
      expect(parsed.retryHotspots).toEqual([]);
    });

    it('makes narrativeRef OPTIONAL — record still valid when absent', async () => {
      const mod = await loadBrainStore();
      const serializeSignal = requireFn(mod, 'serializeSignal');
      const sig = {
        schemaVersion: 1,
        ts: 't',
        project: 'proj',
        feature: 'feat-z',
        runId: 'run-1',
        outcome: 'done',
        kickbacks: [],
        halts: [],
        retryHotspots: [],
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        durationByStep: {},
      };
      const parsed = JSON.parse(serializeSignal(sig));
      expect(parsed.narrativeRef == null).toBe(true);
    });
  });

  // ─── FR-4 / FR-9: assemble from existing sources ───────────────────────────

  describe('FR-4: assembleSignal from events.jsonl + FeatureOutcome', () => {
    const outcome: FeatureOutcome = { slug: 'feat-x', status: 'halted', reason: 'kickback cap exceeded', costTokens: 50 };

    it('populates kickbacks/halts/retryHotspots/tokens/durationByStep from events + outcome', async () => {
      const mod = await loadBrainStore();
      const assembleSignal = requireFn(mod, 'assembleSignal');
      const eventsPath = await writeEvents(projectDir);
      const sig = await assembleSignal({ eventsPath, outcome, project: 'proj', feature: 'feat-x', runId: 'run-1' });
      expect(sig.outcome).toBe('halted');
      expect(Array.isArray(sig.kickbacks)).toBe(true);
      expect(sig.kickbacks.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(sig.halts)).toBe(true);
      expect(sig.halts.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(sig.retryHotspots)).toBe(true);
      expect(sig.retryHotspots.length).toBeGreaterThanOrEqual(1);
      expect(sig.tokens.input).toBeGreaterThanOrEqual(100);
      expect(sig.durationByStep.build).toBe(5000);
    });

    it('produces a record (no throw) when events.jsonl is MISSING', async () => {
      const mod = await loadBrainStore();
      const assembleSignal = requireFn(mod, 'assembleSignal');
      const missing = join(projectDir, 'does-not-exist.jsonl');
      const sig = await assembleSignal({ eventsPath: missing, outcome: { slug: 'feat-x', status: 'done' }, project: 'proj', feature: 'feat-x', runId: 'run-1' });
      expect(sig.outcome).toBe('done');
      expect(sig.kickbacks).toEqual([]);
      expect(sig.halts).toEqual([]);
      expect(sig.retryHotspots).toEqual([]);
    });

    it('produces a record (no throw) when events.jsonl is EMPTY', async () => {
      const mod = await loadBrainStore();
      const assembleSignal = requireFn(mod, 'assembleSignal');
      const empty = join(projectDir, 'empty.jsonl');
      await writeFile(empty, '', 'utf-8');
      const sig = await assembleSignal({ eventsPath: empty, outcome: { slug: 'feat-x', status: 'done' }, project: 'proj', feature: 'feat-x', runId: 'run-1' });
      expect(sig.kickbacks).toEqual([]);
      expect(sig.durationByStep).toEqual({});
    });

    it('skips MALFORMED lines and aggregates the rest (resilient parse)', async () => {
      const mod = await loadBrainStore();
      const assembleSignal = requireFn(mod, 'assembleSignal');
      const path = join(projectDir, 'malformed.jsonl');
      await writeFile(
        path,
        [
          '{ this is not json',
          JSON.stringify({ type: 'kickback', from: 'build', to: 'plan', count: 1, ts: '2026-06-25T00:00:01.000Z' }),
          'also broken }}}',
        ].join('\n') + '\n',
        'utf-8',
      );
      const sig = await assembleSignal({ eventsPath: path, outcome: { slug: 'feat-x', status: 'done' }, project: 'proj', feature: 'feat-x', runId: 'run-1' });
      expect(sig.kickbacks.length).toBe(1);
    });
  });

  // ─── FR-9: stored fields support cross-feature rate metrics ────────────────

  describe('FR-9: rates computable from stored fields', () => {
    it('lets a reader compute kickback/halt/retry rates from fixture records', async () => {
      const mod = await loadBrainStore();
      const assembleSignal = requireFn(mod, 'assembleSignal');
      const withSignals = await writeEvents(projectDir);
      const cleanPath = join(projectDir, 'clean.jsonl');
      await writeFile(cleanPath, JSON.stringify({ type: 'step_completed', step: 'build', status: 'done', ts: '2026-06-25T00:00:01.000Z' }) + '\n', 'utf-8');

      const a = await assembleSignal({ eventsPath: withSignals, outcome: { slug: 'a', status: 'halted' }, project: 'proj', feature: 'a', runId: 'r1' });
      const b = await assembleSignal({ eventsPath: cleanPath, outcome: { slug: 'b', status: 'done' }, project: 'proj', feature: 'b', runId: 'r1' });

      const records = [a, b];
      const haltRate = records.filter((r) => r.outcome === 'halted').length / records.length;
      const kickbackRate = records.filter((r) => r.kickbacks.length > 0).length / records.length;
      const retryRate = records.filter((r) => r.retryHotspots.length > 0).length / records.length;
      expect(haltRate).toBe(0.5);
      expect(kickbackRate).toBe(0.5);
      expect(retryRate).toBe(0.5);
    });

    it('keeps distinct features distinct per project/feature key (no collision)', async () => {
      const mod = await loadBrainStore();
      const assembleSignal = requireFn(mod, 'assembleSignal');
      const eventsPath = await writeEvents(projectDir);
      const p1 = await assembleSignal({ eventsPath, outcome: { slug: 'x', status: 'done' }, project: 'projA', feature: 'feat-x', runId: 'r1' });
      const p2 = await assembleSignal({ eventsPath, outcome: { slug: 'x', status: 'done' }, project: 'projB', feature: 'feat-x', runId: 'r1' });
      const key = (r: { project: string; feature: string }) => `${r.project}/${r.feature}`;
      expect(key(p1)).not.toBe(key(p2));
    });
  });

  // ─── FR-5 / FR-6: narratives ───────────────────────────────────────────────

  describe('FR-5/FR-6: produceNarrative + writeNarrative', () => {
    it('done → full retro narrative via the LLM provider, narrativeRef set', async () => {
      const mod = await loadBrainStore();
      const produceNarrative = requireFn(mod, 'produceNarrative');
      const writeNarrative = requireFn(mod, 'writeNarrative');
      const provider = makeProvider('# Full Retro\n\nDetailed analysis.');

      const text = await produceNarrative({
        outcome: { slug: 'feat-x', status: 'done' },
        project: 'proj',
        feature: 'feat-x',
        runId: 'run-1',
        worktreePath: projectDir,
        provider,
        tierSkippedRetro: false,
      });
      expect(provider.calls).toBe(1);
      expect(text).toContain('Retro');

      const ref = await writeNarrative(brainDir, 'proj', 'feat-x', 'run-1', text as string);
      expect(ref).toContain('feat-x-run-1.md');
      const onDisk = await readFile(join(brainDir, 'narratives', 'proj', 'feat-x-run-1.md'), 'utf-8');
      expect(onDisk).toContain('Full Retro');
    });

    it('tier-skipped done → NO narrative (no LLM call, returns absent)', async () => {
      const mod = await loadBrainStore();
      const produceNarrative = requireFn(mod, 'produceNarrative');
      const provider = makeProvider();
      const text = await produceNarrative({
        outcome: { slug: 'feat-x', status: 'done' },
        project: 'proj',
        feature: 'feat-x',
        runId: 'run-1',
        worktreePath: projectDir,
        provider,
        tierSkippedRetro: true,
      });
      expect(provider.calls).toBe(0);
      expect(text == null).toBe(true);
    });

    it('halted → SHORT halt narrative (gate+reason), no LLM call', async () => {
      const mod = await loadBrainStore();
      const produceNarrative = requireFn(mod, 'produceNarrative');
      const provider = makeProvider();
      const text = await produceNarrative({
        outcome: { slug: 'feat-x', status: 'halted', reason: 'kickback cap exceeded' },
        project: 'proj',
        feature: 'feat-x',
        runId: 'run-1',
        worktreePath: projectDir,
        provider,
        tierSkippedRetro: false,
      });
      expect(provider.calls).toBe(0);
      expect(text).toContain('kickback cap exceeded');
    });

    it('halt with NO reason → "reason unavailable" note, no throw', async () => {
      const mod = await loadBrainStore();
      const produceNarrative = requireFn(mod, 'produceNarrative');
      const provider = makeProvider();
      const text = await produceNarrative({
        outcome: { slug: 'feat-x', status: 'halted' },
        project: 'proj',
        feature: 'feat-x',
        runId: 'run-1',
        worktreePath: projectDir,
        provider,
        tierSkippedRetro: false,
      });
      expect((text ?? '').toLowerCase()).toContain('reason unavailable');
    });
  });

  // ─── FR-8: re-run retains history (run-id keyed) ───────────────────────────

  describe('FR-8: re-run retains history (run-id keyed)', () => {
    it('a second emission appends a new record with a new runId, first retained', async () => {
      const mod = await loadBrainStore();
      const appendSignal = requireFn(mod, 'appendSignal');
      const base = { schemaVersion: 1, ts: 't', project: 'proj', feature: 'feat-x', outcome: 'done', kickbacks: [], halts: [], retryHotspots: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, durationByStep: {} };
      await appendSignal(brainDir, { ...base, runId: 'run-1' });
      await appendSignal(brainDir, { ...base, runId: 'run-2' });
      const lines = await readSignalLines(brainDir);
      expect(lines.length).toBe(2);
      const runIds = lines.map((l) => JSON.parse(l).runId);
      expect(new Set(runIds)).toEqual(new Set(['run-1', 'run-2']));
    });

    it('writes narratives keyed by runId so a re-run does not overwrite the prior', async () => {
      const mod = await loadBrainStore();
      const writeNarrative = requireFn(mod, 'writeNarrative');
      await writeNarrative(brainDir, 'proj', 'feat-x', 'run-1', '# Run 1');
      await writeNarrative(brainDir, 'proj', 'feat-x', 'run-2', '# Run 2');
      const first = await readFile(join(brainDir, 'narratives', 'proj', 'feat-x-run-1.md'), 'utf-8');
      const second = await readFile(join(brainDir, 'narratives', 'proj', 'feat-x-run-2.md'), 'utf-8');
      expect(first).toContain('Run 1');
      expect(second).toContain('Run 2');
    });
  });

  // ─── FR-10: best-effort (never breaks a ship) ──────────────────────────────

  describe('FR-10: emitBrainSignal is best-effort', () => {
    async function emitArgs(extra: Record<string, unknown> = {}) {
      const eventsPath = await writeEvents(projectDir);
      return {
        eventsPath,
        outcome: { slug: 'feat-x', status: 'done' } as FeatureOutcome,
        project: 'proj',
        feature: 'feat-x',
        runId: 'run-1',
        worktreePath: projectDir,
        provider: makeProvider(),
        tierSkippedRetro: false,
        ...extra,
      };
    }

    it('writable store → signal line + narrative written', async () => {
      const mod = await loadBrainStore();
      const emitBrainSignal = requireFn(mod, 'emitBrainSignal');
      await emitBrainSignal(await emitArgs({ brainDir }));
      const lines = await readSignalLines(brainDir);
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]).feature).toBe('feat-x');
    });

    it('UNWRITABLE brain dir → error logged + swallowed, NO throw', async () => {
      const mod = await loadBrainStore();
      const emitBrainSignal = requireFn(mod, 'emitBrainSignal');
      const logs: string[] = [];
      // Point at a path under a regular FILE so any mkdir/append fails hard.
      const blocker = join(projectDir, 'blocker-file');
      await writeFile(blocker, 'x', 'utf-8');
      const unwritable = join(blocker, 'brain');
      await expect(
        emitBrainSignal(await emitArgs({ brainDir: unwritable, log: (m: string) => logs.push(m) })),
      ).resolves.toBeUndefined();
      expect(logs.some((m) => /brain|signal|emit/i.test(m))).toBe(true);
    });

    it('partial failure (narrative fails, signal ok) → logged, no throw', async () => {
      const mod = await loadBrainStore();
      const emitBrainSignal = requireFn(mod, 'emitBrainSignal');
      const throwingProvider: LLMProvider = {
        async invoke(): Promise<InvokeResult> {
          throw new Error('provider boom');
        },
        async invokeInteractive(): Promise<void> {},
      };
      await expect(
        emitBrainSignal(await emitArgs({ brainDir, provider: throwingProvider })),
      ).resolves.toBeUndefined();
      // The signal line is best-effort independent of the narrative failure.
      const lines = await readSignalLines(brainDir);
      expect(lines.length).toBe(1);
    });
  });

  // ─── FR-11: append-safe under concurrency ──────────────────────────────────

  describe('FR-11: appendSignal is concurrency-safe', () => {
    it('N concurrent appends → exactly N intact, individually-parseable lines', async () => {
      const mod = await loadBrainStore();
      const appendSignal = requireFn(mod, 'appendSignal');
      const N = 12;
      const base = { schemaVersion: 1, ts: 't', project: 'proj', feature: 'feat', outcome: 'done', kickbacks: [], halts: [], retryHotspots: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, durationByStep: {} };
      await Promise.all(
        Array.from({ length: N }, (_, i) => appendSignal(brainDir, { ...base, runId: `run-${i}` })),
      );
      const lines = await readSignalLines(brainDir);
      expect(lines.length).toBe(N);
      // Every line must independently parse — no torn/merged records.
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
      const runIds = lines.map((l) => JSON.parse(l).runId);
      expect(new Set(runIds).size).toBe(N);
    });
  });
});
