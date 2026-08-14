import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HALT_PR_BANNER_SENTINEL, type GhRunner, type GitRunner } from '../../src/engine/pr-labels.js';
import { ensureShipReady, rehabilitateHaltPr } from '../../src/engine/halt-pr-rehabilitation.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import { HUMAN_REQUIRED_REASONS } from '../../src/engine/finish-publication.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { Conductor } from '../test-conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeState } from '../../src/engine/state.js';

const FINISH_PUBLICATION_MODULE = '../../src/engine/finish-publication.js';

describe('FINISH human-required guidance', () => {
  it.each([
    'judgment_refused',
    'judgment_halt_prose',
    'ambiguous_pr_identity',
    'invalid_shipped_record',
    'interactive_intent_deferred',
    'interactive_intent_declined',
    'interactive_intent_destructive_choice',
    'interactive_intent_unrecognized',
    'unattended_intent_destructive_choice',
    'unattended_intent_unauthorized_outcome',
  ] as const)('provides reader guidance for %s', (reason) => {
    expect(HUMAN_REQUIRED_REASONS[reason]).toEqual({
      message: expect.any(String),
      nextAction: expect.any(String),
    });
  });

  it('defines distinct non-blank message and next-action guidance for every human-required reason', () => {
    const reasons = [
      'judgment_refused',
      'judgment_halt_prose',
      'ambiguous_pr_identity',
      'invalid_shipped_record',
      'interactive_intent_deferred',
      'interactive_intent_declined',
      'interactive_intent_destructive_choice',
      'interactive_intent_unrecognized',
      'unattended_intent_destructive_choice',
      'unattended_intent_unauthorized_outcome',
    ] as const;
    const messages = reasons.map((reason) => {
      const guidance = HUMAN_REQUIRED_REASONS[reason];
      expect(guidance.message.trim(), `${reason} message`).not.toBe('');
      expect(guidance.nextAction.trim(), `${reason} nextAction`).not.toBe('');
      return guidance.message;
    });

    expect(messages).toHaveLength(10);
    expect(new Set(messages)).toHaveLength(messages.length);
  });
});

async function routeFinishPublicationDisposition(disposition: unknown) {
  const mod = (await import(FINISH_PUBLICATION_MODULE)) as Record<string, unknown>;
  const route = mod.routeFinishPublicationDisposition;
  if (typeof route !== 'function') {
    throw new Error(
      'expected export "routeFinishPublicationDisposition" to be a function (not yet implemented)',
    );
  }
  return route(disposition);
}

async function nonRetryablePublicationReason(reason: string) {
  const mod = (await import(FINISH_PUBLICATION_MODULE)) as Record<string, unknown>;
  const classify = mod.nonRetryablePublicationReason;
  if (typeof classify !== 'function') {
    throw new Error(
      'expected export "nonRetryablePublicationReason" to be a function (not yet implemented)',
    );
  }
  return classify(reason) as string | undefined;
}

type ObservationState = 'present' | 'missing' | 'stale' | 'malformed' | 'unavailable';
type PushObservationState = 'pushed' | 'unpushed' | 'stale' | 'malformed' | 'unavailable';
type PublicationSnapshot = import('../../src/engine/finish-publication.js').PublicationSnapshot;
type PublicationTransition = import('../../src/engine/finish-publication.js').PublicationTransition;
type PublicationTransitionDimensions =
  import('../../src/engine/finish-publication.js').PublicationTransitionDimensions;

type Assert<T extends true> = T;
type PublicationTransitionDimensionsAreTotal = Assert<
  PublicationTransitionDimensions extends Record<PublicationTransition, unknown> ? true : false
>;

void (undefined as unknown as PublicationTransitionDimensionsAreTotal);

async function publicationTransitionDimension(transition: PublicationTransition): Promise<unknown> {
  const mod = (await import(FINISH_PUBLICATION_MODULE)) as Record<string, unknown>;
  const dimensions = mod.PUBLICATION_TRANSITION_DIMENSIONS;
  if (dimensions === null || typeof dimensions !== 'object') {
    throw new Error(
      'expected export "PUBLICATION_TRANSITION_DIMENSIONS" to resolve every publication transition (not yet implemented)',
    );
  }
  return Reflect.get(dimensions, transition);
}

type AdvancedPublicationTransition = (
  emit: undefined,
  transition: PublicationTransition,
  before: PublicationSnapshot,
  after: PublicationSnapshot,
) => Promise<{ kind: 'advanced'; transition: PublicationTransition }>;

async function advancedPublicationTransition(
  transition: PublicationTransition,
  before: PublicationSnapshot,
  after: PublicationSnapshot,
) {
  const mod = (await import(FINISH_PUBLICATION_MODULE)) as Record<string, unknown>;
  const advance = mod.advancedPublicationTransition;
  if (typeof advance !== 'function') {
    throw new Error(
      'expected export "advancedPublicationTransition" to compare pre- and post-effect publication observations (not yet implemented)',
    );
  }
  return (advance as AdvancedPublicationTransition)(undefined, transition, before, after);
}

type PublicationCondition =
  | {
      code: 'release_readiness_invalid';
      message: 'Release readiness is invalid. Restore a valid release readiness result, then retry FINISH.';
      nextAction: 'restore_release_readiness';
    }
  | {
      code: 'ship_evidence_invalid';
      message: 'SHIP evidence is invalid. Re-run the SHIP validators, then retry FINISH.';
      nextAction: 'rerun_ship_validators';
    };

interface AdvanceFinishPublicationInput {
  observe(): Promise<PublicationSnapshot>;
  emit?(event: unknown): void | Promise<void>;
  effects: {
    dispatchJudgment(...args: unknown[]): Promise<unknown>;
    /**
     * The final recorder owns its existing absolute-path guard and marker-last
     * write order. The coordinator supplies only the authorized outcome after
     * it has observed a coherent final publication row.
     */
    recordOutcome?: (request: FinishOutcomeRecordRequest) => Promise<void>;
    createShippedRecord?: () => Promise<void>;
    repairPresentation?: () => Promise<void>;
    establishPr?: {
      gh: GhRunner;
      git: GitRunner;
      cwd: string;
      branch: string;
      baseBranch: string;
      featureDesc?: string;
    };
  };
}

type FinishOutcomeRecordRequest =
  | { choice: 'pr'; prUrl: string }
  | { choice: 'keep' };

type AdvanceFinishPublicationResult =
  | { kind: 'complete' }
  | {
      kind: 'advanced';
      transition: 'judge_pr_prose' | 'establish_pr' | 'write_shipped_record' | 'ready_pr' | 'record_outcome';
    }
  | { kind: 'publication_retry'; condition: PublicationCondition }
  | { kind: 'publication_retry'; transition: 'establish_pr' | 'write_shipped_record'; reason: string }
  | {
      kind: 'publication_retry';
      transition: 'ready_pr';
      reason: 'presentation_repair_effect_unavailable' | 'presentation_repair_failed' | 'presentation_not_verified_after_repair';
    }
  | {
      kind: 'human_required';
      reason: 'ambiguous_pr_identity' | 'invalid_shipped_record';
    };

type AdvanceFinishPublication = (
  input: AdvanceFinishPublicationInput,
) => Promise<AdvanceFinishPublicationResult>;

interface PublicationObservationPorts {
  filesystem: {
    observeImplementationEvidence(): Promise<ObservationState>;
    observeShipEvidence(): Promise<ObservationState>;
    observeOutcomeRecord(): Promise<ObservationState>;
  };
  git: {
    observePushEvidence(): Promise<PushObservationState>;
  };
  github: {
    observePullRequest(): Promise<
      | { state: 'one'; url: string; prose: 'accepted' | 'stale' | 'placeholder' | 'halt'; ready: boolean }
      | { state: 'missing' | 'ambiguous' | 'malformed' | 'unavailable'; urls?: readonly string[] }
    >;
  };
  shippedRecord: {
    observeShippedRecord(): Promise<ObservationState>;
  };
  releaseReadiness: {
    observeReleaseReadiness(): Promise<ObservationState>;
  };
}

interface ObservePublicationSnapshotInput {
  mode: 'daemon';
  intent: {
    outcome: 'pr';
    authority: { kind: 'unattended_policy'; mode: 'daemon' };
  };
  ports: PublicationObservationPorts;
}

async function observePublicationSnapshot(input: ObservePublicationSnapshotInput) {
  const mod = (await import(FINISH_PUBLICATION_MODULE)) as Record<string, unknown>;
  const observer = mod.observePublicationSnapshot;
  if (typeof observer !== 'function') {
    throw new Error('expected export "observePublicationSnapshot" to be a function (not yet implemented)');
  }
  return observer(input);
}

async function resolveInteractivePublicationIntent(choice: unknown) {
  const mod = (await import(FINISH_PUBLICATION_MODULE)) as Record<string, unknown>;
  const resolver = mod.resolveInteractivePublicationIntent;
  if (typeof resolver !== 'function') {
    throw new Error(
      'expected export "resolveInteractivePublicationIntent" to be a function (not yet implemented)',
    );
  }
  return resolver(choice);
}

async function resolveUnattendedPublicationIntent(input: unknown) {
  const mod = (await import(FINISH_PUBLICATION_MODULE)) as Record<string, unknown>;
  const resolver = mod.resolveUnattendedPublicationIntent;
  if (typeof resolver !== 'function') {
    throw new Error(
      'expected export "resolveUnattendedPublicationIntent" to be a function (not yet implemented)',
    );
  }
  return resolver(input);
}

async function advanceFinishPublication(input: AdvanceFinishPublicationInput) {
  const mod = (await import(FINISH_PUBLICATION_MODULE)) as Record<string, unknown>;
  const coordinator = mod.advanceFinishPublication;
  if (typeof coordinator !== 'function') {
    throw new Error(
      'expected export "advanceFinishPublication" to be a function (not yet implemented)',
    );
  }
  return (coordinator as AdvanceFinishPublication)(input);
}

function readyPublicationSnapshot(
  overrides: Partial<PublicationSnapshot> = {},
): PublicationSnapshot {
  const base = {
    mode: 'daemon',
    intent: {
      outcome: 'pr',
      authority: { kind: 'unattended_policy', mode: 'daemon' },
    },
    implementationEvidence: 'valid',
    shipEvidence: 'valid',
    releaseReadiness: 'valid',
    branchPushed: 'valid',
    pr: {
      identity: 'one',
      url: 'https://github.com/acme/widget/pull/1172',
      // Prose that needs the bounded JUDGMENT pass. A `placeholder` body is
      // deterministically unauthored and routes to `author_pr_prose` instead,
      // so it is opted into explicitly by the tests that mean it.
      prose: 'stale',
      ready: false,
    },
    shippedRecord: 'valid',
    outcomeRecord: 'missing',
  } as const satisfies PublicationSnapshot;

  return {
    ...base,
    ...overrides,
    pr: overrides.pr ?? base.pr,
  } as PublicationSnapshot;
}

function observerPorts(overrides: Partial<{
  implementationEvidence: ObservationState;
  shipEvidence: ObservationState;
  outcomeRecord: ObservationState;
  branchPushed: PushObservationState;
  pr: Awaited<ReturnType<PublicationObservationPorts['github']['observePullRequest']>>;
  shippedRecord: ObservationState;
  releaseReadiness: ObservationState;
}> = {}): PublicationObservationPorts {
  return {
    filesystem: {
      observeImplementationEvidence: async () => overrides.implementationEvidence ?? 'present',
      observeShipEvidence: async () => overrides.shipEvidence ?? 'present',
      observeOutcomeRecord: async () => overrides.outcomeRecord ?? 'present',
    },
    git: {
      observePushEvidence: async () => overrides.branchPushed ?? 'pushed',
    },
    github: {
      observePullRequest: async () =>
        overrides.pr ?? {
          state: 'one',
          url: 'https://github.com/acme/widget/pull/1172',
          prose: 'accepted',
          ready: true,
        },
    },
    shippedRecord: {
      observeShippedRecord: async () => overrides.shippedRecord ?? 'present',
    },
    releaseReadiness: {
      observeReleaseReadiness: async () => overrides.releaseReadiness ?? 'present',
    },
  };
}

function observationInput(ports: PublicationObservationPorts): ObservePublicationSnapshotInput {
  return {
    mode: 'daemon',
    intent: {
      outcome: 'pr',
      authority: { kind: 'unattended_policy', mode: 'daemon' },
    },
    ports,
  };
}

function draftPrFakes(ghHandler: (args: string[]) => { stdout: string } | Error) {
  const gitCalls: string[][] = [];
  const ghCalls: string[][] = [];
  const git: GitRunner = async (args) => {
    gitCalls.push([...args]);
    if (args[0] === 'rev-list') return { stdout: '1\n' };
    return { stdout: '' };
  };
  const gh: GhRunner = async (args) => {
    ghCalls.push([...args]);
    const result = ghHandler(args);
    if (result instanceof Error) throw result;
    return result;
  };
  return {
    deps: {
      gh,
      git,
      cwd: '/repo',
      branch: 'feat/widget',
      baseBranch: 'main',
      featureDesc: 'widget',
    },
    gitCalls,
    ghCalls,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('FINISH human-required halt marker', () => {
  it('writes the rendered provider refusal through the coordinator to the needs-human halt marker', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'finish-publication-refusal-marker-'));
    const pipelineDir = join(projectRoot, '.pipeline');
    const stateFilePath = join(pipelineDir, 'conduct-state.json');
    const prUrl = 'https://github.com/acme/widget/pull/1172';
    const detail = 'The provider declined the requested prose judgment.';

    try {
      await mkdir(join(projectRoot, '.docs', 'shipped'), { recursive: true });
      await mkdir(pipelineDir);
      await writeFile(join(pipelineDir, 'finish-choice'), 'pr\n');
      await writeFile(join(projectRoot, '.docs', 'shipped', 'finish-publication.md'), 'shipped\n');
      const state: Record<string, unknown> = {
        complexity_tier: 'S',
        feature_desc: 'finish-publication',
        worktree_branch: 'feat/finish-publication',
        pr_url: prUrl,
      };
      for (const step of [
        'bootstrap', 'memory', 'assess', 'explore', 'prd', 'complexity', 'stories',
        'conflict_check', 'plan', 'coherence_check', 'architecture_diagram',
        'architecture_review', 'worktree', 'acceptance_specs', 'build', 'build_review',
        'wiring_check', 'test_suite', 'manual_test', 'prd_audit',
        'architecture_review_as_built', 'retro', 'rebase',
      ] satisfies StepName[]) {
        state[step] = 'done';
      }
      await writeState(stateFilePath, state as ConductState);

      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot,
        stateFilePath,
        baseBranch: 'main',
        git: async (args) => args[0] === 'remote'
          ? { stdout: 'origin\n' }
          : { stdout: 'refs/remotes/origin/feat/finish-publication\n' },
        gh: async (args) => {
          if (args[0] === 'auth') return { stdout: '' };
          if (args[0] === 'pr' && args[1] === 'view') {
            return {
              stdout: JSON.stringify({
                url: prUrl,
                title: 'feat: publish FINISH refusal guidance',
                body: `Reader-facing prose.\n${HALT_PR_BANNER_SENTINEL}`,
                isDraft: true,
              }),
            };
          }
          throw new Error(`unexpected GitHub call: ${args.join(' ')}`);
        },
        observeReleaseReadiness: async () => 'present',
      });
      const provider = vi.fn(async () => ({
        success: true,
        output: JSON.stringify({ kind: 'refused', detail }),
      }));
      const conductor = new Conductor({
        stateFilePath,
        stepRunner: { run: provider },
        finishPublication: coordinator,
        events: new ConductorEventEmitter(),
        projectRoot,
        fromStep: 'finish',
        mode: 'auto',
        daemon: true,
        git: async () => ({ stdout: '' }),
        gh: async () => ({ stdout: '' }),
        runGh: async () => ({ stdout: '' }),
      });

      await conductor.run();

      const haltBody = await readFile(join(pipelineDir, 'HALT'), 'utf8');
      expect(provider).toHaveBeenCalledOnce();
      expect(haltBody).toContain('Next action:');
      expect(haltBody).toContain(detail);
      await expect(readFile(join(pipelineDir, 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('finish-publication domain types', () => {
  it.each([
    'establish_pr',
    'verify_release_readiness',
    'author_pr_prose',
    'judge_pr_prose',
    'write_shipped_record',
    'ready_pr',
    'record_outcome',
  ] as const satisfies readonly PublicationTransition[])(
    'resolves an owned dimension for %s',
    async (transition) => {
      await expect(publicationTransitionDimension(transition)).resolves.toBeDefined();
    },
  );

  it('exports the semantic unions for the publication lifecycle', async () => {
    type PublicationIntent = import('../../src/engine/finish-publication.js').PublicationIntent;
    type PublicationSnapshot = import('../../src/engine/finish-publication.js').PublicationSnapshot;
    type PublicationTransition = import('../../src/engine/finish-publication.js').PublicationTransition;
    type PublicationDisposition = import('../../src/engine/finish-publication.js').PublicationDisposition;

    const intent: PublicationIntent = {
      outcome: 'pr',
      authority: { kind: 'unattended_policy', mode: 'daemon' },
    };
    const interactiveIntent: PublicationIntent = {
      outcome: 'pr',
      authority: { kind: 'operator_confirmed', mode: 'interactive' },
    };
    const snapshot: PublicationSnapshot = {
      mode: 'daemon',
      intent,
      implementationEvidence: 'valid',
      shipEvidence: 'valid',
      releaseReadiness: 'valid',
      branchPushed: 'valid',
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: true },
      shippedRecord: 'valid',
      outcomeRecord: 'valid',
    };
    // @ts-expect-error A daemon snapshot cannot carry interactive authority.
    const mismatchedSnapshot: PublicationSnapshot = {
      ...snapshot,
      mode: 'daemon',
      intent: interactiveIntent,
    };
    const transition: PublicationTransition = 'establish_pr';
    const disposition: PublicationDisposition = { kind: 'complete' };
    const invalidHumanRequiredDisposition: PublicationDisposition = {
      kind: 'human_required',
      // @ts-expect-error Human-required reasons must be a closed token union.
      reason: 'not_a_real_token',
    };

    const destructiveIntent: PublicationIntent = {
      // @ts-expect-error Unattended authority cannot choose an operator-only destructive outcome.
      outcome: 'merge',
      authority: { kind: 'unattended_policy', mode: 'daemon' },
    };

    void [mismatchedSnapshot, transition, disposition, invalidHumanRequiredDisposition, destructiveIntent];

    await expect(import('../../src/engine/finish-publication.js')).resolves.toBeTypeOf('object');
  });

  it.each([
    ['an authorized keep outcome', {
      ...readyPublicationSnapshot(),
      mode: 'foreground-auto',
      intent: {
        outcome: 'keep',
        authority: { kind: 'unattended_policy', mode: 'foreground-auto' },
      },
      branchPushed: 'missing',
      pr: { identity: 'none' },
    } as PublicationSnapshot, 'record_outcome'],
    ['a missing PR identity', readyPublicationSnapshot({ pr: { identity: 'none' } }), 'establish_pr'],
    ['an ambiguous PR identity', readyPublicationSnapshot({ pr: { identity: 'ambiguous', urls: [] } }), 'establish_pr'],
    ['an indeterminate PR identity', readyPublicationSnapshot({ pr: { identity: 'indeterminate' } }), 'establish_pr'],
    ['missing push evidence', readyPublicationSnapshot({ branchPushed: 'missing' }), 'establish_pr'],
    ['invalid push evidence', readyPublicationSnapshot({ branchPushed: 'invalid' }), 'establish_pr'],
    ['indeterminate push evidence', readyPublicationSnapshot({ branchPushed: 'indeterminate' }), 'establish_pr'],
    ['missing release readiness', readyPublicationSnapshot({ releaseReadiness: 'missing' }), 'verify_release_readiness'],
    ['invalid release readiness', readyPublicationSnapshot({ releaseReadiness: 'invalid' }), 'verify_release_readiness'],
    ['indeterminate release readiness', readyPublicationSnapshot({ releaseReadiness: 'indeterminate' }), 'verify_release_readiness'],
    // The shipped record is written only after prose is accepted, so these
    // rows carry accepted prose: an unauthored body must never commit the
    // daemon-backlog dedup key ahead of a prose halt.
    ['a missing shipped record', readyPublicationSnapshot({
      shippedRecord: 'missing',
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: true },
    }), 'write_shipped_record'],
    ['an invalid shipped record', readyPublicationSnapshot({
      shippedRecord: 'invalid',
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: true },
    }), 'write_shipped_record'],
    ['an indeterminate shipped record', readyPublicationSnapshot({
      shippedRecord: 'indeterminate',
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: true },
    }), 'write_shipped_record'],
    ['stale PR prose', readyPublicationSnapshot({
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'stale', ready: true },
    }), 'judge_pr_prose'],
    ['placeholder PR prose', readyPublicationSnapshot({
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'placeholder', ready: true },
    }), 'author_pr_prose'],
    ['halt PR prose', readyPublicationSnapshot({
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'halt', ready: true },
    }), 'judge_pr_prose'],
    ['indeterminate PR prose', readyPublicationSnapshot({
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'indeterminate', ready: true },
    }), 'judge_pr_prose'],
    ['a draft PR with accepted prose', readyPublicationSnapshot({
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: false },
    }), 'ready_pr'],
    ['all preceding PR publication progress complete', readyPublicationSnapshot({
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: true },
    }), 'record_outcome'],
  ] as const)('selects %s as the next deterministic publication transition', async (_state, snapshot, expected) => {
    const module = await import('../../src/engine/finish-publication.js');
    const nextFinishPublicationTransition = Reflect.get(module, 'nextFinishPublicationTransition') as (
      snapshot: PublicationSnapshot,
    ) => typeof expected;

    expect(nextFinishPublicationTransition(snapshot)).toBe(expected);
  });

  it('rejects a PR outcome record without an external PR identity', async () => {
    type PublicationSnapshot = import('../../src/engine/finish-publication.js').PublicationSnapshot;

    const snapshot = {
      mode: 'daemon',
      intent: {
        outcome: 'pr',
        authority: { kind: 'unattended_policy', mode: 'daemon' },
      },
      implementationEvidence: 'valid',
      shipEvidence: 'valid',
      releaseReadiness: 'valid',
      branchPushed: 'valid',
      pr: { identity: 'none' },
      shippedRecord: 'valid',
      outcomeRecord: 'valid',
    } as PublicationSnapshot;

    await expect(
      advanceFinishPublication({
        observe: async () => snapshot,
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }) },
      }),
    ).resolves.toMatchObject({
      kind: 'publication_retry',
      condition: { code: 'publication_snapshot_incoherent' },
    });
  });
});

describe('FINISH publication disposition routing', () => {
  it('renders human-required guidance into the halt reason', async () => {
    const route = await routeFinishPublicationDisposition({
      kind: 'human_required',
      reason: 'ambiguous_pr_identity',
    });

    expect(route).toEqual({
      kind: 'halt',
      reason: expect.stringContaining('More than one pull request matches this feature'),
    });
    expect(route).toMatchObject({
      reason: expect.stringContaining('Identify the correct pull request'),
    });
    expect(route).not.toEqual({ kind: 'halt', reason: 'ambiguous_pr_identity' });
  });

  it('renders a human-required provider detail alongside mapped guidance', async () => {
    const detail = 'The provider declined to make the requested judgment.';

    const route = await routeFinishPublicationDisposition({
      kind: 'human_required',
      reason: 'judgment_refused',
      detail,
    });

    expect(route).toEqual({
      kind: 'halt',
      reason: expect.stringContaining('The PR prose judgment was refused'),
    });
    expect(route).toMatchObject({
      reason: expect.stringContaining('Review the refusal'),
    });
    expect(route).toMatchObject({ reason: expect.stringContaining(detail) });
  });

  it('renders detail-less human-required guidance without an empty suffix', async () => {
    const route = await routeFinishPublicationDisposition({
      kind: 'human_required',
      reason: 'judgment_refused',
    });
    if (route.kind !== 'halt') throw new Error('expected a human-required halt');
    const guidance = HUMAN_REQUIRED_REASONS.judgment_refused;
    expect(route.reason).toContain(guidance.message);
    expect(route.reason).toContain(guidance.nextAction);
    expect(route.reason).not.toContain(' Detail:');
    expect(route.reason).not.toContain('undefined');
  });

  it.each([
    ['complete', { kind: 'complete' }, { kind: 'complete' }],
    [
      'publication progress',
      { kind: 'publication_progress', transition: 'record_outcome' },
      { kind: 'progress_finish', transition: 'record_outcome' },
    ],
    [
      'transition-based publication retry',
      {
        kind: 'publication_retry',
        transition: 'record_outcome',
        reason: 'outcome_record_write_failed',
      },
      { kind: 'retry_finish', reason: 'outcome_record_write_failed' },
    ],
    [
      'condition-based publication retry',
      {
        kind: 'publication_retry',
        condition: {
          code: 'release_readiness_missing',
          message: 'Release readiness is missing. Publish a valid release readiness result, then retry FINISH.',
          nextAction: 'publish_release_readiness',
        },
      },
      { kind: 'retry_finish', reason: 'release_readiness_missing' },
    ],
    [
      'implementation invalid',
      { kind: 'implementation_invalid', evidence: 'build-review FAIL: finish-publication.ts' },
      { kind: 'retry_build', evidence: 'build-review FAIL: finish-publication.ts' },
    ],
    [
      'contradictory disposition',
      { kind: 'complete', reason: 'contradictory' },
      {
        kind: 'halt',
        reason: 'Unknown or contradictory FINISH publication disposition; human review required.',
      },
    ],
  ] as const)('preserves the established %s route without human-required rendering', async (_route, disposition, expected) => {
    await expect(routeFinishPublicationDisposition(disposition)).resolves.toEqual(expected);
  });

  it('fails closed when an unlisted human-required reason has no guidance', async () => {
    const reason = 'future_unlisted_reason';

    await expect(routeFinishPublicationDisposition({
      kind: 'human_required',
      reason,
    } as unknown)).resolves.toEqual({
      kind: 'halt',
      reason: expect.stringMatching(new RegExp(`^.*${reason}.*no guidance is registered.*$`, 'i')),
    });
  });

  it('accepts a human-required disposition with a non-empty detail through exact validation', async () => {
    await expect(routeFinishPublicationDisposition({
      kind: 'human_required',
      reason: 'judgment_refused',
      detail: 'x',
    })).resolves.toEqual({ kind: 'halt', reason: expect.stringContaining('x') });
  });

  it.each([
    ['a blank detail', { kind: 'human_required', reason: 'judgment_refused', detail: '' }],
    ['a whitespace-only detail', { kind: 'human_required', reason: 'judgment_refused', detail: '   ' }],
    ['a numeric detail', { kind: 'human_required', reason: 'judgment_refused', detail: 42 }],
    ['an object detail', { kind: 'human_required', reason: 'judgment_refused', detail: {} }],
    ['an extra key', { kind: 'human_required', reason: 'judgment_refused', detail: 'x', extra: 'x' }],
    ['a missing reason', { kind: 'human_required', detail: 'x' }],
  ])('rejects a human-required disposition with %s through exact validation', async (_shape, disposition) => {
    await expect(routeFinishPublicationDisposition(disposition)).resolves.toEqual({
      kind: 'halt',
      reason: 'Unknown or contradictory FINISH publication disposition; human review required.',
    });
  });

  it.each([
    ['establish_pr', 'pr_identity_not_verified_after_establish'],
    ['write_shipped_record', 'shipped_record_not_verified_after_write'],
    ['judge_pr_prose', 'judgment_completed_reobserve'],
    ['ready_pr', 'presentation_not_verified_after_repair'],
    ['record_outcome', 'outcome_record_not_verified_after_write'],
  ] as const)('accepts legacy synthesized retry %s/%s by exact disposition validation', async (transition, reason) => {
    await expect(
      routeFinishPublicationDisposition({
        kind: 'publication_retry',
        transition,
        reason,
      }),
    ).resolves.toEqual({ kind: 'retry_finish', reason });
  });

  it.each([
    ['establish_pr', 'draft_pr_effect_unavailable'],
    ['establish_pr', 'draft_pr_skipped'],
    ['establish_pr', 'draft_pr_no-commits'],
    ['establish_pr', 'draft_pr_push-failed'],
    // A rejected LEASE is a genuinely-moved remote, not the expected
    // rebase divergence — it stays its own named reason so an operator can
    // tell "someone else pushed" from "the push simply failed".
    ['establish_pr', 'draft_pr_lease-rejected'],
    ['establish_pr', 'draft_pr_failed'],
    ['establish_pr', 'pr_identity_not_verified_after_establish'],
    ['write_shipped_record', 'shipped_record_effect_unavailable'],
    ['write_shipped_record', 'shipped_record_write_failed'],
    ['write_shipped_record', 'shipped_record_not_verified_after_write'],
    ['judge_pr_prose', 'judgment_timed_out'],
    ['judge_pr_prose', 'judgment_provider_unavailable'],
    ['judge_pr_prose', 'judgment_dispatch_failed'],
    ['judge_pr_prose', 'judgment_completed_reobserve'],
    ['ready_pr', 'presentation_repair_effect_unavailable'],
    ['ready_pr', 'presentation_repair_failed'],
    ['ready_pr', 'presentation_not_verified_after_repair'],
    ['record_outcome', 'outcome_record_effect_unavailable'],
    ['record_outcome', 'outcome_record_write_failed'],
    ['record_outcome', 'outcome_record_not_verified_after_write'],
  ] as const)('keeps publication retry %s/%s in FINISH', async (transition, reason) => {
    await expect(
      routeFinishPublicationDisposition({
        kind: 'publication_retry',
        transition,
        reason,
      }),
    ).resolves.toEqual({ kind: 'retry_finish', reason });
  });

  // --- fail-fast classification ------------------------------------------
  //
  // Every retry_finish reason used to burn the full attempt budget before
  // halting, even when re-running the identical transition could not possibly
  // change the outcome. Between attempts the conductor re-enters
  // `finishPublication.advance` ONLY — no provider is dispatched except for
  // `judge_pr_prose` — so nothing observes new commits, wires a missing
  // effect, or reconciles a moved remote on the retry path.

  it.each([
    // The effect is not wired into the coordinator at all; the deps object is
    // identical on every attempt.
    'draft_pr_effect_unavailable',
    'shipped_record_effect_unavailable',
    'presentation_repair_effect_unavailable',
    'outcome_record_effect_unavailable',
    // The branch has nothing over base; no retry authors commits.
    'draft_pr_no-commits',
    // No branch recorded / detached HEAD / base unresolvable; no retry fixes it.
    'draft_pr_skipped',
    // The remote carries work this checkout never saw; the same lease is
    // rejected identically, and forcing past it would destroy that work.
    'draft_pr_lease-rejected',
  ])('classifies %s as non-retryable, with an operator-facing explanation', async (reason) => {
    const explanation = await nonRetryablePublicationReason(reason);
    expect(typeof explanation).toBe('string');
    expect((explanation as string).length).toBeGreaterThan(0);
  });

  it.each([
    // Transport, auth, or network — a retry can genuinely succeed.
    'draft_pr_push-failed',
    'draft_pr_failed',
    'pr_url_persistence_failed',
    'pr_identity_not_verified_after_establish',
    'shipped_record_write_failed',
    'shipped_record_not_verified_after_write',
    'judgment_timed_out',
    'judgment_provider_unavailable',
    'judgment_dispatch_failed',
    'judgment_completed_reobserve',
    'presentation_repair_failed',
    'presentation_not_verified_after_repair',
    'outcome_record_write_failed',
    'outcome_record_not_verified_after_write',
  ])('keeps %s retryable', async (reason) => {
    await expect(nonRetryablePublicationReason(reason)).resolves.toBeUndefined();
  });

  it('fails CLOSED: an unknown or future reason stays retryable', async () => {
    // Getting this backwards would fail-fast healthy runs, so the classifier
    // must only ever recognise reasons it was explicitly taught.
    await expect(nonRetryablePublicationReason('some_future_reason')).resolves.toBeUndefined();
    await expect(nonRetryablePublicationReason('')).resolves.toBeUndefined();
    await expect(nonRetryablePublicationReason('draft_pr_')).resolves.toBeUndefined();
    await expect(nonRetryablePublicationReason('DRAFT_PR_NO-COMMITS')).resolves.toBeUndefined();
  });

  it.each([

    [
      'publication_snapshot_incoherent',
      'Publication evidence is contradictory. Resolve the cited publication state, then retry FINISH.',
      'resolve_publication_state',
    ],
    [
      'publication_snapshot_indeterminate',
      'Publication evidence could not be determined. Restore the evidence observer, then retry FINISH.',
      'restore_publication_observation',
    ],
    [
      'release_readiness_missing',
      'Release readiness is missing. Publish a valid release readiness result, then retry FINISH.',
      'publish_release_readiness',
    ],
    [
      'release_readiness_invalid',
      'Release readiness is invalid. Restore a valid release readiness result, then retry FINISH.',
      'restore_release_readiness',
    ],
    [
      'release_readiness_indeterminate',
      'Release readiness could not be determined. Restore the readiness observer, then retry FINISH.',
      'restore_release_readiness_observation',
    ],
  ] as const)('keeps publication condition %s in FINISH', async (code, message, nextAction) => {
    await expect(
      routeFinishPublicationDisposition({
        kind: 'publication_retry',
        condition: { code, message, nextAction },
      }),
    ).resolves.toEqual({ kind: 'retry_finish', reason: code });
  });

  it.each([
    [
      'implementation_evidence_invalid',
      'Implementation evidence is invalid. Re-run the BUILD verification, then retry FINISH.',
      'rerun_build_verification',
    ],
    [
      'implementation_evidence_indeterminate',
      'Implementation evidence could not be determined. Restore the implementation evidence observer, then retry FINISH.',
      'restore_implementation_observation',
    ],
    [
      'ship_evidence_invalid',
      'SHIP evidence is invalid. Re-run the SHIP validators, then retry FINISH.',
      'rerun_ship_validators',
    ],
    [
      'ship_evidence_indeterminate',
      'SHIP evidence could not be determined. Restore the SHIP evidence observer, then retry FINISH.',
      'restore_ship_observation',
    ],
  ] as const)('halts evidence-invalid condition %s pending dedicated BUILD routing', async (code, message, nextAction) => {
    await expect(
      routeFinishPublicationDisposition({
        kind: 'publication_retry',
        condition: { code, message, nextAction },
      }),
    ).resolves.toMatchObject({ kind: 'halt', reason: expect.stringContaining(code) });
  });

  it('permits only cited implementation-invalid evidence to route BUILD', async () => {
    const evidence = 'build-review FAIL: src/engine/finish-publication.ts:497';

    await expect(
      routeFinishPublicationDisposition({ kind: 'implementation_invalid', evidence }),
    ).resolves.toEqual({ kind: 'retry_build', evidence });
    await expect(
      routeFinishPublicationDisposition({ kind: 'implementation_invalid', evidence: '   ' }),
    ).resolves.toMatchObject({ kind: 'halt' });
  });

  it('routes every publication-progress transition back to FINISH', async () => {
    const transitions = [
      'verify_release_readiness',
      'judge_pr_prose',
      'establish_pr',
      'write_shipped_record',
      'ready_pr',
      'record_outcome',
    ] as const;

    await expect(
      Promise.all(
        transitions.map(async (transition) => routeFinishPublicationDisposition({
          kind: 'publication_progress',
          transition,
        })),
      ),
    ).resolves.toEqual(transitions.map((transition) => ({ kind: 'progress_finish', transition })));
  });

  it('rejects publication-progress dispositions without exactly a known kind and transition', async () => {
    await expect(
      Promise.all([
        { kind: 'publication_progress', transition: 'unknown_transition' },
        { kind: 'publication_progress' },
        { kind: 'publication_progress', transition: 'record_outcome', reason: 'extra' },
      ].map(routeFinishPublicationDisposition)),
    ).resolves.toEqual([
      { kind: 'halt', reason: 'Unknown or contradictory FINISH publication disposition; human review required.' },
      { kind: 'halt', reason: 'Unknown or contradictory FINISH publication disposition; human review required.' },
      { kind: 'halt', reason: 'Unknown or contradictory FINISH publication disposition; human review required.' },
    ]);
  });

  it.each([
    undefined,
    { kind: 'complete', reason: 'contradictory' },
    { kind: 'publication_retry', transition: 'record_outcome' },
    { kind: 'publication_retry', transition: 'record_outcome', reason: 7 },
    { kind: 'publication_retry', transition: 'unknown_transition', reason: 'bad' },
    { kind: 'publication_retry', transition: 'record_outcome', reason: 'draft_pr_no-commits' },
    {
      kind: 'publication_retry',
      condition: {
        code: 'release_readiness_missing',
        message: 'not the canonical message',
        nextAction: 'publish_release_readiness',
      },
    },
    {
      kind: 'publication_retry',
      transition: 'record_outcome',
      reason: 'contradictory',
      condition: { code: 'release_readiness_missing', message: 'bad', nextAction: 'bad' },
    },
    {
      kind: 'implementation_invalid',
      evidence: 'invalid proof',
      reason: 'contradictory publication retry',
    },
    {
      kind: 'publication_retry',
      condition: { code: 'unknown_condition', message: 'bad', nextAction: 'bad' },
    },
    { kind: 'unknown' },
  ])('halts unknown or contradictory disposition %#', async (disposition) => {
    await expect(routeFinishPublicationDisposition(disposition)).resolves.toMatchObject({
      kind: 'halt',
      reason: expect.stringContaining('publication disposition'),
    });
  });
});

describe('observePublicationSnapshot', () => {
  it('composes authoritative present evidence from injected filesystem, Git, GitHub, record, push, and readiness ports', async () => {
    const calls: string[] = [];
    const ports = observerPorts();
    for (const source of Object.values(ports)) {
      for (const [name, observe] of Object.entries(source)) {
        const original = observe as () => Promise<unknown>;
        Object.assign(source, { [name]: async () => {
          calls.push(name);
          return original();
        } });
      }
    }

    await expect(observePublicationSnapshot(observationInput(ports))).resolves.toMatchObject({
      implementationEvidence: 'valid',
      shipEvidence: 'valid',
      releaseReadiness: 'valid',
      branchPushed: 'valid',
      pr: { identity: 'one', prose: 'accepted', ready: true },
      shippedRecord: 'valid',
      outcomeRecord: 'valid',
    });
    expect(calls).toEqual([
      'observeImplementationEvidence',
      'observeShipEvidence',
      'observeOutcomeRecord',
      'observePushEvidence',
      'observePullRequest',
      'observeShippedRecord',
      'observeReleaseReadiness',
    ]);
  });

  it.each([
    ['missing', { implementationEvidence: 'missing' }, { implementationEvidence: 'invalid' }],
    ['stale', { releaseReadiness: 'stale' }, { releaseReadiness: 'invalid' }],
    ['malformed', { shippedRecord: 'malformed' }, { shippedRecord: 'invalid' }],
    ['unpushed', { branchPushed: 'unpushed' }, { branchPushed: 'missing' }],
    ['unavailable', { outcomeRecord: 'unavailable' }, { outcomeRecord: 'indeterminate' }],
  ] as const)('maps %s evidence into the closed snapshot without inferring success', async (_row, overrides, expected) => {
    await expect(
      observePublicationSnapshot(observationInput(observerPorts(overrides))),
    ).resolves.toMatchObject(expected);
  });

  it.each([
    ['missing', { state: 'missing' as const }, { identity: 'none' }],
    ['ambiguous', { state: 'ambiguous' as const, urls: ['https://github.com/acme/widget/pull/1', 'https://github.com/acme/widget/pull/2'] }, { identity: 'ambiguous' }],
    ['malformed', { state: 'malformed' as const }, { identity: 'indeterminate' }],
    ['unavailable', { state: 'unavailable' as const }, { identity: 'indeterminate' }],
  ])('maps a %s GitHub observation without manufacturing a PR identity', async (_row, pr, expected) => {
    await expect(
      observePublicationSnapshot(observationInput(observerPorts({ pr }))),
    ).resolves.toMatchObject({ pr: expected });
  });
});

describe('resolveInteractivePublicationIntent', () => {
  it.each([
    ['pr', 'pr'],
    ['keep', 'keep'],
  ] as const)('preserves an operator-confirmed %s choice as interactive intent', async (_choice, outcome) => {
    await expect(resolveInteractivePublicationIntent(outcome)).resolves.toEqual({
      outcome,
      authority: { kind: 'operator_confirmed', mode: 'interactive' },
    });
  });

  it.each([
    ['defer', 'interactive_intent_deferred'],
    ['decline', 'interactive_intent_declined'],
  ] as const)('halts %s without synthesizing a publication mutation', async (choice, reason) => {
    await expect(resolveInteractivePublicationIntent(choice)).resolves.toEqual({
      kind: 'human_required',
      reason,
    });
  });

  it.each(['merge-local', 'merge', 'discard'] as const)(
    'halts the destructive %s choice for separate human action',
    async (choice) => {
      await expect(resolveInteractivePublicationIntent(choice)).resolves.toEqual({
        kind: 'human_required',
        reason: 'interactive_intent_destructive_choice',
      });
    },
  );
});

describe('advancedPublicationTransition', () => {
  it.each([
    [
      'author_pr_prose',
      readyPublicationSnapshot({
        pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'placeholder', ready: false },
      }),
      readyPublicationSnapshot({
        pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: false },
      }),
    ],
    [
      'write_shipped_record',
      readyPublicationSnapshot({
        pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: true },
        shippedRecord: 'missing',
      }),
      readyPublicationSnapshot({
        pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: true },
        shippedRecord: 'valid',
      }),
    ],
    [
      'ready_pr',
      readyPublicationSnapshot({
        pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: false },
      }),
      readyPublicationSnapshot({
        pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: true },
      }),
    ],
  ] as const satisfies readonly [PublicationTransition, PublicationSnapshot, PublicationSnapshot][]) (
    'reports advanced when %s moves its owned dimension',
    async (transition, before, after) => {
      await expect(advancedPublicationTransition(transition, before, after)).resolves.toEqual({
        kind: 'advanced',
        transition,
      });
    },
  );
});

describe('advanceFinishPublication unmoved transition dimensions', () => {
  it('halts human-required when judgment completes but PR prose remains halt', async () => {
    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot({
          pr: {
            identity: 'one',
            url: 'https://github.com/acme/widget/pull/1172',
            prose: 'halt',
            ready: false,
          },
        }),
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }) },
      }),
    ).resolves.toMatchObject({ kind: 'human_required' });
  });

  it('renders an unmoved judge_pr_prose halt with its stuck pr.prose value and next action', async () => {
    const disposition = await advanceFinishPublication({
      observe: async () => readyPublicationSnapshot({
        pr: {
          identity: 'one',
          url: 'https://github.com/acme/widget/pull/1172',
          prose: 'halt',
          ready: false,
        },
      }),
      effects: { dispatchJudgment: async () => ({ kind: 'accepted' }) },
    });

    expect(disposition).toMatchObject({ kind: 'human_required' });
    const route = await routeFinishPublicationDisposition(disposition);
    if (route.kind !== 'halt') throw new Error('expected a human-required halt');

    expect(route.reason).toContain('judge_pr_prose');
    expect(route.reason).toContain('pr.prose');
    expect(route.reason).toContain('halt');
    expect(route.reason).toMatch(/next action:/i);
    expect(route.reason).not.toContain('authoring_required_after_judgment');
  });

  it('halts human-required when foreign shipped-record movement masks unchanged PR prose', async () => {
    const observe = vi
      .fn<() => Promise<PublicationSnapshot>>()
      .mockResolvedValueOnce(readyPublicationSnapshot({
        pr: {
          identity: 'one',
          url: 'https://github.com/acme/widget/pull/1172',
          prose: 'halt',
          ready: false,
        },
        shippedRecord: 'missing',
      }))
      .mockResolvedValueOnce(readyPublicationSnapshot({
        pr: {
          identity: 'one',
          url: 'https://github.com/acme/widget/pull/1172',
          prose: 'halt',
          ready: false,
        },
        shippedRecord: 'valid',
      }));

    await expect(
      advanceFinishPublication({
        observe,
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }) },
      }),
    ).resolves.toMatchObject({ kind: 'human_required' });
  });

  it('halts human-required when establishing a PR moves identity without a pushed branch', async () => {
    const draft = draftPrFakes((args) => {
      if (args[1] === 'view') return new Error('no pull requests found');
      if (args[1] === 'create') return { stdout: 'https://github.com/acme/widget/pull/1172\n' };
      return { stdout: '' };
    });
    const observe = vi
      .fn<() => Promise<PublicationSnapshot>>()
      .mockResolvedValueOnce(readyPublicationSnapshot({ pr: { identity: 'none' }, branchPushed: 'missing' }))
      .mockResolvedValueOnce(readyPublicationSnapshot({
        pr: {
          identity: 'one',
          url: 'https://github.com/acme/widget/pull/1172',
          prose: 'stale',
          ready: false,
        },
        branchPushed: 'missing',
      }));

    await expect(
      advanceFinishPublication({
        observe,
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), establishPr: draft.deps },
      }),
    ).resolves.toMatchObject({ kind: 'human_required' });
  });
});

describe('resolveUnattendedPublicationIntent', () => {
  it.each([
    [
      'daemon',
      {
        mode: 'daemon',
        capabilities: { remote: 'configured', authentication: 'authenticated' },
      },
      {
        outcome: 'pr',
        authority: { kind: 'unattended_policy', mode: 'daemon' },
      },
    ],
    [
      'foreground-auto with configured remote and authenticated publication',
      {
        mode: 'foreground-auto',
        capabilities: { remote: 'configured', authentication: 'authenticated' },
      },
      {
        outcome: 'pr',
        authority: { kind: 'unattended_policy', mode: 'foreground-auto' },
      },
    ],
    [
      'foreground-auto with no remote',
      {
        mode: 'foreground-auto',
        capabilities: { remote: 'missing', authentication: 'authenticated' },
      },
      {
        outcome: 'keep',
        authority: { kind: 'unattended_policy', mode: 'foreground-auto' },
      },
    ],
    [
      'foreground-auto with unavailable publication authentication',
      {
        mode: 'foreground-auto',
        capabilities: { remote: 'configured', authentication: 'unavailable' },
      },
      {
        outcome: 'keep',
        authority: { kind: 'unattended_policy', mode: 'foreground-auto' },
      },
    ],
  ] as const)('resolves the existing safe policy for %s', async (_row, input, expected) => {
    await expect(resolveUnattendedPublicationIntent(input)).resolves.toEqual(expected);
  });

  it('halts an outcome that daemon policy does not authorize instead of choosing keep', async () => {
    await expect(
      resolveUnattendedPublicationIntent({
        mode: 'daemon',
        capabilities: { remote: 'configured', authentication: 'authenticated' },
        requestedOutcome: 'keep',
      }),
    ).resolves.toEqual({
      kind: 'human_required',
      reason: 'unattended_intent_unauthorized_outcome',
    });
  });

  it.each([
    ['daemon', 'merge'],
    ['daemon', 'merge-local'],
    ['daemon', 'discard'],
    ['foreground-auto', 'merge'],
    ['foreground-auto', 'merge-local'],
    ['foreground-auto', 'discard'],
  ] as const)(
    'halts the destructive %s unattended %s request without synthesizing a mutation',
    async (mode, requestedOutcome) => {
      await expect(
        resolveUnattendedPublicationIntent({
          mode,
          capabilities: { remote: 'configured', authentication: 'authenticated' },
          requestedOutcome,
        }),
      ).resolves.toEqual({
        kind: 'human_required',
        reason: 'unattended_intent_destructive_choice',
      });
    },
  );
});

describe('advanceFinishPublication preflight', () => {
  it('reaches the judgment boundary once when observed publication, SHIP, and release readiness are valid', async () => {
    let prose: Extract<PublicationSnapshot['pr'], { identity: 'one' }>['prose'] = 'stale';
    const dispatchJudgment = vi.fn(async () => {
      prose = 'accepted';
      return { kind: 'accepted' };
    });

    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot({
          pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose, ready: false },
        }),
        effects: { dispatchJudgment },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'judge_pr_prose' });

    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
  });

  it('returns the exact release-readiness blocker before dispatching judgment', async () => {
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));

    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot({ releaseReadiness: 'invalid' }),
        effects: { dispatchJudgment },
      }),
    ).resolves.toEqual({
      kind: 'publication_retry',
      condition: {
        code: 'release_readiness_invalid',
        message: 'Release readiness is invalid. Restore a valid release readiness result, then retry FINISH.',
        nextAction: 'restore_release_readiness',
      },
    });

    expect(dispatchJudgment).not.toHaveBeenCalled();
  });

  it('selects the stable SHIP blocker before an indeterminate release-readiness result without dispatching judgment', async () => {
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));

    await expect(
      advanceFinishPublication({
        observe: async () =>
          readyPublicationSnapshot({ shipEvidence: 'invalid', releaseReadiness: 'indeterminate' }),
        effects: { dispatchJudgment },
      }),
    ).resolves.toEqual({
      kind: 'publication_retry',
      condition: {
        code: 'ship_evidence_invalid',
        message: 'SHIP evidence is invalid. Re-run the SHIP validators, then retry FINISH.',
        nextAction: 'rerun_ship_validators',
      },
    });

    expect(dispatchJudgment).not.toHaveBeenCalled();
  });
});

describe('advanceFinishPublication PR identity', () => {
  it('reuses an observed existing draft identity without opening another PR', async () => {
    let prose: Extract<PublicationSnapshot['pr'], { identity: 'one' }>['prose'] = 'stale';
    const dispatchJudgment = vi.fn(async () => {
      prose = 'accepted';
      return { kind: 'accepted' };
    });
    const draft = draftPrFakes(() => new Error('must not call GitHub'));

    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot({
          pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose, ready: false },
        }),
        effects: { dispatchJudgment, establishPr: draft.deps },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'judge_pr_prose' });

    expect(draft.gitCalls).toHaveLength(0);
    expect(draft.ghCalls).toHaveLength(0);
    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
  });

  it('opens exactly one draft PR and re-observes its identity before advancing', async () => {
    const draft = draftPrFakes((args) => {
      if (args[1] === 'view') return new Error('no pull requests found');
      if (args[1] === 'create') return { stdout: 'https://github.com/acme/widget/pull/1172\n' };
      return { stdout: '' };
    });
    const observe = vi
      .fn<() => Promise<PublicationSnapshot>>()
      .mockResolvedValueOnce(readyPublicationSnapshot({ pr: { identity: 'none' }, branchPushed: 'missing' }))
      .mockResolvedValueOnce(readyPublicationSnapshot());
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));

    await expect(
      advanceFinishPublication({ observe, effects: { dispatchJudgment, establishPr: draft.deps } }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'establish_pr' });

    expect(draft.ghCalls.filter((args) => args[1] === 'create')).toHaveLength(1);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });

  it('halts ambiguous PR identity without guessing a publication mutation', async () => {
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));
    const draft = draftPrFakes(() => new Error('must not call GitHub'));

    await expect(
      advanceFinishPublication({
        observe: async () =>
          readyPublicationSnapshot({
            pr: { identity: 'ambiguous', urls: ['https://github.com/acme/widget/pull/1', 'https://github.com/acme/widget/pull/2'] },
          }),
        effects: { dispatchJudgment, establishPr: draft.deps },
      }),
    ).resolves.toEqual({ kind: 'human_required', reason: 'ambiguous_pr_identity' });

    expect(draft.gitCalls).toHaveLength(0);
    expect(draft.ghCalls).toHaveLength(0);
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });

  it('does not claim PR identity when GitHub fails and re-observation remains absent', async () => {
    const draft = draftPrFakes(() => new Error('GitHub unavailable'));
    const observe = vi
      .fn<() => Promise<PublicationSnapshot>>()
      .mockResolvedValue(readyPublicationSnapshot({ pr: { identity: 'none' }, branchPushed: 'missing' }));
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));

    await expect(
      advanceFinishPublication({ observe, effects: { dispatchJudgment, establishPr: draft.deps } }),
    ).resolves.toEqual({
      kind: 'human_required',
      reason: 'publication_transition_unmoved',
      detail: 'The establish_pr transition left pr.identity + branchPushed unchanged at false.',
    });

    expect(observe).toHaveBeenCalledTimes(2);
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });
});

describe('advanceFinishPublication durable shipped evidence', () => {
  // `write_shipped_record` now follows accepted prose, so every fixture that
  // must reach it observes an authored body.
  const acceptedProsePr = {
    identity: 'one',
    url: 'https://github.com/acme/widget/pull/1172',
    prose: 'accepted',
    ready: false,
  } as const;
  const shippedSnapshot = (overrides: Partial<PublicationSnapshot> = {}): PublicationSnapshot =>
    readyPublicationSnapshot({ pr: acceptedProsePr, ...overrides });

  it('reuses an existing verified shipped record without invoking its writer', async () => {
    const createShippedRecord = vi.fn(async () => undefined);
    let prose: Extract<PublicationSnapshot['pr'], { identity: 'one' }>['prose'] = 'stale';
    const dispatchJudgment = vi.fn(async () => {
      prose = 'accepted';
      return { kind: 'accepted' };
    });

    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot({
          pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose, ready: false },
        }),
        effects: { dispatchJudgment, createShippedRecord },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'judge_pr_prose' });

    expect(createShippedRecord).not.toHaveBeenCalled();
    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
  });

  it('creates an absent shipped record once and re-observes strict evidence before advancing', async () => {
    let shippedRecord: PublicationSnapshot['shippedRecord'] = 'missing';
    const observe = vi.fn(async () => shippedSnapshot({ shippedRecord }));
    const createShippedRecord = vi.fn(async () => {
      shippedRecord = 'valid';
    });
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));

    await expect(
      advanceFinishPublication({
        observe,
        effects: { dispatchJudgment, createShippedRecord },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'write_shipped_record' });

    expect({ writes: createShippedRecord.mock.calls.length, observations: observe.mock.calls.length }).toEqual({
      writes: 1,
      observations: 2,
    });
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });

  it('refuses mismatched shipped evidence without overwriting it', async () => {
    const createShippedRecord = vi.fn(async () => undefined);
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));

    await expect(
      advanceFinishPublication({
        observe: async () => shippedSnapshot({ shippedRecord: 'invalid' }),
        effects: { dispatchJudgment, createShippedRecord },
      }),
    ).resolves.toEqual({ kind: 'human_required', reason: 'invalid_shipped_record' });

    expect(createShippedRecord).not.toHaveBeenCalled();
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });

  it('keeps FINISH retryable when the shipped-record push fails', async () => {
    const observe = vi.fn(async () => shippedSnapshot({ shippedRecord: 'missing' }));
    const createShippedRecord = vi.fn(async () => {
      throw new Error('git push failed');
    });
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));

    await expect(
      advanceFinishPublication({
        observe,
        effects: { dispatchJudgment, createShippedRecord },
      }),
    ).resolves.toEqual({
      kind: 'human_required',
      reason: 'publication_transition_unmoved',
      detail: 'The write_shipped_record transition left shippedRecord unchanged at missing.',
    });

    expect({ writes: createShippedRecord.mock.calls.length, observations: observe.mock.calls.length }).toEqual({
      writes: 1,
      observations: 2,
    });
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });

  it('recovers a lost writer response by verifying the record before retrying', async () => {
    let shippedRecord: PublicationSnapshot['shippedRecord'] = 'missing';
    const observe = vi.fn(async () => shippedSnapshot({ shippedRecord }));
    const createShippedRecord = vi.fn(async () => {
      shippedRecord = 'valid';
      throw new Error('writer response lost after push');
    });
    const dispatchJudgment = vi.fn(async () => undefined);

    await expect(
      advanceFinishPublication({
        observe,
        effects: { dispatchJudgment, createShippedRecord },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'write_shipped_record' });

    expect({ writes: createShippedRecord.mock.calls.length, observations: observe.mock.calls.length }).toEqual({
      writes: 1,
      observations: 2,
    });
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });
});

describe('advanceFinishPublication concurrent mutation reconciliation', () => {
  it.each([
    ['PR', 'establish_pr'],
    ['shipped record', 'write_shipped_record'],
    ['presentation', 'ready_pr'],
    ['final marker', 'record_outcome'],
  ] as const)('coalesces two callers at the same incomplete %s transition', async (_name, transition) => {
    const entered = deferred<void>();
    const secondObserved = deferred<void>();
    const release = deferred<void>();
    let effectCalls = 0;
    let observations = 0;
    let snapshot = readyPublicationSnapshot();

    const mutate = async (apply: () => void) => {
      effectCalls += 1;
      entered.resolve();
      await secondObserved.promise;
      await release.promise;
      apply();
    };

    const effects: AdvanceFinishPublicationInput['effects'] = {
      dispatchJudgment: async () => ({ kind: 'accepted' }),
    };

    switch (transition) {
      case 'establish_pr': {
        snapshot = readyPublicationSnapshot({ pr: { identity: 'none' }, branchPushed: 'missing' });
        effects.establishPr = {
          cwd: '/repo',
          branch: 'feat/widget',
          baseBranch: 'main',
          git: async (args) => {
            if (args[0] === 'rev-list') return { stdout: '1\n' };
            return { stdout: '' };
          },
          gh: async (args) => {
            if (args[1] === 'view') throw new Error('not found');
            if (args[1] === 'create') {
              await mutate(() => {
                snapshot = readyPublicationSnapshot();
              });
              return { stdout: 'https://github.com/acme/widget/pull/1172\n' };
            }
            return { stdout: '' };
          },
        };
        break;
      }
      case 'write_shipped_record': {
        // Accepted prose is a prerequisite for the shipped record now.
        const acceptedPr = {
          identity: 'one',
          url: 'https://github.com/acme/widget/pull/1172',
          prose: 'accepted',
          ready: false,
        } as const;
        snapshot = readyPublicationSnapshot({ pr: acceptedPr, shippedRecord: 'missing' });
        effects.createShippedRecord = () => mutate(() => {
          snapshot = readyPublicationSnapshot({ pr: acceptedPr });
        });
        break;
      }
      case 'ready_pr':
        snapshot = readyPublicationSnapshot({
          pr: {
            identity: 'one',
            url: 'https://github.com/acme/widget/pull/1172',
            prose: 'accepted',
            ready: false,
          },
        });
        effects.repairPresentation = () => mutate(() => {
          snapshot = readyPublicationSnapshot({
            pr: {
              identity: 'one',
              url: 'https://github.com/acme/widget/pull/1172',
              prose: 'accepted',
              ready: true,
            },
          });
        });
        break;
      case 'record_outcome':
        snapshot = readyPublicationSnapshot({
          pr: {
            identity: 'one',
            url: 'https://github.com/acme/widget/pull/1172',
            prose: 'accepted',
            ready: true,
          },
        });
        effects.recordOutcome = () => mutate(() => {
          snapshot = readyPublicationSnapshot({
            pr: {
              identity: 'one',
              url: 'https://github.com/acme/widget/pull/1172',
              prose: 'accepted',
              ready: true,
            },
            outcomeRecord: 'valid',
          });
        });
        break;
    }

    const observe = async () => {
      observations += 1;
      if (observations === 2) secondObserved.resolve();
      return structuredClone(snapshot);
    };
    const first = advanceFinishPublication({ observe, effects });
    await entered.promise;
    const second = advanceFinishPublication({ observe, effects });
    await secondObserved.promise;
    release.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(effectCalls).toBe(1);
    const expected = transition === 'record_outcome'
      ? { kind: 'complete' }
      : { kind: 'advanced', transition };
    expect([firstResult, secondResult]).toEqual([expected, expected]);
  });
});

describe('advanceFinishPublication PR prose judgment boundary', () => {
  it('halts without spending a FINISH retry when a prose-authoring retry is no longer selectable', async () => {
    const observe = vi
      .fn<() => Promise<PublicationSnapshot>>()
      .mockResolvedValueOnce(readyPublicationSnapshot())
      // The judgment reports prose that needs authoring, but the fresh
      // authoritative snapshot still selects judgment. Retrying authoring
      // would therefore re-enter FINISH unable to perform what it names.
      .mockResolvedValueOnce(readyPublicationSnapshot());

    const disposition = await advanceFinishPublication({
      observe,
      effects: {
        dispatchJudgment: async () => ({
          kind: 'revision_required',
          reason: 'placeholder',
          detail: 'The title and body are placeholders.',
        }),
      },
    });

    expect(disposition).toMatchObject({ kind: 'human_required' });
    expect(await routeFinishPublicationDisposition(disposition)).toMatchObject({ kind: 'halt' });
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it('keeps a judgment retry when the fresh snapshot still selects judgment', async () => {
    const observe = vi
      .fn<() => Promise<PublicationSnapshot>>()
      .mockResolvedValueOnce(readyPublicationSnapshot())
      .mockResolvedValueOnce(readyPublicationSnapshot());

    await expect(
      advanceFinishPublication({
        observe,
        effects: { dispatchJudgment: async () => ({ kind: 'timed_out' }) },
      }),
    ).resolves.toEqual({
      kind: 'publication_retry',
      transition: 'judge_pr_prose',
      reason: 'judgment_timed_out',
    });

    expect(observe).toHaveBeenCalledTimes(2);
  });

  it('skips judgment for accepted PR prose and proceeds to final verification', async () => {
    const dispatchJudgment = vi.fn(async () => undefined);

    await expect(
      advanceFinishPublication({
        observe: async () =>
          readyPublicationSnapshot({
          pr: {
            identity: 'one',
            url: 'https://github.com/acme/widget/pull/1172',
            prose: 'accepted',
            ready: true,
          },
          outcomeRecord: 'valid',
        }),
        effects: { dispatchJudgment },
      }),
    ).resolves.toEqual({ kind: 'complete' });

    expect(dispatchJudgment).not.toHaveBeenCalled();
  });

  it.each(['stale', 'halt'] as const)(
    'dispatches one bounded judgment pass for %s PR prose',
    async (prose) => {
      let observedProse: Extract<PublicationSnapshot['pr'], { identity: 'one' }>['prose'] = prose;
      let request: unknown;
      const dispatchJudgment = vi.fn(async (receivedRequest: unknown) => {
        request = receivedRequest;
        observedProse = 'accepted';
        return { kind: 'accepted' };
      });

      await expect(
        advanceFinishPublication({
          observe: async () =>
            readyPublicationSnapshot({
              pr: {
                identity: 'one',
                url: 'https://github.com/acme/widget/pull/1172',
                prose: observedProse,
                ready: false,
              },
            }),
          effects: { dispatchJudgment },
        }),
      ).resolves.toEqual({ kind: 'advanced', transition: 'judge_pr_prose' });

      expect(dispatchJudgment).toHaveBeenCalledTimes(1);
      expect(request).toEqual({
        kind: 'finish_pr_prose_quality',
        pullRequestUrl: 'https://github.com/acme/widget/pull/1172',
        qualityScope: ['title', 'body'],
        maximumPasses: 1,
      });
    },
  );

  it('dispatches again only when prose becomes stale after an accepted retry', async () => {
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));
    const observe = vi
      .fn<() => Promise<PublicationSnapshot>>()
      .mockResolvedValueOnce(
        readyPublicationSnapshot({
          pr: {
            identity: 'one',
            url: 'https://github.com/acme/widget/pull/1172',
            prose: 'accepted',
            ready: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        readyPublicationSnapshot({
          pr: {
            identity: 'one',
            url: 'https://github.com/acme/widget/pull/1172',
            prose: 'accepted',
            ready: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        readyPublicationSnapshot({
          pr: {
            identity: 'one',
            url: 'https://github.com/acme/widget/pull/1172',
            prose: 'stale',
            ready: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        readyPublicationSnapshot({
          pr: {
            identity: 'one',
            url: 'https://github.com/acme/widget/pull/1172',
            prose: 'accepted',
            ready: false,
          },
        }),
      );

    await expect(
      advanceFinishPublication({ observe, effects: { dispatchJudgment, repairPresentation: async () => undefined } }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'ready_pr' });
    expect(dispatchJudgment).not.toHaveBeenCalled();

    await expect(
      advanceFinishPublication({ observe, effects: { dispatchJudgment } }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'judge_pr_prose' });
    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['timeout', { kind: 'timed_out' }, 'judgment_timed_out'],
    ['provider unavailable', { kind: 'provider_unavailable' }, 'judgment_provider_unavailable'],
  ] as const)(
    'keeps verified publication progress retryable when judgment reports %s',
    async (_failure, judgmentResult, reason) => {
      const dispatchJudgment = vi.fn(async () => judgmentResult);
      const createShippedRecord = vi.fn(async () => undefined);
      const draft = draftPrFakes(() => new Error('must not create another PR'));

      await expect(
        advanceFinishPublication({
          observe: async () => readyPublicationSnapshot(),
          effects: { dispatchJudgment, createShippedRecord, establishPr: draft.deps },
        }),
      ).resolves.toEqual({
        kind: 'publication_retry',
        transition: 'judge_pr_prose',
        reason,
      });

      expect(dispatchJudgment).toHaveBeenCalledTimes(1);
      expect(createShippedRecord).not.toHaveBeenCalled();
      expect(draft.gitCalls).toHaveLength(0);
      expect(draft.ghCalls).toHaveLength(0);
    },
  );

  it.each([
    [
      'refusal',
      { kind: 'refused', detail: 'The provider declined the requested prose judgment.' },
      { kind: 'human_required', reason: 'judgment_refused', detail: 'The provider declined the requested prose judgment.' },
    ],
    [
      'halt boilerplate',
      { kind: 'revision_required', reason: 'halt', detail: 'The PR contains an unresolved operator blocker.' },
      { kind: 'human_required', reason: 'judgment_halt_prose', detail: 'The PR contains an unresolved operator blocker.' },
    ],
    [
      'placeholder prose',
      { kind: 'revision_required', reason: 'placeholder', detail: 'The title and body are placeholders.' },
      { kind: 'publication_retry', transition: 'author_pr_prose', reason: 'authoring_required_after_judgment' },
    ],
    [
      'structurally incomplete prose',
      { kind: 'revision_required', reason: 'structurally_incomplete', detail: 'The body is missing its validation section.' },
      { kind: 'publication_retry', transition: 'author_pr_prose', reason: 'authoring_required_after_judgment' },
    ],
  ] as const)(
    'preserves the established route while forwarding detail only for human-required %s judgments',
    async (_failure, judgmentResult, expected) => {
      const dispatchJudgment = vi.fn(async () => judgmentResult);
      const createShippedRecord = vi.fn(async () => undefined);
      const draft = draftPrFakes(() => new Error('must not create another PR'));

      await expect(
        advanceFinishPublication({
          observe: async () => readyPublicationSnapshot(),
          effects: { dispatchJudgment, createShippedRecord, establishPr: draft.deps },
        }),
      ).resolves.toEqual(expected);

      expect(dispatchJudgment).toHaveBeenCalledTimes(1);
      expect(createShippedRecord).not.toHaveBeenCalled();
      expect(draft.gitCalls).toHaveLength(0);
      expect(draft.ghCalls).toHaveLength(0);
    },
  );

  it('does not repeat judgment after a successful pass is re-observed as accepted', async () => {
    let prose: Extract<PublicationSnapshot['pr'], { identity: 'one' }>['prose'] = 'stale';
    let ready = false;
    const dispatchJudgment = vi.fn(async () => {
      prose = 'accepted';
      return { kind: 'accepted' };
    });
    const observe = vi.fn(async () =>
      readyPublicationSnapshot({
          pr: {
            identity: 'one',
            url: 'https://github.com/acme/widget/pull/1172',
            prose,
            ready,
        },
      }),
    );

    await expect(
      advanceFinishPublication({ observe, effects: { dispatchJudgment, repairPresentation: async () => undefined } }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'judge_pr_prose' });
    await expect(
      advanceFinishPublication({
        observe,
        effects: {
          dispatchJudgment,
          repairPresentation: async () => {
            ready = true;
          },
        },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'ready_pr' });

    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
  });
});

describe('advanceFinishPublication final outcome commit point', () => {
  it.each([
    [
      'PR',
      readyPublicationSnapshot({
        pr: {
          identity: 'one',
          url: 'https://github.com/acme/widget/pull/1172',
          prose: 'accepted',
          ready: true,
        },
      }),
      { choice: 'pr', prUrl: 'https://github.com/acme/widget/pull/1172' },
    ],
    [
      'authorized foreground-auto keep',
      readyPublicationSnapshot({
        mode: 'foreground-auto',
        intent: { outcome: 'keep', authority: { kind: 'unattended_policy', mode: 'foreground-auto' } },
        pr: {
          identity: 'one',
          url: 'https://github.com/acme/widget/pull/1172',
          prose: 'accepted',
          ready: true,
        },
      }),
      { choice: 'keep' },
    ],
  ] as const)('records the %s outcome only after a final coherent observation', async (_outcome, initial, request) => {
    const calls: string[] = [];
    const observe = vi
      .fn<() => Promise<PublicationSnapshot>>()
      .mockImplementationOnce(async () => {
        calls.push('observe-final-coherent-row');
        return initial;
      })
      .mockImplementationOnce(async () => {
        calls.push('observe-recorded-marker');
        return { ...initial, outcomeRecord: 'valid' } as PublicationSnapshot;
      });
    const recordOutcome = vi.fn(async (received: FinishOutcomeRecordRequest) => {
      calls.push('record-outcome');
      expect(received).toEqual(request);
    });

    await expect(
      advanceFinishPublication({
        observe,
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), recordOutcome },
      }),
    ).resolves.toEqual({ kind: 'complete' });

    expect(calls).toEqual([
      'observe-final-coherent-row',
      'record-outcome',
      'observe-recorded-marker',
    ]);
  });

  it('does not invoke the recorder until the final row is coherent and presentation-complete', async () => {
    const recordOutcome = vi.fn(async () => undefined);

    await expect(
      advanceFinishPublication({
        observe: async () =>
          readyPublicationSnapshot({
            shipEvidence: 'invalid',
            pr: {
              identity: 'one',
              url: 'https://github.com/acme/widget/pull/1172',
              prose: 'accepted',
              ready: true,
            },
          }),
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), recordOutcome },
      }),
    ).resolves.toMatchObject({ kind: 'publication_retry' });

    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it('keeps FINISH retryable when the injected recorder is interrupted after its state write and before its marker', async () => {
    const writes: string[] = [];
    const recordOutcome = vi.fn(async () => {
      writes.push('state-write');
      throw new Error('marker-write interrupted');
    });
    const observe = vi.fn(async () =>
      readyPublicationSnapshot({
        pr: {
          identity: 'one',
          url: 'https://github.com/acme/widget/pull/1172',
          prose: 'accepted',
          ready: true,
        },
      }),
    );

    await expect(
      advanceFinishPublication({
        observe,
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), recordOutcome },
      }),
    ).resolves.toEqual({
      kind: 'publication_retry',
      transition: 'record_outcome',
      reason: 'outcome_record_write_failed',
    });

    expect(writes).toEqual(['state-write']);
    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(2);
  });
});

describe('advanceFinishPublication accepted PR presentation', () => {
  function hasMergeAuthorityArg(calls: readonly string[][]): boolean {
    return calls.some((args) =>
      args.some((arg) => arg === 'merge' || arg === '--auto' || arg === '--auto-merge'),
    );
  }

  function fakePresentationGh(initial: {
    isDraft: boolean;
    labels?: string[];
    title?: string;
    body?: string;
  }) {
    const calls: string[][] = [];
    let isDraft = initial.isDraft;
    let labels = [...(initial.labels ?? [])];
    let title = initial.title ?? 'feat: widget';
    let body = initial.body ?? '## Summary\n\nAccepted presentation';
    const gh: GhRunner = async (args) => {
      calls.push([...args]);
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ isDraft, labels: labels.map((name) => ({ name })), title, body }) };
      }
      if (args[0] === 'api' && args.includes('--method') && args.includes('DELETE')) {
        labels = labels.filter((name) => name !== 'needs-remediation');
        return { stdout: '' };
      }
      if (args[0] === 'pr' && args[1] === 'ready') {
        isDraft = false;
        return { stdout: '' };
      }
      if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--title')) {
        title = args[args.indexOf('--title') + 1] ?? title;
      }
      if (args[0] === 'pr' && args[1] === 'edit' && args.includes('--body')) {
        body = args[args.indexOf('--body') + 1] ?? body;
      }
      return { stdout: '' };
    };
    return { gh, calls, isReady: () => !isDraft };
  }

  it('leaves a clean accepted ready PR untouched', async () => {
    const repairPresentation = vi.fn(async () => undefined);
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));

    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot({
          pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: true },
          outcomeRecord: 'valid',
        }),
        effects: { dispatchJudgment, repairPresentation },
      }),
    ).resolves.toEqual({ kind: 'complete' });

    expect(repairPresentation).not.toHaveBeenCalled();
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });

  it('repairs a reused halt PR only after accepted prose and re-observes it ready', async () => {
    const github = fakePresentationGh({ isDraft: true, labels: ['needs-remediation'] });
    let ready = false;
    const observe = vi.fn(async () => readyPublicationSnapshot({
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready },
    }));
    const repairPresentation = vi.fn(async () => {
      await rehabilitateHaltPr({
        gh: github.gh,
        cwd: '/repo',
        prUrl: 'https://github.com/acme/widget/pull/1172',
        sourceRef: null,
      });
      ready = github.isReady();
    });

    await expect(
      advanceFinishPublication({
        observe,
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), repairPresentation },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'ready_pr' });

    expect(repairPresentation).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(github.calls.some((args) => args[0] === 'pr' && args[1] === 'ready')).toBe(true);
    expect(hasMergeAuthorityArg(github.calls)).toBe(false);
  });

  it('flips an accepted draft PR ready and verifies the resulting observation', async () => {
    const github = fakePresentationGh({ isDraft: true });
    let ready = false;
    const observe = vi.fn(async () => readyPublicationSnapshot({
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready },
    }));
    const repairPresentation = vi.fn(async () => {
      await ensureShipReady(github.gh, '/repo', 'https://github.com/acme/widget/pull/1172', undefined, async () => {});
      ready = github.isReady();
    });

    await expect(
      advanceFinishPublication({
        observe,
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), repairPresentation },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'ready_pr' });

    expect(observe).toHaveBeenCalledTimes(2);
    expect(github.calls.filter((args) => args[0] === 'pr' && args[1] === 'ready')).toHaveLength(1);
    expect(hasMergeAuthorityArg(github.calls)).toBe(false);
  });

  it('refuses stale prose before it can invoke presentation repair', async () => {
    const repairPresentation = vi.fn(async () => undefined);
    const dispatchJudgment = vi.fn(async () => ({
      kind: 'revision_required' as const,
      reason: 'structurally_incomplete' as const,
    }));

    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot({
          pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'stale', ready: false },
        }),
        effects: { dispatchJudgment, repairPresentation },
      }),
    ).resolves.toEqual({
      kind: 'publication_retry',
      transition: 'author_pr_prose',
      reason: 'authoring_required_after_judgment',
    });

    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
    expect(repairPresentation).not.toHaveBeenCalled();
  });

  it('keeps accepted draft publication retryable when GitHub presentation repair is unavailable', async () => {
    const repairPresentation = vi.fn(async () => {
      throw new Error('GitHub unavailable');
    });

    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot({
          pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: false },
        }),
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), repairPresentation },
      }),
    ).resolves.toEqual({
      kind: 'publication_retry',
      transition: 'ready_pr',
      reason: 'presentation_repair_failed',
    });

    expect(repairPresentation).toHaveBeenCalledTimes(1);
  });
});

describe('FINISH publication observability', () => {
  it('emits a closed exact blocker without observed credential or URL content', async () => {
    const events: unknown[] = [];

    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot({
          releaseReadiness: 'missing',
          pr: {
            identity: 'one',
            url: 'https://secret.example.test/token=not-for-telemetry',
            prose: 'accepted',
            ready: true,
          },
        }),
        emit: (event) => { events.push(event); },
        effects: { dispatchJudgment: async () => ({ kind: 'accepted' }) },
      }),
    ).resolves.toMatchObject({
      kind: 'publication_retry',
      condition: { code: 'release_readiness_missing' },
    });

    expect(events).toEqual([{
      type: 'finish_publication_blocked',
      condition: 'release_readiness_missing',
    }]);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('emits a transition start and completion around one verified publication effect', async () => {
    const events: unknown[] = [];
    let shippedRecord: 'missing' | 'valid' = 'missing';
    const observe = async () => readyPublicationSnapshot({
      pr: {
        identity: 'one',
        url: 'https://example.test/pull/1172',
        prose: 'accepted',
        ready: true,
      },
      shippedRecord,
    });

    await expect(
      advanceFinishPublication({
        observe,
        emit: (event) => { events.push(event); },
        effects: {
          dispatchJudgment: async () => ({ kind: 'accepted' }),
          createShippedRecord: async () => { shippedRecord = 'valid'; },
        },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'write_shipped_record' });

    expect(events).toEqual([
      { type: 'finish_publication_transition', phase: 'started', transition: 'write_shipped_record' },
      { type: 'finish_publication_transition', phase: 'completed', transition: 'write_shipped_record' },
    ]);
  });
});
