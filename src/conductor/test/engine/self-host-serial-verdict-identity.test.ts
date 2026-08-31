/**
 * A SHIP-tail verdict gate dispatched SERIALLY on a self-host daemon build.
 *
 * The validation group mints one run identity per member unconditionally
 * (`conductor.ts` dispatchGroupRound), but the serial single-step path mints
 * one only when `dispatchIdentityArmed`, which excludes every BUILD/SHIP step
 * of a self-host daemon build. That exclusion predates the post-dispatch
 * write handshake (#1891), which REQUIRES the identity whenever gate code
 * validity is enabled.
 *
 * A resumed feature whose only remaining group member is a verdict gate takes
 * the serial path, so no identity is minted, the sidecar keeps a prior lap's
 * id, and the handshake rejects a verdict the provider genuinely just wrote:
 *
 *   warning: post-dispatch verdict write handshake could not verify
 *   .pipeline/architecture-review-as-built-code-stamp.json for
 *   architecture_review_as_built; expected run id none; found run id unstamped
 *
 * Every retry reproduces the identical condition, so the step burns its whole
 * retry budget and halts with the verdict discarded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('execa', () => ({
  execa: vi.fn(() => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })),
}));

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { CLAUDE_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP } from '../../src/engine/artifacts.js';
import type { ConductState } from '../../src/types/index.js';

/** A prior lap's identity, left in the sidecar exactly as a resume finds it. */
const PRIOR_RUN_ID = '137b5120-0672-4ca9-98fb-1144003f9efc';

/** Everything resolved except the one remaining group member. */
const AS_BUILT_ONLY: ConductState = {
  worktree: 'done', memory: 'done', explore: 'done', complexity: 'done',
  stories: 'done', conflict_check: 'done', plan: 'done', architecture_diagram: 'done',
  architecture_review: 'done', acceptance_specs: 'done', test_suite: 'done',
  build: 'done', build_review: 'done', manual_test: 'skipped', prd_audit: 'done',
  architecture_review_as_built: 'pending', rebase: 'skipped', finish: 'done',
  complexity_tier: 'M', track: 'technical',
  feature_desc: 'serial-verdict-run-identity',
} as ConductState;

const AS_BUILT_REPORT = [
  '# As-Built Architecture Review: serial-verdict-run-identity',
  '**Mode:** as-built (SHIP compliance gate)',
  'Verdict: PASS',
  '',
  '## Production Reachability',
  '',
  '- All changed primitives are reachable from a production root.',
  '',
  '## Drift Notes',
  '',
  '- No drift.',
  '',
].join('\n');

describe('self-host serial SHIP verdict dispatch', () => {
  let projectRoot: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'serial-verdict-identity-'));
    statePath = join(projectRoot, 'conduct-state.json');
    events = new ConductorEventEmitter();
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    // A resume finds the sidecar carrying the identity of the lap that last
    // stamped it. Nothing clears it, so it is the handshake's only candidate.
    await writeFile(
      join(projectRoot, ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP),
      JSON.stringify({ runId: PRIOR_RUN_ID }),
    );
    await writeState(statePath, AS_BUILT_ONLY);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
  });

  function harness() {
    const runtimes = new ProviderRuntimeSet([{
      key: 'claude',
      provider: { invoke: vi.fn() },
      policy: CLAUDE_MODEL_POLICY,
      builtIn: true,
      availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
    }] as never);
    const providerExecution: ProviderExecutionContext = {
      runtimes,
      sessions: {} as never,
      configuredProviders: ['claude'],
    };
    const runIds: (string | undefined)[] = [];
    const logs: string[] = [];
    const runner: StepRunner = {
      run: async (_step, _state, options) => {
        runIds.push((options as { runId?: string } | undefined)?.runId);
        await writeFile(
          join(projectRoot, '.pipeline/architecture-review-as-built.md'),
          AS_BUILT_REPORT,
        );
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      fromStep: 'architecture_review_as_built',
      verifyArtifacts: true,
      mode: 'auto',
      daemon: true,
      selfHost: true,
      providerExecution,
      maxRetries: 1,
      log: (message: string) => { logs.push(message); },
      config: {
        harness_self_host: { build_auth: { mode: 'api-key' }, live_containment: false },
      } as never,
    });
    return { conductor, runIds, logs };
  }

  it('stamps this dispatch identity, so the handshake accepts the verdict it just wrote', async () => {
    const { conductor, logs } = harness();

    await conductor.run();

    const stamped = JSON.parse(
      await readFile(join(projectRoot, ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP), 'utf8'),
    ) as { runId?: string };

    // The identity is minted for THIS dispatch. Leaving the resume's prior id
    // in place is what makes the handshake score the fresh verdict unstamped.
    expect(stamped.runId).toMatch(/\S/);
    expect(stamped.runId).not.toBe(PRIOR_RUN_ID);
    // And the handshake accepts it: no `expected run id none` rejection of a
    // report this dispatch genuinely wrote.
    expect(
      logs.filter((line) => line.includes('verdict write handshake')),
    ).toEqual([]);
  });

  it('hands the lifecycle the same identity it stamps, so the two never diverge', async () => {
    const { conductor, runIds } = harness();

    await conductor.run();

    const stamped = JSON.parse(
      await readFile(join(projectRoot, ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP), 'utf8'),
    ) as { runId?: string };

    // D1 (adr-2026-08-25): one identity per dispatch. The self-build dispatch
    // must carry it too, or the provider lifecycle and the sidecar record two
    // independently minted values for the same attempt.
    expect(runIds).toEqual([stamped.runId]);
  });
});
