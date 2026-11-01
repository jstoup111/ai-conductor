// Covers: task:6, task:22
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execa } from 'execa';
import {
  HALT_RECORD_DIR,
  haltRecordPath,
  isRecordableHaltClass,
  recordHalt,
  renderHaltRecord,
  resolveRecordability,
  supersedeHaltRecord,
  supersedeHaltRecordText,
  type HaltRecordRemoteOptions,
} from '../../src/engine/halt-record.js';
import { writeHaltMarker } from '../../src/engine/halt-marker.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { clearHaltForResume } from '../../src/engine/daemon-rekick.js';
import { executeRemoteGit, type RemoteGitExecutionResult } from '../../src/engine/remote-git-operations.js';
import { pushedTipRef } from '../../src/engine/push-lease.js';
import { writePublicationRecord, type PublicationRecord } from '../../src/engine/stack-publication-record.js';
import { refreshLedgerRefFor } from '../../src/engine/stack-refresh-ledger.js';
import { parseChildId } from '../../src/engine/child-context.js';
import type { GithubMutationExecutionContext } from '../../src/engine/tracker-client.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const input = {
  slug: 'operator-decision',
  haltClass: 'needs-human',
  step: 'build_review',
  phase: 'BUILD',
  branch: 'feat/operator-decision',
  headSha: 'f00dbabe1234567890',
  haltedAt: '2026-08-23T16:30:00.000Z',
  haltBody: 'Build review needs an operator decision.\nThe release note scope is unclear.',
} as const;

describe('halt record rendering', () => {
  // Covers: task:22
  it('classifies a published-stack guard refusal without overwriting the halt record', async () => {
    const root = await makeFeatureRepository();
    const events = new ConductorEventEmitter();
    const failures: Array<{ path: string; reason: string }> = [];
    events.on('halt_record_push_failed', (event) => {
      if (event.type === 'halt_record_push_failed') failures.push({ path: event.path, reason: event.reason });
    });

    await expect(writeHaltMarker(root, input.haltBody, input.haltClass, events, {
      ...successfulRemote(),
      remoteGit: async (): Promise<RemoteGitExecutionResult> => ({
        kind: 'failed', error: 'published stack tip mismatch', targets: [],
      }),
    })).resolves.toEqual({ status: 'written' });

    expect(failures).toEqual([{ path: haltRecordPath(basename(root)), reason: 'stack-tip-mismatch' }]);
    await expect(readFile(join(root, haltRecordPath(basename(root))), 'utf8')).resolves.toContain(
      'Push status: this record may be ahead of the remote; push is not guaranteed.',
    );
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(input.haltBody);
  });

  it('refuses halt-record leaf publication through the pending-ledger guard and emits halt_record_push_failed', async () => {
    const { root, origin, leaf, rewritten } = await makePendingPublishedStackHaltRepository();
    const events = new ConductorEventEmitter();
    const failures: Array<{ path: string; reason: string }> = [];
    const transport = vi.fn(async (args: string[]) => {
      if (args[0] === 'push') throw new Error('refused push reached transport');
      const result = await execa('git', args, { cwd: root, reject: false });
      if ((result.exitCode ?? 1) !== 0) throw new Error(`git ${args.join(' ')} failed`);
      return { stdout: result.stdout };
    });
    events.on('halt_record_push_failed', (event) => {
      if (event.type === 'halt_record_push_failed') failures.push({ path: event.path, reason: event.reason });
    });

    await expect(writeHaltMarker(root, input.haltBody, input.haltClass, events, {
      git: localGit(root),
      mutation: stackMutation(),
      remoteGit: (args, dependencies) => executeRemoteGit(args, {
        ...dependencies,
        config: async () => ({ stdout: 'git@github.com:acme/rocket.git\n' }),
        runRemoteGit: transport,
      }),
    })).resolves.toEqual({ status: 'written' });

    expect(await gitValue(origin, 'refs/heads/feat/daemon-demo')).toBe(leaf);
    expect(await gitValue(root, pushedTipRef('demo', 'feat/daemon-demo'))).toBe(leaf);
    expect(await gitValue(root, 'HEAD')).not.toBe(rewritten);
    expect(transport).toHaveBeenCalledWith(
      expect.arrayContaining(['ls-remote']),
      expect.objectContaining({ credential: 'write' }),
    );
    expect(transport.mock.calls.map(([args]) => args[0])).toEqual(['ls-remote']);
    expect(failures).toEqual([{ path: haltRecordPath('demo'), reason: 'stack-tip-mismatch' }]);
  });

  it('renders every operator pickup field for a halted feature', () => {
    expect(renderHaltRecord(input)).toBe(
      '# Halt record\n\n' +
        'Status: halted\n' +
        'Slug: operator-decision\n' +
        'Class: needs-human\n' +
        'Halting step: build_review\n' +
        'Phase: BUILD\n' +
        'Branch: feat/operator-decision\n' +
        'Head SHA: f00dbabe1234567890\n' +
        'Halted at: 2026-08-23T16:30:00.000Z\n\n' +
        'Push status: this record may be ahead of the remote; push is not guaranteed.\n\n' +
        '## HALT\n\n' +
        '```text\n' +
        'Build review needs an operator decision.\nThe release note scope is unclear.\n' +
        '```\n',
    );
  });

  it('uses a fence that preserves a HALT body containing a fence delimiter', () => {
    const haltBody = 'first line\n```\nembedded delimiter\n````';
    const record = renderHaltRecord({ ...input, haltBody });

    expect(record).toContain(`\`\`\`\`\`text\n${haltBody}\n\`\`\`\`\``);
  });

  it('warns that the record may be ahead of the remote', () => {
    expect(renderHaltRecord(input)).toContain(
      'Push status: this record may be ahead of the remote; push is not guaranteed.\n',
    );
  });

  it('is byte-identical for identical input and resolves the record path', () => {
    const first = renderHaltRecord(input);
    const second = renderHaltRecord(input);

    expect(first).toBe(second);
    expect(haltRecordPath(input.slug)).toBe(`${HALT_RECORD_DIR}/operator-decision.md`);
  });
});

describe('halt record supersession', () => {
  it('resolves a halted record while preserving its halt history', () => {
    const superseded = supersedeHaltRecordText(renderHaltRecord(input), {
      cause: 'operator resume',
      resolvedAt: '2026-08-23T17:00:00.000Z',
    });

    expect(superseded).toBe(
      '# Halt record\n\n' +
        'Status: resolved\n' +
        'Resolution cause: operator resume\n' +
        'Resolved at: 2026-08-23T17:00:00.000Z\n' +
        'Slug: operator-decision\n' +
        'Class: needs-human\n' +
        'Halting step: build_review\n' +
        'Phase: BUILD\n' +
        'Branch: feat/operator-decision\n' +
        'Head SHA: f00dbabe1234567890\n' +
        'Halted at: 2026-08-23T16:30:00.000Z\n\n' +
        'Push status: this record may be ahead of the remote; push is not guaranteed.\n\n' +
        '## HALT\n\n' +
        '```text\n' +
        'Build review needs an operator decision.\nThe release note scope is unclear.\n' +
        '```\n',
    );
  });

  it('leaves an already-resolved record byte-identical', () => {
    const resolved = supersedeHaltRecordText(
      'Status: resolved\nResolution cause: operator resume\nResolved at: 2026-08-23T17:00:00.000Z\n',
      { cause: 'rekick', resolvedAt: '2026-08-23T18:00:00.000Z' },
    );

    expect(resolved).toBe('Status: resolved\nResolution cause: operator resume\nResolved at: 2026-08-23T17:00:00.000Z\n');
  });

  it('commits a resolution once when superseded repeatedly', async () => {
    const root = await makeFeatureRepository();
    const remote = successfulRemote();
    await recordHalt(root, input, remote);
    const before = await commitCount(root);

    await expect(supersedeHaltRecord(root, input.slug, 'operator resume', remote)).resolves.toEqual({ kind: 'written' });
    await expect(supersedeHaltRecord(root, input.slug, 'rekick', remote)).resolves.toEqual({ kind: 'noop' });

    expect(await commitCount(root)).toBe(before + 1);
  });

  it('does nothing when no halt record exists', async () => {
    const root = await makeFeatureRepository();
    const before = await commitCount(root);

    await expect(supersedeHaltRecord(root, input.slug, 'operator resume')).resolves.toEqual({ kind: 'noop' });
    await expect(readFile(join(root, haltRecordPath(input.slug)), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await commitCount(root)).toBe(before);
  });

  it('returns a failure result when the record path cannot be read as a file', async () => {
    const root = await makeFeatureRepository();
    await mkdir(join(root, haltRecordPath(input.slug)), { recursive: true });

    await expect(supersedeHaltRecord(root, input.slug, 'operator resume')).resolves.toMatchObject({
      kind: 'failed',
      reason: expect.stringMatching(/\S/),
    });
  });
});

describe('kickback halt clear record composition', () => {
  it('confirms and clears the marker when no committed halt record exists', async () => {
    const root = await makeFeatureRepository();
    const before = await commitCount(root);
    const cleared: string[] = [];

    await expect(clearComposedHalt(root, cleared)).resolves.toBe('confirmed');

    expect(cleared).toEqual([root]);
    await expect(readFile(join(root, haltRecordPath(input.slug)), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await commitCount(root)).toBe(before);
  });

  it('resolves the committed record before clearing the marker', async () => {
    const root = await makeFeatureRepository();
    await expect(recordHalt(root, input, successfulRemote())).resolves.toEqual({ kind: 'written' });
    await expect(readFile(join(root, haltRecordPath(input.slug)), 'utf8')).resolves.toContain('Status: halted');
    const before = await commitCount(root);
    const cleared: string[] = [];

    await expect(clearComposedHalt(root, cleared)).resolves.toBe('confirmed');

    expect(cleared).toEqual([root]);
    await expect(readFile(join(root, haltRecordPath(input.slug)), 'utf8')).resolves.toContain('Status: resolved');
    await expect(readFile(join(root, haltRecordPath(input.slug)), 'utf8')).resolves.toContain('Resolution cause: kickback-budget');
    expect(await commitCount(root)).toBe(before + 1);
  });

  it('retains the marker and reports the directory read failure', async () => {
    const root = await makeFeatureRepository();
    await mkdir(join(root, haltRecordPath(input.slug)), { recursive: true });
    const cleared: string[] = [];
    const logs: string[] = [];

    await expect(clearComposedHalt(root, cleared, logs)).resolves.toBe('partial');

    expect(cleared).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('halt record not superseded');
    expect(logs[0]).toContain('EISDIR');
  });
});

const scratchRoots: string[] = [];

afterEach(async () => {
  while (scratchRoots.length > 0) {
    await rm(scratchRoots.pop()!, { recursive: true, force: true });
  }
});

describe('halt recordability', () => {
  it('records only operator-actionable halt classes', () => {
    expect([
      isRecordableHaltClass('mechanical'),
      isRecordableHaltClass('needs-human'),
      isRecordableHaltClass('plan-gap'),
      isRecordableHaltClass('protected-artifact'),
    ]).toEqual([false, true, true, true]);
  });

  it('does not record a halt from the repository default branch', async () => {
    const root = await makeScratchRepository();

    await expect(resolveRecordability(root, 'needs-human')).resolves.toBe(false);
  });

  it('records an operator-actionable halt from a feature worktree', async () => {
    const root = await makeScratchRepository();
    const worktree = join(root, '..', 'halt-record-feature-worktree');
    scratchRoots.push(worktree);
    await execa('git', ['worktree', 'add', '-q', '-b', 'feat/operator-decision', worktree], { cwd: root });

    await expect(resolveRecordability(worktree, 'needs-human')).resolves.toBe(true);
  });

  it('fails closed when branch resolution throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'halt-record-not-a-repository-'));
    scratchRoots.push(root);

    await expect(resolveRecordability(root, 'needs-human')).resolves.toBe(false);
  });
});

async function makeScratchRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'halt-record-repository-'));
  scratchRoots.push(root);
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: root });
  await writeFile(join(root, 'README.md'), 'test\n');
  await execa('git', ['add', 'README.md'], { cwd: root });
  await execa('git', ['commit', '-q', '-m', 'initial'], { cwd: root });
  return root;
}

async function makeFeatureRepository(): Promise<string> {
  const root = await makeScratchRepository();
  const worktree = join(root, '..', `${basename(root)}-feature-worktree`);
  scratchRoots.push(worktree);
  await execa('git', ['worktree', 'add', '-q', '-b', input.branch, worktree], { cwd: root });
  return worktree;
}

async function commitCount(cwd: string): Promise<number> {
  const { stdout } = await execa('git', ['rev-list', '--count', 'HEAD'], { cwd });
  return Number.parseInt(stdout, 10);
}

function successfulRemote(): HaltRecordRemoteOptions {
  return {
    git: async (args: string[]) => ({
      stdout: args[0] === 'rev-parse' ? `${'a'.repeat(40)}\n` : '',
    }),
    remoteGit: async (): Promise<RemoteGitExecutionResult> => ({ kind: 'executed', targets: [] }),
  };
}

async function makePendingPublishedStackHaltRepository(): Promise<{
  root: string;
  origin: string;
  leaf: string;
  rewritten: string;
}> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'halt-record-published-stack-'));
  scratchRoots.push(fixtureRoot);
  const primary = join(fixtureRoot, 'primary');
  const root = join(fixtureRoot, 'demo');
  const origin = join(fixtureRoot, 'origin.git');
  await mkdir(primary);
  await initTestRepo(primary);
  await writeFile(join(primary, 'seed.txt'), 'seed\n');
  await execa('git', ['add', '.'], { cwd: primary });
  await execa('git', ['commit', '-m', 'seed'], { cwd: primary });
  await execa('git', ['init', '--bare', '--initial-branch=main', origin], { cwd: fixtureRoot });
  await execa('git', ['remote', 'add', 'origin', origin], { cwd: primary });

  await execa('git', ['checkout', '-b', 'feat/c1/demo'], { cwd: primary });
  const child1 = await commitFile(primary, 'child-1');
  await execa('git', ['push', 'origin', 'HEAD:refs/heads/feat/c1/demo'], { cwd: primary });
  await execa('git', ['checkout', '-b', 'feat/c3/demo'], { cwd: primary });
  const child3 = await commitFile(primary, 'child-3');
  await execa('git', ['push', 'origin', 'HEAD:refs/heads/feat/c3/demo'], { cwd: primary });
  await execa('git', ['worktree', 'add', '-b', 'feat/daemon-demo', root], { cwd: primary });
  scratchRoots.push(root);
  const leaf = await commitFile(root, 'leaf');
  await execa('git', ['push', 'origin', 'HEAD:refs/heads/feat/daemon-demo'], { cwd: root });
  await execa('git', ['fetch', 'origin', '+refs/heads/feat/daemon-demo:refs/remotes/origin/feat/daemon-demo'], { cwd: root });

  const c1 = parseChildId(1)!;
  const c3 = parseChildId(3)!;
  const c5 = parseChildId(5)!;
  const record: PublicationRecord = {
    version: 1,
    members: [
      { position: c1, branch: 'feat/c1/demo', pr: 101 },
      { position: c3, branch: 'feat/c3/demo', pr: 103 },
      { position: c5, branch: 'feat/daemon-demo', pr: 500 },
    ],
  };
  await expect(writePublicationRecord(root, 'demo', undefined, record)).resolves.toEqual({ kind: 'updated' });
  for (const [branch, tip] of [
    ['feat/c1/demo', child1], ['feat/c3/demo', child3], ['feat/daemon-demo', leaf],
  ] as const) {
    await execa('git', ['update-ref', pushedTipRef('demo', branch), tip], { cwd: root });
  }

  await execa('git', ['reset', '--hard', 'main'], { cwd: root });
  const rewritten = await commitFile(root, 'recorded-rewrite');
  const ledger = JSON.stringify({
    version: 1,
    members: {
      'feat/daemon-demo': {
        position: c5, pr: 500, publishedTip: leaf, recordedTip: rewritten,
      },
    },
    rounds: [], aboveOwed: [], posted: [],
  });
  const blob = await execa('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: ledger });
  await execa('git', ['update-ref', refreshLedgerRefFor('demo'), blob.stdout.trim()], { cwd: root });
  return { root, origin, leaf, rewritten };
}

async function commitFile(cwd: string, name: string): Promise<string> {
  await writeFile(join(cwd, `${name}.txt`), `${name}\n`);
  await execa('git', ['add', '.'], { cwd });
  await execa('git', ['commit', '-m', name], { cwd });
  return gitValue(cwd, 'HEAD');
}

async function gitValue(cwd: string, ref: string): Promise<string> {
  return (await execa('git', ['rev-parse', '--verify', ref], { cwd })).stdout.trim();
}

function localGit(cwd: string): HaltRecordRemoteOptions['git'] {
  return async (args, options) => {
    const result = await execa('git', args, { cwd, input: options?.input, reject: false });
    if ((result.exitCode ?? 1) !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
    return { stdout: result.stdout };
  };
}

function stackMutation(): GithubMutationExecutionContext {
  return {
    provenance: {
      repository: 'acme/rocket', defaultBranch: 'main', specBranch: 'feat/daemon-demo',
      featureMarker: '.docs/specs/demo.md', publication: 'initial',
    },
    dependencies: {
      resolveMachineOwner: async () => ({ resolved: true, id: 'alice' }),
      provenanceDiscovery: { readCommittedRecords: async () => [{ path: '.docs/specs/demo.md', content: 'Owner: alice\n' }] },
    },
  };
}

function clearComposedHalt(worktreePath: string, cleared: string[], logs: string[] = []) {
  return clearHaltForResume({
    worktreePath,
    slug: input.slug,
    clearMarker: async (path) => { cleared.push(path); },
    resolveCommittedRecord: (path, slug) =>
      supersedeHaltRecord(path, slug, 'kickback-budget', successfulRemote()),
    log: (message) => { logs.push(message); },
  });
}
