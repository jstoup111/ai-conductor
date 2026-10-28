// Covers: task:12, task:rem-as-built-rem-as-built-r15
import { describe, expect, it, vi } from 'vitest';
import { runStackCommitGuard, type StackCommitGuardDependencies } from '../../src/engine/stack-commit-guard-cli.js';
import { parseChildId } from '../../src/engine/child-context.js';
import type { SliceTopology } from '../../src/engine/slice-topology.js';
import { emptyUnsettledReceipt, type RouteRecord } from '../../src/engine/routing/route-types.js';

const topology: SliceTopology = {
  kind: 'sliced',
  positions: [1, 2, 3],
  sliceMembership: { taskSlices: {}, titles: ['one', 'two', 'three'] },
  storyOwnership: {},
  stackEligibility: { kind: 'eligible' },
};

function route(kind: 'operator' | 'audit', declared = false): RouteRecord {
  return {
    roundId: 'r1' as never,
    kind,
    phase: 'open',
    items: [],
    allocation: {},
    hosts: { [parseChildId(1)!]: 'repairing' },
    currentHostIndex: 0,
    receipt: emptyUnsettledReceipt(),
    outbox: [],
    ...(kind === 'operator' ? {
      operator: {
        origin: 'land',
        reason: 'reviewer edit',
        operator: 'operator',
        entryStep: 'build',
        carried: [],
        otherTips: {},
        priorRegion: {
          statuses: { acceptance_specs: 'done', test_suite: 'done', build: 'done', build_review: 'done' },
          verdicts: {},
        },
        ...(declared ? { declaration: { tip: 'a'.repeat(40) as never, at: '2026-10-24T00:00:00.000Z' } } : {}),
      },
    } : {}),
  };
}

function guard(input: {
  branch: string;
  paths?: readonly string[];
  record?: RouteRecord;
  marker?: 'absent' | 'unreadable' | 'marker';
  durable?: boolean | 'git-error';
  topology?: SliceTopology;
  routingOn?: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const output: string[] = [];
  const loadConfig = vi.fn(async () => ({
    ok: true as const,
    config: { stacked_prs: { route_whole_feature_fixes: input.routingOn ?? true } },
    warnings: [],
  }));
  const durableChildState = vi.fn(async () => input.durable ?? true);
  const loadTopology = vi.fn(async () => input.topology ?? topology);
  const readMarker = vi.fn(async () => {
    if (input.marker === 'absent') return { kind: 'absent' } as const;
    if (input.marker === 'unreadable') return { kind: 'unreadable' } as const;
    return { kind: 'marker', slug: 'demo', blob: 'b'.repeat(40) as never, marker: { host: 1 as never, roundId: 'r1' as never } } as const;
  });
  const readRoute = vi.fn(async () => input.record === undefined
    ? { kind: 'unreadable' as const }
    : { kind: 'record' as const, slug: 'demo', blob: 'c'.repeat(40) as never, record: input.record });
  const dependencies: StackCommitGuardDependencies = {
    projectRoot: '/project',
    env: input.env ?? {},
    symbolicRef: async () => input.branch,
    stagedPaths: async () => input.paths ?? ['src/changed.ts'],
    loadConfig,
    hasDurableChildState: durableChildState,
    loadSliceTopology: loadTopology,
    readRepairMarker: readMarker,
    readRouteRecord: readRoute,
    print: (line) => output.push(line),
  };
  return { output, loadConfig, durableChildState, loadTopology, readMarker, readRoute, run: () => runStackCommitGuard(dependencies) };
}

describe('stack-commit-guard', () => {
  it.each([
    ['feat/c2/demo', 'without a Task trailer'],
    ['feat/c2/demo', 'with Task: 4'],
    ['feat/daemon-demo', 'without a Task trailer'],
  ])('refuses a tracked non-host commit on %s %s', async (branch) => {
    const subject = guard({ branch, record: route('operator') });

    await expect(subject.run()).resolves.toBe(1);
    expect(subject.output.join('\n')).toContain('feat/c1/demo');
    expect(subject.output.join('\n')).toContain('stack land --abandon');
  });

  it('allows the host and a leaf halt-record-only commit', async () => {
    await expect(guard({ branch: 'feat/c1/demo', record: route('operator') }).run()).resolves.toBe(0);

    const haltOnly = guard({
      branch: 'feat/daemon-demo',
      paths: ['.docs/halted/demo.md'],
      record: route('operator'),
    });
    await expect(haltOnly.run()).resolves.toBe(0);
    expect(haltOnly.readMarker).not.toHaveBeenCalled();
  });

  it('refuses a non-host tracked commit during an audit round', async () => {
    const subject = guard({ branch: 'feat/c2/demo', record: route('audit') });

    await expect(subject.run()).resolves.toBe(1);
    expect(subject.output.join('\n')).toContain('feat/c1/demo');
  });

  it('requires a daemon session for a declared operator host commit', async () => {
    const declared = route('operator', true);
    const refused = guard({ branch: 'feat/c1/demo', record: declared });
    await expect(refused.run()).resolves.toBe(1);
    expect(refused.output.join('\n')).toContain('declaration');

    await expect(guard({
      branch: 'feat/c1/demo',
      record: declared,
      env: { CONDUCT_DAEMON_SESSION: '1' },
    }).run()).resolves.toBe(0);
  });

  it('fails closed when a marker exists but its route record is unreadable', async () => {
    const subject = guard({ branch: 'feat/c2/demo' });

    await expect(subject.run()).resolves.toBe(1);
    expect(subject.output.join('\n')).toContain('unreadable route record');
  });

  it('abstains for a flat feature before any routing-ref read', async () => {
    const subject = guard({
      branch: 'feat/daemon-demo',
      durable: false,
      topology: { kind: 'unsliced' },
    });

    await expect(subject.run()).resolves.toBe(0);
    expect(subject.readMarker).not.toHaveBeenCalled();
    expect(subject.readRoute).not.toHaveBeenCalled();
  });

  it('abstains with routing off before any routing-state read', async () => {
    const subject = guard({ branch: 'feat/c2/demo', routingOn: false });

    await expect(subject.run()).resolves.toBe(0);
    expect(subject.loadConfig).toHaveBeenCalledWith('/project');
    expect(subject.durableChildState).not.toHaveBeenCalled();
    expect(subject.loadTopology).not.toHaveBeenCalled();
    expect(subject.readMarker).not.toHaveBeenCalled();
    expect(subject.readRoute).not.toHaveBeenCalled();
  });
});
