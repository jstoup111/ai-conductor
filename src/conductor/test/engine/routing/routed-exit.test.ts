// Covers: task:6
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { parseCommitSha } from '../../../src/engine/restack/restack-types.js';
import { hostNoOpEvidence } from '../../../src/engine/routing/routed-exit.js';
import { closureRefFor, repairMarkerRefFor, routeRecordRefFor } from '../../../src/engine/routing/routing-refs.js';
import { emptyUnsettledReceipt, parseRoundId, type RouteRecord } from '../../../src/engine/routing/route-types.js';
import type { StoredRouteRecord } from '../../../src/engine/routing/route-record-store.js';
import { sealStack } from '../restack/restack-sweepG2-fixture.js';

const host = parseChildId(1)!;
const anotherHost = parseChildId(2)!;
const roundId = parseRoundId('r1')!;
const roots: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  vi.doUnmock('../../../src/engine/restack/restack-executor.js');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeBlob(git: ReturnType<typeof makeGitRunner>, value: unknown): Promise<string> {
  const result = await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify(value) });
  if (result.exitCode !== 0) throw new Error('cannot write fixture blob');
  return result.stdout.trim();
}

async function fixture(): Promise<{ readonly root: string; readonly git: ReturnType<typeof makeGitRunner>; readonly stored: StoredRouteRecord }> {
  const root = await mkdtemp(join(tmpdir(), 'routed-exit-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'routed-exit@example.invalid']);
  await git(['config', 'user.name', 'Routed exit']);
  await writeFile(join(root, 'host.txt'), 'closure\n');
  await git(['add', 'host.txt']);
  await git(['commit', '-qm', 'closed host']);
  const closure = parseCommitSha((await git(['rev-parse', 'HEAD'])).stdout.trim())!;
  const tree = parseCommitSha((await git(['rev-parse', 'HEAD^{tree}'])).stdout.trim())!;
  await git(['update-ref', closureRefFor('demo', host), closure]);
  const record: RouteRecord = {
    roundId,
    kind: 'audit',
    phase: 'open',
    items: [{ findingId: 'finding-1', kind: 'audit', owner: host, host, reason: 'task ownership', fallback: [] }],
    allocation: { [host]: { remTaskIds: ['rem-1'], blockBodies: ['### Task rem-1\n'] } },
    hosts: { [host]: 'repairing' },
    currentHostIndex: 0,
    receipt: emptyUnsettledReceipt(),
    outbox: [],
    entry: { host, pinnedBase: closure, tree },
  };
  return { root, git, stored: { kind: 'record', slug: 'demo', blob: closure, record } };
}

describe('host no-op evidence (real local Git)', () => {
  it('compares an unchanged host with its pinned entry baseline', async () => {
    const subject = await fixture();

    await expect(hostNoOpEvidence(subject.root, 'demo', subject.stored, host)).resolves.toEqual({
      kind: 'evidence', headMoved: false, treeDiffers: false, tipEqualsClosure: true,
    });
  });

  it('recognizes a moved tip with the entry tree', async () => {
    const subject = await fixture();
    await subject.git(['commit', '--allow-empty', '-qm', 'metadata only']);

    await expect(hostNoOpEvidence(subject.root, 'demo', subject.stored, host)).resolves.toEqual({
      kind: 'evidence', headMoved: true, treeDiffers: false, tipEqualsClosure: false,
    });
  });

  it('recognizes a tree changed after entry', async () => {
    const subject = await fixture();
    await writeFile(join(subject.root, 'host.txt'), 'changed\n');
    await subject.git(['add', 'host.txt']);
    await subject.git(['commit', '-qm', 'change host tree']);

    await expect(hostNoOpEvidence(subject.root, 'demo', subject.stored, host)).resolves.toEqual({
      kind: 'evidence', headMoved: true, treeDiffers: true, tipEqualsClosure: false,
    });
  });

  it.each([
    ['has no entry baseline', (stored: StoredRouteRecord) => ({ ...stored, record: { ...stored.record, entry: undefined } })],
    ['belongs to another host', (stored: StoredRouteRecord) => ({ ...stored, record: { ...stored.record, entry: { ...stored.record.entry!, host: anotherHost } } })],
  ])('fails closed when the entry baseline %s', async (_scenario, change) => {
    const subject = await fixture();
    const closure = closureRefFor('demo', host);
    const before = await subject.git(['rev-parse', '-q', '--verify', closure]);

    await expect(hostNoOpEvidence(subject.root, 'demo', change(subject.stored), host)).resolves.toEqual({
      kind: 'unavailable', detail: 'host 1 entry baseline is unavailable',
    });
    await expect(subject.git(['rev-parse', '-q', '--verify', closure])).resolves.toEqual(before);
  });

  it('fails closed without a host closure and leaves it absent', async () => {
    const subject = await fixture();
    const closure = closureRefFor('demo', host);
    await subject.git(['update-ref', '-d', closure]);

    await expect(hostNoOpEvidence(subject.root, 'demo', subject.stored, host)).resolves.toEqual({
      kind: 'unavailable', detail: 'host 1 closure is unavailable',
    });
    await expect(subject.git(['rev-parse', '-q', '--verify', closure])).resolves.toMatchObject({ exitCode: 1 });
  });
});

// Covers: task:13
describe('routed exit resolver forwarding', () => {
  it('forwards the supplied resolver and cap to the exit restack', async () => {
    const runRestack = vi.fn().mockResolvedValue({ kind: 'applied', opId: 'test-op' });
    vi.resetModules();
    vi.doMock('../../../src/engine/restack/restack-executor.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../../src/engine/restack/restack-executor.js')>();
      return { ...actual, runRestack };
    });
    const { requestRoutedExit } = await import('../../../src/engine/routing/routed-exit.js');
    const subject = await fixture();
    const resolver = vi.fn(async () => ({ resolved: false as const, reason: 'not used' }));
    await mkdir(join(subject.root, '.ai-conductor'), { recursive: true });
    await writeFile(join(subject.root, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  route_whole_feature_fixes: true\n');
    await subject.git(['add', '.ai-conductor/config.yml']);
    await subject.git(['commit', '-qm', 'enable routing']);
    await subject.git(['checkout', '-qb', 'feat/c1/demo']);
    await subject.git(['commit', '--allow-empty', '-qm', 'closed child']);
    const closure = parseCommitSha((await subject.git(['rev-parse', 'HEAD'])).stdout.trim())!;
    await subject.git(['update-ref', closureRefFor('demo', host), closure]);
    await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
    await subject.git(['commit', '--allow-empty', '-qm', 'leaf']);
    await sealStack(subject.root, [1, 2]);
    await subject.git(['checkout', '-q', 'feat/c1/demo']);
    await subject.git(['commit', '--allow-empty', '-qm', 'routed work']);
    const tree = parseCommitSha((await subject.git(['rev-parse', `${closure}^{tree}`])).stdout.trim())!;
    const record: RouteRecord = { ...subject.stored.record, entry: { host, pinnedBase: closure, tree } };
    const recordBlob = await writeBlob(subject.git, record);
    await subject.git(['update-ref', routeRecordRefFor('demo', roundId), recordBlob]);
    await subject.git(['update-ref', repairMarkerRefFor('demo'), await writeBlob(subject.git, { host, roundId })]);
    await expect(requestRoutedExit({
      worktree: subject.root,
      slug: 'demo',
      roundId,
      host,
      git: subject.git,
      resolver,
      resolverCap: 7,
    })).resolves.toEqual({ kind: 'restacked' });

    expect(runRestack).toHaveBeenCalledWith(expect.objectContaining({
      cause: 'feature-repair',
      resolver,
      resolverCap: 7,
    }));
  });
});
