// Covers: task:16
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import { persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import type { StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const dirs: string[] = [];

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'prd-audit-handshake-'));
  dirs.push(dir);
  return dir;
}

function handshakeFor(projectRoot: string) {
  const conductor = new Conductor({
    projectRoot,
    stateFilePath: join(projectRoot, '.pipeline', 'state.json'),
    stepRunner: { run: vi.fn() } as never,
    events: new ConductorEventEmitter(),
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
});
