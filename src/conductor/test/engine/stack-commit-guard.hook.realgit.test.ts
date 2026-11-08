// Covers: task:13
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { leafBranchFor } from '../../src/engine/feature-branch-identity.js';
import { closureRefFor } from '../../src/engine/routing/routing-refs.js';
import { createRouteRecord, readRepairMarker, readRouteRecord, writeRoutingTransaction } from '../../src/engine/routing/route-record-store.js';
import { repairMarkerRefFor } from '../../src/engine/routing/routing-refs.js';
import { parseRoundId, type RouteRecord } from '../../src/engine/routing/route-types.js';
import { dispatchStackRoundsCommand } from '../../src/engine/stack-rounds-cli.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { writeSliceTopologyFixture, type SliceTopologyFixtureFilesystem } from './slice-topology-fixture.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
// global-setup builds this entry before workers start. Invoking it directly
// avoids compiling TypeScript once per Git hook under CI parallelism.
const engineIndex = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const child = parseChildId(1)!;
const roundId = parseRoundId('r1')!;
const leafReturnRoundId = parseRoundId('r2')!;
const fixtureFilesystem: SliceTopologyFixtureFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: root })).stdout.trim();
}

async function writeHookLauncher(root: string): Promise<string> {
  const launcher = join(root, 'stack-commit-guard-launcher');
  await writeFile(launcher, `#!/bin/sh\nexec node ${JSON.stringify(engineIndex)} "$@"\n`, 'utf8');
  await chmod(launcher, 0o755);
  return launcher;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stack-commit-guard-hook-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'stack-guard@example.test']);
  await git(root, ['config', 'user.name', 'Stack guard']);
  await writeFile(join(root, '.gitignore'), '.pipeline/\n');
  await git(root, ['add', '.gitignore']);
  await git(root, ['commit', '-qm', 'base']);
  await writeSliceTopologyFixture(root, {
    slug: 'demo',
    sliceMembership: { taskSlices: { T1: 1, T2: 2 }, titles: ['host', 'other'] },
    storyOwnership: { S1: 1, S2: 2 },
  }, fixtureFilesystem);

  await git(root, ['checkout', '-qb', 'feat/c1/demo']);
  await writeFile(join(root, 'child.txt'), 'closed child\n');
  await git(root, ['add', 'child.txt']);
  await git(root, ['commit', '-qm', 'closed child']);
  const closure = await git(root, ['rev-parse', 'HEAD']);
  await git(root, ['update-ref', closureRefFor('demo', child), closure]);
  await writeFile(join(root, 'manual.txt'), 'reviewer edit\n');
  await git(root, ['add', 'manual.txt']);
  await git(root, ['commit', '-qm', 'reviewer edit']);
  await git(root, ['branch', 'feat/c2/demo', closure]);
  await git(root, ['checkout', '-qb', leafBranchFor('demo'), closure]);
  await git(root, ['commit', '--allow-empty', '-qm', 'leaf']);
  await git(root, ['checkout', '-q', 'feat/c1/demo']);
  await mkdir(join(root, '.pipeline', 'children', '1'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'children', '1', 'conduct-state.json'), JSON.stringify({
    acceptance_specs: 'done', build: 'done', test_suite: 'done', build_review: 'done',
  }));
  return root;
}

async function withHookModules<T>(root: string, action: (modules: {
  readonly launcher: string;
  readonly writeGitHooksAndWire: (worktree: string, log?: (message: string) => void) => Promise<void>;
  readonly openOperatorRound: typeof import('../../src/engine/routing/operator-round.js')['openOperatorRound'];
}) => Promise<T>): Promise<T> {
  const launcher = await writeHookLauncher(root);
  const [{ writeGitHooksAndWire }, { openOperatorRound }] = await Promise.all([
    import('../../src/engine/worktree-prepare.js'),
    import('../../src/engine/routing/operator-round.js'),
  ]);
  return action({
    launcher,
    writeGitHooksAndWire: (worktree, log) => writeGitHooksAndWire(worktree, log, { launcher }),
    openOperatorRound,
  });
}

async function commit(root: string, file: string): Promise<void> {
  await writeFile(join(root, file), `${file}\n`);
  await git(root, ['add', file]);
  await git(root, ['commit', '-qm', `feat: ${file}`]);
}

async function openSoleAuditRound(root: string): Promise<void> {
  const created = await createRouteRecord(root, 'demo', {
    roundId: leafReturnRoundId,
    kind: 'audit',
    sealedAuthored: 0,
    items: [],
    allocation: { [child]: { remTaskIds: [], blockBodies: [] } },
  });
  if (created.kind !== 'created') throw new Error(`could not create ${leafReturnRoundId}: ${created.kind}`);
  const stored = await readRouteRecord(root, 'demo', leafReturnRoundId);
  if (stored.kind !== 'record') throw new Error(`could not read ${leafReturnRoundId}`);
  const record: RouteRecord = { ...stored.record, phase: 'open', hosts: { [child]: 'admitted' } };
  const updated = await writeRoutingTransaction(root, 'demo', [{ kind: 'update-record', previous: stored, record }]);
  if (updated.kind !== 'updated') throw new Error(`could not open ${leafReturnRoundId}: ${updated.kind}`);
  await writeFile(join(root, 'marker.json'), JSON.stringify({ host: child, roundId: leafReturnRoundId }));
  const blob = await git(root, ['hash-object', '-w', 'marker.json']);
  await git(root, ['update-ref', repairMarkerRefFor('demo'), blob]);
}

describe('stack commit guard pre-commit hook (real local Git)', () => {
  it('refreshes the hook while opening a round and refuses non-host commits without a phase marker', async () => {
    const root = await fixture();

    await withHookModules(root, async ({ launcher, writeGitHooksAndWire, openOperatorRound }) => {
      await writeGitHooksAndWire(root);
      const hookPath = join(root, '.pipeline', 'git-hooks', 'pre-commit');
      const currentHook = await readFile(hookPath, 'utf8');
      expect(currentHook).toContain(launcher);
      await writeFile(hookPath, currentHook.replace(/^.*stack-commit-guard.*\n/m, ''));
      await expect(readFile(hookPath, 'utf8')).resolves.not.toContain('stack-commit-guard');

      await expect(openOperatorRound({
        worktree: root,
        slug: 'demo',
        roundId,
        host: child,
        reason: 'land reviewer edits in child one',
        operator: 'operator@example.test',
        carried: [],
        emitter: new ConductorEventEmitter(),
      })).resolves.toMatchObject({ kind: 'opened' });
      await expect(readFile(hookPath, 'utf8')).resolves.toContain('stack-commit-guard');

      await git(root, ['checkout', '-q', 'feat/c2/demo']);
      await expect(commit(root, 'wrong-child.txt')).rejects.toMatchObject({
        stderr: expect.stringContaining('stack-commit-guard: refusing tracked-file commit on feat/c2/demo'),
      });

      await git(root, ['reset', '--hard', 'HEAD']);
      await git(root, ['checkout', '-q', 'feat/c1/demo']);
      await expect(commit(root, 'host.txt')).resolves.toBeUndefined();
    });
  });

  // Covers: task:12
  it('allows a leaf tracked-file commit after a sole audit round closes into a leaf return', async () => {
    const root = await fixture();
    const output: string[] = [];

    await withHookModules(root, async ({ writeGitHooksAndWire }) => {
      await writeGitHooksAndWire(root);
      await openSoleAuditRound(root);

      await expect(dispatchStackRoundsCommand({
        kind: 'stack-rounds-close', slug: 'demo', roundId: 'r2', reason: 'fix lands on leaf',
      }, {
        cwd: root, resolveMainRoot: async () => root, resolveWorktree: async () => root,
        loadConfig: async () => ({ ok: true, config: { stacked_prs: { route_whole_feature_fixes: true } }, warnings: [] }),
        hasDurableChildState: async () => true, resolveOperator: async () => 'operator@example.test',
        print: (line: string) => output.push(line),
      } as never)).resolves.toBe(0);

      await expect(readRouteRecord(root, 'demo', leafReturnRoundId)).resolves.toMatchObject({
        kind: 'record', record: { phase: 'closed', hosts: { [child]: 'done' } },
      });
      await expect(readRepairMarker(root, 'demo')).resolves.toMatchObject({ kind: 'absent' });
      expect(output.join('\n')).toContain('leaf return closed r2');
      expect(output.join('\n')).toContain('closed hosts 1');
      expect(output.join('\n')).toContain('reason fix lands on leaf');
      expect(output.join('\n')).toContain('ai-conductor halt clear');

      await git(root, ['checkout', '-q', leafBranchFor('demo')]);
      await expect(commit(root, 'leaf-fix.txt')).resolves.toBeUndefined();
    });
  });
});
