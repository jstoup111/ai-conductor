// RED acceptance spec for conduct-state mutation ownership.
//
// Story-level seam:
//   TS-1 + TS-5 — a real Conductor run holds an in-memory snapshot while a
//   second production state client commits a disjoint field. The Conductor's
//   next transition must preserve both clients' changes in either order.
//
// The second client runs in-process through the production state-helper entry
// point because this race depends on write interleaving, not process identity;
// lease/process exclusivity itself is owned by plan Tasks 8-9's adapter tests.
// The injected sentinel failure stops the run immediately after the observed
// transition and lets Conductor.run() execute its real cleanup/error-write path.
//
// Per writing-system-tests section 3a, the remaining criteria are lower-layer
// store/adapter contracts owned by the plan's scoped TDD tests: atomic batches
// and conflicts (Tasks 4-6), atomic persistence and leases (Tasks 7-9), explicit
// replacement/reset (Tasks 10 and 17), dependency injection and error handling
// (Tasks 11-17), and the deterministic writer-bypass audit (Task 18).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
}));
vi.mock('../../src/engine/self-host/operator-credentials.js', () => ({
  readOperatorCredentialsState: vi.fn().mockResolvedValue('fresh'),
  waitForCredentialsChange: vi.fn(),
}));
vi.mock('../../src/engine/self-host/sandbox-build-env.js', () => ({
  provisionSandboxBuildEnv: vi.fn(),
  realSandboxFs: {},
  SandboxProvisionError: class SandboxProvisionError extends Error {},
}));
vi.mock('../../src/engine/rebase.js', async () => {
  const actual = await vi.importActual('../../src/engine/rebase.js');
  return {
    ...actual,
    performRebase: vi.fn().mockResolvedValue({ kind: 'noop' }),
  };
});

import type { ConductState, StepName } from '../../src/types/index.js';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import {
  readState,
  setComplexityTier,
  writeState,
} from '../../src/engine/state.js';

const EXPECTED_SENTINEL = 'acceptance sentinel: stop after concurrent state write';

describe('acceptance: conduct-state disjoint writers', () => {
  let projectRoot: string;
  let statePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'conduct-state-lost-update-'));
    statePath = join(projectRoot, '.pipeline', 'conduct-state.json');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function runInterleaving(
    externalWrite: 'before-conductor-transition' | 'after-conductor-transition',
  ): Promise<ConductState> {
    await writeState(statePath, {
      feature_desc: 'conduct-state-json-lost-update-conductor-s-whole-o',
      track: 'technical',
      complexity_tier: 'M',
      worktree: 'done',
      memory: 'done',
    });

    const runner: StepRunner = {
      run: vi.fn(async (step: StepName) => {
        expect(step).toBe('explore');
        if (externalWrite === 'before-conductor-transition') {
          await setComplexityTier(statePath, 'L');
        }
        throw new Error(EXPECTED_SENTINEL);
      }),
    };
    const events = new ConductorEventEmitter();
    const haltReasons: string[] = [];
    events.on('loop_halt', (event) => {
      if (event.type === 'loop_halt') haltReasons.push(event.reason);
    });

    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'explore',
      verifyArtifacts: false,
      maxRetries: 1,
    });

    await conductor.run();
    expect(haltReasons.join('\n')).toContain(EXPECTED_SENTINEL);

    if (externalWrite === 'after-conductor-transition') {
      await setComplexityTier(statePath, 'L');
    }

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    return result.value;
  }

  it.each([
    'before-conductor-transition',
    'after-conductor-transition',
  ] as const)(
    'preserves both disjoint changes when the external client commits %s',
    async (externalWrite) => {
      const finalState = await runInterleaving(externalWrite);

      expect(finalState.explore).toBe('in_progress');
      expect(finalState.complexity_tier).toBe('L');
    },
  );
});
