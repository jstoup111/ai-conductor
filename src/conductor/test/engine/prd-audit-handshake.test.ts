// Covers: task:16
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import { gateVerdictStillValid } from '../../src/engine/gate-code-validity.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import type { StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const dirs: string[] = [];

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'prd-audit-handshake-'));
  dirs.push(dir);
  return dir;
}

function handshakeFor(
  projectRoot: string,
  config?: { gate_code_validity?: { enabled?: boolean } },
) {
  const conductor = new Conductor({
    projectRoot,
    stateFilePath: join(projectRoot, '.pipeline', 'state.json'),
    stepRunner: { run: vi.fn() } as never,
    events: new ConductorEventEmitter(),
    config,
  });
  return (conductor as unknown as {
    verdictDispatchHandshake: (
      step: StepName,
      runId: string,
      startedAt: number,
      dispatchOutput?: string,
    ) => Promise<{ done: false; routeClass: 'absent'; retrySignal?: string; reason: string } | undefined>;
  }).verdictDispatchHandshake.bind(conductor);
}

async function gitFixtureDir(): Promise<{ dir: string; head: string }> {
  const dir = await fixtureDir();
  const git = makeGitRunner(dir);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'fixture@example.test']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['config', 'commit.gpgsign', 'false']);
  await writeFile(join(dir, 'README.md'), 'fixture\n', 'utf8');
  await git(['add', 'README.md']);
  await git(['commit', '-q', '-m', 'fixture']);
  return { dir, head: (await git(['rev-parse', 'HEAD'])).stdout.trim() };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('prd_audit current-output handshake', () => {
  it('names the step, engine attempt, expected typed output, and no-verdict outcome for prose-only output', async () => {
    const dir = await fixtureDir();
    const result = await handshakeFor(dir)(
      'prd_audit',
      'engine-attempt-16',
      Date.now(),
      'structured-result-missing',
    );

    expect(result).toMatchObject({
      done: false,
      routeClass: 'absent',
      retrySignal: 'structured-result-missing',
    });
    expect(result?.reason).toContain('prd_audit dispatch engine-attempt-16');
    expect(result?.reason).toContain('produced no verdict');
    expect(result?.reason).toContain('expected terminal typed output .pipeline/prd-audit.json');
  });

  it('keeps rejected judgment diagnostics distinct while still naming the absent current output', async () => {
    const dir = await fixtureDir();
    const result = await handshakeFor(dir)(
      'prd_audit',
      'engine-attempt-17',
      Date.now(),
      'structured-result-rejected: criterionJudgments[1].criterion S1.99 does not resolve; criterionJudgments[1].evidence is required',
    );

    expect(result).toMatchObject({
      done: false,
      routeClass: 'absent',
      retrySignal: 'structured-result-rejected',
    });
    expect(result?.reason).toContain('prd_audit dispatch engine-attempt-17 produced no verdict');
    expect(result?.reason).toContain('expected terminal typed output .pipeline/prd-audit.json');
    expect(result?.reason).toContain('incomplete judgment');
    expect(result?.reason).toContain('criterionJudgments[1].criterion S1.99');
    expect(result?.reason).toContain('criterionJudgments[1].evidence is required');
  });

  it('does not accept an older typed verdict merely because its mtime was refreshed', async () => {
    const dir = await fixtureDir();
    await persistPrdAuditVerdict(dir, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'PASS',
          evidence: 'Prior output.', rationale: 'Prior output.', requirementAssociations: [], evidenceTaskIds: [],
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'prior-attempt', codeStamp: 'prior-head' });
    const now = new Date();
    await utimes(join(dir, '.pipeline', 'prd-audit.json'), now, now);

    const result = await handshakeFor(dir)('prd_audit', 'engine-attempt-18', Date.now());

    expect(result).toMatchObject({
      done: false,
      routeClass: 'absent',
      retrySignal: 'stale-run-identity',
    });
    expect(result?.reason).toContain('prd_audit dispatch engine-attempt-18 produced no verdict');
    expect(result?.reason).toContain('expected terminal typed output .pipeline/prd-audit.json');
    expect(result?.reason).toContain('prior-attempt');
  });

  it.each([
    ['a reachable current-HEAD stamp', true],
    ['a null stamp', false],
    ['disabled code-validity', true],
  ] as const)('rejects a prior attempt with %s', async (fixtureKind, useCurrentHead) => {
    const { dir, head } = await gitFixtureDir();
    if (fixtureKind === 'a reachable current-HEAD stamp') {
      await expect(gateVerdictStillValid(
        { projectRoot: dir, git: makeGitRunner(dir) },
        'prd_audit',
        head,
      )).resolves.toBe('preserve');
    }
    await persistPrdAuditVerdict(dir, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'PASS',
          evidence: 'Prior output.', rationale: 'Prior output.', requirementAssociations: [], evidenceTaskIds: [],
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'prior-attempt', codeStamp: useCurrentHead ? head : null });

    const result = await handshakeFor(
      dir,
      fixtureKind === 'disabled code-validity' ? { gate_code_validity: { enabled: false } } : undefined,
    )('prd_audit', 'engine-attempt-19', Date.now());

    expect(result).toMatchObject({
      done: false,
      routeClass: 'absent',
      retrySignal: 'stale-run-identity',
    });
  });

  it('accepts a complete verdict from the current attempt', async () => {
    const dir = await fixtureDir();
    await persistPrdAuditVerdict(dir, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'PASS',
          evidence: 'Current output.', rationale: 'Current output.', requirementAssociations: [], evidenceTaskIds: [],
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'engine-attempt-20', codeStamp: null });

    await expect(handshakeFor(dir)('prd_audit', 'engine-attempt-20', Date.now())).resolves.toBeUndefined();
  });
});
