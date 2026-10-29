// Covers: task:rem-as-built-R24
// Covers: task:22
// Covers: task:rem-prd-audit-R19
// Covers: task:3
// Covers: task:4
// Covers: task:5
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';
import { readKickbackLedger } from '../../../src/engine/kickback-ledger.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import {
  cascadeUpdateLines,
  cascadesRefFor,
  checkCascadeCap,
  readCascadeCounts,
} from '../../../src/engine/restack/cascade-cap.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];
const envelopeFilesystem = {
  readFile: (path: string) => readFile(path, 'utf8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

function child(value: number) {
  const parsed = parseChildId(value);
  if (parsed === undefined) throw new Error(`invalid child ${value}`);
  return parsed;
}

async function fixture(options: { tier?: 'S' | 'M' | 'L'; config?: string } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'cascade-cap-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const commit = async (message: string, path: string) => {
    await writeFile(join(repo, path), `${message}\n`);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'cascade@example.test']);
  await git(['config', 'user.name', 'Cascade cap']);
  await commit('base', 'base.txt');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await commit('closed child', 'child.txt');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  await commit('repair child', 'repair.txt');
  await git(['checkout', '-qb', 'feat/daemon-demo', closed]);
  await mkdir(join(repo, '.pipeline', 'children', '2'), { recursive: true });
  if (options.tier !== undefined) {
    await writeFile(join(repo, '.pipeline', 'conduct-state.json'), JSON.stringify({ complexity_tier: options.tier }));
  }
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), options.config ?? '{}\n');
  await writeSliceTopologyFixture(repo, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  return { repo, git };
}

async function writeCascadeCounts(repo: string, counts: Record<string, number>, limits?: Record<string, number>) {
  const git = makeGitRunner(repo);
  const blob = (await git(['hash-object', '-w', '--stdin'], { input: JSON.stringify({ version: 1, counts, ...(limits === undefined ? {} : { limits }) }) })).stdout.trim();
  await git(['update-ref', cascadesRefFor('demo'), blob]);
}

describe('restack cascade cap (real local Git)', () => {
  it.each([
    { charged: 7, expected: 8 },
    { charged: 3, expected: 4 },
  ])('uses the unconfigured tier-L allowance when child 1 has $charged charged cascades', async ({ charged, expected }) => {
    const subject = await fixture({ tier: 'L' });
    await writeCascadeCounts(subject.repo, { 1: charged });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: expected } },
    });
  });

  it('uses the tier-L cap before creating a journal and leaves every origin unchanged', async () => {
    const subject = await fixture({ tier: 'L' });
    await writeCascadeCounts(subject.repo, { 1: 8, 2: 0 });
    const records: Array<{ type: string; reason?: string; child?: number }> = [];
    const events = new ConductorEventEmitter();
    events.on('restack_refused', (event) => { records.push(event); });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', originatingChildren: [child(1), child(2)], events, git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'halted' });
    expect(records).toMatchObject([{ type: 'restack_refused', reason: 'cascade-cap', child: 1 }]);
    await expect(subject.git(['rev-parse', '--verify', 'refs/conductor/demo/restack/journal'])).rejects.toBeDefined();
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: 8, 2: 0 } },
    });
  });

  it('names the default tier-L allowance and exhausted budget in a cascade-cap halt', async () => {
    const subject = await fixture({ tier: 'L' });
    await writeCascadeCounts(subject.repo, { 1: 8 });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'halted' });

    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('originating child 1 reached 8/8 cascades — tier L allowance 8 (default)');
    expect(halt).toContain('Kickback budget (restack): 8/8 consumed; 0 remaining');
  });

  it('names a raised cascade limit after the tier allowance in a cascade-cap halt', async () => {
    const subject = await fixture({ tier: 'L' });
    await writeCascadeCounts(subject.repo, { 1: 10 }, { 1: 10 });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'halted' });

    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves
      .toContain('originating child 1 reached 10/10 cascades — tier L allowance 8 (default); raised to 10');
  });

  it('names configured and unrecorded-M allowances in cascade-cap halts', async () => {
    const configured = await fixture({
      tier: 'M',
      config: 'stacked_prs:\n  max_restack_cascades:\n    M: 4\n',
    });
    await writeCascadeCounts(configured.repo, { 2: 4 });
    await expect(runRestack({
      worktree: configured.repo,
      slug: 'demo',
      cause: 'feature-repair',
      originatingChildren: [child(2)],
      git: makeGitRunner(configured.repo),
    })).resolves.toEqual({ kind: 'halted' });
    await expect(readFile(join(configured.repo, '.pipeline', 'HALT'), 'utf8')).resolves
      .toContain('originating child 2 reached 4/4 cascades — tier M allowance 4 (configured)');

    const unrecorded = await fixture();
    await writeCascadeCounts(unrecorded.repo, { 1: 3 });
    await expect(runRestack({
      worktree: unrecorded.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(unrecorded.repo),
    })).resolves.toEqual({ kind: 'halted' });
    await expect(readFile(join(unrecorded.repo, '.pipeline', 'HALT'), 'utf8')).resolves
      .toContain('tier unrecorded, treated as M; allowance 3 (default)');
  });

  it.each(['M', 'S', undefined] as const)('halts at the default allowance for tier %s', async (tier) => {
    const subject = await fixture(tier === undefined ? {} : { tier });
    await writeCascadeCounts(subject.repo, { 1: 3 });
    const records: Array<{ type: string; reason?: string; child?: number }> = [];
    const events = new ConductorEventEmitter();
    events.on('restack_refused', (event) => { records.push(event); });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', events, git: makeGitRunner(subject.repo),
    })).resolves.toEqual({ kind: 'halted' });
    expect(records).toMatchObject([{ type: 'restack_refused', reason: 'cascade-cap', child: 1 }]);
    await expect(subject.git(['rev-parse', '--verify', 'refs/conductor/demo/restack/journal'])).rejects.toBeDefined();
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });

  it('lets another originating child consume the tier-M allowance independently', async () => {
    const subject = await fixture({ tier: 'M' });
    await writeCascadeCounts(subject.repo, { 1: 3, 2: 2 });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', originatingChildren: [child(2)], git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({
      kind: 'counts', counts: { counts: { 1: 3, 2: 3 } },
    });
  });

  it('uses a configured tier-L allowance', async () => {
    const config = 'stacked_prs:\n  max_restack_cascades:\n    L: 10\n';
    const proceeding = await fixture({ tier: 'L', config });
    await writeCascadeCounts(proceeding.repo, { 1: 9 });
    await expect(runRestack({
      worktree: proceeding.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(proceeding.repo),
    })).resolves.toMatchObject({ kind: 'applied' });
    await expect(readCascadeCounts(proceeding.repo, 'demo')).resolves.toMatchObject({ kind: 'counts', counts: { counts: { 1: 10 } } });

    const halted = await fixture({ tier: 'L', config });
    await writeCascadeCounts(halted.repo, { 1: 10 });
    const events = new ConductorEventEmitter();
    const records: Array<{ type: string; reason?: string; child?: number }> = [];
    events.on('restack_refused', (event) => { records.push(event); });
    await expect(runRestack({
      worktree: halted.repo, slug: 'demo', cause: 'feature-repair', events, git: makeGitRunner(halted.repo),
    })).resolves.toEqual({ kind: 'halted' });
    expect(records).toMatchObject([{ type: 'restack_refused', reason: 'cascade-cap', child: 1 }]);

    const malformed = await fixture({ tier: 'L' });
    const blob = (await makeGitRunner(malformed.repo)(['hash-object', '-w', '--stdin'], { input: '{not-json' })).stdout.trim();
    await malformed.git(['update-ref', cascadesRefFor('demo'), blob]);
    const malformedRecords: Array<{ type: string; reason?: string; child?: number }> = [];
    const malformedEvents = new ConductorEventEmitter();
    malformedEvents.on('restack_refused', (event) => { malformedRecords.push(event); });
    await expect(runRestack({
      worktree: malformed.repo, slug: 'demo', cause: 'feature-repair', events: malformedEvents, git: makeGitRunner(malformed.repo),
    })).resolves.toEqual({ kind: 'halted' });
    expect(malformedRecords).toMatchObject([{ type: 'restack_refused', reason: 'cascade-cap', child: 1 }]);
    await expect(readFile(join(malformed.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    await expect(readFile(join(malformed.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(cascadesRefFor('demo'));
    await expect(malformed.git(['rev-parse', '--verify', 'refs/conductor/demo/restack/journal'])).rejects.toBeDefined();
  });

  it('does not enforce or charge a cascade cap for a base refresh', async () => {
    const subject = await fixture({ tier: 'M' });
    await writeCascadeCounts(subject.repo, { 1: 3 });

    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: (await subject.git(['rev-parse', 'main'])).stdout.trim(), git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'repair-pending' });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'counts', counts: { counts: { 1: 3 } } });
  });

  it('keeps per-originating-child counters in a ref-backed blob and prepares a single CAS update', async () => {
    const subject = await fixture();
    const first = await cascadeUpdateLines(subject.repo, 'demo', [child(1), child(2)], { git: makeGitRunner(subject.repo) });
    expect(first.kind).toBe('lines');
    if (first.kind !== 'lines') return;
    expect(first.counts.counts).toEqual({ 1: 1, 2: 1 });
    await makeGitRunner(subject.repo)(['update-ref', '--stdin'], { input: ['start', ...first.lines, 'prepare', 'commit', ''].join('\n') });
    expect(await readCascadeCounts(subject.repo, 'demo')).toMatchObject({ kind: 'counts', counts: { counts: { 1: 1, 2: 1 } } });

    const second = await cascadeUpdateLines(subject.repo, 'demo', [child(1)], { git: makeGitRunner(subject.repo) });
    expect(second.kind).toBe('lines');
    if (second.kind !== 'lines') return;
    await makeGitRunner(subject.repo)(['update-ref', '--stdin'], { input: ['start', ...second.lines, 'prepare', 'commit', ''].join('\n') });
    expect(await readCascadeCounts(subject.repo, 'demo')).toMatchObject({ kind: 'counts', counts: { counts: { 1: 2, 2: 1 } } });
  });

  it('fails closed on a malformed counter blob', async () => {
    const subject = await fixture();
    const blob = (await makeGitRunner(subject.repo)(['hash-object', '-w', '--stdin'], { input: '{not-json' })).stdout.trim();
    await subject.git(['update-ref', cascadesRefFor('demo'), blob]);
    await expect(readCascadeCounts(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'unreadable', ref: cascadesRefFor('demo') });
    await expect(checkCascadeCap(subject.repo, 'demo', [child(1)], 8)).resolves.toMatchObject({
      kind: 'exhausted', child: 1, count: 8, limit: 8, detail: expect.stringContaining(cascadesRefFor('demo')),
    });
  });

  it('uses the caller-provided default and reports whether an exhausted limit was raised', async () => {
    const subject = await fixture();
    await writeCascadeCounts(subject.repo, { 1: 7 });
    await expect(checkCascadeCap(subject.repo, 'demo', [child(1)], 8)).resolves.toMatchObject({
      kind: 'clear', limit: 8,
    });

    await writeCascadeCounts(subject.repo, { 1: 8, 2: 0 });
    await expect(checkCascadeCap(subject.repo, 'demo', [child(1), child(2)], 8)).resolves.toEqual({
      kind: 'exhausted', child: child(1), count: 8, limit: 8, raised: false,
    });

    await writeCascadeCounts(subject.repo, { 1: 5 }, { 1: 5 });
    await expect(checkCascadeCap(subject.repo, 'demo', [child(1)], 8)).resolves.toEqual({
      kind: 'exhausted', child: child(1), count: 5, limit: 5, raised: true,
    });
  });

  it('halts before journal creation when an originating child reaches its cap, persisting child-scoped evidence and the refusal event', async () => {
    const subject = await fixture();
    await writeCascadeCounts(subject.repo, { 1: 3 });
    const records: Array<{ type: string; reason?: string; child?: number }> = [];
    const events = new ConductorEventEmitter();
    events.on('restack_refused', (event) => { records.push(event); });

    const result = await runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      events,
      git: makeGitRunner(subject.repo),
    });

    expect(result).toEqual({ kind: 'halted' });
    await expect(subject.git(['rev-parse', '--verify', 'refs/conductor/demo/restack/journal'])).rejects.toBeDefined();
    expect(records).toMatchObject([{ type: 'restack_refused', reason: 'cascade-cap', child: 1 }]);
    expect(await readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).toBe('needs-human');
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain('child 1');
    expect(halt).toContain('3/3 consumed');
    await expect(readKickbackLedger(subject.repo, child(2))).resolves.toMatchObject({
      gates: { restack: { capEvidence: { allowance: 'restacks', consumed: 3, limit: 3 } } },
    });
  });

  it('keeps child 1 at its default cascade cap when child 2 has a raised limit', async () => {
    const subject = await fixture();
    await writeCascadeCounts(subject.repo, { 1: 3 }, { 2: 5 });
    const records: Array<{ type: string; reason?: string; child?: number }> = [];
    const events = new ConductorEventEmitter();
    events.on('restack_refused', (event) => { records.push(event); });

    const result = await runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      events,
      git: makeGitRunner(subject.repo),
    });

    expect({ result, records }).toMatchObject({
      result: { kind: 'halted' },
      records: [{ type: 'restack_refused', reason: 'cascade-cap', child: 1 }],
    });
  });

  it('halts before journal creation when the cascade counter ref is corrupt', async () => {
    const subject = await fixture();
    const blob = (await makeGitRunner(subject.repo)(['hash-object', '-w', '--stdin'], { input: '{not-json' })).stdout.trim();
    await subject.git(['update-ref', cascadesRefFor('demo'), blob]);
    const records: Array<{ type: string; reason?: string; child?: number }> = [];
    const events = new ConductorEventEmitter();
    events.on('restack_refused', (event) => { records.push(event); });

    const result = await runRestack({
      worktree: subject.repo,
      slug: 'demo',
      cause: 'feature-repair',
      events,
      git: makeGitRunner(subject.repo),
    });

    expect(result).toEqual({ kind: 'halted' });
    await expect(subject.git(['rev-parse', '--verify', 'refs/conductor/demo/restack/journal'])).rejects.toBeDefined();
    expect(records).toMatchObject([{ type: 'restack_refused', reason: 'cascade-cap', child: 1 }]);
    expect(await readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).toBe('needs-human');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(cascadesRefFor('demo'));
  });
});
