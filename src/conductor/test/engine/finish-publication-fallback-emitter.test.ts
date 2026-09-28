// Covers: task:5
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * AB-2 (FINISH class): the canonical emitter handed to the FINISH composition
 * must reach every guarded publication boundary, or warned operator fallback
 * (D9) rethrows before the operator attempt.
 */
const shipDraftInputs: Array<Record<string, unknown>> = [];
const advanceArgs: Array<Record<string, unknown>> = [];

afterEach(() => {
  shipDraftInputs.length = 0;
  advanceArgs.length = 0;
  vi.doUnmock('../../src/engine/ship-draft-pr.js');
  vi.doUnmock('../../src/engine/finish-publication.js');
  vi.resetModules();
});

async function loadWithMocks() {
  vi.resetModules();
  vi.doMock('../../src/engine/ship-draft-pr.js', async () => ({
    ...await vi.importActual('../../src/engine/ship-draft-pr.js'),
    createShipDraftPublicationDependencies: vi.fn(async (input: Record<string, unknown>) => {
      shipDraftInputs.push(input);
      return undefined;
    }),
  }));
  vi.doMock('../../src/engine/finish-publication.js', async () => ({
    ...await vi.importActual('../../src/engine/finish-publication.js'),
    advanceFinishPublication: vi.fn(async (args: Record<string, unknown>) => {
      advanceArgs.push(args);
      return { kind: 'complete' as const };
    }),
  }));
}

describe('FINISH publication threads the canonical event emitter', () => {
  it('coordinator passes events to provenance-derived operations and establishPr', async () => {
    await loadWithMocks();
    const { createProductionFinishPublicationCoordinator } = await import('../../src/engine/finish-publication-production.js');
    const root = await mkdtemp(join(tmpdir(), 'finish-emitter-'));
    try {
      const events = { emit: vi.fn(async () => {}) };
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
        baseBranch: 'main',
        git: async () => ({ stdout: '' }),
        gh: async () => ({ stdout: '' }),
        acquireInteractiveIntent: async () => 'pr',
        observeReleaseReadiness: async () => 'present',
        events,
      });
      await coordinator.advance({
        state: { feature_desc: 'feature', worktree_branch: 'feat/feature' },
        mode: 'interactive',
        daemon: false,
        dispatchJudgment: async () => ({ success: true }),
        emit: async () => {},
      });
      expect(shipDraftInputs.length).toBeGreaterThan(0);
      for (const input of shipDraftInputs) expect(input.events).toBe(events);
      expect(advanceArgs).toHaveLength(1);
      const effects = advanceArgs[0].effects as { establishPr: Record<string, unknown> };
      expect(effects.establishPr.events).toBe(events);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('presentation repair passes events to provenance-derived operations', async () => {
    await loadWithMocks();
    const { createProvenanceGuardedFinishPresentationRepair } = await import('../../src/engine/conductor.js');
    const events = { emit: vi.fn(async () => {}) };
    const repair = createProvenanceGuardedFinishPresentationRepair({
      projectRoot: '/fixture',
      git: async () => ({ stdout: '' }),
      gh: async () => ({ stdout: '' }),
      baseBranch: 'main',
      events,
    });
    await expect(repair({
      prUrl: 'https://github.com/acme/widget/pull/1',
      state: { feature_desc: 'feature', worktree_branch: 'feat/feature' },
    })).rejects.toThrow(/unavailable/);
    expect(shipDraftInputs).toHaveLength(1);
    expect(shipDraftInputs[0].events).toBe(events);
  });
});
