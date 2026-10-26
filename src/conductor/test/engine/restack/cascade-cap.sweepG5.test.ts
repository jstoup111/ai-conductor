// Covers: task:rem-prd-audit-R19
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { writeSliceTopologyFixture } from '../slice-topology-fixture.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { cascadesRefFor } from '../../../src/engine/restack/cascade-cap.js';
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

/** Child 1 is closed and has an appended operator commit, so a repair is due. */
async function repairDueFixture() {
  const repo = await mkdtemp(join(tmpdir(), 'cascade-cap-sweep-g5-'));
  repositories.push(repo);
  const git = async (args: string[]) => (await execFile('git', args, { cwd: repo })).stdout;
  const commit = async (message: string, path: string) => {
    await writeFile(join(repo, path), `${message}\n`);
    await git(['add', path]);
    await git(['commit', '-qm', message]);
    return (await git(['rev-parse', 'HEAD'])).trim();
  };
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'cascade@example.test']);
  await git(['config', 'user.name', 'Cascade sweep']);
  await commit('base', 'base.txt');
  await git(['checkout', '-qb', 'feat/c1/demo']);
  const closed = await commit('closed child', 'child.txt');
  await git(['update-ref', 'refs/conductor/demo/closed/c1', closed]);
  await commit('repair child', 'repair.txt');
  await git(['checkout', '-qb', 'feat/daemon-demo', closed]);
  await mkdir(join(repo, '.pipeline', 'children', '2'), { recursive: true });
  await writeSliceTopologyFixture(repo, {
    version: 1, slug: 'demo', runId: 'run-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Child 1', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  return { repo, git, closed };
}

describe('cascade cap sweep G5', () => {
  // Covers: S13.9, task:rem-prd-audit-R19
  it('treats an unreadable or malformed cascades ref as an exhausted cap and halts needs-human naming the ref before any journal', async () => {
    const corruptions: Record<string, (subject: Awaited<ReturnType<typeof repairDueFixture>>) => Promise<string>> = {
      // A blob whose content is not cascade-count JSON.
      malformed: async ({ repo }) => (await makeGitRunner(repo)(['hash-object', '-w', '--stdin'], { input: '{"version":1,"counts":' })).stdout.trim(),
      // A ref naming an object that cannot be read as a blob at all.
      unreadable: async ({ git }) => (await git(['rev-parse', 'HEAD'])).trim(),
    };
    for (const [variant, corrupt] of Object.entries(corruptions)) {
      const subject = await repairDueFixture();
      await subject.git(['update-ref', cascadesRefFor('demo'), await corrupt(subject)]);
      const refsBefore = await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/', 'refs/conductor/']);
      const events = new ConductorEventEmitter();
      const seen: { type: string; reason?: string; child?: number }[] = [];
      events.on('restack_planned', (event) => { seen.push(event); });
      events.on('restack_refused', (event) => { seen.push(event); });

      const result = await runRestack({ worktree: subject.repo, slug: 'demo', cause: 'feature-repair', events, git: makeGitRunner(subject.repo) });

      expect({ variant, result }).toEqual({ variant, result: { kind: 'halted' } });
      expect({ variant, seen }).toMatchObject({ variant, seen: [{ type: 'restack_refused', reason: 'cascade-cap', child: 1 }] });
      await expect(subject.git(['rev-parse', '--verify', 'refs/conductor/demo/restack/journal'])).rejects.toBeDefined();
      expect(await readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).toBe('needs-human');
      expect(await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).toContain(cascadesRefFor('demo'));
      // Nothing moved: only the halt-record commit on the checked-out leaf may differ.
      const refsAfter = await subject.git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/feat/c1/demo', 'refs/conductor/']);
      for (const line of refsAfter.split('\n').filter(Boolean)) expect(refsBefore).toContain(line);
      expect(await subject.git(['rev-parse', 'refs/conductor/demo/closed/c1'])).toBe(`${subject.closed}\n`);
    }
  });
});
