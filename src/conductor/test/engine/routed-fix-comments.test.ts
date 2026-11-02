// Covers: task:11
import { describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import {
  nextFinishPublicationTransition,
  observePublicationSnapshot,
  type PublicationObservationPorts,
} from '../../src/engine/finish-publication.js';
import { observePublishedStackRefresh } from '../../src/engine/finish-publication-production.js';
import { routedCommentTargets, type RefreshLedger } from '../../src/engine/stack-refresh-ledger.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';

const tip = 'a'.repeat(40) as never;
const blob = 'b'.repeat(40);
const host = parseChildId(1)!;
const roundId = parseRoundId('r1')!;

function unchangedRoutedLedger(): RefreshLedger {
  return {
    version: 1,
    members: {
      'feat/c1/demo': { position: host, pr: 101, publishedTip: tip, recordedTip: tip },
    },
    rounds: [{ roundId, kind: 'audit', host, marker: '<!-- conductor:routed-fix:r1:101 -->' }],
    aboveOwed: [],
    posted: [],
  };
}

function publicationPorts(stack: PublicationObservationPorts['stack']): PublicationObservationPorts {
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
    ...(stack === undefined ? {} : { stack }),
  };
}

async function observeFinish(stack: PublicationObservationPorts['stack']) {
  return observePublicationSnapshot({
    mode: 'daemon',
    intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
    ports: publicationPorts(stack),
  });
}

describe('routed fix comment exclusions', () => {
  it('does not target an unchanged routed member', async () => {
    const git = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${blob}\n`, stderr: '' };
      if (args[0] === 'cat-file') return { exitCode: 0, stdout: JSON.stringify(unchangedRoutedLedger()), stderr: '' };
      throw new Error(`unexpected git operation: ${args.join(' ')}`);
    });

    await expect(routedCommentTargets({
      worktree: '/worktree', slug: 'demo', baseBranch: 'main', git,
    })).resolves.toEqual({ kind: 'targets', targets: [] });
  });

  it('does not select routed comments for an unpublished stack with a routed fix', async () => {
    const stackRefresh = await observePublishedStackRefresh({
      root: '/worktree',
      slug: 'unpublished-routed-fix',
      git: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
    });
    const snapshot = await observeFinish({
      observeStackDimension: async () => 'not-applicable',
      observeStackRefresh: async () => stackRefresh,
    });

    expect({ stackRefresh: snapshot.stackRefresh, transition: nextFinishPublicationTransition(snapshot) })
      .toEqual({ stackRefresh: 'not-applicable', transition: 'record_outcome' });
  });

  it('does not select routed comments for a remediated single-PR feature', async () => {
    const snapshot = await observeFinish(undefined);

    expect({ stackRefresh: snapshot.stackRefresh, transition: nextFinishPublicationTransition(snapshot) })
      .toEqual({ stackRefresh: 'not-applicable', transition: 'record_outcome' });
  });
});
