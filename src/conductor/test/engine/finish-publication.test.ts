import { describe, expect, it, vi } from 'vitest';
import { validatePublicationSnapshot } from '../../src/engine/finish-publication.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';

const FINISH_PUBLICATION_MODULE = '../../src/engine/finish-publication.js';

type ObservationState = 'present' | 'missing' | 'stale' | 'malformed' | 'unavailable';
type PushObservationState = 'pushed' | 'unpushed' | 'stale' | 'malformed' | 'unavailable';
type PublicationSnapshot = import('../../src/engine/finish-publication.js').PublicationSnapshot;

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
  effects: {
    dispatchJudgment(...args: unknown[]): Promise<unknown>;
    createShippedRecord?: () => Promise<void>;
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

type AdvanceFinishPublicationResult =
  | { kind: 'advanced'; transition: 'judge_pr_prose' | 'establish_pr' | 'write_shipped_record' }
  | { kind: 'publication_retry'; condition: PublicationCondition }
  | { kind: 'publication_retry'; transition: 'establish_pr' | 'write_shipped_record'; reason: string }
  | { kind: 'human_required'; reason: 'ambiguous_pr_identity' | 'invalid_shipped_record' };

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
      prose: 'placeholder',
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

describe('finish-publication domain types', () => {
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

    const destructiveIntent: PublicationIntent = {
      // @ts-expect-error Unattended authority cannot choose an operator-only destructive outcome.
      outcome: 'merge',
      authority: { kind: 'unattended_policy', mode: 'daemon' },
    };

    void [mismatchedSnapshot, transition, disposition, destructiveIntent];

    await expect(import('../../src/engine/finish-publication.js')).resolves.toBeTypeOf('object');
  });

  it('selects release readiness as the first incomplete daemon PR transition', async () => {
    type PublicationIntent = import('../../src/engine/finish-publication.js').PublicationIntent;
    type PublicationSnapshot = import('../../src/engine/finish-publication.js').PublicationSnapshot;
    type PublicationTransition = import('../../src/engine/finish-publication.js').PublicationTransition;

    const snapshot: PublicationSnapshot = {
      mode: 'daemon',
      intent: {
        outcome: 'pr',
        authority: { kind: 'unattended_policy', mode: 'daemon' },
      } satisfies PublicationIntent,
      implementationEvidence: 'valid',
      shipEvidence: 'valid',
      releaseReadiness: 'missing',
      branchPushed: 'valid',
      pr: { identity: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'accepted', ready: true },
      shippedRecord: 'valid',
      outcomeRecord: 'valid',
    };
    const module = await import('../../src/engine/finish-publication.js');
    const nextFinishPublicationTransition = Reflect.get(module, 'nextFinishPublicationTransition') as (
      snapshot: PublicationSnapshot,
    ) => PublicationTransition;

    expect(nextFinishPublicationTransition(snapshot)).toBe('verify_release_readiness');
  });

  it('rejects a valid local outcome record without an external PR identity', () => {
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

    expect(validatePublicationSnapshot(snapshot)).toEqual({
      kind: 'incoherent',
      reason: 'valid_outcome_record_requires_external_pr',
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
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));

    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot(),
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
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));
    const draft = draftPrFakes(() => new Error('must not call GitHub'));

    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot(),
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
      kind: 'publication_retry',
      transition: 'establish_pr',
      reason: 'draft_pr_failed',
    });

    expect(observe).toHaveBeenCalledTimes(2);
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });
});

describe('advanceFinishPublication durable shipped evidence', () => {
  it('reuses an existing verified shipped record without invoking its writer', async () => {
    const createShippedRecord = vi.fn(async () => undefined);
    const dispatchJudgment = vi.fn(async () => ({ kind: 'accepted' }));

    await expect(
      advanceFinishPublication({
        observe: async () => readyPublicationSnapshot(),
        effects: { dispatchJudgment, createShippedRecord },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'judge_pr_prose' });

    expect(createShippedRecord).not.toHaveBeenCalled();
    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
  });

  it('creates an absent shipped record once and re-observes strict evidence before advancing', async () => {
    let shippedRecord: PublicationSnapshot['shippedRecord'] = 'missing';
    const observe = vi.fn(async () => readyPublicationSnapshot({ shippedRecord }));
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
        observe: async () => readyPublicationSnapshot({ shippedRecord: 'invalid' }),
        effects: { dispatchJudgment, createShippedRecord },
      }),
    ).resolves.toEqual({ kind: 'human_required', reason: 'invalid_shipped_record' });

    expect(createShippedRecord).not.toHaveBeenCalled();
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });

  it('keeps FINISH retryable when the shipped-record push fails', async () => {
    const observe = vi.fn(async () => readyPublicationSnapshot({ shippedRecord: 'missing' }));
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
      kind: 'publication_retry',
      transition: 'write_shipped_record',
      reason: 'shipped_record_write_failed',
    });

    expect({ writes: createShippedRecord.mock.calls.length, observations: observe.mock.calls.length }).toEqual({
      writes: 1,
      observations: 2,
    });
    expect(dispatchJudgment).not.toHaveBeenCalled();
  });

  it('recovers a lost writer response by verifying the record before retrying', async () => {
    let shippedRecord: PublicationSnapshot['shippedRecord'] = 'missing';
    const observe = vi.fn(async () => readyPublicationSnapshot({ shippedRecord }));
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

describe('advanceFinishPublication PR prose judgment boundary', () => {
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
          }),
        effects: { dispatchJudgment },
      }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'record_outcome' });

    expect(dispatchJudgment).not.toHaveBeenCalled();
  });

  it.each(['placeholder', 'halt'] as const)(
    'dispatches one bounded judgment pass for %s PR prose',
    async (prose) => {
      let request: unknown;
      const dispatchJudgment = vi.fn(async (receivedRequest: unknown) => {
        request = receivedRequest;
        return { kind: 'accepted' };
      });

      await expect(
        advanceFinishPublication({
          observe: async () =>
            readyPublicationSnapshot({
              pr: {
                identity: 'one',
                url: 'https://github.com/acme/widget/pull/1172',
                prose,
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
            prose: 'stale',
            ready: false,
          },
        }),
      );

    await expect(
      advanceFinishPublication({ observe, effects: { dispatchJudgment } }),
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
    ['refusal', { kind: 'refused' }, 'judgment_refused'],
    [
      'malformed prose',
      { kind: 'revision_required', reason: 'structurally_incomplete' },
      'judgment_malformed_prose',
    ],
  ] as const)(
    'requires a human without rolling back verified publication progress when judgment returns %s',
    async (_failure, judgmentResult, reason) => {
      const dispatchJudgment = vi.fn(async () => judgmentResult);
      const createShippedRecord = vi.fn(async () => undefined);
      const draft = draftPrFakes(() => new Error('must not create another PR'));

      await expect(
        advanceFinishPublication({
          observe: async () => readyPublicationSnapshot(),
          effects: { dispatchJudgment, createShippedRecord, establishPr: draft.deps },
        }),
      ).resolves.toEqual({ kind: 'human_required', reason });

      expect(dispatchJudgment).toHaveBeenCalledTimes(1);
      expect(createShippedRecord).not.toHaveBeenCalled();
      expect(draft.gitCalls).toHaveLength(0);
      expect(draft.ghCalls).toHaveLength(0);
    },
  );

  it('does not repeat judgment after a successful pass is re-observed as accepted', async () => {
    let prose: Extract<PublicationSnapshot['pr'], { identity: 'one' }>['prose'] = 'placeholder';
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
          ready: false,
        },
      }),
    );

    await expect(
      advanceFinishPublication({ observe, effects: { dispatchJudgment } }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'judge_pr_prose' });
    await expect(
      advanceFinishPublication({ observe, effects: { dispatchJudgment } }),
    ).resolves.toEqual({ kind: 'advanced', transition: 'ready_pr' });

    expect(dispatchJudgment).toHaveBeenCalledTimes(1);
  });
});
