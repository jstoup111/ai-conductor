import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ConductState } from '../../src/types/index.js';
import {
  readState,
  writeState,
  saveStepStatus,
  getStepStatus,
  stepDone,
  stepSatisfied,
  setComplexityTier,
  markFeatureComplete,
  markDownstreamStale,
} from '../../src/engine/state.js';

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
      const state: ConductState = { worktree: 'done', brainstorm: 'skipped' };
      await writeState(statePath, state);
      const raw = await readFile(statePath, 'utf-8');
      // Should be valid JSON parseable by any standard parser
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(JSON.parse(raw)).toEqual(state);
    });
  });

  // --- saveStepStatus ---

  describe('saveStepStatus', () => {
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
      expect(getStepStatus(state, 'brainstorm')).toBe('pending');
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
      brainstorm: 'done',
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
      'worktree', 'memory', 'brainstorm', 'complexity', 'stories',
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
        brainstorm: 'done',
        complexity: 'pending',
        stories: 'failed',
        conflict_check: 'skipped',
        plan: 'done',
      };
      const result = markDownstreamStale(state, 'brainstorm', [...stepNames]);
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
      expect(result.brainstorm).toBe('done');
      expect(result.complexity).toBe('done');
      expect(result.stories).toBe('done');
    });
  });
});
