// Covers: task:rem-prd-audit-R9
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { publishResolution } from '../../src/engine/autoresolve.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import type { GithubOperationRequest, GithubOperationRunner } from '../../src/engine/github-operations.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import { pushedTipIntentRef, pushedTipRef } from '../../src/engine/push-lease.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import type { executeRemoteGit } from '../../src/engine/remote-git-operations.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const PR_URL = 'https://github.com/acme/rocket/pull/42';
const BRANCH = 'feat/daemon-demo';

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await execFile('git', [...args], { cwd })).stdout.trim();
}

async function commit(cwd: string, file: string, message: string): Promise<string> {
  await writeFile(join(cwd, file), `${message}\n`);
  await git(cwd, ['add', file]);
  await git(cwd, ['commit', '-qm', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

/**
 * The engine pushed and recorded R1 for `feat/daemon-demo`; a human then
 * pushed R2 on top of it, and another worktree's full fetch advanced the
 * tracking ref to R2. The engine's local resolution is built on R1 only.
 */
async function humanPushedOverRecordedTip() {
  const root = await mkdtemp(join(tmpdir(), 'autoresolve-lease-sweep-g5-'));
  roots.push(root);
  const remote = join(root, 'origin.git');
  const engine = join(root, 'engine');
  const human = join(root, 'human');
  await git(root, ['init', '-q', '--bare', '--initial-branch=main', remote]);
  await mkdir(engine);
  await initTestRepo(engine);
  await writeFile(join(engine, '.gitignore'), '.pipeline/\n.test-git-hooks/\n');
  await git(engine, ['add', '.gitignore']);
  await git(engine, ['commit', '-qm', 'seed']);
  await git(engine, ['remote', 'add', 'origin', remote]);
  await git(engine, ['push', '-q', 'origin', 'main']);
  await git(engine, ['checkout', '-qb', BRANCH]);
  const recorded = await commit(engine, 'engine.txt', 'R1 engine push');
  await git(engine, ['push', '-q', 'origin', `${BRANCH}:${BRANCH}`]);
  await git(engine, ['update-ref', pushedTipRef('demo', BRANCH), recorded]);
  await git(engine, ['fetch', '-q', 'origin']);

  await git(root, ['clone', '-q', '--branch', BRANCH, remote, human]);
  await git(human, ['config', 'user.email', 'human@example.test']);
  await git(human, ['config', 'user.name', 'Human']);
  const humanTip = await commit(human, 'human.txt', 'R2 human push');
  await git(human, ['push', '-q', 'origin', BRANCH]);

  // Another worktree's full fetch: the tracking ref now names R2, which HEAD lacks.
  await git(engine, ['fetch', '-q', 'origin']);
  const resolved = await commit(engine, 'resolution.txt', 'engine resolution');
  return { remote, engine, recorded, humanTip, resolved };
}

describe('publishResolution expected-SHA lease (real local Git) sweep G5', () => {
  // Covers: S14.7, task:rem-prd-audit-R9
  it('refuses an autoresolve force push over a fetched human tip R2 when the recorded tip is R1, persists push_lease_refused, and escalates with the refusal', async () => {
    const subject = await humanPushedOverRecordedTip();
    expect(await git(subject.engine, ['rev-parse', `refs/remotes/origin/${BRANCH}`])).toBe(subject.humanTip);

    const remoteWrites: string[][] = [];
    const remoteGit: typeof executeRemoteGit = async (args) => {
      remoteWrites.push([...args]);
      return { kind: 'failed', error: 'remote write must not be reached', targets: [] };
    };
    // The GitHub boundary: comment lookup reads through gh, mutations go through guarded operations.
    const runGh: GhRunner = async (args) => ({ stdout: args[0] === 'pr' && args[1] === 'view' ? JSON.stringify({ comments: [] }) : '' });
    const mutations: GithubOperationRequest[] = [];
    const operations: GithubOperationRunner = { run: async (request) => { mutations.push(request); return {}; } };
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.engine, '.pipeline', 'events.jsonl'), events);
    persister.start();
    let result: Awaited<ReturnType<typeof publishResolution>>;
    try {
      result = await publishResolution({
        git: makeGitRunner(subject.engine),
        branch: BRANCH,
        prUrl: PR_URL,
        gh: { runGh, operations, cwd: subject.engine, log: () => {} },
        remoteGit,
        events,
        cwd: subject.engine,
      });
    } finally {
      persister.stop();
    }

    // Refused, and the remote is unchanged at the human's R2.
    expect(result).toEqual({ published: false, stage: 'lease-push', reason: expect.stringContaining('lease push refused') });
    expect(remoteWrites).toEqual([]);
    expect(await git(subject.remote, ['rev-parse', `refs/heads/${BRANCH}`])).toBe(subject.humanTip);
    // The lease anchor is untouched and no intent is left behind.
    expect(await git(subject.engine, ['rev-parse', pushedTipRef('demo', BRANCH)])).toBe(subject.recorded);
    await expect(git(subject.engine, ['rev-parse', '--verify', '--quiet', pushedTipIntentRef('demo', BRANCH)])).rejects.toBeDefined();

    // push_lease_refused {expected R1, actual R2} is persisted on the event spine.
    const persisted = (await readFile(join(subject.engine, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.type === 'push_lease_refused');
    expect(persisted).toEqual([expect.objectContaining({
      type: 'push_lease_refused', ref: `refs/heads/${BRANCH}`, expected: subject.recorded, actual: subject.humanTip,
    })]);

    // Autoresolve escalates with the refusal as the reason.
    if (result.published) throw new Error('publication should have been refused');
    expect(mutations).toContainEqual(expect.objectContaining({
      operation: 'pull-request.label.add', payload: expect.objectContaining({ label: 'needs-remediation' }),
    }));
    const comment = mutations.find((request) => request.operation === 'pull-request.comment.create');
    const body = comment?.payload !== undefined && 'body' in comment.payload ? String(comment.payload.body) : '';
    expect(body).toContain('**Stage:** lease-push');
    expect(body).toContain(`**Reason:** ${result.reason}`);
    expect(result.reason).toContain(subject.recorded);
  });
});
