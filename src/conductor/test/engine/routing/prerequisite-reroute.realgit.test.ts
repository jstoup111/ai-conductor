// Covers: task:7, task:8, task:57, task:58, task:59, task:206
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const prerequisiteMocks = vi.hoisted(() => ({
  rerouteRound: vi.fn(),
  settleRoutedBuildClaim: vi.fn(),
}));

vi.mock('../../../src/engine/routing/prerequisite-claim.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/engine/routing/prerequisite-claim.js')>();
  return {
    ...actual,
    rerouteRound: (...args: Parameters<typeof actual.rerouteRound>) => {
      prerequisiteMocks.rerouteRound(...args);
      return actual.rerouteRound(...args);
    },
    settleRoutedBuildClaim: (...args: Parameters<typeof actual.settleRoutedBuildClaim>) => {
      prerequisiteMocks.settleRoutedBuildClaim(...args);
      return actual.settleRoutedBuildClaim(...args);
    },
  };
});

import { parseChildId } from '../../../src/engine/child-context.js';
import { Conductor } from '../../../src/engine/conductor.js';
import { leafBranchFor } from '../../../src/engine/feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { enterHostRegion } from '../../../src/engine/routing/host-region-entry.js';
import { completeRerouteSync, rerouteRound, settleRoutedBuildClaim, verifyPrerequisiteClaim } from '../../../src/engine/routing/prerequisite-claim.js';
import { admitRound, reconcileRounds } from '../../../src/engine/routing/round-admission.js';
import { createRouteRecord, drainOutbox, readRepairMarker, readRouteRecord, transitionHost, writeRouteRecord, writeRoutingTransaction } from '../../../src/engine/routing/route-record-store.js';
import { closureRefFor, rejectedPinRefFor, repairMarkerRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { parseRoundId } from '../../../src/engine/routing/route-types.js';
import { journalRefFor, writeRestackJournalBlob, type RestackJournal } from '../../../src/engine/restack/restack-journal.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../../src/engine/restack/restack-types.js';
import { ALL_STEPS } from '../../../src/engine/steps.js';
import type { ConductState, StepName } from '../../../src/types/index.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const c1 = parseChildId(1)!;
const c2 = parseChildId(2)!;
const c3 = parseChildId(3)!;
const c4 = parseChildId(4)!;
const roundId = parseRoundId('r1')!;

function sha(raw: string): CommitSha {
  const parsed = parseCommitSha(raw);
  if (!parsed) throw new Error(`expected commit SHA, received ${raw}`);
  return parsed;
}

async function fixture(input: { source?: typeof c1; destination?: typeof c2; destinationInRecord?: boolean; leafDestination?: boolean } = {}) {
  const source = input.source ?? c1;
  const destination = input.destination ?? c2;
  const repo = await mkdtemp(join(tmpdir(), 'prerequisite-reroute-'));
  const git = makeGitRunner(repo);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await mkdir(join(repo, 'src', 'engine'), { recursive: true });
  await mkdir(join(repo, 'test'), { recursive: true });
  await writeFile(join(repo, '.docs', 'plans', 'demo.md'), '### Task T1: Existing work\n');
  await writeFile(join(repo, 'src-a.ts'), 'export const parseA = 1;\n');
  await writeFile(join(repo, 'src', 'engine', 'a.ts'), 'export const a = 1;\n');
  await writeFile(join(repo, 'src', 'index.ts'), 'export const sourceIndex = 1;\n');
  await writeFile(join(repo, 'test', 'index.ts'), 'export const testIndex = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'base']);

  await git(['checkout', '-qb', `feat/c${source}/demo`]);
  const closed1 = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const closed1Tree = (await git(['rev-parse', `${closed1}^{tree}`])).stdout.trim();
  await git(['update-ref', closureRefFor('demo', source), closed1]);
  await writeFile(join(repo, 'source.ts'), 'export const source = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'builder work\n\nRound: r1']);
  await writeFile(join(repo, 'source-2.ts'), 'export const sourceTwo = 2;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'more builder work\n\nRound: r1']);
  const rejected = (await git(['rev-parse', 'HEAD'])).stdout.trim();

  await git(['checkout', '-qb', `feat/c${destination}/demo`, closed1]);
  await writeFile(join(repo, 'parse-b.ts'), 'export const parseB = 1;\n');
  await writeFile(join(repo, 'src', 'engine', 'register-artifact-cli.ts'), 'export const registerArtifact = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'child 2 prerequisite']);
  const closed2 = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  if (input.leafDestination) {
    await git(['branch', 'feat/daemon-demo']);
  } else {
    await git(['update-ref', closureRefFor('demo', destination), closed2]);
    // Claim resolution is defined against the sealed leaf listing. This
    // two-child fixture uses the destination tip as that listing until a
    // leaf-specific scenario replaces it below.
    await git(['branch', 'feat/daemon-demo']);
  }
  await git(['checkout', '-q', `feat/c${source}/demo`]);

  const created = await createRouteRecord(repo, 'demo', {
    roundId,
    sealedAuthored: 1,
    kind: 'audit',
    items: [{
      findingId: 'f1', kind: 'audit', owner: source, host: source, reason: 'task-slice', fallback: [], existingTask: true, taskIds: ['rem-prd-audit-T1'],
      obligation: { branch: `feat/c${source}/demo`, head: sha(closed1), tree: sha(closed1Tree) },
    }],
    allocation: {
      [source]: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: [`### Task rem-prd-audit-T1: Repair routed task\n**Child:** ${source}\n**Round:** r1\n`] },
      ...(input.destinationInRecord === false ? {} : { [destination]: { remTaskIds: [], blockBodies: [] } }),
    },
  });
  if (created.kind !== 'created') throw new Error(created.kind);
  await admitRound(repo, 'demo', created.record, source);
  const stored = await readRouteRecord(repo, 'demo', roundId);
  if (stored.kind !== 'record') throw new Error('missing admitted record');
  const repairing = transitionHost(stored, source, 'repairing', { credit: false });
  if (repairing.kind !== 'updated') throw new Error('cannot enter repair');
  await writeRoutingTransaction(repo, 'demo', [{ kind: 'update-record', previous: stored, record: repairing.record }]);
  return { repo, git, closed1, closed2, rejected, source, destination };
}

async function refAt(git: GitRunner, ref: string): Promise<string | undefined> {
  const result = await git(['rev-parse', '-q', '--verify', ref]);
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

async function routingRefs(git: GitRunner) {
  const refs = await git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/demo/']);
  return refs.stdout.trim();
}

async function writeNonTerminalJournal(subject: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  const journal: RestackJournal = {
    opId: 'prerequisite-reroute' as RestackOpId,
    cause: 'feature-repair',
    committer: { name: 'Routing', email: 'routing@example.test', date: '2030-01-01T00:00:00Z' },
    dirtyPaths: [], refs: [], ranges: [], children: [], state: 'moved',
    owner: { host: 'test-host', pid: 1, processStartTime: '1' },
  };
  const blob = await writeRestackJournalBlob(subject.repo, journal);
  await subject.git(['update-ref', journalRefFor('demo'), blob]);
}

async function addHookStampedOperatorCommit(subject: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  const hook = join(subject.repo, '.git', 'hooks', 'commit-msg');
  await mkdir(join(subject.repo, '.git', 'hooks'), { recursive: true });
  await writeFile(hook, '#!/bin/sh\nprintf "\\nRound: r1\\n" >> "$1"\n');
  await chmod(hook, 0o755);
  await writeFile(join(subject.repo, 'operator.ts'), 'export const operator = true;\n');
  await subject.git(['add', '.']);
  await subject.git(['commit', '-qm', 'operator repair']);
  return (await subject.git(['rev-parse', 'HEAD'])).stdout.trim();
}

describe('verified prerequisite reroute (real local Git)', () => {
  // Covers: task:7
  it('reroutes an explicitly resolved prerequisite path to its leaf host', async () => {
    const subject = await fixture({ destination: c3 });
    try {
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('missing routed work order');
      await expect(writeRoutingTransaction(subject.repo, 'demo', [{
        kind: 'update-record', previous: stored, record: {
          ...stored.record,
          items: stored.record.items.map((item) => ({ ...item, prerequisitePaths: ['src/engine/'] })),
        },
      }], { git: subject.git })).resolves.toEqual({ kind: 'updated' });

      await expect(settleRoutedBuildClaim({
        structuredResult: { outcome: 'blocked-by-prerequisite', child: 3, paths: ['src/engine/register-artifact-cli.ts'] },
        worktree: subject.repo, slug: 'demo', roundId, host: c1, git: subject.git,
      })).resolves.toEqual({ kind: 'rerouted' });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({
        kind: 'marker', marker: { roundId, host: c3 },
      });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('resolves a bare claimed prerequisite and reroutes using resolved stored evidence', async () => {
    const subject = await fixture({ destination: c3 });
    try {
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('missing route record');
      const next = { ...stored.record, items: stored.record.items.map((item) => ({ ...item, prerequisitePaths: ['src/engine/'] })) };
      await expect(writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: stored, record: next }], { git: subject.git }))
        .resolves.toEqual({ kind: 'updated' });

      await expect(settleRoutedBuildClaim({
        structuredResult: { outcome: 'blocked-by-prerequisite', child: 3, paths: ['register-artifact-cli.ts'] },
        worktree: subject.repo, slug: 'demo', roundId, host: c1, git: subject.git,
      })).resolves.toMatchObject({ kind: 'rerouted' });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'marker', marker: { host: c3 } });
      await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
        kind: 'record',
        record: { fallback: [expect.objectContaining({ evidence: ['src/engine/register-artifact-cli.ts'] })] },
      });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('turns directory-only claims into ordinary failed attempts without moving routing refs', async () => {
    const subject = await fixture({ destination: c3 });
    try {
      const before = {
        branch: await refAt(subject.git, 'refs/heads/feat/c1/demo'),
        closure: await refAt(subject.git, closureRefFor('demo', c1)),
        marker: await refAt(subject.git, repairMarkerRefFor('demo')),
        routing: await routingRefs(subject.git),
      };
      await expect(settleRoutedBuildClaim({
        structuredResult: { outcome: 'blocked-by-prerequisite', child: 3, paths: ['src/engine/'] },
        worktree: subject.repo, slug: 'demo', roundId, host: c1, git: subject.git,
      })).resolves.toMatchObject({ kind: 'failed', detail: expect.stringContaining('claim names no prerequisite file') });
      await expect(refAt(subject.git, 'refs/heads/feat/c1/demo')).resolves.toBe(before.branch);
      await expect(refAt(subject.git, closureRefFor('demo', c1))).resolves.toBe(before.closure);
      await expect(refAt(subject.git, repairMarkerRefFor('demo'))).resolves.toBe(before.marker);
      await expect(routingRefs(subject.git)).resolves.toBe(before.routing);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('rejects an already-present claim without moving the routed host or refs', async () => {
    const subject = await fixture({ destination: c3 });
    try {
      const before = {
        branch: await refAt(subject.git, 'refs/heads/feat/c1/demo'),
        closure: await refAt(subject.git, closureRefFor('demo', c1)),
        marker: await refAt(subject.git, repairMarkerRefFor('demo')),
        routing: await routingRefs(subject.git),
      };
      await expect(settleRoutedBuildClaim({
        structuredResult: { outcome: 'blocked-by-prerequisite', child: 3, paths: ['src/engine/a.ts'] },
        worktree: subject.repo, slug: 'demo', roundId, host: c1, git: subject.git,
      })).resolves.toMatchObject({ kind: 'failed', detail: expect.stringContaining('claimed prerequisite is already present at host 1') });
      await expect(refAt(subject.git, 'refs/heads/feat/c1/demo')).resolves.toBe(before.branch);
      await expect(refAt(subject.git, closureRefFor('demo', c1))).resolves.toBe(before.closure);
      await expect(refAt(subject.git, repairMarkerRefFor('demo'))).resolves.toBe(before.marker);
      await expect(routingRefs(subject.git)).resolves.toBe(before.routing);
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'marker', marker: { roundId, host: c1 } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('rejects an ambiguous-only claim without moving the routed host or refs', async () => {
    const subject = await fixture();
    try {
      const before = await routingRefs(subject.git);
      await expect(settleRoutedBuildClaim({
        structuredResult: { outcome: 'blocked-by-prerequisite', child: 2, paths: ['index.ts'] },
        worktree: subject.repo, slug: 'demo', roundId, host: c1, git: subject.git,
      })).resolves.toMatchObject({ kind: 'failed', detail: expect.stringContaining('claim names no prerequisite file') });
      expect(await routingRefs(subject.git)).toBe(before);
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'marker', marker: { roundId, host: c1 } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('verifies only an upward immutable destination before any ref move', async () => {
    const subject = await fixture();
    try {
      expect(await verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c2, symbols: ['parseB'] }, host: c1, slug: 'demo', git: subject.git,
      })).toEqual({ kind: 'verified', destination: c2, ref: closureRefFor('demo', c2), claimedPaths: [] });
      expect(await verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c1, symbols: ['parseB'] }, host: c2, slug: 'demo', git: subject.git,
      })).toMatchObject({ kind: 'refused-not-above' });
      expect(await verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c2, symbols: ['missing'] }, host: c1, slug: 'demo', git: subject.git,
      })).toMatchObject({ kind: 'unverified' });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('pins, resets and moves the marker atomically, then recovers the tree before destination admission', async () => {
    const subject = await fixture();
    try {
      const calls: Array<{ readonly args: readonly string[]; readonly input?: string }> = [];
      const git: GitRunner = async (args, options) => {
        calls.push({ args, input: options?.input });
        return subject.git(args, options);
      };
      const result = await rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git });
      expect(result.kind).toBe('rerouted');
      expect((await subject.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim()).toBe(subject.closed1);
      expect((await subject.git(['rev-parse', rejectedPinRefFor('demo', roundId, 1)])).stdout.trim()).toBe(subject.rejected);
      expect(await readRepairMarker(subject.repo, 'demo')).toMatchObject({ kind: 'marker', marker: { roundId, host: c2 } });
      const writes = calls.filter((call) => call.args[0] === 'update-ref' && call.args[1] === '--stdin');
      expect(writes).toHaveLength(1);
      expect(writes[0]?.input).toContain(`update ${rejectedPinRefFor('demo', roundId, 1)} ${subject.rejected} ${'0'.repeat(40)}`);
      expect(writes[0]?.input).toContain(`update refs/heads/feat/c1/demo ${subject.closed1} ${subject.rejected}`);
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toMatchObject({
        kind: 'record', record: {
          hosts: { 1: 'reroute-moved', 2: 'pending' },
          allocation: { 2: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1: Repair routed task\n**Child:** 2\n**Round:** r1\n'] } },
          fallback: [expect.objectContaining({ from: c1, to: c2, evidence: ['parseB'] })],
          items: [expect.objectContaining({
            host: c2,
            obligation: expect.objectContaining({
              branch: 'feat/c2/demo', head: sha(subject.closed2),
              tree: sha((await subject.git(['rev-parse', `${subject.closed2}^{tree}`])).stdout.trim()),
            }),
          })],
        },
      });
      const afterReroute = await readRouteRecord(subject.repo, 'demo', roundId);
      if (afterReroute.kind !== 'record') throw new Error('missing rerouted record');
      const rerouteEvents = afterReroute.record.outbox.filter(({ event }) => event.type === 'remediation_rerouted');
      expect(rerouteEvents).toHaveLength(1);
      expect(rerouteEvents[0]?.event).toMatchObject({
        type: 'remediation_rerouted', roundId, from: c1, to: c2,
        evidence: rejectedPinRefFor('demo', roundId, 1),
      });
      const persisted: unknown[] = [];
      expect(await drainOutbox(subject.repo, afterReroute, async (event) => {
        persisted.push(event);
        return 'persisted';
      })).toEqual({ kind: 'drained' });
      expect(persisted.filter((event) => typeof event === 'object' && event !== null && 'type' in event && event.type === 'remediation_rerouted')).toHaveLength(1);

      const completed = await completeRerouteSync({ worktree: subject.repo, slug: 'demo', roundId, git: subject.git });
      expect(completed).toMatchObject({ kind: 'completed', record: { hosts: { 1: 'rerouted', 2: 'admitted' } } });
      expect((await readFile(join(subject.repo, 'src-a.ts'), 'utf8')).trim()).toBe('export const parseA = 1;');
      expect(await readFile(join(subject.repo, 'source.ts'), 'utf8').catch(() => undefined)).toBeUndefined();
      expect(await completeRerouteSync({ worktree: subject.repo, slug: 'demo', roundId, git: subject.git })).toMatchObject({ kind: 'completed' });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('refuses an intermediate destination with no closure without moving any branch or routing ref', async () => {
    const subject = await fixture();
    try {
      await subject.git(['branch', leafBranchFor('demo'), `feat/c${c2}/demo`]);
      await subject.git(['update-ref', '-d', closureRefFor('demo', c2)]);
      const before = await routingRefs(subject.git);
      await expect(rerouteRound({
        worktree: subject.repo, slug: 'demo', roundId, from: c1, to: c2, leaf: c3, evidence: ['parseB'], git: subject.git,
      })).resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining('destination closure is unavailable') });
      expect(await routingRefs(subject.git)).toBe(before);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('settles a routed BUILD claim behind one result: none, failed attempt, or admitted reroute', async () => {
    const subject = await fixture();
    try {
      const settle = (structuredResult: unknown, host = c1) => settleRoutedBuildClaim({
        structuredResult, worktree: subject.repo, slug: 'demo', roundId, host, git: subject.git,
      });
      expect(await settle({ outcome: 'completed' })).toEqual({ kind: 'none' });
      expect(await settle({ outcome: 'surprise' })).toEqual({ kind: 'failed', detail: 'routed prerequisite claim is malformed' });
      expect(await settle({ outcome: 'blocked-by-prerequisite', child: 2, symbols: ['missing'] })).toMatchObject({
        kind: 'failed', detail: expect.stringMatching(/^routed prerequisite claim unverified: /),
      });
      // A failed claim moves no ref.
      expect((await subject.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim()).toBe(subject.rejected);

      expect(await settle({ outcome: 'blocked-by-prerequisite', child: 2, symbols: ['parseB'] })).toEqual({ kind: 'rerouted' });
      expect((await subject.git(['rev-parse', 'refs/heads/feat/c1/demo'])).stdout.trim()).toBe(subject.closed1);
      expect(await readRouteRecord(subject.repo, 'demo', roundId)).toMatchObject({
        kind: 'record', record: { hosts: { 1: 'rerouted', 2: 'admitted' } },
      });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('refuses a BUILD claim when its admitted destination prerequisite path is absent', async () => {
    const subject = await fixture({ destination: c3 });
    try {
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('missing routed work order');
      const updated = await writeRouteRecord(subject.repo, stored, {
        ...stored.record,
        items: stored.record.items.map((item) => ({ ...item, prerequisitePaths: ['src/engine/a.ts'] })),
      }, { git: subject.git });
      if (updated.kind !== 'updated') throw new Error(`work order update ${updated.kind}`);
      const verified = await verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c3, paths: ['src/engine/register-artifact-cli.ts'] },
        host: c1, slug: 'demo', prerequisitePaths: ['src/engine/a.ts'], leaf: c3, git: subject.git,
      });
      expect(verified).toMatchObject({ kind: 'verified', destination: c3, ref: 'refs/heads/feat/daemon-demo' });

      const absentRequired: GitRunner = async (args, options) => {
        if (args[0] === 'ls-tree' && args.includes('refs/heads/feat/daemon-demo') && args.includes('src/engine/a.ts')) {
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        return subject.git(args, options);
      };
      await expect(verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c3, paths: ['src/engine/register-artifact-cli.ts'] },
        host: c1, slug: 'demo', prerequisitePaths: ['src/engine/a.ts'], leaf: c3, git: absentRequired,
      })).resolves.toMatchObject({ kind: 'unverified', detail: expect.stringContaining('lacks prerequisite paths') });

      // The leaf knows the resolved file, while child 2's immutable closure
      // deliberately does not. This is the settlement boundary's no-ref-move
      // case, distinct from the direct child-3 leaf verification above.
      await subject.git(['branch', 'feat/c2/demo', subject.closed1]);
      await subject.git(['update-ref', closureRefFor('demo', c2), subject.closed1]);
      const beforeSettlement = await readRouteRecord(subject.repo, 'demo', roundId);
      if (beforeSettlement.kind !== 'record') throw new Error('missing routed work order before settlement');
      await expect(writeRouteRecord(subject.repo, beforeSettlement, {
        ...beforeSettlement.record,
        items: beforeSettlement.record.items.map((item) => ({ ...item, prerequisitePaths: ['src/engine/register-artifact-cli.ts'] })),
      }, { git: subject.git })).resolves.toMatchObject({ kind: 'updated' });
      const before = await routingRefs(subject.git);
      await expect(settleRoutedBuildClaim({
        structuredResult: { outcome: 'blocked-by-prerequisite', child: 2, paths: ['src/engine/register-artifact-cli.ts'] },
        worktree: subject.repo, slug: 'demo', roundId, host: c1, git: subject.git,
      })).resolves.toMatchObject({ kind: 'failed', detail: expect.stringContaining('lacks prerequisite paths') });
      expect(await routingRefs(subject.git)).toBe(before);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('does not reroute an operator round from a verified-shape prerequisite claim', async () => {
    const subject = await fixture({ destinationInRecord: false });
    try {
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('missing operator route record');
      const operator = {
        ...stored.record,
        kind: 'operator' as const,
        operator: {
          origin: 'land' as const,
          reason: 'reviewer request',
          operator: 'operator@example.test',
          entryStep: 'acceptance_specs' as const,
          carried: [],
          otherTips: { 'feat/c1/demo': subject.rejected as CommitSha },
          priorRegion: {
            statuses: { acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done' } as const,
            verdicts: {},
          },
        },
      };
      if ((await writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: stored, record: operator }])).kind !== 'updated') {
        throw new Error('could not make operator route record');
      }
      await expect(verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c2, symbols: ['parseB'] }, host: c1, slug: 'demo', git: subject.git,
      })).resolves.toMatchObject({ kind: 'verified', destination: c2 });

      await mkdir(join(subject.repo, '.pipeline', 'children', '1'), { recursive: true });
      const parentState = Object.fromEntries(ALL_STEPS.map((step) => [step.name, 'done'])) as ConductState;
      Object.assign(parentState, { feature_desc: 'demo', complexity_tier: 'M', run_started_at: 1 });
      await writeFile(join(subject.repo, '.pipeline', 'conduct-state.json'), JSON.stringify(parentState));
      await writeFile(join(subject.repo, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
        acceptance_specs: 'done', build: 'pending', test_suite: 'done', build_review: 'done',
      }));
      const beforeTip = await refAt(subject.git, 'refs/heads/feat/c1/demo');
      prerequisiteMocks.rerouteRound.mockClear();
      prerequisiteMocks.settleRoutedBuildClaim.mockClear();
      let parkAfterBuild = false;
      const dispatched: StepName[] = [];
      const run = vi.fn(async (step: StepName) => {
        dispatched.push(step);
        if (step !== 'build') throw new Error(`unexpected dispatch: ${step}`);
        parkAfterBuild = true;
        return {
          success: true,
          finalStructuredResult: { outcome: 'blocked-by-prerequisite', child: 2, symbols: ['parseB'] },
        };
      });
      const conductor = new Conductor({
        projectRoot: subject.repo,
        stateFilePath: join(subject.repo, '.pipeline', 'conduct-state.json'),
        featureSlug: 'demo', fromStep: 'build', mode: 'auto', daemon: true, verifyArtifacts: false,
        config: { stacked_prs: { enabled: true, max_slices: 2, route_whole_feature_fixes: true } },
        events: new ConductorEventEmitter(), stepRunner: { run }, acceptanceRedExec: vi.fn(),
        operatorParkBoundary: async () => parkAfterBuild,
        childRegionLifecycle: {
          resolveActiveChild: async () => ({
            kind: 'active', child: c1, position: c1, isLeaf: false, branch: 'feat/c1/demo', routedRepair: { child: c1, roundId },
          }),
          enterHostRegion: async () => ({ kind: 'resume', pinnedBase: subject.closed1 }) as never,
          enterChildRegion: async () => ({ kind: 'completed' }) as never,
        },
      });

      await conductor.run();

      expect(dispatched).toEqual(['build']);
      expect(run).toHaveBeenCalledWith('build', expect.anything(), expect.not.objectContaining({ routedPrerequisiteClaim: true }));
      expect(prerequisiteMocks.settleRoutedBuildClaim).not.toHaveBeenCalled();
      expect(prerequisiteMocks.rerouteRound).not.toHaveBeenCalled();
      expect(await readRepairMarker(subject.repo, 'demo')).toMatchObject({ kind: 'marker', marker: { host: c1, roundId } });
      expect(await refAt(subject.git, 'refs/heads/feat/c1/demo')).toBe(beforeTip);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('adds an absent destination as pending in the fenced reroute record before admitting it', async () => {
    const subject = await fixture({ destinationInRecord: false });
    try {
      await expect(rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: subject.source, to: subject.destination, evidence: ['parseB'], git: subject.git }))
        .resolves.toMatchObject({ kind: 'rerouted', record: { hosts: { 1: 'reroute-moved', 2: 'pending' } } });
      await expect(completeRerouteSync({ worktree: subject.repo, slug: 'demo', roundId, git: subject.git }))
        .resolves.toMatchObject({ kind: 'completed', record: { hosts: { 1: 'rerouted', 2: 'admitted' } } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:rem-as-built-rem-as-built-R2
  it('reconciles a crashed reroute before admitting or dispatching its destination, and retries a failed tree sync', async () => {
    const subject = await fixture();
    try {
      await expect(rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git: subject.git }))
        .resolves.toMatchObject({ kind: 'rerouted', record: { hosts: { 1: 'reroute-moved', 2: 'pending' } } });

      const failingSync: GitRunner = async (args, options) => {
        if (args[0] === 'read-tree') return { exitCode: 1, stdout: '', stderr: 'injected sync failure' };
        return subject.git(args, options);
      };
      await expect(reconcileRounds(subject.repo, 'demo', { git: failingSync })).resolves.toEqual({
        kind: 'unavailable', detail: 'routing round r1 worktree sync failed: cannot synchronize restacked worktree: injected sync failure',
      });
      await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
        kind: 'record', record: { hosts: { 1: 'reroute-moved', 2: 'pending' } },
      });

      await expect(reconcileRounds(subject.repo, 'demo', { git: subject.git })).resolves.toEqual({ kind: 'navigate-host', roundId: 'r1', host: c2 });
      await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
        kind: 'record', record: { hosts: { 1: 'rerouted', 2: 'admitted' } },
      });
      expect((await subject.git(['rev-parse', 'HEAD^{tree}'])).stdout.trim())
        .toBe((await subject.git(['rev-parse', `${subject.closed1}^{tree}`])).stdout.trim());
      await expect(completeRerouteSync({ worktree: subject.repo, slug: 'demo', roundId, git: subject.git }))
        .resolves.toMatchObject({ kind: 'completed', record: { hosts: { 1: 'rerouted', 2: 'admitted' } } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  // Covers: task:rem-as-built-rem-as-built-R2
  it('returns recovered reroute navigation before attempting another pending round', async () => {
    const subject = await fixture();
    try {
      await expect(rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git: subject.git }))
        .resolves.toMatchObject({ kind: 'rerouted' });
      const secondRoundId = parseRoundId('r2')!;
      const second = await createRouteRecord(subject.repo, 'demo', {
        roundId: secondRoundId,
        sealedAuthored: 1,
        kind: 'audit',
        items: [{ findingId: 'second-pending', kind: 'audit', owner: c1, host: c1, reason: 'task-slice', fallback: [] }],
        allocation: { [c1]: { remTaskIds: [], blockBodies: [] } },
      });
      if (second.kind !== 'created') throw new Error('second route creation failed');
      const secondBefore = (await subject.git(['rev-parse', routeRecordRefFor('demo', secondRoundId)])).stdout.trim();

      await expect(reconcileRounds(subject.repo, 'demo', { git: subject.git }))
        .resolves.toEqual({ kind: 'navigate-host', roundId: 'r1', host: c2 });
      await expect(readRepairMarker(subject.repo, 'demo')).resolves.toMatchObject({
        kind: 'marker', marker: { roundId: 'r1', host: c2 },
      });
      expect((await subject.git(['rev-parse', routeRecordRefFor('demo', secondRoundId)])).stdout.trim()).toBe(secondBefore);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('enters the reroute destination with its moved frozen allocation and unchanged receipt', async () => {
    const subject = await fixture();
    try {
      const before = await readRouteRecord(subject.repo, 'demo', roundId);
      if (before.kind !== 'record') throw new Error('missing route record before reroute');
      const receipt = JSON.stringify(before.record.receipt);
      await expect(rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git: subject.git }))
        .resolves.toMatchObject({ kind: 'rerouted' });
      await expect(completeRerouteSync({ worktree: subject.repo, slug: 'demo', roundId, git: subject.git }))
        .resolves.toMatchObject({ kind: 'completed' });

      await mkdir(join(subject.repo, '.pipeline', 'children', '2'), { recursive: true });
      await writeFile(join(subject.repo, '.pipeline', 'conduct-state.json'), JSON.stringify({ feature_desc: 'demo' }));
      await writeFile(join(subject.repo, '.pipeline', 'task-status.json'), JSON.stringify({
        tasks: [{ id: 'rem-prd-audit-T1', status: 'done' }],
      }));
      await writeFile(join(subject.repo, '.pipeline', 'children', '2', 'conduct-state.json'), JSON.stringify({
        acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
      }));
      const entered = await enterHostRegion({
        worktree: subject.repo, slug: 'demo', roundId, host: c2, planPath: '.docs/plans/demo.md',
        emitter: new ConductorEventEmitter(), git: subject.git,
      });
      if (entered.kind !== 'entered') throw new Error('detail' in entered ? entered.detail : `unexpected host-entry result: ${entered.kind}`);
      expect(entered).toMatchObject({ kind: 'entered', pinnedBase: sha(subject.closed2) });
      await expect(readFile(join(subject.repo, '.docs', 'plans', 'demo.md'), 'utf8'))
        .resolves.toContain('### Task rem-prd-audit-T1: Repair routed task\n**Child:** 2\n**Round:** r1\n');
      await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
        kind: 'record', record: {
          hosts: { 1: 'rerouted', 2: 'repairing' },
          allocation: { 2: { remTaskIds: ['rem-prd-audit-T1'], blockBodies: ['### Task rem-prd-audit-T1: Repair routed task\n**Child:** 2\n**Round:** r1\n'] } },
        },
      });
      const after = await readRouteRecord(subject.repo, 'demo', roundId);
      if (after.kind !== 'record') throw new Error('missing route record after destination entry');
      expect(JSON.stringify(after.record.receipt)).toBe(receipt);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('reroutes an admitted destination onward to the leaf, then refuses a later leaf claim', async () => {
    const subject = await fixture();
    try {
      await expect(rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git: subject.git }))
        .resolves.toMatchObject({ kind: 'rerouted' });
      await expect(completeRerouteSync({ worktree: subject.repo, slug: 'demo', roundId, git: subject.git }))
        .resolves.toMatchObject({ kind: 'completed', record: { hosts: { 1: 'rerouted', 2: 'admitted' } } });

      await subject.git(['switch', '-q', 'feat/c2/demo']);
      await subject.git(['switch', '-q', '-C', 'feat/daemon-demo', 'feat/c2/demo']);
      await writeFile(join(subject.repo, 'parse-c.ts'), 'export const parseC = 1;\n');
      await subject.git(['add', 'parse-c.ts']);
      await subject.git(['commit', '-qm', 'leaf prerequisite']);
      await subject.git(['switch', '-q', 'feat/c2/demo']);

      const admitted = await readRouteRecord(subject.repo, 'demo', roundId);
      if (admitted.kind !== 'record') throw new Error('missing admitted destination');
      const repairing = transitionHost(admitted, c2, 'repairing', { credit: false });
      if (repairing.kind !== 'updated') throw new Error('cannot enter destination repair');
      await expect(writeRoutingTransaction(subject.repo, 'demo', [{ kind: 'update-record', previous: admitted, record: repairing.record }], { git: subject.git }))
        .resolves.toEqual({ kind: 'updated' });

      await expect(rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: c2, to: c3, leaf: c3, evidence: ['parseC'], git: subject.git }))
        .resolves.toMatchObject({ kind: 'rerouted', record: { hosts: { 1: 'rerouted', 2: 'reroute-moved', 3: 'pending' } } });
      await expect(completeRerouteSync({ worktree: subject.repo, slug: 'demo', roundId, git: subject.git }))
        .resolves.toMatchObject({ kind: 'completed', record: { hosts: { 1: 'rerouted', 2: 'rerouted', 3: 'admitted' } } });
      await expect(verifyPrerequisiteClaim({
        claim: { outcome: 'blocked-by-prerequisite', child: c3, symbols: ['parseC'] }, host: c3, slug: 'demo', leaf: c3, git: subject.git,
      })).resolves.toMatchObject({ kind: 'refused-not-above' });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('uses the destination position in sparse host order rather than its numeric id', async () => {
    const subject = await fixture({ source: c2, destination: c4 });
    try {
      const rerouted = await rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: c2, to: c4, evidence: ['parseB'], git: subject.git });
      expect(rerouted).toMatchObject({ kind: 'rerouted', record: { hosts: { 2: 'reroute-moved', 4: 'pending' }, currentHostIndex: 1 } });
      const stored = await readRouteRecord(subject.repo, 'demo', roundId);
      expect(stored).toMatchObject({ kind: 'record', record: { currentHostIndex: 1 } });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('writes a child-to-leaf reroute with the inserted leaf as the current host', async () => {
    const subject = await fixture({ source: c2, destination: c3, destinationInRecord: false, leafDestination: true });
    try {
      await expect(rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: c2, to: c3, leaf: c3, evidence: ['parseB'], git: subject.git }))
        .resolves.toMatchObject({ kind: 'rerouted', record: { hosts: { 2: 'reroute-moved', 3: 'pending' }, currentHostIndex: 1 } });
      await expect(readRouteRecord(subject.repo, 'demo', roundId)).resolves.toMatchObject({
        kind: 'record', record: { hosts: { 2: 'reroute-moved', 3: 'pending' }, currentHostIndex: 1 },
      });
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('keeps a hook-stamped operator commit reachable from the rejected pin', async () => {
    const subject = await fixture();
    try {
      const operatorTip = await addHookStampedOperatorCommit(subject);
      expect(await rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git: subject.git }))
        .toMatchObject({ kind: 'rerouted' });
      expect(await refAt(subject.git, rejectedPinRefFor('demo', roundId, 1))).toBe(operatorTip);
      expect((await subject.git(['merge-base', '--is-ancestor', operatorTip, rejectedPinRefFor('demo', roundId, 1)])).exitCode).toBe(0);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

  it('refuses an unstamped operator descendant but permits a halt-record-only descendant', async () => {
    const unstamped = await fixture();
    try {
      await writeFile(join(unstamped.repo, 'operator.ts'), 'export const operator = true;\n');
      await unstamped.git(['add', '.']);
      await unstamped.git(['commit', '--no-verify', '-qm', 'operator change']);
      const tip = await refAt(unstamped.git, 'refs/heads/feat/c1/demo');
      await expect(rerouteRound({ worktree: unstamped.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git: unstamped.git }))
        .resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining(tip!) });
      expect(await refAt(unstamped.git, 'refs/heads/feat/c1/demo')).toBe(tip);
      expect(await refAt(unstamped.git, rejectedPinRefFor('demo', roundId, 1))).toBeUndefined();
    } finally { await rm(unstamped.repo, { recursive: true, force: true }); }

    const halted = await fixture();
    try {
      await mkdir(join(halted.repo, '.docs', 'halted'), { recursive: true });
      await writeFile(join(halted.repo, '.docs', 'halted', 'demo.md'), 'halted\n');
      await halted.git(['add', '.docs/halted/demo.md']);
      await halted.git(['commit', '-qm', 'record halt']);
      await expect(rerouteRound({ worktree: halted.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git: halted.git }))
        .resolves.toMatchObject({ kind: 'rerouted' });
    } finally { await rm(halted.repo, { recursive: true, force: true }); }
  });

  it('refuses a non-terminal journal or non-pending destination without moving its transaction refs', async () => {
    const journaled = await fixture();
    try {
      const routeBefore = await refAt(journaled.git, routeRecordRefFor('demo', roundId));
      await writeNonTerminalJournal(journaled);
      await expect(rerouteRound({ worktree: journaled.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git: journaled.git }))
        .resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining('restack-journal-open') });
      expect(await refAt(journaled.git, 'refs/heads/feat/c1/demo')).toBe(journaled.rejected);
      expect(await refAt(journaled.git, rejectedPinRefFor('demo', roundId, 1))).toBeUndefined();
      expect(await refAt(journaled.git, routeRecordRefFor('demo', roundId))).toBe(routeBefore);
    } finally { await rm(journaled.repo, { recursive: true, force: true }); }

    const unavailable = await fixture();
    try {
      const stored = await readRouteRecord(unavailable.repo, 'demo', roundId);
      if (stored.kind !== 'record') throw new Error('missing route record');
      // A destination that already finished in place is the reachable non-pending case.
      expect(await writeRoutingTransaction(unavailable.repo, 'demo', [{
        kind: 'update-record', previous: stored,
        record: { ...stored.record, hosts: { ...stored.record.hosts, [c2]: 'done' } },
      }])).toEqual({ kind: 'updated' });
      await expect(rerouteRound({ worktree: unavailable.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git: unavailable.git }))
        .resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining('destination is not pending') });
      expect(await refAt(unavailable.git, 'refs/heads/feat/c1/demo')).toBe(unavailable.rejected);
      expect(await refAt(unavailable.git, rejectedPinRefFor('demo', roundId, 1))).toBeUndefined();
    } finally { await rm(unavailable.repo, { recursive: true, force: true }); }
  });

  it.each(['marker', 'branch'] as const)('fails closed when a concurrent %s writer wins the CAS', async (racer) => {
    const subject = await fixture();
    try {
      const routeBefore = await refAt(subject.git, routeRecordRefFor('demo', roundId));
      let raced = false;
      const git: GitRunner = async (args, options) => {
        if (!raced && args[0] === 'update-ref' && args[1] === '--stdin') {
          raced = true;
          if (racer === 'marker') {
            const replacement = await subject.git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ roundId, host: c2 }) });
            await subject.git(['update-ref', repairMarkerRefFor('demo'), replacement.stdout.trim()]);
          } else {
            await subject.git(['update-ref', 'refs/heads/feat/c1/demo', subject.closed1]);
          }
        }
        return subject.git(args, options);
      };
      await expect(rerouteRound({ worktree: subject.repo, slug: 'demo', roundId, from: c1, to: c2, evidence: ['parseB'], git }))
        .resolves.toMatchObject({ kind: 'refused', detail: expect.stringContaining('r1 reroute compare-and-swap failed') });
      expect(await refAt(subject.git, routeRecordRefFor('demo', roundId))).toBe(routeBefore);
      expect(await refAt(subject.git, rejectedPinRefFor('demo', roundId, 1))).toBeUndefined();
      expect(raced).toBe(true);
    } finally { await rm(subject.repo, { recursive: true, force: true }); }
  });

});
