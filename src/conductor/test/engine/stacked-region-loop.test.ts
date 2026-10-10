// Covers: task:10
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

let root: string;

async function git(args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout;
}

async function commit(message: string): Promise<string> {
  await writeFile(join(root, 'README.md'), `${message}\n`);
  await git(['add', 'README.md']);
  await git(['commit', '-qm', message]);
  return (await git(['rev-parse', 'HEAD'])).trim();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stacked-region-loop-'));
  await git(['init', '-q', '-b', 'feat/daemon-demo']);
  await git(['config', 'user.email', 'loop@example.test']);
  await git(['config', 'user.name', 'Loop Test']);
  await writeFile(join(root, 'README.md'), 'base\n');
  await git(['add', 'README.md']);
  await git(['commit', '-qm', 'base']);
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), 'stacked_prs:\n  enabled: true\n  max_slices: 2\n');
  await git(['add', '.ai-conductor/config.yml']);
  await git(['commit', '-qm', 'configure stack']);
  await writeFile(join(root, '.git', 'info', 'exclude'), '.pipeline/\n');
  await writeCoverageBindingEnvelope(root, {
    version: 1, slug: 'demo', runId: 'loop-1', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['first', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'conduct-state.json'), JSON.stringify({
    feature_desc: 'demo', coverage_binding: 'done', acceptance_specs: 'pending',
  }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('stacked BUILD region loop', () => {
  it('creates and switches to child 1 before its first acceptance_specs dispatch', async () => {
    const dispatched: string[] = [];
    const events = new ConductorEventEmitter();
    const lifecycle: unknown[] = [];
    events.on('child_started', (event) => { lifecycle.push(event); });
    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      fromStep: 'acceptance_specs',
      // Production composition roots inject the parsed project configuration.
      config: { stacked_prs: { enabled: true, max_slices: 2 } },
      events,
      stepRunner: {
        run: async (step) => {
          dispatched.push(step);
          throw new Error('stop at first region dispatch');
        },
      },
    });

    await conductor.run();

    // The mocked run intentionally stops at the acceptance boundary; no later
    // child can be created before that first child has completed BUILD.
    expect(dispatched).not.toContain('build');
    expect(await git(['branch', '--show-current'])).toBe('feat/c1/demo\n');
    await expect(git(['rev-parse', 'feat/c1/demo'])).resolves.toBe(await git(['rev-parse', 'feat/daemon-demo']));
    await expect(git(['show-ref', '--verify', '--quiet', 'refs/heads/feat/c2/demo'])).rejects.toMatchObject({ code: 1 });
    expect(lifecycle).toEqual([{ type: 'child_started', child: 1, position: 1, branch: 'feat/c1/demo' }]);
  });

  it('moves a pending leaf to its closed parent before resuming its region', async () => {
    const leafBefore = (await git(['rev-parse', 'HEAD'])).trim();
    await git(['branch', 'feat/c1/demo']);
    await git(['switch', '-q', 'feat/c1/demo']);
    const childTip = await commit('child 1 complete');
    await git(['update-ref', 'refs/conductor/demo/closed/c1', childTip, '']);
    await git(['switch', '-q', 'feat/daemon-demo']);
    await git(['update-ref', 'refs/remotes/origin/main', leafBefore]);
    await git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    await mkdir(join(root, '.pipeline', 'children', '2'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'children', '2', 'conduct-state.json'), JSON.stringify({
      acceptance_specs: 'pending', build: 'pending', test_suite: 'pending', build_review: 'pending',
    }));

    const conductor = new Conductor({
      projectRoot: root,
      stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
      featureSlug: 'demo',
      fromStep: 'acceptance_specs',
      config: { stacked_prs: { enabled: true, max_slices: 2 } },
      events: new ConductorEventEmitter(),
      stepRunner: {
        run: async () => {
          throw new Error('stop at first leaf dispatch');
        },
      },
    });

    await conductor.run();

    await expect(git(['branch', '--show-current'])).resolves.toBe('feat/daemon-demo\n');
    await expect(git(['rev-parse', 'feat/daemon-demo'])).resolves.toBe(`${childTip}\n`);
  });
});
