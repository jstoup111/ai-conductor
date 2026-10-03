import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

import { checkStepCompletion, sweepStaleReviewArtifacts } from '../../src/engine/artifacts.js';
import { Conductor } from '../../src/engine/conductor.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { PRD_AUDIT_VERDICT_PATH, persistPrdAuditVerdict } from '../../src/engine/prd-audit-verdict-store.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFileAsync = promisify(execFile);
const scratches: string[] = [];

afterEach(async () => {
  while (scratches.length > 0) await rm(scratches.pop()!, { recursive: true, force: true });
});

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', dir, ...args]);
  return stdout.trim();
}

async function commit(dir: string, path: string, content: string, message: string): Promise<string> {
  await mkdir(join(dir, path, '..'), { recursive: true });
  await writeFile(join(dir, path), content);
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

async function preservedReaderFixture(): Promise<{ dir: string; head: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'rebase-preserved-readers-'));
  scratches.push(dir);
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(dir, '.gitignore'), '.pipeline/\n');
  const original = await commit(dir, 'src/shared.ts', 'reviewed\n', 'reviewed work');
  const head = await commit(dir, 'src/shared.ts', 'upstream plus replay\n', 'clean replay');
  const expectedTree = await git(dir, 'rev-parse', `${head}^{tree}`);
  const replay = { preRebaseHead: original, mergeBase: original, target: original, completedHead: head, expectedTree };
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await persistPrdAuditVerdict(dir, {
    complete: true,
    judgment: {
      version: 'v1',
      criterionJudgments: [{
        criterion: { storyId: '1', ordinal: 1 }, criterionId: 'S1.1', grade: 'PASS',
        evidence: 'src/shared.ts:1', rationale: 'The fixture supplies a complete typed audit judgment.',
        requirementAssociations: [], evidenceTaskIds: [],
      }],
      noOwnerObservations: [],
    },
    diagnostics: [],
    recordedDispositions: [],
  }, { attemptId: 'before-rebase', codeStamp: original });
  const verdict = await readFile(join(dir, PRD_AUDIT_VERDICT_PATH), 'utf8');
  await writeVerdict(dir, 'prd_audit', {
    satisfied: true,
    checkedAt: 1,
    preservation: {
      gate: 'prd_audit',
      original: {
        artifactDigest: `sha256:${createHash('sha256').update(verdict).digest('hex')}`,
        attemptId: 'before-rebase',
        runId: 'before-rebase',
        codeStamp: original,
      },
      replay,
      relevantInputIdentities: ['.docs/specs/feature.md@replay-bound'],
      operationId: 'rebase-1',
    },
  });
  await writeVerdict(dir, 'rebase', {
    satisfied: true,
    checkedAt: 1,
    rebaseOperation: {
      id: 'rebase-1', status: 'applied', transition: { preserved: ['prd_audit'], invalidated: [], reverified: [] }, replay,
    },
  });
  return { dir, head };
}

describe('integration/rebase-preserved-readers (Task 8)', () => {
  it('retains a valid preserved review across completion and stale-artifact sweep', async () => {
    const { dir, head } = await preservedReaderFixture();
    const reportPath = join(dir, '.pipeline/prd-audit.md');
    const old = new Date(2000, 0, 1);
    await utimes(reportPath, old, old);

    await expect(checkStepCompletion(dir, 'prd_audit', {
      sessionStartedAt: Date.now(),
      getHeadSha: async () => head,
    })).resolves.toMatchObject({ done: true });
    await expect(sweepStaleReviewArtifacts(dir, 'prd_audit', Date.now(), undefined, undefined, 'restarted-run')).resolves.toEqual([]);
    await expect(readFile(reportPath, 'utf8')).resolves.toContain('PASS');
  });

  it('refuses finish and a restarted conductor while the durable transition is applying', async () => {
    const { dir } = await preservedReaderFixture();
    const rebase = JSON.parse(await readFile(join(dir, '.pipeline/gates/rebase.json'), 'utf8'));
    rebase.rebaseOperation.status = 'applying';
    await writeVerdict(dir, 'rebase', rebase);
    await writeFile(join(dir, '.pipeline/finish-choice'), 'pr\n');
    await writeState(join(dir, '.pipeline/conduct-state.json'), { pr_url: 'https://example.test/pr/1' });

    await expect(checkStepCompletion(dir, 'finish', { sessionStartedAt: 0, isHeadPushed: async () => true }))
      .resolves.toMatchObject({ done: false, reason: expect.stringMatching(/rebase transition is still applying/) });

    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: join(dir, '.pipeline/conduct-state.json'),
      stepRunner: { run: async () => ({ success: true }) },
      events: new ConductorEventEmitter(),
      resume: true,
      verifyArtifacts: true,
      mode: 'auto',
    });
    await conductor.run();
    await expect(readFile(join(dir, '.pipeline/HALT'), 'utf8')).resolves.toMatch(/rebase transition is still applying/);
  });

});
