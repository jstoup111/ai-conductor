import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExecuteFullSuiteOptions } from '../../src/engine/full-suite-executor.js';
import {
  changedOnlyRequiresAggregate,
  deriveFullSuiteChangedSelection,
  FullSuiteVerifier,
  type FullSuiteGitRunner,
} from '../../src/engine/full-suite-verifier.js';

const scratches: string[] = [];
const BASE = 'abc1234def5678';
const CATEGORY_FINGERPRINTS = {
  additional_inputs: 'a', dependencies: 'b', environment: 'c', migrations: 'd',
  project_config: 'e', source: 'f', test_infrastructure: 'g', tests: 'h',
};

afterEach(async () => {
  for (const path of scratches.splice(0)) await rm(path, { recursive: true, force: true });
});

function gitWith(changed: string[], options: { mergeBase?: number } = {}): FullSuiteGitRunner {
  return async (args) => {
    if (args[0] === 'symbolic-ref') return { exitCode: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' };
    if (args[0] === 'merge-base') {
      return options.mergeBase === undefined || options.mergeBase === 0
        ? { exitCode: 0, stdout: `${BASE}\n`, stderr: '' }
        : { exitCode: options.mergeBase, stdout: '', stderr: 'no base' };
    }
    if (args[0] === 'status') return { exitCode: 0, stdout: '', stderr: '' };
    return { exitCode: 0, stdout: changed.map((p) => `${p}\n`).join(''), stderr: '' };
  };
}

async function changedModeProject(fullSuite?: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'full-suite-changed-mode-'));
  scratches.push(projectRoot);
  const config = join(projectRoot, '.ai-conductor/config.yml');
  await mkdir(resolve(config, '..'), { recursive: true });
  await writeFile(config, [
    'test_suite:',
    '  command: node suite.mjs --all',
    "  changed_command: 'node suite.mjs --changed {base}'",
    '  verification:',
    '    mode: changed',
    ...(fullSuite === undefined ? [] : [`    full_suite: ${fullSuite}`]),
    '',
  ].join('\n'));
  return projectRoot;
}

function recordingExecute(projectRoot: string, commands: string[]) {
  return async ({ testSuite }: ExecuteFullSuiteOptions) => {
    commands.push(testSuite.command ?? '<commands>');
    return {
      ok: true as const,
      command: testSuite.command ?? '',
      cwd: projectRoot,
      startedAt: '2026-10-03T10:00:00.000Z',
      endedAt: '2026-10-03T10:00:01.000Z',
      durationMs: 1_000,
      exitCode: 0 as const,
      stdout: '',
      stderr: '',
    };
  };
}

const fingerprintAt = (digest: string) => async () => ({
  ok: true as const,
  fingerprint: { digest, headSha: 'head', categoryFingerprints: CATEGORY_FINGERPRINTS },
});
const fixedFingerprint = fingerprintAt('sha256:changed');

function verifierFor(projectRoot: string, commands: string[], digest: string) {
  return new FullSuiteVerifier({
    projectRoot,
    execute: recordingExecute(projectRoot, commands),
    fingerprint: fingerprintAt(digest),
    git: gitWith(['src/a.ts']),
    worktreeStatus: async () => '',
  } as never);
}

describe('changed-only test_suite selection', () => {
  it.each([
    ['src/engine/foo.ts', false],
    ['test/engine/foo.test.ts', false],
    ['src/conductor/vitest.smoke.config.ts', true],
    ['src/conductor/vitest.config.ts', true],
    ['src/conductor/test/global-setup.ts', true],
    ['src/conductor/test/helpers/tmp.ts', true],
    ['src/conductor/package.json', true],
    ['src/conductor/scripts/run-vitest.mjs', true],
    ['.ai-conductor/config.yml', true],
  ])('%s requires the aggregate suite: %s', (path, expected) => {
    expect(changedOnlyRequiresAggregate(path)).toBe(expected);
  });

  it('selects the merge-base for a source-and-test-only change set', async () => {
    await expect(deriveFullSuiteChangedSelection(gitWith(['src/a.ts', 'test/a.test.ts'])))
      .resolves.toEqual({ status: 'CHANGED', base: BASE });
  });

  it('fails closed to aggregate when infra changed, nothing changed, or the base is unknown', async () => {
    await expect(deriveFullSuiteChangedSelection(gitWith(['src/a.ts', 'test/global-setup.ts'])))
      .resolves.toEqual({ status: 'EMPTY' });
    await expect(deriveFullSuiteChangedSelection(gitWith([]))).resolves.toEqual({ status: 'EMPTY' });
    await expect(deriveFullSuiteChangedSelection(gitWith(['src/a.ts'], { mergeBase: 1 })))
      .resolves.toEqual({ status: 'EMPTY' });
  });
});

describe('FullSuiteVerifier changed mode', () => {
  it('runs the changed command on a lap and the aggregate once when publication requires it', async () => {
    const projectRoot = await changedModeProject();
    const commands: string[] = [];
    const verifier = new FullSuiteVerifier({
      projectRoot,
      execute: recordingExecute(projectRoot, commands),
      fingerprint: fixedFingerprint,
      git: gitWith(['src/a.ts']),
      worktreeStatus: async () => '',
    } as never);

    const lap = await verifier.ensure();
    expect(lap).toMatchObject({ status: 'EXECUTED', evidence: { mode: 'changed', executionBasis: 'changed' } });
    await expect(verifier.inspect()).resolves.toMatchObject({ status: 'CURRENT' });
    await expect(verifier.inspect({ requireAggregate: true }))
      .resolves.toEqual({ status: 'STALE', reason: 'aggregate_required' });

    const ship = await verifier.ensure(undefined, { requireAggregate: true });
    expect(ship).toMatchObject({ status: 'EXECUTED', evidence: { mode: 'changed', executionBasis: 'aggregate' } });
    await expect(verifier.inspect({ requireAggregate: true })).resolves.toMatchObject({ status: 'CURRENT' });
    expect(commands).toEqual([`node suite.mjs --changed ${BASE}`, 'node suite.mjs --all']);
  });

  it('runs the aggregate command on a lap whose change set touches test infrastructure', async () => {
    const projectRoot = await changedModeProject();
    const commands: string[] = [];
    const result = await new FullSuiteVerifier({
      projectRoot,
      execute: recordingExecute(projectRoot, commands),
      fingerprint: fixedFingerprint,
      git: gitWith(['src/a.ts', 'vitest.config.ts']),
      worktreeStatus: async () => '',
    } as never).ensure();
    expect(result).toMatchObject({ status: 'EXECUTED', evidence: { executionBasis: 'aggregate' } });
    expect(commands).toEqual(['node suite.mjs --all']);
  });
});

describe('test_suite.verification.full_suite policy at publication', () => {
  it('before_publish: a changed-only PASS never satisfies publication; the aggregate re-runs after later changes', async () => {
    const projectRoot = await changedModeProject('before_publish');
    const commands: string[] = [];
    await verifierFor(projectRoot, commands, 'sha256:one').ensure(undefined, { requireAggregate: true });
    await verifierFor(projectRoot, commands, 'sha256:two').ensure();
    const ship = verifierFor(projectRoot, commands, 'sha256:two');
    await expect(ship.inspect({ requireAggregate: true }))
      .resolves.toEqual({ status: 'STALE', reason: 'aggregate_required' });
    await ship.ensure(undefined, { requireAggregate: true });
    expect(commands).toEqual(['node suite.mjs --all', `node suite.mjs --changed ${BASE}`, 'node suite.mjs --all']);
  });

  it('once: requires the aggregate until the first aggregate PASS, then changed-only laps satisfy publication', async () => {
    const projectRoot = await changedModeProject('once');
    const commands: string[] = [];
    await verifierFor(projectRoot, commands, 'sha256:one').ensure();
    await expect(verifierFor(projectRoot, commands, 'sha256:one').inspect({ requireAggregate: true }))
      .resolves.toEqual({ status: 'STALE', reason: 'aggregate_required' });

    const first = await verifierFor(projectRoot, commands, 'sha256:one').ensure(undefined, { requireAggregate: true });
    expect(first).toMatchObject({ evidence: { executionBasis: 'aggregate', aggregatePassedAt: expect.any(String) } });

    // Later lap changes code; a fresh verifier stands in for a restart / re-kick.
    const lap = await verifierFor(projectRoot, commands, 'sha256:two').ensure();
    expect(lap).toMatchObject({ evidence: { executionBasis: 'changed', aggregatePassedAt: expect.any(String) } });
    const ship = verifierFor(projectRoot, commands, 'sha256:two');
    await expect(ship.inspect({ requireAggregate: true })).resolves.toMatchObject({ status: 'CURRENT' });
    await expect(ship.ensure(undefined, { requireAggregate: true })).resolves.toMatchObject({ status: 'REUSED' });
    expect(commands).toEqual([
      `node suite.mjs --changed ${BASE}`,
      'node suite.mjs --all',
      `node suite.mjs --changed ${BASE}`,
    ]);
  });

  it('skip: the changed-only PASS satisfies publication and the aggregate never runs', async () => {
    const projectRoot = await changedModeProject('skip');
    const commands: string[] = [];
    await verifierFor(projectRoot, commands, 'sha256:one').ensure();
    const ship = verifierFor(projectRoot, commands, 'sha256:one');
    await expect(ship.inspect({ requireAggregate: true })).resolves.toMatchObject({ status: 'CURRENT' });
    await expect(ship.ensure(undefined, { requireAggregate: true })).resolves.toMatchObject({ status: 'REUSED' });
    expect(commands).toEqual([`node suite.mjs --changed ${BASE}`]);
  });
});
