// Covers: task:13
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanInheritedState, renderDashboard } from '../../src/engine/daemon-dashboard.js';
import { runDaemonStatus } from '../../src/engine/daemon-observe-cli.js';
import {
  writeCoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from '../../src/engine/coverage-binding-envelope.js';

const execFile = promisify(execFileCallback);
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

let repository: string;
let featureRoot: string;

async function git(args: string[], cwd = repository): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), 'stacked-status-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'status@example.test']);
  await git(['config', 'user.name', 'Status Test']);
  await writeFile(join(repository, 'README.md'), 'base\n');
  await git(['add', 'README.md']);
  await git(['commit', '-qm', 'base']);
  await git(['branch', 'feat/daemon-demo']);
  await mkdir(join(repository, '.worktrees'), { recursive: true });
  featureRoot = join(repository, '.worktrees', 'demo');
  await git(['worktree', 'add', '-q', featureRoot, 'feat/daemon-demo']);

  const tip = (await git(['rev-parse', 'feat/daemon-demo'])).trim();
  await git(['branch', 'feat/c1/demo', tip]);
  await git(['update-ref', 'refs/conductor/demo/closed/c1', tip]);
  await mkdir(join(featureRoot, '.ai-conductor'), { recursive: true });
  await writeFile(
    join(featureRoot, '.ai-conductor', 'config.yml'),
    'stacked_prs:\n  enabled: true\n  max_slices: 2\n',
  );
  await writeCoverageBindingEnvelope(featureRoot, {
    version: 1,
    slug: 'demo',
    runId: 'status-1',
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['first', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, envelopeFilesystem);
  await mkdir(join(featureRoot, '.pipeline', 'children', '2'), { recursive: true });
  await writeFile(
    join(featureRoot, '.pipeline', 'conduct-state.json'),
    JSON.stringify({ coverage_binding: 'done', build_review: 'done' }),
  );
  await writeFile(
    join(featureRoot, '.pipeline', 'children', '2', 'conduct-state.json'),
    JSON.stringify({ build: 'in_progress' }),
  );
  await writeFile(
    join(featureRoot, '.pipeline', 'children', '2', 'kickback-ledger.json'),
    JSON.stringify({
      version: 1,
      gates: {
        build_review: {
          count: 2, cumulative: 2, treeHash: 'child-2', lastReason: 'child two finding',
          priorVerdict: false, resolvedBefore: 0,
          capEvidence: {
            gate: 'build_review', consumed: 2, limit: 5,
            latestReason: 'child two finding', haltGeneration: 'child-2-halt',
          },
        },
      },
    }),
  );
  await writeFile(
    join(featureRoot, '.pipeline', 'kickback-ledger.json'),
    JSON.stringify({
      version: 1,
      gates: {
        build_review: {
          count: 1, cumulative: 1, treeHash: 'flat', lastReason: 'flat ledger',
          priorVerdict: false, resolvedBefore: 0,
          capEvidence: {
            gate: 'build_review', consumed: 1, limit: 5,
            latestReason: 'flat ledger', haltGeneration: 'flat-halt',
          },
        },
      },
    }),
  );
});

afterEach(async () => {
  await git(['worktree', 'remove', '--force', featureRoot]).catch(() => undefined);
  await rm(repository, { recursive: true, force: true });
});

describe('stacked daemon status', () => {
  it('renders the cursor-selected child and its overlay state in the dashboard', async () => {
    const state = await scanInheritedState({
      worktreeBase: join(repository, '.worktrees'),
      processedDir: join(repository, '.daemon', 'processed'),
      discover: async () => [],
    });

    expect(state.inProgress).toEqual([
      expect.objectContaining({
        slug: 'demo',
        step: 'build',
        activeChild: { child: 2, total: 2 },
      }),
    ]);
    expect(renderDashboard(state)).toContain('demo @build (child 2/2)');
  });

  it('shows the active child and reads its kickback ledger in daemon status', async () => {
    const registryPath = join(repository, 'registry.json');
    await writeFile(registryPath, JSON.stringify([{
      schemaVersion: 1,
      name: 'demo-repo',
      path: repository,
      status: 'registered',
      registeredAt: '2026-10-09T00:00:00.000Z',
    }]));
    const out: string[] = [];

    await runDaemonStatus({
      registryPath,
      out: (line) => out.push(line),
      hasSessionProbe: () => false,
    });

    const rendered = out.join('\n');
    expect(rendered).toContain('PLAN GROWTH [demo child 2/2]');
    expect(rendered).toContain('KICKBACK BUDGET [demo]: Allowance: laps; Child: 2 |');
    expect(rendered).toContain('Kickback budget (build_review): 2/5 consumed; 3 remaining');
    expect(rendered).toContain('Latest reason: child two finding');
    expect(rendered).not.toContain('flat ledger');
  });
});
