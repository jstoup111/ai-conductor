import { describe, expect, it } from 'vitest';
import { validatePublicationSnapshot } from '../../src/engine/finish-publication.js';

const FINISH_PUBLICATION_MODULE = '../../src/engine/finish-publication.js';

type ObservationState = 'present' | 'missing' | 'stale' | 'malformed' | 'unavailable';
type PushObservationState = 'pushed' | 'unpushed' | 'stale' | 'malformed' | 'unavailable';

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
      | { state: 'one'; url: string; prose: 'accepted' | 'stale' | 'placeholder'; ready: boolean }
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
