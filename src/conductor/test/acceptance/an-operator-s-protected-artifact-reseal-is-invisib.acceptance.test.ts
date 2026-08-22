/**
 * RED acceptance coverage for jstoup111/ai-conductor#1502.
 *
 * Story-flow classification (writing-system-tests §3a):
 * - Stories 1-4 are single-operation reader, assembly, and prompt contracts;
 *   plan Tasks 1-9 own their unit coverage.
 * - Story 5 crosses the durable protected-artifact seal, real build_review
 *   input assembly, and grader-prompt rendering boundaries. It is covered here.
 *
 * Production path exercised:
 * - src/engine/build-review-inputs.ts: assembleBuildReviewInputs reads the
 *   feature-root seal while assembling the real Git diff and approved plan.
 * - src/engine/build-review-prompt.ts: buildGraderPrompt renders those inputs.
 *
 * The LLM grader is a third-party boundary and is intentionally not invoked.
 * The accepted story pins the deterministic terminal observation as the prompt
 * string, which is where #1502 loses the operator's reseal today.
 *
 * Verify-claims: every asserted field, heading, and with/without-reseal outcome
 * is stated by the accepted stories and approved ADR. No unconfirmed
 * load-bearing assumption is encoded here.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { assembleBuildReviewInputs } from '../../src/engine/build-review-inputs.js';
import { buildGraderPrompt } from '../../src/engine/build-review-prompt.js';
import { deriveBuildReviewRubricProjections } from '../../src/engine/build-review-projections.js';
import { makeGitRunner } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCallback);
const STORY_PATH = '.docs/stories/resealed-story.md';
const UNUSED_PATH = '.docs/plans/resealed-but-unchanged.md';
const PLAN_PATH = '.docs/plans/feature.md';
const SEAL_PATH = '.pipeline/protected-artifact-seal.json';
const SECTION_HEADING = '## Operator-authorized protected-artifact reseals';
const NEXT_HEADING = '## Engine-derived removal evidence';
const scratchRoots: string[] = [];

interface ResealRecord {
  fromCommit: string;
  toCommit: string;
  trigger: string;
  paths: string[];
  reason?: string;
}

interface Fixture {
  root: string;
  baseline: string;
  head: string;
  planPath: string;
}

afterEach(async () => {
  await Promise.all(scratchRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }),
  ));
});

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: root });
  return stdout.trim();
}

async function writeRepoFile(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'operator-reseal-build-review-'));
  scratchRoots.push(root);

  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'acceptance@example.test');
  await git(root, 'config', 'user.name', 'Acceptance Test');
  await git(root, 'config', 'commit.gpgsign', 'false');
  await writeRepoFile(root, '.gitignore', '.pipeline/\n');
  await writeRepoFile(root, STORY_PATH, 'approved story\n');
  await writeRepoFile(root, UNUSED_PATH, 'approved but unchanged plan\n');
  await writeRepoFile(root, PLAN_PATH, '# Approved plan\n\nAmend the sealed story.\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-q', '-m', 'decide: approve artifacts');
  const baseline = await git(root, 'rev-parse', 'HEAD');

  // A local-path origin gives resolveFreshBase its real remote/tracking-ref
  // path without any network or third-party boundary.
  await git(root, 'remote', 'add', 'origin', root);
  await git(root, 'update-ref', 'refs/remotes/origin/main', 'refs/heads/main');
  await git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');

  await git(root, 'checkout', '-q', '-b', 'feat/operator-reseal-evidence');
  await writeRepoFile(root, STORY_PATH, 'operator-approved amended story\n');
  await git(root, 'add', STORY_PATH);
  await git(root, 'commit', '-q', '-m', 'docs: amend sealed story');
  const head = await git(root, 'rev-parse', 'HEAD');

  return { root, baseline, head, planPath: join(root, PLAN_PATH) };
}

async function writeSeal(fixture: Fixture, rebaselines: ResealRecord[]): Promise<void> {
  await writeRepoFile(fixture.root, SEAL_PATH, `${JSON.stringify({
    version: 2,
    baselineCommit: fixture.head,
    protectedArtifacts: [],
    rebaselines,
  }, null, 2)}\n`);
}

function operatorReseals(inputs: unknown): unknown {
  return (inputs as Record<string, unknown>).operatorReseals;
}

function currentProof(head: string) {
  return {
    inspectTestSuite: async () => ({
      status: 'CURRENT', evidence: { provenanceHeadSha: head, outcome: 'PASS' },
    } as never),
  };
}

function evidenceSection(prompt: string): string {
  const start = prompt.indexOf(SECTION_HEADING);
  const end = prompt.indexOf(NEXT_HEADING, start);
  expect(start, 'operator-reseal evidence heading').toBeGreaterThanOrEqual(0);
  expect(end, 'heading after operator-reseal evidence').toBeGreaterThan(start);
  return prompt.slice(start, end);
}

function withoutEvidenceSection(prompt: string): string {
  return prompt.replace(evidenceSection(prompt), `${SECTION_HEADING}\n<evidence>\n\n`);
}

describe('acceptance: operator reseal reaches build_review Scope evidence (#1502 Story 5)', () => {
  it('distinguishes an operator-resealed amendment from the identical diff without a reseal', async () => {
    const fixture = await makeFixture();
    const rationale = 'Operator approved the corrected acceptance boundary verbatim.';
    const operatorReseal: ResealRecord = {
      trigger: 'operator-reseal',
      paths: [STORY_PATH],
      reason: rationale,
      fromCommit: fixture.baseline,
      toCommit: fixture.head,
    };
    const subsequentRotation: ResealRecord = {
      trigger: 'proactive-rebase',
      paths: [STORY_PATH],
      fromCommit: fixture.head,
      toCommit: 'post-rebase-head',
    };

    await writeSeal(fixture, [operatorReseal, subsequentRotation]);
    const withResealInputs = await assembleBuildReviewInputs(
      makeGitRunner(fixture.root),
      fixture.planPath,
      currentProof(fixture.head),
    );
    const withResealPrompt = buildGraderPrompt(withResealInputs);

    expect(operatorReseals(withResealInputs)).toEqual([{
      paths: [STORY_PATH],
      reason: rationale,
      fromCommit: fixture.baseline,
      toCommit: fixture.head,
    }]);
    expect(withResealInputs.sourceSnapshot.operatorReseals).toEqual(operatorReseals(withResealInputs));
    const projections = deriveBuildReviewRubricProjections({
      lapId: 'lap-operator-reseal',
      inputs: withResealInputs,
      tautology: { changedTestSelectors: [], revertedProductionManifest: [], preflight: { classification: 'red' } },
    } as never);
    expect(projections.scope.operatorReseals).toEqual(operatorReseals(withResealInputs));
    for (const projection of [projections.tautology, projections.rootCause, projections.completeness]) {
      expect(projection).not.toHaveProperty('operatorReseals');
    }
    const populatedSection = evidenceSection(withResealPrompt);
    expect(populatedSection).toContain(STORY_PATH);
    expect(populatedSection).toContain(rationale);
    expect(populatedSection).toContain(fixture.baseline);
    expect(populatedSection).toContain(fixture.head);
    expect(populatedSection).not.toContain('proactive-rebase');

    await writeSeal(fixture, [subsequentRotation]);
    const withoutResealInputs = await assembleBuildReviewInputs(
      makeGitRunner(fixture.root),
      fixture.planPath,
      currentProof(fixture.head),
    );
    const withoutResealPrompt = buildGraderPrompt(withoutResealInputs);

    // Assemble both source snapshots through production, rather than holding
    // the shared digest fixed in a fixture. A reseal is Scope-only cache input:
    // it must not perturb the three closed sibling projections.
    const withoutResealProjections = deriveBuildReviewRubricProjections({
      lapId: 'lap-operator-reseal',
      inputs: withoutResealInputs,
      tautology: { changedTestSelectors: [], revertedProductionManifest: [], preflight: { classification: 'red' } },
    } as never);

    expect(operatorReseals(withoutResealInputs)).toEqual([]);
    expect(evidenceSection(withoutResealPrompt)).toContain('(none)');
    expect(withoutEvidenceSection(withResealPrompt)).toBe(
      withoutEvidenceSection(withoutResealPrompt),
    );
    expect(projections.scope.digest).not.toBe(withoutResealProjections.scope.digest);
    for (const rubric of ['tautology', 'rootCause', 'completeness'] as const) {
      expect(projections[rubric].digest).toBe(withoutResealProjections[rubric].digest);
      expect(projections[rubric].snapshotDigest).toBe(withoutResealProjections[rubric].snapshotDigest);
    }
  });

  it('renders an unused reseal without labeling the amended diff path', async () => {
    const fixture = await makeFixture();
    await writeSeal(fixture, [{
      trigger: 'operator-reseal',
      paths: [UNUSED_PATH],
      reason: 'This separate protected path was operator-approved.',
      fromCommit: fixture.baseline,
      toCommit: fixture.head,
    }]);

    const inputs = await assembleBuildReviewInputs(
      makeGitRunner(fixture.root),
      fixture.planPath,
      currentProof(fixture.head),
    );
    const section = evidenceSection(buildGraderPrompt(inputs));

    expect(section).toContain(UNUSED_PATH);
    expect(section).not.toContain(STORY_PATH);
    expect(inputs.diff).toContain(STORY_PATH);
  });
});
