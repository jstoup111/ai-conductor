// Covers: task:6
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { detectStackRestackResolveCommand } from '../../src/cli.js';
import { parseChildId } from '../../src/engine/child-context.js';
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
    acquireLease: async () => ({ kind: 'acquired' as const, lease: { release: async () => undefined } }),
    resolveOperator: async () => 'operator@example.test',
    print: (line: string) => output.push(line),
  };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

describe('stack restack-resolve --decision (real local Git)', () => {
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
});
