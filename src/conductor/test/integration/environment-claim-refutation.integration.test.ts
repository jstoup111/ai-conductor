/**
 * Integration spec for #1106: a self-build dispatch that halts on a claimed
 * environmental blocker the engine can disprove must NOT be accepted.
 *
 * The seam under test is the conductor's self-host candidate-safety wrapper —
 * the one place that already surrounds every resolved candidate and holds both
 * the dispatch facts (which provider ran, whether it is fenced) and the
 * dispatch's own output. A refuted claim has to come back as a FAILED attempt
 * so the conductor's existing retry path carries the disproof forward, rather
 * than the fabricated blocker parking finished work.
 *
 * The provider boundary is a scripted fake: no CLI, no network.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ENVIRONMENT_CLAIM_REFUTED } from '../../src/engine/self-host/environment-claim-audit.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import type { InvokeResult } from '../../src/execution/llm-provider.js';
import type { StepRunner } from '../../src/engine/conductor.js';

/** The verbatim finish HALT from `.daemon/daemon.log` (#1106). */
const FABRICATED_HALT: InvokeResult = {
  success: true,
  exitCode: 0,
  output: [
    '**HALT — Environment sandbox prevents finish completion.**',
    '',
    '- ✅ Tests: 9207 passed, 5 skipped (aggregate suite PASS)',
    '- ✅ Git status: Clean working tree',
    '',
    "**Blocker:** The environment's write-fence sandbox blocks both `git push` and `gh pr` operations.",
    '',
    'Human review required.',
  ].join('\n'),
};

const HONEST_FINISH: InvokeResult = {
  success: true,
  exitCode: 0,
  output: 'Pushed the branch and recorded the finish choice via finish-record.',
};

type SafetyWrapper = (
  candidate: { step: StepName; providerKey: string; model: string; effort: 'low' },
  state: ConductState,
  sandboxEnabled: boolean,
  invoke: () => Promise<InvokeResult>,
) => Promise<InvokeResult>;

function selfBuildConductor(projectRoot: string): Conductor {
  const stepRunner: StepRunner = { run: async () => ({ success: true }) };
  return new Conductor({
    stateFilePath: join(projectRoot, 'conduct-state.json'),
    stepRunner,
    events: new ConductorEventEmitter(),
    projectRoot,
    mode: 'auto',
    daemon: true,
    selfHost: true,
  });
}

async function dispatchThroughSafety(
  conductor: Conductor,
  providerKey: string,
  result: InvokeResult,
): Promise<InvokeResult> {
  const wrapper = (conductor as unknown as { withSelfHostCandidateSafety: SafetyWrapper })
    .withSelfHostCandidateSafety.bind(conductor);
  return wrapper(
    { step: 'finish', providerKey, model: 'haiku', effort: 'low' },
    { feature_desc: 'environment-claim-refutation' } as ConductState,
    true,
    async () => result,
  );
}

describe('self-host dispatch refuses a disprovable environmental blocker (#1106)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'environment-claim-1106-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('fails the claude attempt and returns the disproof as its reason', async () => {
    const result = await dispatchThroughSafety(selfBuildConductor(projectRoot), 'claude', FABRICATED_HALT);

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain(ENVIRONMENT_CLAIM_REFUTED);
    expect(result.output).toContain('git push');
    // The original dispatch text is preserved beneath the refutation so the
    // operator can still read what the step actually said.
    expect(result.output).toContain('Human review required.');
  });

  it('passes an honest finish through untouched', async () => {
    const result = await dispatchThroughSafety(selfBuildConductor(projectRoot), 'claude', HONEST_FINISH);

    expect(result).toEqual(HONEST_FINISH);
  });

  it('does not second-guess the sandboxed codex provider', async () => {
    const result = await dispatchThroughSafety(selfBuildConductor(projectRoot), 'codex', FABRICATED_HALT);

    expect(result).toEqual(FABRICATED_HALT);
  });
});
