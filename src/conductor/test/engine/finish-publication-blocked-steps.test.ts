// Covers: task:2
import { describe, expect, it } from 'vitest';
import {
  advanceFinishPublication,
  observePublicationSnapshot,
  preflightFinishPublication,
  type PublicationObservationPorts,
} from '../../src/engine/finish-publication.js';

type ReleaseReadinessObservation =
  | 'present'
  | 'missing'
  | 'stale'
  | 'malformed'
  | 'unavailable';

function ports(releaseReadiness: ReleaseReadinessObservation | {
  observation: ReleaseReadinessObservation;
  steps: readonly string[];
}): PublicationObservationPorts {
  return {
    filesystem: {
      observeImplementationEvidence: async () => ({ state: 'present' }),
      observeShipEvidence: async () => 'present',
      observeOutcomeRecord: async () => 'missing',
    },
    git: { observePushEvidence: async () => 'pushed' },
    github: {
      observePullRequest: async () => ({
        state: 'one', url: 'https://github.com/acme/widget/pull/1172', prose: 'stale', ready: false,
      }),
    },
    shippedRecord: { observeShippedRecord: async () => 'present' },
    releaseReadiness: {
      observeReleaseReadiness: async () => releaseReadiness as never,
    },
  };
}

async function advance(releaseReadiness: Parameters<typeof ports>[0]) {
  return advanceFinishPublication({
    observe: () => observePublicationSnapshot({
      mode: 'daemon',
      intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
      ports: ports(releaseReadiness),
    }),
    effects: { dispatchJudgment: async () => ({ kind: 'accepted' }) },
  });
}

describe('FINISH release-readiness blocked steps', () => {
  it('reports the missing blocker with its unsatisfied compliance gate', async () => {
    await expect(advance({ observation: 'missing', steps: ['compliance-gate'] })).resolves.toMatchObject({
      kind: 'publication_retry',
      condition: {
        code: 'release_readiness_missing',
        message: expect.stringContaining('compliance-gate'),
        steps: ['compliance-gate'],
      },
    });
  });

  it.each([
    ['stale', 'release_readiness_invalid'],
    ['unavailable', 'release_readiness_indeterminate'],
  ] as const)('carries both unsatisfied steps on the %s blocker', async (observation, code) => {
    await expect(advance({ observation, steps: ['compliance-gate', 'notes-gate'] })).resolves.toMatchObject({
      kind: 'publication_retry',
      condition: {
        code,
        message: expect.stringContaining('compliance-gate'),
        steps: ['compliance-gate', 'notes-gate'],
      },
    });
  });

  it('does not classify an unavailable readiness observation as missing or invalid', async () => {
    const result = await advance({ observation: 'unavailable', steps: ['compliance-gate'] });
    expect(result).toMatchObject({
      kind: 'publication_retry', condition: { code: 'release_readiness_indeterminate' },
    });
  });

  it('admits present readiness to publication and preserves the base blocker codes and dispositions', async () => {
    const presentSnapshot = await observePublicationSnapshot({
        mode: 'daemon',
        intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
        ports: ports('present'),
    });
    const blocked = await Promise.all(
      (['missing', 'stale', 'unavailable'] as const).map(async (observation) => {
        const snapshot = await observePublicationSnapshot({
          mode: 'daemon',
          intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
          ports: ports(observation),
        });
        return preflightFinishPublication(snapshot);
      }),
    );

    expect({ present: preflightFinishPublication(presentSnapshot), blocked }).toEqual({
      present: { kind: 'ready_for_judgment' },
      blocked: [
        { kind: 'blocked', condition: {
          code: 'release_readiness_missing',
          message: 'Release readiness is missing. Publish a valid release readiness result, then retry FINISH.',
          nextAction: 'publish_release_readiness',
        } },
        { kind: 'blocked', condition: {
          code: 'release_readiness_invalid',
          message: 'Release readiness is invalid. Restore a valid release readiness result, then retry FINISH.',
          nextAction: 'restore_release_readiness',
        } },
        { kind: 'blocked', condition: {
          code: 'release_readiness_indeterminate',
          message: 'Release readiness could not be determined. Restore the readiness observer, then retry FINISH.',
          nextAction: 'restore_release_readiness_observation',
        } },
      ],
    });
  });
});
