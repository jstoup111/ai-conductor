// Covers: task:8
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LandGateError, landSpec, resolveIdeaFiles } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { computeReviewedDigest, renderPlanReviewArtifact } from '../../../src/engine/plan-review-artifact.js';

const execFile = promisify(execFileCb);
let repoPath: string;

const CITABLE_DECISION = '## Decision\n\n1. **Keep this decision citable.**\n';
const VALID_LEDGER = [
  '## Assumptions',
  '',
  '| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| A1 | The local evidence is sufficient. | verified | 100% | yes | The land gate could accept invalid ADRs. | — |',
].join('\n');

function approvedAdr(): string {
  return ['# ADR: valid record', '', '**Status:** Approved', '', CITABLE_DECISION, VALID_LEDGER, ''].join('\n');
}

async function git(args: string[], cwd = repoPath): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim();
}

function options() {
  return {
    ownerConfig: { spec_owner: 'test-owner' },
    renderDeps: {
      hasTool: async () => true,
      writeTemp: async () => '/tmp/land-spec-decision-record-shape.mmd',
      runMmdc: async () => ({ ok: true }),
    },
  };
}

async function seedWorktree(): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, 'shape landing');
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', 'shape-landing.md'), '# PRD\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', 'shape-landing.md'), [
    '# Stories', '', '**Status:** Accepted', '', '## Story 1: land', '### Acceptance Criteria',
    '#### Happy Path', '- Given valid artifacts, when land runs, then it commits.', '',
    '#### Negative Paths', '- Given invalid artifacts, when land runs, then it refuses.', '',
  ].join('\n'));
  await writeFile(join(worktreePath, '.docs', 'plans', 'shape-landing.md'), [
    '# Implementation Plan', '', '**Stories:** .docs/stories/shape-landing.md', '',
    '### Task 1: Land', '**Story:** Story 1', '', '**Done when:**',
    '- Given valid artifacts, when land runs, then it commits.',
    '- Given invalid artifacts, when land runs, then it refuses.', '',
    '## Coverage Check', '', '| Criterion | Task ids | Quote | Disposition |',
    '| --- | --- | --- | --- |',
    '| Story 1 happy: Given valid artifacts, when land runs, then it commits. | 1 | "Given valid artifacts, when land runs, then it commits." | diff-local |',
    '| Story 1 negative: Given invalid artifacts, when land runs, then it refuses. | 1 | "Given invalid artifacts, when land runs, then it refuses." | diff-local |', '',
  ].join('\n'));
  return worktreePath;
}

async function writeCleanPlanReview(worktreePath: string): Promise<void> {
  const planText = await readFile(join(worktreePath, '.docs', 'plans', 'shape-landing.md'), 'utf-8');
  const storiesText = await readFile(join(worktreePath, '.docs', 'stories', 'shape-landing.md'), 'utf-8');
  const decisionsDir = join(worktreePath, '.docs', 'decisions');
  const adrTexts = Object.fromEntries(await Promise.all((await readdir(decisionsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.startsWith('adr-'))
    .map(async (entry) => [entry.name.slice(0, -3), await readFile(join(decisionsDir, entry.name), 'utf-8')] as const)));
  const reviewedDigest = computeReviewedDigest({
    planText,
    storiesText,
    adrTexts,
    artifactTexts: { '.docs/coherence/shape-landing.md': '' },
    changedPaths: [...await resolveIdeaFiles(worktreePath, repoPath)],
  });
  await mkdir(join(worktreePath, '.docs', 'plan-review'), { recursive: true });
  await writeFile(join(worktreePath, '.docs', 'plan-review', 'shape-landing.md'), renderPlanReviewArtifact({
    round: 1,
    authoringHost: 'claude',
    reviewerProvider: 'codex',
    independence: 'cross-provider',
    findings: [],
    dispositions: [],
    reviewedDigest,
  }));
}

async function addDecision(worktreePath: string, name: string, content = '# record\n'): Promise<void> {
  await mkdir(join(worktreePath, '.docs', 'decisions'), { recursive: true });
  await writeFile(join(worktreePath, '.docs', 'decisions', name), content);
}

async function land(worktreePath: string) {
  await writeCleanPlanReview(worktreePath);
  return landSpec({ name: 'repo', canonicalPath: repoPath }, 'shape landing', worktreePath, undefined, options());
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-decision-record-shape-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => { await rm(repoPath, { recursive: true, force: true }); });

describe('landSpec decision record shape gate', () => {
  it('lands canonical ADR and architecture-review additions', async () => {
    const worktreePath = await seedWorktree();
    await addDecision(worktreePath, 'adr-2026-11-07-x.md', approvedAdr());
    await addDecision(worktreePath, 'architecture-review-2026-11-07-x.md');

    await expect(land(worktreePath)).resolves.toMatchObject({ slug: 'shape-landing' });
  });

  it.each(['styleguide.md', 'api-response-contract.md'])('lands recognized consumer record %s', async (name) => {
    const worktreePath = await seedWorktree();
    await addDecision(worktreePath, name);

    await expect(land(worktreePath)).resolves.toMatchObject({ slug: 'shape-landing' });
  });

  it('ignores modified, deleted, and untouched legacy off-shape records', async () => {
    await mkdir(join(repoPath, '.docs', 'decisions'), { recursive: true });
    await Promise.all([
      writeFile(join(repoPath, '.docs', 'decisions', 'review-legacy-fixture.md'), '# legacy\n'),
      writeFile(join(repoPath, '.docs', 'decisions', '000-legacy-fixture.md'), '# legacy\n'),
      writeFile(join(repoPath, '.docs', 'decisions', 'untouched-legacy-fixture.md'), '# legacy\n'),
    ]);
    await git(['add', '.docs/decisions']);
    await git(['commit', '-m', 'add legacy records']);
    const worktreePath = await seedWorktree();
    await writeFile(join(worktreePath, '.docs', 'decisions', 'review-legacy-fixture.md'), '# changed legacy\n');
    await unlink(join(worktreePath, '.docs', 'decisions', '000-legacy-fixture.md'));
    await git(['add', '-A', '.docs/decisions'], worktreePath);
    await git(['commit', '-m', 'modify legacy records'], worktreePath);

    await expect(land(worktreePath)).resolves.toMatchObject({ slug: 'shape-landing' });
  });

  it('refuses an added off-shape corpus file without committing', async () => {
    const worktreePath = await seedWorktree();
    await addDecision(worktreePath, 'notes.md');
    const head = await git(['rev-parse', 'HEAD'], worktreePath);

    const error = await land(worktreePath).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'decision-record-shape' });
    expect((error as Error).message).toMatch(/\.docs\/decisions\/notes\.md/);
    for (const shape of ['adr-', 'architecture-review-', 'review-', 'technical-assessment-', 'api-response-contract.md', 'styleguide.md']) {
      expect((error as Error).message).toContain(shape);
    }
    expect(await git(['rev-parse', 'HEAD'], worktreePath)).toBe(head);
  });

  it('treats a rename target as an added corpus file', async () => {
    await mkdir(join(repoPath, '.docs', 'decisions'), { recursive: true });
    await writeFile(join(repoPath, '.docs', 'decisions', 'adr-2026-11-01-old.md'), approvedAdr());
    await git(['add', '.docs/decisions']);
    await git(['commit', '-m', 'add ADR']);
    const worktreePath = await seedWorktree();
    await rename(
      join(worktreePath, '.docs', 'decisions', 'adr-2026-11-01-old.md'),
      join(worktreePath, '.docs', 'decisions', 'old-notes.md'),
    );
    await writeFile(join(worktreePath, '.docs', 'decisions', 'old-notes.md'), '# Notes\n');
    await git(['add', '-A', '.docs/decisions'], worktreePath);
    await git(['commit', '-m', 'rename ADR'], worktreePath);

    await expect(land(worktreePath)).rejects.toMatchObject({
      gate: 'decision-record-shape',
      message: expect.stringMatching(/old-notes\.md/),
    });
  });

  it('does not apply the shape rule outside the corpus directory', async () => {
    const worktreePath = await seedWorktree();
    await writeFile(join(worktreePath, '.docs', 'plans', 'notes.md'), '# notes\n');

    const error = await land(worktreePath).catch((reason: unknown) => reason);
    expect((error as { gate?: string }).gate).not.toBe('decision-record-shape');
  });

  it('reports existing ADR approval failure before the shape rule', async () => {
    const worktreePath = await seedWorktree();
    await addDecision(worktreePath, 'adr-2026-11-07-unapproved.md', '# ADR\n');
    await addDecision(worktreePath, 'notes.md');

    await expect(land(worktreePath)).rejects.toMatchObject({ gate: 'adr-not-approved' });
  });
});
