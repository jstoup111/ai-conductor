// Covers: task:11, task:14
import { describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import {
  nextFinishPublicationTransition,
  advanceFinishPublication,
  observePublicationSnapshot,
  type PublicationSnapshot,
  type PublicationObservationPorts,
} from '../../src/engine/finish-publication.js';
import { observePublishedStackRefresh, postRoutedComments } from '../../src/engine/finish-publication-production.js';
import {
  refreshLedgerRefFor,
  routedCommentTargets,
  type RefreshLedger,
  type RoutedCommentTarget,
} from '../../src/engine/stack-refresh-ledger.js';
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

const repository = 'acme/widget';
const ledgerBlob = 'c'.repeat(40);
const nextBlob = 'd'.repeat(40);

function commentsOwedSnapshot(): PublicationSnapshot {
  return {
    mode: 'daemon',
    intent: { outcome: 'pr', authority: { kind: 'unattended_policy', mode: 'daemon' } },
    implementationEvidence: 'valid',
    shipEvidence: 'valid',
    releaseReadiness: 'valid',
    branchPushed: 'valid',
    shippedRecord: 'valid',
    outcomeRecord: 'missing',
    stackRefresh: 'comments-owed',
    pr: { identity: 'one', url: `https://github.com/${repository}/pull/101`, prose: 'accepted', ready: true },
  };
}

function owedLedger(rounds: RefreshLedger['rounds'], aboveOwed: RefreshLedger['aboveOwed'] = []): RefreshLedger {
  return {
    version: 1,
    members: {
      'feat/c1/demo': { position: host, pr: 101, publishedTip: tip, recordedTip: blob as never },
      'feat/c2/demo': { position: parseChildId(2)!, pr: 102, publishedTip: tip, recordedTip: blob as never },
      'feat/c3/demo': { position: parseChildId(3)!, pr: 103, publishedTip: tip, recordedTip: blob as never },
    },
    rounds,
    aboveOwed,
    posted: [],
  };
}

function commentFixture(input: {
  ledger: RefreshLedger;
  targets: readonly RoutedCommentTarget[];
  bodies: Readonly<Record<number, string>>;
}) {
  let ledger = input.ledger;
  let blobAtRef = ledgerBlob;
  const calls: string[][] = [];
  const git = vi.fn(async (args: readonly string[], options?: { input?: string }) => {
    if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${blobAtRef}\n`, stderr: '' };
    if (args[0] === 'cat-file') return { exitCode: 0, stdout: JSON.stringify(ledger), stderr: '' };
    if (args[0] === 'hash-object') {
      ledger = JSON.parse(options?.input ?? '{}') as RefreshLedger;
      return { exitCode: 0, stdout: `${nextBlob}\n`, stderr: '' };
    }
    if (args[0] === 'update-ref') {
      blobAtRef = nextBlob;
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    throw new Error(`unexpected git operation: ${args.join(' ')}`);
  });
  const gh = vi.fn(async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ comments: [] }) };
    if (args[0] === 'pr' && args[1] === 'comment') return { stdout: '' };
    throw new Error(`unexpected gh operation: ${args.join(' ')}`);
  });
  return {
    calls,
    git,
    ledger: () => ledger,
    run: () => postRoutedComments({
      root: '/worktree', slug: 'demo', baseBranch: 'main', repository, git, gh,
      routedCommentTargets: async () => ({ kind: 'targets', targets: input.targets }),
      renderHostComment: async ({ target }) => ({ kind: 'body', body: input.bodies[target.pr]! }),
      renderMemberAboveComment: async ({ target }) => ({ kind: 'body', body: input.bodies[target.pr]! }),
    }),
  };
}

describe('FINISH routed fix comments', () => {
  it('posts every owed marker once and CAS-records the receipts', async () => {
    const first = '<!-- conductor:routed-fix:r1:101 -->';
    const second = '<!-- conductor:routed-fix:r2:102 -->';
    const fixture = commentFixture({
      ledger: owedLedger([
        { roundId, kind: 'audit', host, marker: first },
        { roundId: parseRoundId('r2')!, kind: 'audit', host: parseChildId(2)!, marker: second },
      ]),
      targets: [
        { kind: 'host', pr: 101, roundId, rebaseOnly: [] },
        { kind: 'host', pr: 102, roundId: parseRoundId('r2')!, rebaseOnly: [] },
      ],
      bodies: { 101: `first\n${first}`, 102: `second\n${second}` },
    });

    await fixture.run();

    expect({
      scans: fixture.calls.filter((args) => args[0] === 'pr' && args[1] === 'view'),
      creates: fixture.calls.filter((args) => args[0] === 'pr' && args[1] === 'comment'),
      posted: fixture.ledger().posted,
      cas: fixture.git.mock.calls.filter(([args]) => args[0] === 'update-ref').map(([args]) => args),
    }).toEqual({
      scans: [
        ['pr', 'view', '101', '-R', repository, '--json', 'comments'],
        ['pr', 'view', '102', '-R', repository, '--json', 'comments'],
      ],
      creates: [
        ['pr', 'comment', '101', '-R', repository, '--body', `first\n${first}`],
        ['pr', 'comment', '102', '-R', repository, '--body', `second\n${second}`],
      ],
      posted: [first, second],
      cas: [
        ['update-ref', refreshLedgerRefFor('demo'), nextBlob, ledgerBlob],
        ['update-ref', refreshLedgerRefFor('demo'), nextBlob, nextBlob],
      ],
    });
  });

  it('selects owed comments before the finish outcome', () => {
    expect(nextFinishPublicationTransition(commentsOwedSnapshot())).toBe('post_routed_comments');
  });

  it('runs the owed-comment effect instead of recording the outcome', async () => {
    let settled = false;
    const postRoutedComments = vi.fn(async () => { settled = true; });
    const recordOutcome = vi.fn(async () => undefined);

    const result = await advanceFinishPublication({
      observe: async () => ({ ...commentsOwedSnapshot(), stackRefresh: settled ? 'settled' : 'comments-owed' }),
      effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), postRoutedComments, recordOutcome },
    });

    expect({ result, posts: postRoutedComments.mock.calls.length, outcomes: recordOutcome.mock.calls.length }).toEqual({
      result: { kind: 'advanced', transition: 'post_routed_comments' }, posts: 1, outcomes: 0,
    });
  });

  it('names each routed host in its own comment when one FINISH refreshes two rounds', async () => {
    const first = '<!-- conductor:routed-fix:r1:101 -->';
    const second = '<!-- conductor:routed-fix:r2:102 -->';
    const fixture = commentFixture({
      ledger: owedLedger([
        { roundId, kind: 'audit', host, marker: first },
        { roundId: parseRoundId('r2')!, kind: 'operator', host: parseChildId(2)!, marker: second },
      ]),
      targets: [
        { kind: 'host', pr: 101, roundId, rebaseOnly: [] },
        { kind: 'host', pr: 102, roundId: parseRoundId('r2')!, rebaseOnly: [] },
      ],
      bodies: { 101: `audit host #101\n${first}`, 102: `operator host #102\n${second}` },
    });

    await fixture.run();

    expect(fixture.calls.filter((args) => args[1] === 'comment').map((args) => ({ pr: args[2], body: args[6] }))).toEqual([
      { pr: '101', body: `audit host #101\n${first}` },
      { pr: '102', body: `operator host #102\n${second}` },
    ]);
  });

  it('posts the host and changed child but not a clean replay child', async () => {
    const hostMarker = '<!-- conductor:routed-fix:r1:101 -->';
    const changedMarker = `<!-- conductor:routed-refresh:${blob}:102 -->`;
    const fixture = commentFixture({
      ledger: owedLedger(
        [{ roundId, kind: 'audit', host, marker: hostMarker }],
        [{ pr: 102, hostPr: 101, newTip: blob as never, marker: changedMarker }],
      ),
      targets: [
        { kind: 'host', pr: 101, roundId, rebaseOnly: [103] },
        { kind: 'member-above', pr: 102, hostPr: 101, newTip: blob as never },
      ],
      bodies: {
        101: `host #101\nRebased without diff change:\n- PR #103 was rebased with no diff change.\n${hostMarker}`,
        102: `This PR's diff changed while carrying the routed fix from #101.\n${changedMarker}`,
      },
    });

    await fixture.run();

    expect(fixture.calls.filter((args) => args[1] === 'comment').map((args) => ({ pr: args[2], body: args[6] }))).toEqual([
      { pr: '101', body: expect.stringContaining('PR #103 was rebased with no diff change.') },
      { pr: '102', body: expect.stringContaining('routed fix from #101') },
    ]);
  });
});
