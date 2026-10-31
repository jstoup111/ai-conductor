// Covers: task:12
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { remediationGapTargetsAnotherFeatureSealedArtifact } from '../../src/engine/remediation-hints.js';
import { persistFixtureTestRemediationPlan } from './remediation-plan-fixtures.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { FeatureOwnership } from '../../src/engine/feature-ownership.js';
import type { DocsPath } from '../../src/engine/feature-manifest.js';
import type { RemediationGap } from '../../src/engine/artifacts.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

const manifestOwnership: FeatureOwnership = {
  kind: 'manifest',
  manifestPath: '.docs/f/manifest.json' as DocsPath,
  ownedPaths: ['.docs/plans/foreign-plan.md' as DocsPath],
  protectedPaths: ['.docs/plans/foreign-plan.md' as DocsPath],
};

function gap(title: string): RemediationGap {
  return {
    id: 'ownership-gap',
    disposition: 'build',
    category: null,
    rationale: 'The remediation requires a documentation edit.',
    tasks: [{ id: 'repair-doc', title }],
  };
}

async function git(root: string, args: string[]): Promise<void> {
  await execFile('git', args, { cwd: root });
}

async function write(root: string, path: string, contents: string): Promise<void> {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), contents, 'utf8');
}

async function manifestFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'remediation-ownership-'));
  roots.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'remediation-ownership@example.test']);
  await git(root, ['config', 'user.name', 'Remediation ownership']);
  await write(root, '.docs/plans/f.md', '# Implementation plan\n');
  await write(root, '.docs/f/manifest.json', `${JSON.stringify({
    schemaVersion: 1,
    slug: 'f',
    artifacts: [{ kind: 'plan', path: '.docs/plans/f.md' }],
  }, null, 2)}\n`);
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await write(
    root,
    '.pipeline/engine-state.json',
    JSON.stringify({ activePlanPath: join(root, '.docs/plans/f.md') }),
  );
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'manifest-backed feature']);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('manifest-backed remediation target ownership', () => {
  it('keeps a manifest-listed plan target even when its stem is foreign', () => {
    const listedTarget = gap('Amend .docs/plans/foreign-plan.md with the corrected assertion.');
    expect(remediationGapTargetsAnotherFeatureSealedArtifact(
      listedTarget,
      'f',
      manifestOwnership,
    )).toBeUndefined();
    expect(remediationGapTargetsAnotherFeatureSealedArtifact(
      listedTarget,
      'f',
    )).toMatchObject({ artifact: '.docs/plans/foreign-plan.md' });
  });

  it('redirects an unlisted same-feature story target as foreign', () => {
    expect(remediationGapTargetsAnotherFeatureSealedArtifact(
      gap('Amend .docs/stories/f-old.md with the corrected assertion.'),
      'f',
      manifestOwnership,
    )).toMatchObject({ artifact: '.docs/stories/f-old.md' });
  });

  it('does not use legacy stem matching for an unlisted dated same-feature story', () => {
    expect(remediationGapTargetsAnotherFeatureSealedArtifact(
      gap('Amend .docs/stories/2026-10-28-f.md with the corrected assertion.'),
      'f',
      manifestOwnership,
    )).toMatchObject({ artifact: '.docs/stories/2026-10-28-f.md' });
  });

  it('keeps a legacy feature’s same-stem story target with its owning feature', () => {
    expect(remediationGapTargetsAnotherFeatureSealedArtifact(
      gap('Amend .docs/stories/f.md with the corrected assertion.'),
      'f',
      { kind: 'legacy' },
    )).toBeUndefined();
  });

  it('supplies manifest ownership to the remediation redirect call site', async () => {
    const projectRoot = await manifestFixture();
    const events = new ConductorEventEmitter();
    const redirects: unknown[] = [];
    events.on('remediation_sealed_artifact_redirect', (event) => {
      redirects.push(event);
    });
    const runner: StepRunner = {
      run: async (_step, _state, options) => {
        await persistFixtureTestRemediationPlan(projectRoot, options, [gap(
          'Amend .docs/stories/2026-10-28-f.md with the corrected assertion.',
        )]);
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'),
      stepRunner: runner,
      events,
      projectRoot,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidenceFile: string },
      ) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      { session_started_at: Date.now() - 1_000, feature_desc: 'f' } as ConductState,
      ALL_STEPS,
      'prd audit blocked',
      { source: 'finish-verification', evidenceFile: '.pipeline/finish-verification.md' },
    );

    expect(outcome).toMatchObject({ kind: 'halt' });
    expect(redirects).toEqual([expect.objectContaining({
      artifact: '.docs/stories/2026-10-28-f.md',
    })]);
  });
});
