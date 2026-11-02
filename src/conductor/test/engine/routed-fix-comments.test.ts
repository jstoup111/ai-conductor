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
  refreshLedgerRefFor,
  routedCommentTargets,
  type RefreshLedger,
  type RoutedCommentTarget,
} from '../../src/engine/stack-refresh-ledger.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';
import type { GithubOperationRunner } from '../../src/engine/github-operations.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const tip = 'a'.repeat(40) as never;
const blob = 'b'.repeat(40);
const host = parseChildId(1)!;
const roundId = parseRoundId('r1')!;

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

    const operations: GithubOperationRunner = { run: vi.fn(async () => ({})) };
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

  it('retries a failed comment lookup without creating before scanning again', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` },
      lookupFailures: 1,
    });

    await expect(fixture.run()).rejects.toThrow('lookup failed for PR #101');
    expect(fixture.calls.filter((args) => args[1] === 'comment')).toEqual([]);
    await fixture.run();

    expect(fixture.calls.filter((args) => args[1] === 'view')).toHaveLength(2);
    expect(fixture.calls.filter((args) => args[1] === 'comment')).toHaveLength(1);
  });

  it('does not recreate a receipt from an earlier routed round', async () => {
    const marker = '<!-- conductor:routed-fix:r1:101 -->';
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }], [], [marker]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` },
    });

    await fixture.run();

    expect(fixture.calls).toEqual([]);
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
    const operations: GithubOperationRunner = { run: vi.fn(async () => ({ kind: 'refused' as const, reason: 'other-owner' as const })) };
    const fixture = commentFixture({
      ledger: owedLedger([{ roundId, kind: 'audit', host, marker }]),
      targets: [{ kind: 'host', pr: 101, roundId, rebaseOnly: [] }],
      bodies: { 101: `body\n${marker}` },
      operations,
    });

    await expect(fixture.run()).rejects.toThrow('routed comment create failed for PR #101: refused');

    expect({ creates: operations.run, posted: fixture.ledger().posted }).toEqual({
      creates: expect.any(Function), posted: [],
    });
    expect(operations.run).toHaveBeenCalledOnce();
  });

  it('keeps the receipt when the posted-comment emitter fails', async () => {
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
