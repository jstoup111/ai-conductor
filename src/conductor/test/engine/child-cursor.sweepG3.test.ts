// Covers: task:29
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveActiveChild } from '../../src/engine/child-cursor.js';
import { Conductor } from '../../src/engine/conductor.js';
import {
  writeCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from '../../src/engine/coverage-binding-envelope.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);

const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

let repository: string;
const extraRoots: string[] = [];

async function git(args: string[], cwd = repository): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

async function sealStack(positions: readonly number[]): Promise<void> {
  await mkdir(join(repository, '.ai-conductor'), { recursive: true });
  await writeFile(join(repository, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 3\n');
  await writeCoverageBindingEnvelope(repository, {
    version: 1,
    slug: 'demo',
    runId: 'run-1',
    status: 'done',
    entries: [],
    sliceMembership: {
      taskSlices: Object.fromEntries(positions.map((position) => [String(position), position])),
      titles: positions.map((position) => `Child ${position}`),
    },
    storyOwnership: Object.fromEntries(positions.map((position) => [`S${position}`, position])),
  }, envelopeFilesystem);
}

async function commitFile(name: string, contents: string, message: string): Promise<string> {
  await writeFile(join(repository, name), contents);
  await git(['add', name]);
  await git(['commit', '-qm', message]);
  return (await git(['rev-parse', 'HEAD'])).trim();
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), 'child-cursor-sweep-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'cursor@example.test']);
  await git(['config', 'user.name', 'Cursor sweep']);
  await writeFile(join(repository, 'README.md'), 'base\n');
  await git(['add', 'README.md']);
  await git(['commit', '-qm', 'base']);
  await git(['branch', 'feat/daemon-demo']);
});

afterEach(async () => {
  await Promise.all(extraRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  await rm(repository, { recursive: true, force: true });
});

describe('repair-pending and divergent cursor kinds (sweep)', () => {
  // Covers: task:29
  it('distinguishes an operator commit past closed/c1 (repair-pending) from an amended A2 or a reset behind the closure (closed-child-rewritten)', async () => {
    await sealStack([1, 2]);
    await git(['checkout', '-q', '-b', 'feat/c1/demo', 'feat/daemon-demo']);
    const a1 = await commitFile('a1.txt', 'A1\n', 'A1');
    const a2 = await commitFile('a2.txt', 'A2\n', 'A2');
    await git(['update-ref', 'refs/conductor/demo/closed/c1', a2]);
    // The leaf child already builds on the closed child 1.
    await git(['branch', '-f', 'feat/daemon-demo', a2]);

    // Operator commit X appended past the closure: the closure stays an ancestor of the tip.
    await commitFile('x.txt', 'X\n', 'operator X');
    await expect(git(['merge-base', '--is-ancestor', a2, 'feat/c1/demo'])).resolves.toBe('');
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'repair-pending', child: 2, position: 2, isLeaf: true, branch: 'feat/daemon-demo', repairChildren: [1],
    });

    // A2 amended: the closure is no longer contained in the child's branch.
    await git(['reset', '-q', '--hard', a2]);
    await writeFile(join(repository, 'a2.txt'), 'A2 amended\n');
    await git(['add', 'a2.txt']);
    await git(['commit', '-q', '--amend', '-m', 'A2 amended']);
    expect((await git(['rev-parse', 'HEAD'])).trim()).not.toBe(a2);
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'divergent', child: 1, check: 'closed-child-rewritten',
    });

    // feat/c1/demo reset behind closed/c1.
    await git(['reset', '-q', '--hard', a1]);
    await expect(resolveActiveChild(repository, 'demo')).resolves.toEqual({
      kind: 'divergent', child: 1, check: 'closed-child-rewritten',
    });
  });

  // Covers: task:29
  it('resolves range-not-ancestor for child 2 and renders the refusal naming range-not-ancestor and child 2', async () => {
    await sealStack([1, 2, 3]);
    const closure = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
    await git(['branch', 'feat/c1/demo', closure]);
    await git(['update-ref', 'refs/conductor/demo/closed/c1', closure]);
    await expect(git(['merge-base', '--is-ancestor', closure, 'feat/c1/demo'])).resolves.toBe('');
    const unrelatedTip = (await git(['commit-tree', `${closure}^{tree}`, '-m', 'unrelated child base'])).trim();
    await git(['branch', 'feat/c2/demo', unrelatedTip]);

    const cursor = await resolveActiveChild(repository, 'demo');
    expect(cursor).toEqual({ kind: 'divergent', child: 2, check: 'range-not-ancestor' });

    // Render through the production conductor refusal path.
    const root = await mkdtemp(join(tmpdir(), 'child-cursor-sweep-render-'));
    extraRoots.push(root);
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const statePath = join(root, '.pipeline', 'conduct-state.json');
    await writeFile(statePath, JSON.stringify({ feature_desc: 'demo', acceptance_specs: 'pending' }));
    const run = vi.fn().mockResolvedValue({ success: true });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: statePath,
      featureSlug: 'demo',
      fromStep: 'acceptance_specs',
      events: new ConductorEventEmitter(),
      stepRunner: { run },
      config: { stacked_prs: { enabled: true } } as never,
      childRegionLifecycle: { resolveActiveChild: async () => cursor },
    });

    await conductor.run();

    expect(run).not.toHaveBeenCalled();
    const body = await readFile(join(root, '.pipeline', 'HALT'), 'utf8');
    expect(body).toBe('child BUILD region refused: child 2 failed active-child check range-not-ancestor\n');
    expect(body).not.toContain('#2943');
  });
});
