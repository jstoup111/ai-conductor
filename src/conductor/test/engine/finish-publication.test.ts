import { describe, expect, it } from 'vitest';
import { validatePublicationSnapshot } from '../../src/engine/finish-publication.js';

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
