// Covers: task:55
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../src/engine/child-context.js';
import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { evaluateProtectedArtifactSealRotationInRepository, type ProtectedArtifactSeal } from '../../src/engine/protected-artifact-seal.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';
import { createRouteRecord } from '../../src/engine/routing/route-record-store.js';
import { parseRoundId } from '../../src/engine/routing/route-types.js';

const roots: string[] = [];
const planPath = '.docs/plans/demo.md';
const slug = 'demo';
const child = parseChildId(2)!;
const roundId = parseRoundId('r1')!;
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function mustSucceed(git: GitRunner, args: string[]): Promise<string> {
  const result = await git(args);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function seal(baselineCommit: string): ProtectedArtifactSeal {
  return {
    version: 2,
    baselineCommit,
    protectedArtifacts: [{
      path: planPath,
      fingerprint: `sha256:${createHash('sha256').update('approved plan\n').digest('hex')}`,
    }],
    rebaselines: [],
  };
}

async function routedFixture(blockId = 'rem-prd-audit-T2') {
  const repo = await mkdtemp(join(tmpdir(), 'protected-artifact-seal-routing-'));
  roots.push(repo);
  const git = makeGitRunner(repo);
  await mustSucceed(git, ['init', '-q', '-b', 'main']);
  await mustSucceed(git, ['config', 'user.email', 'seal-routing@example.test']);
  await mustSucceed(git, ['config', 'user.name', 'Seal routing']);
  await mkdir(join(repo, '.docs', 'plans'), { recursive: true });
  await mkdir(join(repo, '.ai-conductor'), { recursive: true });
  await writeFile(join(repo, planPath), 'approved plan\n');
  await writeFile(join(repo, '.ai-conductor', 'config.yml'), [
    'stacked_prs:', '  enabled: true', '  max_slices: 3', '  route_whole_feature_fixes: true', '',
  ].join('\n'));
  await mustSucceed(git, ['add', '.']);
  await mustSucceed(git, ['commit', '-qm', 'approved plan']);
  const initial = await mustSucceed(git, ['rev-parse', 'HEAD']);

  await mustSucceed(git, ['checkout', '-qb', 'sealed-history', initial]);
  await mustSucceed(git, ['commit', '--allow-empty', '-qm', 'sealed baseline lineage']);
  const baselineCommit = await mustSucceed(git, ['rev-parse', 'HEAD']);

  await mustSucceed(git, ['checkout', '-qb', 'feat/c1/demo', initial]);
  await mustSucceed(git, ['commit', '--allow-empty', '-qm', 'closed child one']);
  await mustSucceed(git, ['update-ref', `refs/conductor/${slug}/closed/c1`, 'HEAD']);
  await mustSucceed(git, ['checkout', '-qb', 'feat/c2/demo']);
  await writeFile(join(repo, planPath), `approved plan\n### Task ${blockId}: Routed repair\n`);
  await mustSucceed(git, ['add', planPath]);
  await mustSucceed(git, ['commit', '-qm', 'append routed remediation']);
  await writeCoverageBindingEnvelope(repo, {
    version: 1, slug, runId: 'seal-routing', status: 'done', entries: [],
    sliceMembership: { taskSlices: { T1: 1, T2: 2, T3: 3 }, titles: ['one', 'two', 'leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  const created = await createRouteRecord(repo, slug, {
    roundId,
    kind: 'audit',
    items: [{ findingId: 'finding', kind: 'audit', owner: child, host: child, reason: 'task-slice', fallback: [] }],
    allocation: { [child]: { remTaskIds: ['rem-prd-audit-T2'], blockBodies: [`### Task rem-prd-audit-T2: Routed repair\n**Child:** 2\n**Round:** r1\n`] } },
  });
  if (created.kind !== 'created') throw new Error(`route record: ${created.kind}`);
  return { repo, git, baselineCommit };
}

describe('protected artifact seal rotation for routed remediation (real local Git)', () => {
  it('accepts frozen-allocation ids after a recreated routed worktree loses its appended-id cache', async () => {
    const subject = await routedFixture();

    await expect(evaluateProtectedArtifactSealRotationInRepository({
      projectRoot: subject.repo,
      seal: seal(subject.baselineCommit),
      headCommit: await mustSucceed(subject.git, ['rev-parse', 'HEAD']),
      baseTipRef: 'main',
    })).resolves.toEqual({ permitted: true, paths: [planPath], includedEngineAppendedPaths: [planPath] });
  });

  it('refuses an id absent from both the recreated cache and every frozen allocation', async () => {
    const subject = await routedFixture('rem-prd-audit-unvouched');

    await expect(evaluateProtectedArtifactSealRotationInRepository({
      projectRoot: subject.repo,
      seal: seal(subject.baselineCommit),
      headCommit: await mustSucceed(subject.git, ['rev-parse', 'HEAD']),
      baseTipRef: 'main',
    })).resolves.toMatchObject({ permitted: false, condition: 'engine-append-unvouched', path: planPath });
  });

  it('does not inspect routing refs for an N=1 feature', async () => {
    const subject = await routedFixture();
    await mustSucceed(subject.git, ['checkout', '-qb', 'feat/daemon-single', 'main']);
    const calls: string[][] = [];
    const recording: GitRunner = async (args, options) => {
      calls.push(args);
      return subject.git(args, options);
    };

    await evaluateProtectedArtifactSealRotationInRepository({
      projectRoot: subject.repo,
      seal: seal(subject.baselineCommit),
      headCommit: await mustSucceed(subject.git, ['rev-parse', 'HEAD']),
      baseTipRef: 'sealed-history',
      git: recording,
    });

    expect(calls.flat()).not.toContainEqual(expect.stringMatching(/routes|repairing|revalidate/));
  });
});
