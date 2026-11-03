// Covers: task:7, task:24
import { describe, expect, it, vi } from 'vitest';
import {
  nextFinishPublicationTransition,
  advanceFinishPublication,
  observePublicationSnapshot,
  type PublicationObservationPorts,
  type PublicationSnapshot,
} from '../../src/engine/finish-publication.js';
import { observePublishedStackRefresh } from '../../src/engine/finish-publication-production.js';

function snapshot(overrides: Partial<PublicationSnapshot> = {}): PublicationSnapshot {
  return {
    mode: 'daemon',
    intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
    implementationEvidence: 'valid',
    shipEvidence: 'valid',
    releaseReadiness: 'valid',
    branchPushed: 'valid',
    shippedRecord: 'valid',
    outcomeRecord: 'missing',
    pr: {
      identity: 'one',
      url: 'https://github.com/acme/widget/pull/1',
      prose: 'accepted',
      ready: true,
    },
    ...overrides,
  } as PublicationSnapshot;
}

function observationPorts(): PublicationObservationPorts {
  return {
    filesystem: {
      observeImplementationEvidence: async () => ({ state: 'present' }),
      observeShipEvidence: async () => 'present',
      observeOutcomeRecord: async () => 'missing',
    },
    git: { observePushEvidence: async () => 'pushed' },
    github: {
      observePullRequest: async () => ({
        state: 'one',
        url: 'https://github.com/acme/widget/pull/1',
        prose: 'accepted',
        ready: true,
      }),
    },
    shippedRecord: { observeShippedRecord: async () => 'present' },
    releaseReadiness: { observeReleaseReadiness: async () => 'present' },
    stack: {
      observeStackDimension: async () => 'not-applicable',
      observeStackRefresh: async () => 'not-applicable',
    },
  };
}

describe('FINISH published-member refresh selection', () => {
  it('selects the pending refresh before establishing an otherwise missing PR', () => {
    expect(nextFinishPublicationTransition(snapshot({
      stackRefresh: 'push-pending',
      pr: { identity: 'none' },
      branchPushed: 'missing',
    }))).toBe('refresh_published_members');
  });

  it('does not create or establish stack PRs after a settled refresh', () => {
    const transition = nextFinishPublicationTransition(snapshot({ stackRefresh: 'settled' }));

    expect(transition).toBe('record_outcome');
    expect(transition).not.toBe('refresh_published_members');
    expect(transition).not.toBe('establish_child_prs');
  });

  it('keeps an authorized outcome terminal and observes no-ledger refreshes as not applicable', async () => {
    const stackRefresh = await observePublishedStackRefresh({
      root: '/worktree',
      slug: 'demo',
      git: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
    });
    const observed = await observePublicationSnapshot({
      mode: 'foreground-auto',
      intent: { outcome: 'keep', authority: { kind: 'unattended_policy', mode: 'foreground-auto' } },
      ports: {
        ...observationPorts(),
        stack: {
          observeStackDimension: async () => 'not-applicable',
          observeStackRefresh: async () => stackRefresh,
        },
      },
    });

    expect(observed.stackRefresh).toBe('not-applicable');
    expect(nextFinishPublicationTransition(observed)).toBe('record_outcome');
  });

  it('does not cross the refresh effect when FINISH preflight rejects implementation evidence', async () => {
    const refreshPublishedMembers = vi.fn(async () => undefined);
    await expect(advanceFinishPublication({
      observe: async () => snapshot({
        implementationEvidence: 'invalid',
        unsatisfiedImplementationEvidenceMembers: ['build_review'],
        stackRefresh: 'push-pending',
      }),
      effects: {
        dispatchJudgment: async () => ({ kind: 'accepted' }),
        refreshPublishedMembers,
      },
    })).resolves.toMatchObject({ kind: 'implementation_invalid' });
    expect(refreshPublishedMembers).not.toHaveBeenCalled();
  });

  it('selects the routed-comment transition after member refresh', () => {
    expect(nextFinishPublicationTransition(snapshot({
      stackRefresh: 'comments-owed',
    }))).toBe('post_routed_comments');
  });
});
