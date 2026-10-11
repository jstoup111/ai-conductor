import { execFile as execFileCallback } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { makeGitRunner, type GitRunner } from '../../../src/engine/rebase.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { journalRefFor, readRestackJournal, stagingRefFor } from '../../../src/engine/restack/restack-journal.js';
import type { RestackResolver } from '../../../src/engine/restack/restack-resolver.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { createSweepRepository, persistedEvents, removeAll, sealStack, stackRefs } from './restack-sweepG2-fixture.js';

const execFile = promisify(execFileCallback);
const cleanup: string[] = [];
const childTwo = parseChildId(2)!;

afterEach(async () => {
  await removeAll(cleanup);
});

/** A three-child stack whose child 2 conflicts with the default advance. */
async function conflictingStack(kind: 'content' | 'rename' = 'content') {
  const subject = await createSweepRepository('restack-conflict-sweep-', cleanup);
  await subject.write('src/x.ts', 'old\n');
  await subject.git(['add', 'src/x.ts']);
  await subject.commit('base', 'src/c.ts', 'one\ntwo\n');
  await subject.git(['checkout', '-qb', 'feat/c1/demo']);
  const c1 = await subject.commit('C1', 'c1.txt', 'child one\n');
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c1', c1]);
  await subject.git(['checkout', '-qb', 'feat/c2/demo']);
  let c2;
  if (kind === 'content') {
    c2 = await subject.commit('C2', 'src/c.ts', 'one\nchild\n');
  } else {
    await subject.git(['mv', 'src/x.ts', 'src/z.ts']);
    await subject.git(['commit', '-qm', 'C2 rename']);
    c2 = await subject.rev('HEAD');
  }
  await subject.git(['update-ref', 'refs/conductor/demo/closed/c2', c2]);
  await subject.git(['checkout', '-qb', 'feat/daemon-demo']);
  await subject.commit('L1', 'leaf.txt', 'leaf\n');
  await subject.git(['checkout', '-q', 'main']);
  const newDefault = kind === 'content'
    ? await subject.commit('main advance', 'src/c.ts', 'one\nmain\n')
    : await subject.commit('main advance', 'src/z.ts', 'main\n');
  await subject.git(['checkout', '-q', 'feat/daemon-demo']);
  await sealStack(subject.repo);
  return { ...subject, c1, c2, newDefault };
}

function inTemporaryCheckout(context: Parameters<RestackResolver>[0]) {
  return (args: string[]) => execFile('git', args, { cwd: context.projectRoot, env: { ...process.env, ...context.environment } });
}

describe('runRestack unresolved conflict sweep (real local Git)', () => {
  // Covers: S6.5, task:15
  it('halts needs-human naming child 2, C2 and src/c.ts after the resolver exhausts its budget, pinning the old own tip before aborting', async () => {
    const subject = await conflictingStack();
    const before = await stackRefs(subject);
    const native = makeGitRunner(subject.repo);
    const sequence: string[] = [];
    const git: GitRunner = async (args, options) => {
      const result = await native(args, options);
      if (result.exitCode === 0 && args[0] === 'update-ref' && args[1] === stagingRefFor('demo', childTwo)) sequence.push(`pin ${args[2]}`);
      if (result.exitCode === 0 && args[0] === 'update-ref' && args[1] === '--stdin') {
        const line = options?.input?.split('\n').find((candidate) => candidate.startsWith(`update ${journalRefFor('demo')} `));
        const blob = line?.split(' ')[2];
        if (blob) sequence.push(`journal ${(JSON.parse((await native(['cat-file', 'blob', blob])).stdout) as { state: string }).state}`);
      }
      return result;
    };
    let attempts = 0;
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault, git, events,
        // Claims success without resolving, so every attempt is consumed.
        resolver: async () => { attempts += 1; return { resolved: true }; },
        resolverCap: 2,
      })).resolves.toEqual({ kind: 'halted' });
    } finally {
      persister.stop();
    }

    expect(attempts).toBe(2);
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toMatch(/^restack conflict child 2\n/);
    expect(halt).toContain(`commit ${subject.c2}; paths: src/c.ts`);
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    const journal = await readRestackJournal(subject.repo, 'demo');
    expect(journal).toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    const opId = journal.kind === 'journal' ? journal.journal.opId : undefined;
    const conflicts = (await persistedEvents(subject.repo)).filter((event) => event.type === 'restack_conflict');
    expect(conflicts).toEqual([expect.objectContaining({ type: 'restack_conflict', opId, child: 2, commit: subject.c2, paths: ['src/c.ts'] })]);
    expect(await stackRefs(subject)).toBe(before);
    expect(await subject.rev(stagingRefFor('demo', childTwo))).toBe(subject.c2);
    const pinned = sequence.lastIndexOf(`pin ${subject.c2}`);
    expect(pinned).toBeGreaterThanOrEqual(0);
    expect(sequence.indexOf('journal aborted')).toBeGreaterThan(pinned);
  });

  // Covers: S6.6, S6.7, task:15
  it('rejects a resolver result that drops a child 2 subject (FR-9) or is not based on the new closed/c1 (FR-8) and halts as the unresolved conflict', async () => {
    const cases = [
      ['drops C2', 'feature commit(s) lost during resolution: C2'],
      ['wrong base', 'rebase resolution left the branch not current with base'],
    ] as const;
    for (const [mode, guard] of cases) {
      const subject = await conflictingStack();
      const before = await stackRefs(subject);
      const events = new ConductorEventEmitter();
      const conflicts: unknown[] = [];
      const refusals: unknown[] = [];
      events.on('restack_conflict', (event) => { conflicts.push(event); });
      events.on('restack_refused', (event) => { refusals.push(event); });
      const resolver: RestackResolver = async (context) => {
        const git = inTemporaryCheckout(context);
        if (mode === 'drops C2') {
          await git(['rebase', '--skip']);
        } else {
          await git(['rebase', '--abort']);
          await git(['reset', '-q', '--hard', subject.c2]);
        }
        return { resolved: true };
      };

      await expect(runRestack({
        worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: subject.newDefault, events,
        git: makeGitRunner(subject.repo), resolver, resolverCap: 1,
      })).resolves.toEqual({ kind: 'halted' });

      const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
      expect(halt).toMatch(/^restack conflict child 2\n/);
      expect(halt).toContain(`commit ${subject.c2}; paths: src/c.ts`);
      expect(halt).toContain(guard);
      expect(conflicts).toEqual([expect.objectContaining({ child: 2, commit: subject.c2, paths: ['src/c.ts'] })]);
      expect(refusals).toEqual([]);
      expect(await stackRefs(subject)).toBe(before);
      expect(await subject.rev(stagingRefFor('demo', childTwo))).toBe(subject.c2);
      await expect(readRestackJournal(subject.repo, 'demo')).resolves.toMatchObject({ kind: 'journal', journal: { state: 'aborted' } });
    }
  });

  // Covers: S6.8, S3.6, task:15
  it('refuses a resolver result touching an unowned path as replay-mismatch and hands a src/z.ts rename collision to the resolver instead of accepting it', async () => {
    const unowned = await conflictingStack();
    const unownedBefore = await stackRefs(unowned);
    const unownedEvents = new ConductorEventEmitter();
    const refusals: unknown[] = [];
    unownedEvents.on('restack_refused', (event) => { refusals.push(event); });
    await expect(runRestack({
      worktree: unowned.repo, slug: 'demo', cause: 'base-refresh', newDefault: unowned.newDefault, events: unownedEvents,
      git: makeGitRunner(unowned.repo), resolverCap: 1,
      resolver: async (context) => {
        await writeFile(join(context.projectRoot, 'src', 'c.ts'), 'one\nchild\n');
        await writeFile(join(context.projectRoot, 'src', 'unowned.ts'), 'unowned\n');
        const git = inTemporaryCheckout(context);
        await git(['add', 'src/c.ts', 'src/unowned.ts']);
        await git(['rebase', '--continue']);
        return { resolved: true };
      },
    })).resolves.toEqual({ kind: 'halted' });
    expect(refusals).toEqual([expect.objectContaining({ reason: 'replay-mismatch', child: 2, detail: expect.stringContaining('src/unowned.ts') })]);
    expect(await unowned.git(['show', 'feat/c2/demo:src/unowned.ts']).then(() => 'present', () => 'absent')).toBe('absent');
    expect(await stackRefs(unowned)).toBe(unownedBefore);

    const renamed = await conflictingStack('rename');
    const renamedBefore = await stackRefs(renamed);
    const events = new ConductorEventEmitter();
    const conflicts: Array<{ paths: string[] }> = [];
    const applied: unknown[] = [];
    events.on('restack_conflict', (event) => { conflicts.push(event as unknown as { paths: string[] }); });
    events.on('restack_applied', (event) => { applied.push(event); });
    const dispatched: string[][] = [];
    await expect(runRestack({
      worktree: renamed.repo, slug: 'demo', cause: 'base-refresh', newDefault: renamed.newDefault, events,
      git: makeGitRunner(renamed.repo), resolverCap: 1,
      resolver: async (context) => {
        dispatched.push([...context.conflicts]);
        return { resolved: false, reason: 'rename collision left for the operator' };
      },
    })).resolves.toEqual({ kind: 'halted' });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toContain('src/z.ts');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.paths).toContain('src/z.ts');
    expect(applied).toEqual([]);
    expect(await stackRefs(renamed)).toBe(renamedBefore);
  });
});
