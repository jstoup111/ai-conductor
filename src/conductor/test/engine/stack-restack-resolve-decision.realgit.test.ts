// Covers: task:7
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { detectStackRestackResolveCommand } from '../../src/cli.js';
import { parseChildId } from '../../src/engine/child-context.js';
import type { GitRunner } from '../../src/engine/rebase.js';
import { dispatchStackRestackResolve } from '../../src/engine/stack-restack-resolve-cli.js';
import {
  readRestackDecision,
  resolutionRefFor,
  type RestackConflictRecord,
  writeConflictRecord,
} from '../../src/engine/restack/restack-conflict-record.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from '../../src/engine/restack/restack-types.js';

const execFile = promisify(execFileCallback);
const repositories: string[] = [];

function sha(value: string): CommitSha {
  const parsed = parseCommitSha(value.trim());
  if (!parsed) throw new Error(`expected SHA, got ${value}`);
  return parsed;
}

function child(value: number) {
  const parsed = parseChildId(value);
  if (!parsed) throw new Error(`expected child, got ${value}`);
  return parsed;
}

async function fixture(opId: string = 'repair-conflict') {
  const repo = await mkdtemp(join(tmpdir(), 'stack-restack-resolve-decision-'));
  repositories.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'restack@example.test']);
  await git(['config', 'user.name', 'Restack fixture']);
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'flag.ts'), 'base\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'base']);
  const base = sha((await git(['rev-parse', 'HEAD'])).stdout);
  await writeFile(join(repo, 'src', 'flag.ts'), 'conflict\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'conflicting child']);
  const commit = sha((await git(['rev-parse', 'HEAD'])).stdout);
  const record: RestackConflictRecord = {
    opId: opId as RestackOpId,
    child: child(2), oldParent: base, oldTip: commit, newParent: base,
    newParentTree: sha((await git(['rev-parse', `${base}^{tree}`])).stdout),
    candidateSubjects: ['conflicting child'], commit, paths: ['src/flag.ts'],
  };
  await expect(writeConflictRecord(repo, 'demo', record)).resolves.toEqual({ kind: 'updated' });
  await mkdir(join(repo, '.pipeline'), { recursive: true });
  await writeFile(join(repo, '.pipeline', 'HALT'), `Restack-Conflict: 2 ${opId}\n`);
  await writeFile(join(repo, '.pipeline', 'HALT.class'), 'needs-human\n');
  return { repo, git, record, commit };
}

function command(...args: string[]) {
  const parsed = detectStackRestackResolveCommand(['node', 'ai-conductor', 'stack', 'restack-resolve', ...args]);
  if (!parsed) throw new Error('command did not parse');
  return parsed;
}

function deps(repo: string, output: string[]) {
  return {
    resolveMainRoot: async () => repo,
    resolveWorktree: async () => repo,
    acquireLease: async () => ({ kind: 'acquired' as const, lease: { release: async () => ({ ok: true as const }) } }),
    resolveOperator: async () => 'operator@example.test',
    print: (line: string) => { output.push(line); },
  };
}

async function snapshot(subject: Awaited<ReturnType<typeof fixture>>) {
  const read = async (path: string) => readFile(join(subject.repo, path), 'utf8').catch(() => undefined);
  return {
    refs: (await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/conductor/demo/'])).stdout,
    events: await read('.pipeline/events.jsonl'),
    halt: await read('.pipeline/HALT'),
    haltClass: await read('.pipeline/HALT.class'),
  };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('stack restack-resolve --decision (real local Git)', () => {
  // Covers: task:8
  it('refuses when another owner holds the feature dispatch lease without changing durable state', async () => {
    const subject = await fixture();
    const before = await snapshot(subject);
    const output: string[] = [];

    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', 'answer'), {
      ...deps(subject.repo, output),
      acquireLease: async () => ({
        kind: 'live-owner' as const,
        owner: { host: 'test-host', pid: 42, processStartTime: '123', token: 'owner-token', purpose: 'daemon dispatch' },
      }),
    })).resolves.toBe(1);

    expect(output).toEqual(['stack restack-resolve: refused — feature dispatch lease is held by daemon dispatch (pid 42)']);
    await expect(snapshot(subject)).resolves.toEqual(before);
  });

  // Covers: task:8
  it('keeps the HALT and concurrent answer when the decision compare-and-swap loses a race', async () => {
    const subject = await fixture();
    const output: string[] = [];
    const decisionRef = 'refs/conductor/demo/restack/decision/c2';
    const concurrentAnswer = join(subject.repo, 'concurrent-answer.json');
    await writeFile(concurrentAnswer, '{"concurrent":true}');
    const concurrentBlob = sha((await subject.git(['hash-object', '-w', concurrentAnswer])).stdout);
    let raced = false;
    const git: GitRunner = async (args, options) => {
      if (!raced && args[0] === 'update-ref' && args[1] === '--stdin') {
        raced = true;
        await subject.git(['update-ref', decisionRef, concurrentBlob]);
      }
      const result = await execa('git', args, { cwd: subject.repo, input: options?.input, reject: false });
      return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
    };

    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', 'answer'), {
      ...deps(subject.repo, output), git,
    })).resolves.toBe(1);

    expect(output).toEqual(['stack restack-resolve: refused — could not record decision']);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('Restack-Conflict: 2 repair-conflict');
    expect(raced).toBe(true);
    await expect(subject.git(['rev-parse', decisionRef])).resolves.toMatchObject({ stdout: `${concurrentBlob}\n` });
  });

  // Covers: task:8
  it.each([
    ['event append', { appendEvent: async () => { throw new Error('event store unavailable'); } }],
    ['operator identity', { resolveOperator: (() => {
      let calls = 0;
      return async () => (++calls === 1 ? 'operator@example.test' : undefined);
    })() }],
  ] as const)('preserves the HALT after a recorded decision cannot complete its %s, then retries', async (_failure, lateFailure) => {
    const subject = await fixture();
    const output: string[] = [];

    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', 'answer'), {
      ...deps(subject.repo, output), ...lateFailure,
    })).resolves.toBe(1);

    expect(output).toEqual([expect.stringMatching(/^stack restack-resolve: recorded but could not (append decision event|resolve operator identity):/)]);
    await expect(readRestackDecision(subject.repo, 'demo', child(2))).resolves.toMatchObject({ kind: 'decision', decision: { answer: 'answer' } });
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).resolves.toContain('Restack-Conflict: 2 repair-conflict');

    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', 'answer'), deps(subject.repo, []))).resolves.toBe(0);
    await expect(access(join(subject.repo, '.pipeline', 'HALT'))).rejects.toThrow();
  });

  it.each(['repair-conflict', 'base-refresh-conflict'])('records and reports a decision for a %s conflict, emits no answer, and clears the halt', async (opId) => {
    const subject = await fixture(opId);
    const output: string[] = [];
    const answer = `keep upstream (${opId})`;

    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', answer), deps(subject.repo, output))).resolves.toBe(0);
    await expect(readRestackDecision(subject.repo, 'demo', child(2))).resolves.toMatchObject({
      kind: 'decision', decision: {
        child: 2, oldParent: subject.record.oldParent, oldTip: subject.record.oldTip,
        commit: subject.record.commit, paths: ['src/flag.ts'], answer, operator: 'operator@example.test',
      },
    });
    expect(output).toEqual(['stack restack-resolve: recorded decision for child 2']);
    await expect(access(join(subject.repo, '.pipeline', 'HALT'))).rejects.toThrow();
    await expect(access(join(subject.repo, '.pipeline', 'HALT.class'))).rejects.toThrow();
    const events = await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8');
    expect(events.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(events)).toMatchObject({
      type: 'restack_decision', action: 'recorded', opId, child: 2,
      commit: subject.record.commit, paths: ['src/flag.ts'], operator: 'operator@example.test',
    });
    expect(events).not.toContain(answer);
  });

  it('replaces a prior decision through the answer transaction', async () => {
    const subject = await fixture();
    const first = 'first answer';
    const second = 'second answer';
    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', first), deps(subject.repo, []))).resolves.toBe(0);
    await writeFile(join(subject.repo, '.pipeline', 'HALT'), 'Restack-Conflict: 2 repair-conflict\n');
    await writeFile(join(subject.repo, '.pipeline', 'HALT.class'), 'needs-human\n');

    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', second), deps(subject.repo, []))).resolves.toBe(0);
    await expect(readRestackDecision(subject.repo, 'demo', child(2))).resolves.toMatchObject({ kind: 'decision', decision: { answer: second } });
  });

  it('atomically replaces a stranded tip with a decision, and a stranded decision with a tip', async () => {
    const subject = await fixture();
    await subject.git(['update-ref', resolutionRefFor('demo', child(2)), subject.commit]);
    const answer = 'choose the upstream seam';
    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', answer), deps(subject.repo, []))).resolves.toBe(0);
    await expect(subject.git(['rev-parse', '-q', '--verify', resolutionRefFor('demo', child(2))])).rejects.toMatchObject({ code: 1 });
    await expect(readRestackDecision(subject.repo, 'demo', child(2))).resolves.toMatchObject({ kind: 'decision', decision: { answer } });

    await writeFile(join(subject.repo, '.pipeline', 'HALT'), 'Restack-Conflict: 2 repair-conflict\n');
    await writeFile(join(subject.repo, '.pipeline', 'HALT.class'), 'needs-human\n');
    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--tip', subject.commit), deps(subject.repo, []))).resolves.toBe(0);
    await expect(readRestackDecision(subject.repo, 'demo', child(2))).resolves.toEqual({ kind: 'missing' });
    await expect(subject.git(['rev-parse', resolutionRefFor('demo', child(2))])).resolves.toMatchObject({ stdout: `${subject.commit}\n` });
  });

  it.each([
    ['both --tip and --decision', ['--slug', 'demo', '--child', '2', '--tip', 'a'.repeat(40), '--decision', 'answer']],
    ['neither --tip nor --decision', ['--slug', 'demo', '--child', '2']],
  ])('refuses %s without changing durable state', async (_label, args) => {
    const subject = await fixture();
    const before = await snapshot(subject);
    const output: string[] = [];
    const parsed = detectStackRestackResolveCommand(['node', 'ai-conductor', 'stack', 'restack-resolve', ...args]);
    expect(parsed).not.toBeNull();

    await expect(dispatchStackRestackResolve(parsed!, deps(subject.repo, output))).resolves.toBe(1);
    expect(output).toEqual([expect.stringMatching(/^stack restack-resolve: refused — supply exactly one of --tip or --decision$/)]);
    await expect(snapshot(subject)).resolves.toEqual(before);
  });

  it.each(['', 'a'.repeat(4_001)])('refuses an answer outside the supported length without changing durable state', async (answer) => {
    const subject = await fixture();
    const before = await snapshot(subject);
    const output: string[] = [];

    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', answer), deps(subject.repo, output))).resolves.toBe(1);
    expect(output).toEqual([expect.stringMatching(/^stack restack-resolve: refused — decision answer length must be between 1 and 4000 characters$/)]);
    await expect(snapshot(subject)).resolves.toEqual(before);
  });

  it('refuses a decision for a different recorded child without changing durable state', async () => {
    const subject = await fixture();
    const before = await snapshot(subject);
    const output: string[] = [];
    const record = { ...subject.record, child: child(3) };
    await expect(writeConflictRecord(subject.repo, 'demo', record)).resolves.toEqual({ kind: 'updated' });
    const afterRecord = await snapshot(subject);

    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', 'answer'), deps(subject.repo, output))).resolves.toBe(1);
    expect(output).toEqual(['stack restack-resolve: refused — record names child 3']);
    await expect(snapshot(subject)).resolves.toEqual(afterRecord);
    expect(afterRecord.refs).not.toBe(before.refs);
  });

  it('refuses when no matching conflict halt is live without changing durable state', async () => {
    const subject = await fixture();
    await rm(join(subject.repo, '.pipeline', 'HALT'));
    const before = await snapshot(subject);
    const output: string[] = [];

    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', 'answer'), deps(subject.repo, output))).resolves.toBe(1);
    expect(output).toEqual(['stack restack-resolve: refused — no matching restack-conflict halt is live']);
    await expect(snapshot(subject)).resolves.toEqual(before);
  });

  it('refuses a decision for a flat feature without changing durable state', async () => {
    const subject = await fixture();
    await subject.git(['update-ref', '-d', 'refs/conductor/demo/restack/conflict/record']);
    await subject.git(['update-ref', '-d', 'refs/conductor/demo/restack/conflict/parent']);
    const before = await snapshot(subject);
    const output: string[] = [];

    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', 'answer'), deps(subject.repo, output))).resolves.toBe(1);
    expect(output).toEqual(['stack restack-resolve: refused — feature is not stacked']);
    await expect(snapshot(subject)).resolves.toEqual(before);
  });

  it('refuses a decision when stacked pull requests are disabled without changing durable state', async () => {
    const subject = await fixture();
    await mkdir(join(subject.repo, '.ai-conductor'), { recursive: true });
    await writeFile(join(subject.repo, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: false\n');
    const before = await snapshot(subject);
    const output: string[] = [];

    await expect(dispatchStackRestackResolve(command('--slug', 'demo', '--child', '2', '--decision', 'answer'), deps(subject.repo, output))).resolves.toBe(1);
    expect(output).toEqual(['stack restack-resolve: refused — feature is not stacked']);
    await expect(snapshot(subject)).resolves.toEqual(before);
  });
});
