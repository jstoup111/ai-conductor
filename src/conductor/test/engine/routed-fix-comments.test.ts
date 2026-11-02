// Covers: task:11, task:14, task:15, task:16, task:17, task:18
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
  mergeRefreshLedger,
  refreshLedgerRefFor,
  routedCommentTargets,
  type RefreshLedger,
  type RoutedCommentTarget,
} from '../../src/engine/stack-refresh-ledger.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';
import type {
  GithubOperationRequest,
  GithubOperationRunner,
  GithubOperationRunnerRefusal,
  GithubOperationRunnerResponse,
} from '../../src/engine/github-operations.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const tip = 'a'.repeat(40) as never;
const blob = 'b'.repeat(40);
const host = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
type GithubOperationRun = (request: GithubOperationRequest) => Promise<GithubOperationRunnerResponse | GithubOperationRunnerRefusal>;

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
  it('does not target an unchanged routed member when a later member changed', async () => {
    const unchangedTip = 'c'.repeat(40) as never;
    const changedPublishedTip = 'd'.repeat(40) as never;
    const changedRecordedTip = 'e'.repeat(40) as never;
    let ledger: RefreshLedger = {
      version: 1,
      members: {
        'feat/c1/demo': { position: host, pr: 101, publishedTip: tip, recordedTip: blob as never },
        'feat/c2/demo': { position: parseChildId(2)!, pr: 102, publishedTip: unchangedTip, recordedTip: unchangedTip },
        'feat/c3/demo': { position: parseChildId(3)!, pr: 103, publishedTip: changedPublishedTip, recordedTip: changedRecordedTip },
      },
      rounds: [{ roundId, kind: 'audit', host, marker: '<!-- conductor:routed-fix:r1:101 -->' }],
      aboveOwed: [],
      posted: [],
    };
    let blobAtRef = ledgerBlob;
    const git = vi.fn(async (args: readonly string[], options?: { input?: string }) => {
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${blobAtRef}\n`, stderr: '' };
      if (args[0] === 'cat-file') return { exitCode: 0, stdout: JSON.stringify(ledger), stderr: '' };
      if (args[0] === 'diff') return { exitCode: 0, stdout: args[2]!, stderr: '' };
      if (args[0] === 'patch-id') return {
        exitCode: 0,
        stdout: options?.input === changedRecordedTip ? 'changed\n' : 'published\n',
        stderr: '',
      };
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

    const targetsResult = await routedCommentTargets({
      worktree: '/worktree', slug: 'demo', baseBranch: 'main', git,
    });
    expect(targetsResult).toEqual({
      kind: 'targets',
      targets: [
        { kind: 'host', pr: 101, roundId, rebaseOnly: [] },
        { kind: 'member-above', pr: 103, hostPr: 101, newTip: changedRecordedTip },
      ],
    });
    if (targetsResult.kind !== 'targets') throw new Error('expected routed comment targets');

    const operationRun = vi.fn<GithubOperationRun>(async () => ({}));
    const operations: GithubOperationRunner = { run: operationRun };
    const fixture = commentFixture({
      ledger,
      targets: targetsResult.targets,
      bodies: {
        101: 'host comment',
        103: `changed child\n<!-- conductor:routed-refresh:${changedRecordedTip}:101:103 -->`,
      },
      operations,
    });
    await expect(fixture.run()).resolves.toBeUndefined();

    expect(operations.run).not.toHaveBeenCalledWith(expect.objectContaining({
      target: { repository, kind: 'pull-request', number: 102 },
    }));
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

function owedLedger(
  rounds: RefreshLedger['rounds'],
  aboveOwed: RefreshLedger['aboveOwed'] = [],
  posted: RefreshLedger['posted'] = [],
): RefreshLedger {
  return {
    version: 1,
    members: {
      'feat/c1/demo': { position: host, pr: 101, publishedTip: tip, recordedTip: blob as never },
      'feat/c2/demo': { position: parseChildId(2)!, pr: 102, publishedTip: tip, recordedTip: blob as never },
      'feat/c3/demo': { position: parseChildId(3)!, pr: 103, publishedTip: tip, recordedTip: blob as never },
    },
    rounds,
    aboveOwed,
    posted,
  };
}

function commentFixture(input: {
  ledger: RefreshLedger;
  targets: readonly RoutedCommentTarget[];
  bodies: Readonly<Record<number, string>>;
  bodyForTarget?: (target: RoutedCommentTarget) => string;
  existingComments?: Readonly<Record<number, readonly string[]>>;
  lookupFailures?: number;
  operations?: GithubOperationRunner;
  events?: ConductorEventEmitter;
}) {
  let ledger = input.ledger;
  let blobAtRef = ledgerBlob;
  const calls: string[][] = [];
  let lookupFailures = input.lookupFailures ?? 0;
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
    if (args[0] === 'pr' && args[1] === 'view') {
      if (lookupFailures > 0) {
        lookupFailures -= 1;
        throw new Error('lookup unavailable');
      }
      return { stdout: JSON.stringify({ comments: (input.existingComments?.[Number(args[2])] ?? []).map((body) => ({ body })) }) };
    }
    throw new Error(`unexpected gh operation: ${args.join(' ')}`);
  });
  const operations = input.operations ?? {
    run: vi.fn(async (request) => {
      const body = request.payload && 'body' in request.payload ? request.payload.body : undefined;
      calls.push(['pr', 'comment', String(request.target.kind === 'pull-request' ? request.target.number : ''), '-R', request.target.repository, '--body', body ?? '']);
      return {};
    }),
  } satisfies GithubOperationRunner;
  return {
    calls,
    git,
    gh,
    ledger: () => ledger,
    run: () => postRoutedComments({
      root: '/worktree', slug: 'demo', baseBranch: 'main', repository, git, gh,
      operations,
      operationsForTarget: () => operations,
      events: input.events,
      routedCommentTargets: async () => ({ kind: 'targets', targets: input.targets }),
      renderHostComment: async ({ target }) => ({ kind: 'body', body: input.bodyForTarget?.(target) ?? input.bodies[target.pr]! }),
      renderMemberAboveComment: async ({ target }) => ({ kind: 'body', body: input.bodyForTarget?.(target) ?? input.bodies[target.pr]! }),
    }),
  };
}

describe('FINISH routed fix comments', () => {
  it('replays an interrupted above-host receipt after a later restack changes its recorded tip', async () => {
    const publishedTip = 'e'.repeat(40) as never;
    const firstRecordedTip = 'f'.repeat(40) as never;
    const laterRecordedTip = '1'.repeat(40) as never;
    const laterHostTip = '2'.repeat(40) as never;
    const firstMarker = `<!-- conductor:routed-refresh:${firstRecordedTip}:101:102 -->`;
    const secondMarker = `<!-- conductor:routed-refresh:${laterRecordedTip}:101:102 -->`;
    let ledger: RefreshLedger = {
      version: 1,
      members: {
        'feat/c1/demo': { position: host, pr: 101, publishedTip: tip, recordedTip: blob as never },
        'feat/c2/demo': { position: parseChildId(2)!, pr: 102, publishedTip, recordedTip: firstRecordedTip },
      },
      rounds: [{ roundId, kind: 'audit', host, marker: '<!-- conductor:routed-fix:r1:101 -->' }],
      aboveOwed: [],
      posted: [],
    };
    let blobAtRef = ledgerBlob;
    const git = vi.fn(async (args: readonly string[], options?: { input?: string }) => {
      if (args[0] === 'rev-parse') {
        if (args.at(-1) === refreshLedgerRefFor('demo')) return { exitCode: 0, stdout: `${blobAtRef}\n`, stderr: '' };
        const branch = Object.keys(ledger.members).find((candidate) => args.at(-1)?.includes(candidate));
        return branch === undefined
          ? { exitCode: 1, stdout: '', stderr: '' }
          : { exitCode: 0, stdout: `${ledger.members[branch]!.recordedTip}\n`, stderr: '' };
      }
      if (args[0] === 'cat-file') return { exitCode: 0, stdout: JSON.stringify(ledger), stderr: '' };
      if (args[0] === 'diff') return { exitCode: 0, stdout: args[2]!, stderr: '' };
      if (args[0] === 'patch-id') return {
        exitCode: 0,
        stdout: options?.input === publishedTip ? 'published\n' : `${options?.input}\n`,
        stderr: '',
      };
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

    // The first FINISH discovers and durably records the receipt, then crashes
    // before it can post the resulting target.
    await routedCommentTargets({ worktree: '/worktree', slug: 'demo', baseBranch: 'main', git });
    expect(ledger.aboveOwed).toEqual([
      { pr: 102, hostPr: 101, newTip: firstRecordedTip, marker: firstMarker },
    ]);

    // A later routed restack moves the member again and starts a fresh round.
    ledger = mergeRefreshLedger(ledger, {
      moves: [
        { position: host, branch: 'feat/c1/demo', pr: 101, pushedTip: blob as never, recordedTip: laterHostTip },
        { position: parseChildId(2)!, branch: 'feat/c2/demo', pr: 102, pushedTip: firstRecordedTip, recordedTip: laterRecordedTip },
      ],
      round: {
        roundId: parseRoundId('r2')!, kind: 'revalidate', host, marker: '<!-- conductor:routed-fix:r2:101 -->',
      },
    });
    const laterTargets = await routedCommentTargets({ worktree: '/worktree', slug: 'demo', baseBranch: 'main', git });
    if (laterTargets.kind !== 'targets') throw new Error('expected routed comment targets');
    expect(laterTargets.targets).toEqual(expect.arrayContaining([
      { kind: 'member-above', pr: 102, hostPr: 101, newTip: firstRecordedTip },
      { kind: 'member-above', pr: 102, hostPr: 101, newTip: laterRecordedTip },
    ]));
    expect(await observePublishedStackRefresh({ root: '/worktree', slug: 'demo', git })).toBe('comments-owed');

    const operationRun = vi.fn<GithubOperationRun>(async () => ({}));
    const operations: GithubOperationRunner = { run: operationRun };
    await postRoutedComments({
      root: '/worktree', slug: 'demo', baseBranch: 'main', repository, git,
      gh: async () => ({ stdout: JSON.stringify({ comments: [] }) }),
      operations,
      routedCommentTargets: async () => ({ kind: 'targets', targets: laterTargets.targets }),
      renderHostComment: async ({ target }) => ({ kind: 'body', body: `host\n<!-- conductor:routed-fix:${target.roundId}:${target.pr} -->` }),
      renderMemberAboveComment: async ({ target }) => ({ kind: 'body', body: `member\n<!-- conductor:routed-refresh:${target.newTip}:${target.hostPr}:${target.pr} -->` }),
    });

    const createdBodies = operationRun.mock.calls
      .map(([request]) => request.payload)
      .filter((payload): payload is { body: string } => typeof payload === 'object' && payload !== null && 'body' in payload && typeof payload.body === 'string')
      .map((payload) => payload.body);
    expect({
      firstMarkerCreates: createdBodies.filter((body) => body.includes(firstMarker)),
      posted: ledger.posted,
      refresh: await observePublishedStackRefresh({ root: '/worktree', slug: 'demo', git }),
    }).toEqual({ firstMarkerCreates: [expect.stringContaining(firstMarker)], posted: expect.arrayContaining([firstMarker, secondMarker]), refresh: 'settled' });
  });

  it('keeps a changed descendant receipt and comment for each routed host', async () => {
    const hostTwo = parseChildId(2)!;
    const descendant = parseChildId(3)!;
    const hostTwoPublishedTip = 'c'.repeat(40) as never;
    const hostTwoRecordedTip = 'd'.repeat(40) as never;
    const descendantPublishedTip = 'e'.repeat(40) as never;
    const descendantRecordedTip = 'f'.repeat(40) as never;
    const hostOneMarker = '<!-- conductor:routed-fix:r1:101 -->';
    const hostTwoMarker = '<!-- conductor:routed-fix:r2:102 -->';
    let ledger: RefreshLedger = {
      version: 1,
      members: {
        'feat/c1/demo': { position: host, pr: 101, publishedTip: tip, recordedTip: blob as never },
        'feat/c2/demo': { position: hostTwo, pr: 102, publishedTip: hostTwoPublishedTip, recordedTip: hostTwoRecordedTip },
        'feat/c3/demo': { position: descendant, pr: 103, publishedTip: descendantPublishedTip, recordedTip: descendantRecordedTip },
      },
      rounds: [
        { roundId, kind: 'audit', host, marker: hostOneMarker },
        { roundId: parseRoundId('r2')!, kind: 'audit', host: hostTwo, marker: hostTwoMarker },
      ],
      aboveOwed: [],
      posted: [],
    };
    const targetGit = vi.fn(async (args: readonly string[], options?: { input?: string }) => {
      if (args[0] === 'rev-parse') return { exitCode: 0, stdout: `${ledgerBlob}\n`, stderr: '' };
      if (args[0] === 'cat-file') return { exitCode: 0, stdout: JSON.stringify(ledger), stderr: '' };
      if (args[0] === 'diff') return { exitCode: 0, stdout: args[2]!, stderr: '' };
      if (args[0] === 'patch-id') {
        const identity = options?.input;
        return {
          exitCode: 0,
          stdout: identity === hostTwoPublishedTip || identity === hostTwoRecordedTip
            ? 'clean-replay\n'
            : identity === descendantRecordedTip ? 'resolved\n' : 'published\n',
          stderr: '',
        };
      }
      if (args[0] === 'hash-object') {
        ledger = JSON.parse(options?.input ?? '{}') as RefreshLedger;
        return { exitCode: 0, stdout: `${nextBlob}\n`, stderr: '' };
      }
      if (args[0] === 'update-ref') return { exitCode: 0, stdout: '', stderr: '' };
      throw new Error(`unexpected git operation: ${args.join(' ')}`);
    });

    const targetsResult = await routedCommentTargets({
      worktree: '/worktree', slug: 'demo', baseBranch: 'main', git: targetGit,
    });
    if (targetsResult.kind !== 'targets') throw new Error('expected routed comment targets');
    const descendantMarkers = [
      `<!-- conductor:routed-refresh:${descendantRecordedTip}:101:103 -->`,
      `<!-- conductor:routed-refresh:${descendantRecordedTip}:102:103 -->`,
    ];
    expect({
      targets: targetsResult.targets.filter((target) => target.kind === 'member-above' && target.pr === 103),
      owed: ledger.aboveOwed,
    }).toEqual({
      targets: [
        { kind: 'member-above', pr: 103, hostPr: 101, newTip: descendantRecordedTip },
        { kind: 'member-above', pr: 103, hostPr: 102, newTip: descendantRecordedTip },
      ],
      owed: [
        { pr: 103, hostPr: 101, newTip: descendantRecordedTip, marker: descendantMarkers[0] },
        { pr: 103, hostPr: 102, newTip: descendantRecordedTip, marker: descendantMarkers[1] },
      ],
    });

    const fixture = commentFixture({
      ledger,
      targets: targetsResult.targets,
      bodies: {},
      bodyForTarget: (target) => target.kind === 'host'
        ? `${target.pr === 101 ? hostOneMarker : hostTwoMarker}`
        : `changed descendant from #${target.hostPr}\n<!-- conductor:routed-refresh:${target.newTip}:${target.hostPr}:${target.pr} -->`,
    });
    await expect(fixture.run()).resolves.toBeUndefined();

    const descendantCreates = fixture.calls.filter((args) => args[0] === 'pr' && args[1] === 'comment' && args[2] === '103');
    expect({
      creates: descendantCreates.map((args) => args[6]),
      posted: fixture.ledger().posted.filter((marker) => descendantMarkers.includes(marker)),
    }).toEqual({ creates: descendantMarkers.map((marker) => expect.stringContaining(marker)), posted: descendantMarkers });

    await fixture.run();
    expect(fixture.calls.filter((args) => args[0] === 'pr' && args[1] === 'comment' && args[2] === '103')).toHaveLength(2);
  });

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
    const changedMarker = `<!-- conductor:routed-refresh:${blob}:101:102 -->`;
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

  it('records a pre-existing marker after a crash without creating a second comment', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` },
      existingComments: { 101: [`already posted\n${marker}`] },
    });

    await fixture.run();

    expect({ creates: fixture.calls.filter((args) => args[1] === 'comment'), posted: fixture.ledger().posted })
      .toEqual({ creates: [], posted: [marker] });
  });

  it('returns a FINISH retry for a failed lookup without creating, then scans again', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` },
      lookupFailures: 1,
    });

    const observe = async () => ({
      ...commentsOwedSnapshot(),
      stackRefresh: fixture.ledger().posted.includes(marker) ? 'settled' as const : 'comments-owed' as const,
    });
    const first = await advanceFinishPublication({
      observe,
      effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), postRoutedComments: fixture.run },
    });

    expect(first).toEqual(expect.objectContaining({
      kind: 'publication_retry', transition: 'post_routed_comments',
    }));
    expect(fixture.calls.filter((args) => args[1] === 'comment')).toEqual([]);

    const second = await advanceFinishPublication({
      observe,
      effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), postRoutedComments: fixture.run },
    });

    expect({ second, scans: fixture.calls.filter((args) => args[1] === 'view'), creates: fixture.calls.filter((args) => args[1] === 'comment') })
      .toEqual({
        second: { kind: 'advanced', transition: 'post_routed_comments' },
        scans: [
          ['pr', 'view', '101', '-R', repository, '--json', 'comments'],
          ['pr', 'view', '101', '-R', repository, '--json', 'comments'],
        ],
        creates: [expect.any(Array)],
      });
  });

  it('does not recreate a posted earlier-round comment when a later round is owed', async () => {
    const earlier = '<!-- conductor:routed-fix:r1:101 -->';
    const later = '<!-- conductor:routed-fix:r2:102 -->';
    const fixture = commentFixture({
      ledger: owedLedger([
        { roundId, kind: 'audit', host, marker: earlier },
        { roundId: parseRoundId('r2')!, kind: 'audit', host: parseChildId(2)!, marker: later },
      ], [], [earlier]),
      targets: [
        { kind: 'host', pr: 101, roundId, rebaseOnly: [] },
        { kind: 'host', pr: 102, roundId: parseRoundId('r2')!, rebaseOnly: [] },
      ],
      bodies: { 101: `earlier\n${earlier}`, 102: `later\n${later}` },
    });

    await fixture.run();

    expect({
      creates: fixture.calls.filter((args) => args[1] === 'comment'),
      posted: fixture.ledger().posted,
    }).toEqual({
      creates: [['pr', 'comment', '102', '-R', repository, '--body', `later\n${later}`]],
      posted: [earlier, later],
    });
  });

  it('retries unreadable targets and bodies without creating, then recomputes them', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const target = { kind: 'host' as const, pr: 101, roundId, rebaseOnly: [] };
    const targets = vi.fn()
      .mockResolvedValueOnce({ kind: 'retryable' as const })
      .mockResolvedValue({ kind: 'targets' as const, targets: [target] });
    const render = vi.fn()
      .mockResolvedValueOnce({ kind: 'retryable' as const })
      .mockResolvedValue({ kind: 'body' as const, body: `body\n${marker}` });
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [target],
      bodies: { 101: `body\n${marker}` },
    });
    const operationRun = vi.fn<GithubOperationRun>(async () => ({}));
    const operations: GithubOperationRunner = { run: operationRun };
    const run = () => postRoutedComments({
      root: '/worktree', slug: 'demo', baseBranch: 'main', repository,
      git: fixture.git, gh: fixture.gh, operations,
      routedCommentTargets: targets,
      renderHostComment: render,
    });
    const observe = async () => ({
      ...commentsOwedSnapshot(),
      stackRefresh: fixture.ledger().posted.includes(marker) ? 'settled' as const : 'comments-owed' as const,
    });
    const advance = () => advanceFinishPublication({
      observe,
      effects: { dispatchJudgment: async () => ({ kind: 'accepted' }), postRoutedComments: run },
    });

    const targetRetry = await advance();
    const bodyRetry = await advance();
    expect(operationRun).not.toHaveBeenCalled();

    const completed = await advance();

    expect({ targetRetry, bodyRetry, completed, targets: targets.mock.calls.length, bodies: render.mock.calls.length, creates: operationRun.mock.calls.length })
      .toEqual({
        targetRetry: expect.objectContaining({ kind: 'publication_retry', transition: 'post_routed_comments' }),
        bodyRetry: expect.objectContaining({ kind: 'publication_retry', transition: 'post_routed_comments' }),
        completed: { kind: 'advanced', transition: 'post_routed_comments' },
        targets: 3,
        bodies: 2,
        creates: 1,
      });
  });

  it('uses an operation runner bound to the member PR', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const boundTargets: unknown[] = [];
    const requests: unknown[] = [];
    const operations: GithubOperationRunner = { run: vi.fn(async (request) => { requests.push(request); return {}; }) };
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` },
      operations,
    });
    fixture.run = () => postRoutedComments({
      root: '/worktree', slug: 'demo', baseBranch: 'main', repository, git: fixture.git, gh: fixture.gh,
      operations, operationsForTarget: (target) => { boundTargets.push(target); return operations; },
      routedCommentTargets: async () => ({ kind: 'targets', targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }] }),
      renderHostComment: async () => ({ kind: 'body', body: `body\n${marker}` }),
    });

    await fixture.run();

    expect({ boundTargets, requests }).toEqual({
      boundTargets: [{ repository, kind: 'pull-request', number: 101 }],
      requests: [expect.objectContaining({ operation: 'pull-request.comment.create', target: { repository, kind: 'pull-request', number: 101 } })],
    });
  });

  it('leaves a failed guarded comment owed for the bounded FINISH retry path', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const operationRun = vi.fn<GithubOperationRun>(async () => ({ kind: 'refused', reason: 'other-owner' }));
    const operations: GithubOperationRunner = { run: operationRun };
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` },
      operations,
    });

    await expect(fixture.run()).rejects.toThrow('routed comment create failed for PR #101: refused');

    expect({ creates: operationRun, posted: fixture.ledger().posted }).toEqual({
      creates: expect.any(Function), posted: [],
    });
    expect(operationRun).toHaveBeenCalledOnce();
  });

  it('retries a refused comment without refreshing or recording the FINISH outcome', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const operations: GithubOperationRunner = { run: vi.fn(async () => ({ kind: 'refused' as const, reason: 'other-owner' as const })) };
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` },
      operations,
    });
    const refreshPublishedMembers = vi.fn(async () => undefined);
    const recordOutcome = vi.fn(async () => undefined);
    const observe = async () => ({
      ...commentsOwedSnapshot(),
      stackRefresh: fixture.ledger().posted.includes(marker) ? 'settled' as const : 'comments-owed' as const,
    });

    const attempts = await Promise.all(Array.from({ length: 3 }, () => advanceFinishPublication({
      observe,
      effects: {
        dispatchJudgment: async () => ({ kind: 'accepted' }),
        refreshPublishedMembers,
        postRoutedComments: fixture.run,
        recordOutcome,
      },
    })));

    expect({ attempts, refreshes: refreshPublishedMembers.mock.calls, outcomes: recordOutcome.mock.calls, posted: fixture.ledger().posted })
      .toEqual({
        attempts: Array.from({ length: 3 }, () => expect.objectContaining({
          kind: 'publication_retry', transition: 'post_routed_comments', detail: 'routed comment create failed for PR #101: refused',
        })),
        refreshes: [], outcomes: [], posted: [],
      });
  });

  it('A `pull-request.comment.create` failing through 3 attempts writes a `needs-human` HALT naming the PR, records no `finish-choice` outcome, and leaves earlier markers in `posted`', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const operationRun = vi.fn<GithubOperationRun>(async () => ({ kind: 'refused', reason: 'other-owner' }));
    const operations: GithubOperationRunner = { run: operationRun };
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` }, operations,
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(fixture.run()).rejects.toThrow('routed comment create failed for PR #101: refused');
    }

    expect({ creates: operationRun.mock.calls.length, posted: fixture.ledger().posted }).toEqual({ creates: 3, posted: [] });
  });

  it('does not post an owed comment when the refresh push fails first', async () => {
    const postRoutedComments = vi.fn(async () => undefined);
    const result = await advanceFinishPublication({
      observe: async () => ({ ...commentsOwedSnapshot(), stackRefresh: 'push-pending' as const }),
      effects: {
        dispatchJudgment: async () => ({ kind: 'accepted' }),
        refreshPublishedMembers: async () => { throw new Error('push rejected'); },
        postRoutedComments,
      },
    });

    expect({ result, comments: postRoutedComments.mock.calls }).toEqual({
      result: expect.objectContaining({ kind: 'publication_retry', transition: 'refresh_published_members' }),
      comments: [],
    });
  });

  it('emits an ownership refusal for a guarded comment and leaves it owed', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const events = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    events.on('github_operation_refused', (event) => { refusals.push(event); });
    const operationRun = vi.fn<GithubOperationRun>(async () => ({ kind: 'refused', reason: 'other-owner' }));
    const operations: GithubOperationRunner = { run: operationRun };
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` }, operations, events,
    });

    await expect(fixture.run()).rejects.toThrow('routed comment create failed for PR #101: refused');

    expect({ refusals, creates: operationRun.mock.calls.length, posted: fixture.ledger().posted }).toEqual({
      refusals: [expect.objectContaining({
        type: 'github_operation_refused', operation: 'pull-request.comment.create',
        target: { repository, kind: 'pull-request', number: 101 }, reason: 'other-owner',
      })],
      creates: 1, posted: [],
    });
  });

  it('refuses a comment when its supplied operation runner is bound to another PR', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const wrongPrRun = vi.fn<GithubOperationRun>(async (
      request: GithubOperationRequest,
    ): Promise<GithubOperationRunnerResponse | GithubOperationRunnerRefusal> => (
      request.target.kind === 'pull-request' && request.target.number === 102
        ? {}
        : { kind: 'refused', reason: 'invalid-target' }
    ));
    const wrongPrRunner: GithubOperationRunner = { run: wrongPrRun };
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` }, operations: wrongPrRunner,
    });

    await expect(fixture.run()).rejects.toThrow('routed comment create failed for PR #101: refused');

    expect({ requests: wrongPrRun.mock.calls.length, posted: fixture.ledger().posted }).toEqual({ requests: 1, posted: [] });
  });

  it('An emitter that throws after a comment leaves the marker in `posted`, and a replay makes no second `pull-request.comment.create` call', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const events = new ConductorEventEmitter();
    events.on('stack_member_comment_posted', () => { throw new Error('spine unavailable'); });
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` },
      events,
    });

    await fixture.run();
    await fixture.run();

    expect({ posted: fixture.ledger().posted, creates: fixture.calls.filter((args) => args[1] === 'comment') })
      .toEqual({ posted: [marker], creates: [expect.any(Array)] });
  });
});
