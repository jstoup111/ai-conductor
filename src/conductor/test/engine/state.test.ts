import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ConductState } from '../../src/types/index.js';
import type {
  ConductStateStore,
  NamedAtomicStateMutationBatch,
  PrivilegedStateCorrection,
  PrivilegedStateReplacement,
  StateMutation,
  StateMutationResult,
} from '../../src/engine/conduct-state-store.js';
import {
  readState,
  writeState,
  applyStateChanges,
  applyStateCorrection,
  replaceState,
  saveStepStatus,
  getStepStatus,
  stepDone,
  stepSatisfied,
  setComplexityTier,
  savePrUrl,
  markFeatureComplete,
  markDownstreamStale,
} from '../../src/engine/state.js';

class RecordingConductStateStore implements ConductStateStore<ConductState> {
  readonly calls: Array<
    | { kind: 'mutation'; mutation: StateMutation<ConductState> }
    | { kind: 'batch'; batch: NamedAtomicStateMutationBatch<ConductState> }
    | { kind: 'correction'; correction: PrivilegedStateCorrection<ConductState> }
    | { kind: 'replacement'; replacement: PrivilegedStateReplacement<ConductState> }
  > = [];

  constructor(private readonly result: StateMutationResult = { kind: 'applied' }) {}

  async apply(mutation: StateMutation<ConductState>): Promise<StateMutationResult> {
    this.calls.push({ kind: 'mutation', mutation });
    return this.result;
  }

  async applyBatch(batch: NamedAtomicStateMutationBatch<ConductState>): Promise<StateMutationResult> {
    this.calls.push({ kind: 'batch', batch });
    return this.result;
  }

  async applyCorrection(correction: PrivilegedStateCorrection<ConductState>): Promise<StateMutationResult> {
    this.calls.push({ kind: 'correction', correction });
    return this.result;
  }

  async replace(replacement: PrivilegedStateReplacement<ConductState>): Promise<StateMutationResult> {
    this.calls.push({ kind: 'replacement', replacement });
    return this.result;
  }
}

describe('engine/state', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'state-test-'));
    statePath = join(dir, 'conduct-state.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // --- readState ---

  describe('readState', () => {
    it('returns default empty state when file is missing', async () => {
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({});
      }
    });

    it('reads valid JSON state', async () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        last_step: 'memory',
      };
      await writeFile(statePath, JSON.stringify(state, null, 2));
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.worktree).toBe('done');
        expect(result.value.memory).toBe('done');
        expect(result.value.last_step).toBe('memory');
      }
    });

    it('returns error for corrupted JSON', async () => {
      await writeFile(statePath, '{not valid json!!!');
      const result = await readState(statePath);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('corrupted');
      }
    });

    it('returns error for empty file', async () => {
      await writeFile(statePath, '');
      const result = await readState(statePath);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('corrupted');
      }
    });
  });

  // --- writeState ---

  describe('writeState', () => {
    it('writes JSON with 2-space indent', async () => {
      const state: ConductState = { worktree: 'done', last_step: 'worktree' };
      await writeState(statePath, state);
      const raw = await readFile(statePath, 'utf-8');
      expect(raw).toBe(JSON.stringify(state, null, 2) + '\n');
    });

    it('round-trips correctly with readState', async () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'in_progress',
        complexity_tier: 'M',
        feature_desc: 'test feature',
      };
      await writeState(statePath, state);
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(state);
      }
    });

    it('output is readable by standard JSON parsers (backward compat)', async () => {
      const state: ConductState = { worktree: 'done', explore: 'skipped' };
      await writeState(statePath, state);
      const raw = await readFile(statePath, 'utf-8');
      // Should be valid JSON parseable by any standard parser
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(JSON.parse(raw)).toEqual(state);
    });

    it('overwrites the supplied fixture state without a pr_url-specific exception', async () => {
      await writeState(statePath, { pr_url: 'https://github.com/acme/repo/pull/1164' });
      await writeState(statePath, {});

      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({});
    });
  });

  describe('command state mutations', () => {
    it('submits only changed daemon-owned fields as one named mutation batch', async () => {
      const store = new RecordingConductStateStore();
      await applyStateChanges(
        statePath,
        { build: 'done', pr_url: 'https://github.com/acme/repo/pull/42' },
        { complexity_tier: 'M', track: 'technical', prd: 'skipped', feature_desc: 'demo' },
        'seed daemon feature state',
        store,
      );

      expect(store.calls).toEqual([{
        kind: 'batch',
        batch: {
          name: 'seed daemon feature state',
          mutations: [
            { field: 'complexity_tier', expected: undefined, intent: 'seed daemon feature state', next: 'M' },
            { field: 'track', expected: undefined, intent: 'seed daemon feature state', next: 'technical' },
            { field: 'prd', expected: undefined, intent: 'seed daemon feature state', next: 'skipped' },
            { field: 'feature_desc', expected: undefined, intent: 'seed daemon feature state', next: 'demo' },
          ],
        },
      }]);
    });

    it('returns the typed store failure instead of masking it as a state update', async () => {
      const failure: StateMutationResult = { kind: 'persistence', message: 'disk is read-only' };
      await expect(applyStateChanges(
        statePath,
        {},
        { complexity_tier: 'M' },
        'seed daemon feature state',
        new RecordingConductStateStore(failure),
      )).resolves.toEqual(failure);
    });

    it('uses the privileged replacement port for an explicit full clear', async () => {
      const store = new RecordingConductStateStore();
      await replaceState(statePath, {}, 'reset conductor state', store);
      expect(store.calls).toEqual([{
        kind: 'replacement',
        replacement: { intent: 'reset conductor state', next: {}, privileged: true },
      }]);
    });

    it('preserves a concurrent unrelated update while applying a corrective batch', async () => {
      const observed: ConductState = { feature_status: 'complete', finish: 'done' };
      await writeState(statePath, observed);
      await writeState(statePath, { ...observed, pr_url: 'https://github.com/acme/repo/pull/42' });

      await expect(applyStateCorrection(
        statePath,
        {
          name: 'recover incomplete feature state',
          deletions: [{
            field: 'feature_status',
            expected: 'complete',
            intent: 'clear incomplete feature completion',
          }],
          mutations: [{
            field: 'finish',
            expected: 'done',
            intent: 'restage failed verification step',
            next: 'pending',
          }],
          privileged: true,
        },
        undefined,
      )).resolves.toEqual({ kind: 'applied' });

      await expect(readState(statePath)).resolves.toEqual({
        ok: true,
        value: { finish: 'pending', pr_url: 'https://github.com/acme/repo/pull/42' },
      });
    });
  });

  // --- saveStepStatus ---

  describe('saveStepStatus', () => {
    it('submits a named atomic status and last-step batch with the observed prior values', async () => {
      await writeState(statePath, { worktree: 'done', last_step: 'worktree' });
      const store = new RecordingConductStateStore();

      await saveStepStatus(statePath, 'memory', 'done', store);

      expect(store.calls).toEqual([
        {
          kind: 'batch',
          batch: {
            name: 'save step status',
            mutations: [
              {
                field: 'memory',
                expected: undefined,
                intent: 'save memory step status',
                next: 'done',
              },
              {
                field: 'last_step',
                expected: 'worktree',
                intent: 'record last completed step',
                next: 'memory',
              },
            ],
          },
        },
      ]);
    });

    it('returns a typed store failure without reporting a successful status update', async () => {
      const failure: StateMutationResult = {
        kind: 'lease',
        message: 'state lease was not acquired',
      };
      const store = new RecordingConductStateStore(failure);

      await expect(saveStepStatus(statePath, 'worktree', 'done', store)).resolves.toEqual(failure);
    });

    it('creates file and saves step status', async () => {
      await saveStepStatus(statePath, 'worktree', 'done');
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.worktree).toBe('done');
        expect(result.value.last_step).toBe('worktree');
      }
    });

    it('updates existing state without losing other keys', async () => {
      await writeState(statePath, {
        worktree: 'done',
        feature_desc: 'my feature',
        last_step: 'worktree',
      });
      await saveStepStatus(statePath, 'memory', 'done');
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.worktree).toBe('done');
        expect(result.value.memory).toBe('done');
        expect(result.value.feature_desc).toBe('my feature');
        expect(result.value.last_step).toBe('memory');
      }
    });
  });

  // --- getStepStatus ---

  describe('getStepStatus', () => {
    it('returns step status when present', () => {
      const state: ConductState = { worktree: 'done', memory: 'failed' };
      expect(getStepStatus(state, 'worktree')).toBe('done');
      expect(getStepStatus(state, 'memory')).toBe('failed');
    });

    it('returns pending for unknown/missing steps', () => {
      const state: ConductState = {};
      expect(getStepStatus(state, 'stories')).toBe('pending');
    });
  });

  // --- stepDone ---

  describe('stepDone', () => {
    it('returns true for done', () => {
      expect(stepDone({ worktree: 'done' }, 'worktree')).toBe(true);
    });

    it('returns true for skipped', () => {
      expect(stepDone({ worktree: 'skipped' }, 'worktree')).toBe(true);
    });

    it('returns false for stale', () => {
      expect(stepDone({ worktree: 'stale' }, 'worktree')).toBe(false);
    });

    it('returns false for pending', () => {
      expect(stepDone({}, 'worktree')).toBe(false);
    });

    it('returns false for failed', () => {
      expect(stepDone({ worktree: 'failed' }, 'worktree')).toBe(false);
    });

    it('returns false for in_progress', () => {
      expect(stepDone({ worktree: 'in_progress' }, 'worktree')).toBe(false);
    });
  });

  // --- stepSatisfied ---

  describe('stepSatisfied', () => {
    it('returns true for done', () => {
      expect(stepSatisfied({ worktree: 'done' }, 'worktree')).toBe(true);
    });

    it('returns true for skipped', () => {
      expect(stepSatisfied({ worktree: 'skipped' }, 'worktree')).toBe(true);
    });

    it('returns true for stale (critical for gates)', () => {
      expect(stepSatisfied({ worktree: 'stale' }, 'worktree')).toBe(true);
    });

    it('returns false for pending', () => {
      expect(stepSatisfied({}, 'worktree')).toBe(false);
    });

    it('returns false for failed', () => {
      expect(stepSatisfied({ worktree: 'failed' }, 'worktree')).toBe(false);
    });

    it('returns false for in_progress', () => {
      expect(stepSatisfied({ worktree: 'in_progress' }, 'worktree')).toBe(false);
    });
  });

  // --- setComplexityTier ---

  describe('setComplexityTier', () => {
    it('submits individual mutations for complexity, PR URL, and feature completion', async () => {
      const store = new RecordingConductStateStore();

      await setComplexityTier(statePath, 'M', store);
      await savePrUrl(statePath, 'https://github.com/org/repo/pull/42', store);
      await markFeatureComplete(statePath, store);

      expect(store.calls).toEqual([
        {
          kind: 'mutation',
          mutation: {
            field: 'complexity_tier',
            expected: undefined,
            intent: 'store complexity tier',
            next: 'M',
          },
        },
        {
          kind: 'mutation',
          mutation: {
            field: 'pr_url',
            expected: undefined,
            intent: 'store pull request URL',
            next: 'https://github.com/org/repo/pull/42',
          },
        },
        {
          kind: 'mutation',
          mutation: {
            field: 'feature_status',
            expected: undefined,
            intent: 'mark feature complete',
            next: 'complete',
          },
        },
      ]);
    });

    it('stores tier in state', async () => {
      await writeState(statePath, { worktree: 'done' });
      await setComplexityTier(statePath, 'M');
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.complexity_tier).toBe('M');
        expect(result.value.worktree).toBe('done');
      }
    });
  });

  // --- markFeatureComplete ---

  describe('markFeatureComplete', () => {
    it('sets feature_status to complete', async () => {
      await writeState(statePath, { finish: 'done' });
      await markFeatureComplete(statePath);
      const result = await readState(statePath);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.feature_status).toBe('complete');
      }
    });
  });

  // --- markDownstreamStale ---

  describe('markDownstreamStale', () => {
    const allSteps: ConductState = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'done',
      manual_test: 'done',
      retro: 'done',
      finish: 'done',
    };

    const stepNames = [
      'worktree', 'memory', 'explore', 'complexity', 'stories',
      'conflict_check', 'plan', 'architecture_diagram', 'architecture_review',
      'acceptance_specs', 'build', 'manual_test', 'retro', 'finish',
    ] as const;

    it('marks all done steps after target as stale', () => {
      const result = markDownstreamStale(
        { ...allSteps },
        'plan',
        [...stepNames],
      );
      // Steps before and including plan: unchanged
      expect(result.worktree).toBe('done');
      expect(result.plan).toBe('done');
      // Steps after plan: stale
      expect(result.architecture_diagram).toBe('stale');
      expect(result.architecture_review).toBe('stale');
      expect(result.acceptance_specs).toBe('stale');
      expect(result.build).toBe('stale');
      expect(result.manual_test).toBe('stale');
      expect(result.retro).toBe('stale');
      expect(result.finish).toBe('stale');
    });

    it('does not change pending/failed/skipped steps', () => {
      const state: ConductState = {
        worktree: 'done',
        memory: 'done',
        explore: 'done',
        complexity: 'pending',
        stories: 'failed',
        conflict_check: 'skipped',
        plan: 'done',
      };
      const result = markDownstreamStale(state, 'explore', [...stepNames]);
      expect(result.complexity).toBe('pending');
      expect(result.stories).toBe('failed');
      expect(result.conflict_check).toBe('skipped');
      expect(result.plan).toBe('stale');
    });

    it('does not change steps before or at the target', () => {
      const result = markDownstreamStale(
        { ...allSteps },
        'stories',
        [...stepNames],
      );
      expect(result.worktree).toBe('done');
      expect(result.memory).toBe('done');
      expect(result.explore).toBe('done');
      expect(result.complexity).toBe('done');
      expect(result.stories).toBe('done');
    });
  });

  describe('migrateState (adr-2026-06-29-brainstorm-rename-migration: brainstorm → explore + prd)', () => {
    it('maps brainstorm:done to explore:done + prd:done on read', async () => {
      await writeFile(statePath, JSON.stringify({ brainstorm: 'done', complexity: 'done' }), 'utf-8');
      const r = await readState(statePath);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.explore).toBe('done');
      expect(r.value.prd).toBe('done');
    });

    it('maps brainstorm:skipped to explore + prd skipped', async () => {
      await writeFile(statePath, JSON.stringify({ brainstorm: 'skipped' }), 'utf-8');
      const r = await readState(statePath);
      if (!r.ok) return;
      expect(r.value.explore).toBe('skipped');
      expect(r.value.prd).toBe('skipped');
    });

    it('does NOT override explore/prd already present (idempotent)', async () => {
      await writeFile(
        statePath,
        JSON.stringify({ brainstorm: 'done', explore: 'stale', prd: 'skipped' }),
        'utf-8',
      );
      const r = await readState(statePath);
      if (!r.ok) return;
      expect(r.value.explore).toBe('stale');
      expect(r.value.prd).toBe('skipped');
    });

    it('no-op when there is no brainstorm key', async () => {
      await writeFile(statePath, JSON.stringify({ explore: 'done', prd: 'done' }), 'utf-8');
      const r = await readState(statePath);
      if (!r.ok) return;
      expect(r.value.explore).toBe('done');
      expect((r.value as Record<string, unknown>).brainstorm).toBeUndefined();
    });
  });
});
