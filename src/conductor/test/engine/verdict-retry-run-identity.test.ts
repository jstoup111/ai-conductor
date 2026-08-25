import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
}));
vi.mock('../../src/engine/gate-code-validity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/gate-code-validity.js')>();
  return { ...actual, verdictProducedByRun: vi.fn(actual.verdictProducedByRun) };
});

import { verdictProducedByRun } from '../../src/engine/gate-code-validity.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { PRD_AUDIT_CODE_STAMP } from '../../src/engine/artifacts.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState } from '../../src/types/index.js';

/**
 * D4 (adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity): every
 * reader of a verdict artifact consults the SAME identity helper with THIS
 * dispatch's run identity. The retry-input classifier runs after the loop has
 * cleared its in-flight dispatch fields, so a reader that reaches for the live
 * field there scores a stamped verdict `unstamped` and silently drops back to
 * mtime — the per-reader freshness convention this ADR removed.
 */
describe('verdict retry-input identity reader', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'verdict-run-identity-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
    vi.mocked(verdictProducedByRun).mockClear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('classifies retry inputs with the dispatch identity, not a cleared field', async () => {
    const seedResult = await readState(statePath);
    const seed = (seedResult.ok ? seedResult.value : {}) as Record<string, unknown>;
    for (const step of ALL_STEPS) {
      seed[step.name] = step.name === 'prd_audit' ? 'pending' : 'skipped';
      if (step.name === 'prd_audit') break;
      seed[step.name] = 'done';
    }
    seed.prd_audit = 'pending';
    seed.architecture_review_as_built = 'skipped';
    seed.retro = 'skipped';
    seed.rebase = 'skipped';
    seed.finish = 'done';
    await writeState(statePath, seed as ConductState);
    await mkdir(join(dir, '.pipeline'), { recursive: true });

    // Settles without writing the verdict report: the handshake scores the
    // dispatch `absent` and the retry-input classifier runs on the same lap.
    const runner: StepRunner = { run: async () => ({ success: true }) };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'prd_audit',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
      maxRetries: 1,
    });

    await conductor.run();

    const stamped = JSON.parse(
      await readFile(join(dir, PRD_AUDIT_CODE_STAMP), 'utf8'),
    ) as { runId?: string };
    const expectedRunIds = vi
      .mocked(verdictProducedByRun)
      .mock.calls.filter(([, step]) => step === 'prd_audit')
      .map(([, , runId]) => runId);

    expect(stamped.runId).toMatch(/\S/);
    // Both readers on this lap — the post-dispatch handshake and the
    // retry-input classifier — see the stamped dispatch identity.
    expect(expectedRunIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(expectedRunIds)).toEqual(new Set([stamped.runId]));
  });
});
