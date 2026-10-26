// Covers: task:29
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { detectStackOwnersCommand } from '../../src/cli.js';
import { PRE_DISPATCH_COMMANDS } from '../../src/cli-pre-dispatch.js';
import { dispatchStackOwnersCommand } from '../../src/engine/stack-owners-cli.js';
import { childBranchFor, leafBranchFor } from '../../src/engine/feature-branch-identity.js';
import { writeSliceTopologyFixture } from './slice-topology-fixture.js';

const execFile = promisify(execFileCallback);
const repos: string[] = [];

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'stack-owners-'));
  repos.push(repo);
  const git = (args: string[]) => execFile('git', args, { cwd: repo });
  const slug = 'demo';
  const c1 = childBranchFor(slug, 1);
  if (!c1.ok) throw new Error('fixture child branch is invalid');
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'owners@example.invalid']);
  await git(['config', 'user.name', 'Stack owners']);
  await writeFile(join(repo, 'src-flag.tmp'), 'base\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'base']);
  await git(['checkout', '-qb', c1.branch]);
  await writeFile(join(repo, 'src-flag.tmp'), 'child one\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'child one']);
  const closure = String((await git(['rev-parse', 'HEAD'])).stdout).trim();
  await git(['update-ref', `refs/conductor/${slug}/closed/c1`, closure]);
  await git(['checkout', '-qb', leafBranchFor(slug)]);
  await writeFile(join(repo, 'src-flag.tmp'), 'child two\n');
  await writeFile(join(repo, 'src-other.tmp'), 'other\n');
  await git(['add', '.']);
  await git(['commit', '-qm', 'child two']);
  await writeSliceTopologyFixture(repo, {
    slug,
    sliceMembership: { taskSlices: { '1': 1, '2': 2 }, titles: ['Foundation', 'Delivery'] },
  });
  return { repo, slug, git, closure };
}

async function snapshot(repo: string, git: (args: string[]) => ReturnType<typeof execFile>) {
  const read = async (path: string): Promise<Record<string, string>> => {
    try {
      const entries = await readdir(join(repo, path), { recursive: true, withFileTypes: true });
      const files = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
        const relative = join(entry.parentPath.slice(join(repo, path).length + 1), entry.name);
        return [relative, await readFile(join(repo, path, relative), 'utf8')] as const;
      }));
      return Object.fromEntries(files.sort(([left], [right]) => left.localeCompare(right)));
    } catch {
      return {};
    }
  };
  return {
    refs: String((await git(['for-each-ref', '--format=%(refname) %(objectname)'])).stdout),
    leases: await read('.daemon/leases'),
    parks: await read('.daemon/parked'),
    state: await read('.pipeline'),
  };
}

function command(...args: string[]) {
  const parsed = detectStackOwnersCommand(['node', 'ai-conductor', 'stack', 'owners', ...args]);
  if (parsed === null) throw new Error('command did not parse');
  return parsed;
}

describe('stack owners CLI with real local Git', () => {
  it('reports each child that touched a requested path and every path in a diff range', async () => {
    const { repo, slug, git, closure } = await fixture();
    const output: string[] = [];
    const before = await snapshot(repo, git);

    await expect(dispatchStackOwnersCommand(command('--slug', slug, '--path', 'src-flag.tmp'), {
      resolveWorktree: async () => repo,
      print: (line) => output.push(line),
    })).resolves.toBe(0);

    expect(JSON.parse(output[0]!)).toEqual({
      paths: [{
        path: 'src-flag.tmp',
        children: [
          { position: 1, branch: 'feat/c1/demo', title: 'Foundation' },
          { position: 2, branch: 'feat/daemon-demo', title: 'Delivery' },
        ],
      }],
    });
    expect(await snapshot(repo, git)).toEqual(before);

    output.length = 0;
    const expectedPaths = String((await git(['diff', '--no-renames', '--name-only', `${closure}..HEAD`])).stdout)
      .split('\n').filter(Boolean);
    await expect(dispatchStackOwnersCommand(command('--slug', slug, '--diff', `${closure}..HEAD`), {
      resolveWorktree: async () => repo,
      print: (line) => output.push(line),
    })).resolves.toBe(0);
    expect(JSON.parse(output[0]!)).toEqual({ paths: expectedPaths.map((path) => ({
      path,
      children: path === 'src-flag.tmp'
        ? [
            { position: 1, branch: 'feat/c1/demo', title: 'Foundation' },
            { position: 2, branch: 'feat/daemon-demo', title: 'Delivery' },
          ]
        : [{ position: 2, branch: 'feat/daemon-demo', title: 'Delivery' }],
    })) });
    expect(await snapshot(repo, git)).toEqual(before);
  });

  it('reports an untouched path with no owners', async () => {
    const { repo, slug } = await fixture();
    const output: string[] = [];

    await expect(dispatchStackOwnersCommand(command('--slug', slug, '--path', 'untouched.txt'), {
      resolveWorktree: async () => repo,
      print: (line) => output.push(line),
    })).resolves.toBe(0);

    expect(JSON.parse(output[0]!)).toEqual({ paths: [{ path: 'untouched.txt', children: [] }] });
  });

  it('refuses flat and unavailable topology without changing local state', async () => {
    const { repo, slug, git } = await fixture();
    const output: string[] = [];
    const before = await snapshot(repo, git);

    await expect(dispatchStackOwnersCommand(command('--slug', slug, '--path', 'src-flag.tmp'), {
      resolveWorktree: async () => repo,
      loadTopology: async () => ({ kind: 'unsliced' }),
      print: (line) => output.push(line),
    })).resolves.toBe(1);
    expect(output.join('\n')).toContain('not stacked');

    output.length = 0;
    await expect(dispatchStackOwnersCommand(command('--slug', slug, '--path', 'src-flag.tmp'), {
      resolveWorktree: async () => repo,
      loadTopology: async () => ({ kind: 'unavailable', cause: 'plan-invalid' }),
      print: (line) => output.push(line),
    })).resolves.toBe(1);
    expect(output.join('\n')).toContain('plan-invalid');
    expect(await snapshot(repo, git)).toEqual(before);
  });

  it('registers stack owners for Commander help and pre-dispatch routing', async () => {
    expect({
      command: (await import('../../src/cli.js')).createProgram().commands.find((entry) => entry.name() === 'stack')
        ?.commands.map((entry) => entry.name()),
      preDispatch: PRE_DISPATCH_COMMANDS.find((entry) => entry.detector === 'detectStackOwnersCommand'),
    }).toEqual({
      command: ['land', 'owners'],
      preDispatch: { detector: 'detectStackOwnersCommand', commandPath: ['stack', 'owners'], helpOwner: 'router' },
    });
  });
});
