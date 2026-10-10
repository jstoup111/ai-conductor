// Covers: task:26
import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FullSuiteVerifier, type FullSuiteGitRunner } from '../../src/engine/full-suite-verifier.js';
import { parseChildId } from '../../src/engine/child-context.js';
import type { ExecuteFullSuiteOptions } from '../../src/engine/full-suite-executor.js';

const scratches: string[] = [];
const BASE = 'abc1234def5678';
const child1 = { child: parseChildId(1)!, isLeaf: false };
const child2 = { child: parseChildId(2)!, isLeaf: true };
const fingerprints = {
  additional_inputs: 'a', dependencies: 'b', environment: 'c', migrations: 'd',
  project_config: 'e', source: 'f', test_infrastructure: 'g', tests: 'h',
};

afterEach(async () => {
  for (const root of scratches.splice(0)) await rm(root, { recursive: true, force: true });
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'full-suite-child-'));
  scratches.push(root);
  await mkdir(join(root, '.ai-conductor'), { recursive: true });
  await writeFile(join(root, '.ai-conductor', 'config.yml'), [
    'test_suite:',
    '  command: node suite.mjs --all',
    "  changed_command: 'node suite.mjs --changed {base}'",
    '  verification:',
    '    mode: changed',
    '    full_suite: once',
    '',
  ].join('\n'));
  return root;
}

const git: FullSuiteGitRunner = async (args) => {
  if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
  if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${BASE}\n`, stderr: '' };
  if (args[0] === 'status') return { exitCode: 0, stdout: '', stderr: '' };
  return { exitCode: 0, stdout: 'src/child.ts\n', stderr: '' };
};

function verifier(root: string, commands: string[]) {
  return new FullSuiteVerifier({
    projectRoot: root,
    git,
    fingerprint: async () => ({
      ok: true as const,
      fingerprint: { digest: 'sha256:child', headSha: 'head', categoryFingerprints: fingerprints },
    }),
    execute: async ({ testSuite }: ExecuteFullSuiteOptions) => {
      commands.push(testSuite.command ?? 'commands');
      return {
        ok: true as const,
        command: testSuite.command ?? '', cwd: root,
        startedAt: '2026-10-09T00:00:00.000Z', endedAt: '2026-10-09T00:00:01.000Z',
        durationMs: 1_000, exitCode: 0 as const, stdout: '', stderr: '',
      };
    },
    worktreeStatus: async () => '',
  });
}

describe('child-scoped test-suite evidence', () => {
  it('keeps non-leaf changed evidence in its child and runs the once aggregate for the leaf', async () => {
    const root = await project();
    const commands: string[] = [];

    const first = verifier(root, commands);
    await expect(first.ensure(undefined, { requireAggregate: true, activeChild: child1 }))
      .resolves.toMatchObject({ status: 'EXECUTED', evidence: { executionBasis: 'changed' } });
    await expect(readFile(join(root, '.pipeline', 'children', '1', 'test-suite-evidence.json'), 'utf8'))
      .resolves.toContain('"executionBasis": "changed"');

    const leaf = verifier(root, commands);
    await expect(leaf.ensure(undefined, { requireAggregate: true, activeChild: child2 }))
      .resolves.toMatchObject({ status: 'EXECUTED', evidence: { executionBasis: 'aggregate' } });
    await expect(readFile(join(root, '.pipeline', 'children', '2', 'test-suite-evidence.json'), 'utf8'))
      .resolves.toContain('"executionBasis": "aggregate"');
    await expect(access(join(root, '.pipeline', 'test-suite-evidence.json'), constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(commands).toEqual([`node suite.mjs --changed ${BASE}`, 'node suite.mjs --all']);
  });
});
