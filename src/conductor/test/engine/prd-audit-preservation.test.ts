/**
 * Covers: task:27, Story 8 c56 c57 c60
 *
 * The PRD report is intentionally never used as authority in these fixtures.
 * Each case writes the typed verdict, then drives the same completion and
 * code-validity seams that resume/rebase use in the conductor.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { gateVerdictStillValid } from '../../src/engine/gate-code-validity.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import {
  PRD_AUDIT_VERDICT_PATH,
  persistPrdAuditVerdict,
} from '../../src/engine/prd-audit-verdict-store.js';
import type { PrdAuditJudgment } from '../../src/engine/prd-audit-contract.js';

const roots: string[] = [];
const oldMtime = new Date(2000, 0, 1);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<{ root: string; git: ReturnType<typeof makeGitRunner> }> {
  const root = await mkdtemp(join(tmpdir(), 'prd-audit-preservation-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'fixture@example.test']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['config', 'commit.gpgsign', 'false']);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.gitignore'), '.pipeline/\n', 'utf8');
  await git(['add', '.gitignore']);
  await git(['commit', '-q', '-m', 'chore: ignore fixture evidence']);
  return { root, git };
}

async function commit(
  fixture: { root: string; git: ReturnType<typeof makeGitRunner> },
  files: Record<string, string>,
  message: string,
): Promise<string> {
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(fixture.root, path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, contents, 'utf8');
  }
  await fixture.git(['add', '.']);
  await fixture.git(['commit', '-q', '-m', message]);
  const head = await fixture.git(['rev-parse', 'HEAD']);
  return head.stdout.trim();
}

const cleanJudgment: PrdAuditJudgment = {
  version: 'v1',
  criterionJudgments: [{
    criterion: { storyId: '1', ordinal: 1 },
    criterionId: 'S1.1',
    grade: 'PASS',
    evidence: 'The typed review found the implemented behavior.',
    rationale: 'The criterion is satisfied by the reviewed tree.',
    requirementAssociations: [],
    evidenceTaskIds: [],
  }],
  noOwnerObservations: [],
};

async function writeTypedPass(
  root: string,
  codeStamp: string | null,
  attemptId = 'review-run',
): Promise<void> {
  await persistPrdAuditVerdict(root, {
    complete: true,
    judgment: cleanJudgment,
    diagnostics: [],
    recordedDispositions: [],
  }, { attemptId, codeStamp });
}

function completionContext(
  root: string,
  git: ReturnType<typeof makeGitRunner>,
  attemptRunId = 'resume-run',
) {
  return {
    attemptRunId,
    sessionStartedAt: Date.now(),
    config: { gate_code_validity: { enabled: true } },
    git,
    getHeadSha: async () => (await git(['rev-parse', 'HEAD'])).stdout.trim(),
    projectRoot: root,
  };
}

describe('typed PRD-audit preservation', () => {
  it('reuses complete, code-valid typed evidence on resume without treating the derived report as authority', async () => {
    const fixture = await repository();
    const reviewed = await commit(fixture, { 'src/feature.ts': 'export const feature = true;\n' }, 'feat: reviewed feature');
    await writeTypedPass(fixture.root, reviewed, 'prior-review-run');
    const originalArtifact = await readFile(join(fixture.root, PRD_AUDIT_VERDICT_PATH), 'utf8');
    await utimes(join(fixture.root, PRD_AUDIT_VERDICT_PATH), oldMtime, oldMtime);
    await writeFile(join(fixture.root, '.pipeline', 'prd-audit.md'), 'not a verdict\n', 'utf8');

    const completion = await checkStepCompletion(
      fixture.root,
      'prd_audit',
      completionContext(fixture.root, fixture.git),
    );

    expect(completion).toMatchObject({ done: true });
    expect(completion.verdictFreshness).toMatchObject({ outcome: 'preserved_surface_miss' });
    expect(await readFile(join(fixture.root, PRD_AUDIT_VERDICT_PATH), 'utf8')).toBe(originalArtifact);
  });

  it.each(['.docs/stories/active.md', '.docs/specs/active.md'])(
    'rejects a resume reuse when a reviewed PRD input changes (%s)',
    async (changedInput) => {
      const fixture = await repository();
      const reviewed = await commit(fixture, {
        '.docs/plans/active.md': '**Stories:** .docs/stories/active.md\n',
        '.docs/stories/active.md': '# Story\n\nOriginal acceptance criterion.\n',
        '.docs/specs/active.md': '# PRD\n\nOriginal product intent.\n',
        'src/feature.ts': 'export const feature = true;\n',
      }, 'feat: reviewed inputs');
      await writeFile(join(fixture.root, '.pipeline', 'conduct-state.json'), JSON.stringify({ feature_desc: 'active' }));
      await writeTypedPass(fixture.root, reviewed, 'prior-review-run');
      await commit(fixture, { [changedInput]: '# Changed\n\nThis changes reviewed intent.\n' }, 'docs: change reviewed input');

      await expect(checkStepCompletion(
        fixture.root,
        'prd_audit',
        completionContext(fixture.root, fixture.git),
      )).resolves.toMatchObject({ done: false, routeClass: 'absent' });
    },
  );

  it('preserves the original typed judgment through a fully attested selective replay, then rejects a later story change', async () => {
    const fixture = await repository();
    const reviewed = await commit(fixture, {
      '.docs/plans/active.md': '**Stories:** .docs/stories/active.md\n',
      '.docs/stories/active.md': '# Story\n\nOriginal acceptance criterion.\n',
      'src/feature.ts': 'export const feature = true;\n',
    }, 'feat: originally reviewed');
    await writeFile(join(fixture.root, '.pipeline', 'conduct-state.json'), JSON.stringify({ feature_desc: 'active' }));
    const completed = await commit(fixture, { 'src/replayed.ts': 'export const replayed = true;\n' }, 'feat: completed replay');
    const expectedTree = (await fixture.git(['rev-parse', `${completed}^{tree}`])).stdout.trim();
    await writeTypedPass(fixture.root, reviewed, 'original-review-run');
    const originalArtifact = await readFile(join(fixture.root, PRD_AUDIT_VERDICT_PATH), 'utf8');
    const artifactDigest = `sha256:${createHash('sha256').update(originalArtifact).digest('hex')}`;
    const replay = {
      preRebaseHead: reviewed,
      mergeBase: reviewed,
      target: reviewed,
      completedHead: completed,
      expectedTree,
    };
    await writeVerdict(fixture.root, 'prd_audit', {
      satisfied: true,
      checkedAt: 1,
      preservation: {
        gate: 'prd_audit',
        original: {
          artifactDigest,
          attemptId: 'original-review-run',
          runId: 'original-review-run',
          codeStamp: reviewed,
        },
        replay,
        relevantInputIdentities: [
          '.docs/plans/active.md@sha256:plan',
          '.docs/stories/active.md@sha256:story',
        ],
        operationId: 'rebase-operation',
      },
    });
    await writeVerdict(fixture.root, 'rebase', {
      satisfied: true,
      checkedAt: 1,
      rebaseOperation: {
        id: 'rebase-operation',
        status: 'applied',
        transition: { preserved: ['prd_audit'], invalidated: [], reverified: [] },
        replay,
      },
    });

    await expect(gateVerdictStillValid(
      { projectRoot: fixture.root, git: fixture.git },
      'prd_audit',
      reviewed,
    )).resolves.toBe('preserve');
    await expect(checkStepCompletion(
      fixture.root,
      'prd_audit',
      completionContext(fixture.root, fixture.git, 'original-review-run'),
    )).resolves.toMatchObject({ done: true });
    expect(await readFile(join(fixture.root, PRD_AUDIT_VERDICT_PATH), 'utf8')).toBe(originalArtifact);

    await commit(fixture, { '.docs/stories/active.md': '# Story\n\nChanged acceptance criterion.\n' }, 'docs: change replay input');
    await expect(gateVerdictStillValid(
      { projectRoot: fixture.root, git: fixture.git },
      'prd_audit',
      reviewed,
    )).resolves.toBe('rerun');
  });

  it('accepts an engine-explained rewrite but rejects unexplained and uncomputable stamps', async () => {
    const fixture = await repository();
    const reviewed = await commit(fixture, { 'src/feature.ts': 'export const feature = true;\n' }, 'feat: reviewed');
    await fixture.git(['commit', '--amend', '-q', '-m', 'feat: rewritten without engine translation']);
    const translated = (await fixture.git(['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(
      join(fixture.root, '.pipeline', 'rebase-rewrites.json'),
      JSON.stringify({ [reviewed]: translated }),
      'utf8',
    );

    await expect(gateVerdictStillValid(
      { projectRoot: fixture.root, git: fixture.git },
      'prd_audit',
      reviewed,
    )).resolves.toBe('preserve');
    await rm(join(fixture.root, '.pipeline', 'rebase-rewrites.json'));

    await expect(gateVerdictStillValid(
      { projectRoot: fixture.root, git: fixture.git },
      'prd_audit',
      reviewed,
    )).resolves.toBe('rerun');
    await expect(gateVerdictStillValid(
      {
        projectRoot: fixture.root,
        git: async () => ({ exitCode: 1, stdout: '', stderr: 'git unavailable' }),
      },
      'prd_audit',
      'uncomputable-stamp',
    )).resolves.toBe('rerun');
  });

  it('never preserves a typed PASS that currently has a blocking judgment', async () => {
    const fixture = await repository();
    const reviewed = await commit(fixture, { 'src/feature.ts': 'export const feature = true;\n' }, 'feat: reviewed');
    await persistPrdAuditVerdict(fixture.root, {
      complete: true,
      judgment: {
        version: 'v1',
        criterionJudgments: [{
          criterion: { storyId: '1', ordinal: 1 },
          criterionId: 'S1.1',
          grade: 'FIXABLE',
          evidence: 'A currently blocking implementation gap remains.',
          rationale: 'The judgment has not been remedied.',
          requirementAssociations: [],
          evidenceTaskIds: [],
          ownerTaskId: '27',
        }],
        noOwnerObservations: [],
      },
      diagnostics: [],
      recordedDispositions: [],
    }, { attemptId: 'prior-review-run', codeStamp: reviewed });

    await expect(checkStepCompletion(
      fixture.root,
      'prd_audit',
      completionContext(fixture.root, fixture.git),
    )).resolves.toMatchObject({
      done: false,
      routeClass: 'named-route',
      reason: expect.stringContaining('S1.1 (FIXABLE)'),
    });
  });
});
