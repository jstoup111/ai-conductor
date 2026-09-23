// Covers: task:13
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conductor } from '../../test-conductor.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { writeSelfHostHalt } from '../../../src/engine/self-host/gate-halt.js';
import {
  resolveReleaseMetadataFlow,
  supersedesReleaseMetadataSnapshot,
} from '../../../src/engine/self-host/release-metadata-flow.js';
import type { GhRunner } from '../../../src/engine/tracker-client.js';

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'release-metadata-flow-wiring-'));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('self-host release metadata flow wiring', () => {
  function conductor(
    projectRoot: string,
    steps: Record<string, unknown>,
    releaseGate = vi.fn(async () => ({ ok: true as const })),
    runGh: GhRunner = vi.fn(async () => ({ stdout: JSON.stringify({ body: 'Release-Disposition: no-note' }) })),
  ) {
    return {
      conductor: new Conductor({
        stateFilePath: join(projectRoot, '.pipeline', 'state.json'),
        stepRunner: { run: async () => ({ success: true }) },
        events: new ConductorEventEmitter(),
        projectRoot,
        daemon: true,
        selfHost: true,
        baseBranch: 'main',
        config: {
          harness_self_host: { release_artifact_gate: true },
          steps,
        } as never,
        selfHostGuardrails: {
          versionGate: vi.fn(async () => ({ ok: true as const })),
          releaseGate,
        } as never,
        gh: vi.fn(async () => ({ stdout: JSON.stringify({ state: 'OPEN' }) })),
        runGh,
      }),
      releaseGate,
      runGh,
    };
  }

  it('passes retained draft metadata to the release gate when the declared step is active', async () => {
    const projectRoot = await root();
    const { conductor: subject, releaseGate } = conductor(
      projectRoot,
      { 'release-disposition': { skill: '.agents/skills/renamed/SKILL.md' } },
      undefined,
      vi.fn(async (args: string[]) => args[1] === 'list'
        ? { stdout: JSON.stringify([{ url: 'https://github.com/acme/conductor/pull/13', state: 'OPEN' }]) }
        : { stdout: JSON.stringify({ body: 'Release-Disposition: no-note' }) }),
    );

    await expect((subject as any).runSelfHostFinishGates('feat/task-13')).resolves.toEqual({ ok: true });
    expect(releaseGate).toHaveBeenCalledWith(expect.objectContaining({
      releaseMetadata: expect.objectContaining({ disposition: 'no-note' }),
    }));
  });

  it('halts needs-human when the enabled self-host gate lacks release-disposition', async () => {
    const projectRoot = await root();
    const { conductor: subject, releaseGate } = conductor(projectRoot, {});

    await expect((subject as any).runSelfHostFinishGates()).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('release-disposition'),
    });
    await expect(readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    expect(releaseGate).not.toHaveBeenCalled();
  });

  it.each([
    ['outside a self-build', false, true],
    ['when the release gate is disabled', true, false],
  ])('does not activate %s', (_name, isSelfBuild, releaseArtifactGateEnabled) => {
    expect(resolveReleaseMetadataFlow({
      isSelfBuild,
      releaseArtifactGateEnabled,
      steps: { 'release-disposition': { skill: '.agents/skills/renamed/SKILL.md' } },
    })).toBe('inactive');
  });

  it('does not snapshot or restore while the flow is inactive', async () => {
    const projectRoot = await root();
    const runGh = vi.fn(async () => ({ stdout: '' }));
    const { conductor: subject } = conductor(projectRoot, {}, undefined, runGh);
    (subject as any).selfHost = false;

    await (subject as any).snapshotFinishReleaseMetadata('feat/task-13');
    await (subject as any).restoreFinishReleaseMetadata('https://github.com/acme/conductor/pull/13');

    expect(runGh).not.toHaveBeenCalled();
  });

  // Daemon dispatch never passes `featureDesc` to the Conductor constructor;
  // the durable conduct state carries it. Without the fallback every daemon
  // finish on a self-host feature failed its post-finish restore (PR #2667).
  it('composes the post-finish restore guard from conduct state when constructor fields are absent', async () => {
    const projectRoot = await root();
    const prUrl = 'https://github.com/acme/conductor/pull/13';
    const body = 'Release-Disposition: no-note';
    const runGh = vi.fn(async () => ({ stdout: JSON.stringify({ body }) }));
    const { conductor: subject } = conductor(
      projectRoot,
      { 'release-disposition': { skill: '.agents/skills/renamed/SKILL.md' } },
      undefined,
      runGh,
    );
    const resolvePublication = vi.fn(async () => undefined);
    (subject as any).resolveShipDraftPublicationDependencies = resolvePublication;
    (subject as any).releaseMetadataSnapshot = { prUrl, block: body };
    (subject as any).gh = runGh;

    await (subject as any).restoreFinishReleaseMetadata(prUrl, {
      worktree_branch: 'feat/daemon-task-13',
      feature_desc: 'task-13',
    });

    expect(resolvePublication).toHaveBeenCalledWith(expect.objectContaining({
      branch: 'feat/daemon-task-13',
      featureDesc: 'task-13',
      prUrl,
    }));
  });

  it.each([
    ['outside a self-build', false, true],
    ['when the release gate is disabled', true, false],
  ])('does not clear a snapshot for release-disposition %s', (_name, isSelfBuild, releaseArtifactGateEnabled) => {
    const flow = resolveReleaseMetadataFlow({
      isSelfBuild,
      releaseArtifactGateEnabled,
      steps: { 'release-disposition': { skill: '.agents/skills/renamed/SKILL.md' } },
    });

    expect(supersedesReleaseMetadataSnapshot(flow, 'release-disposition')).toBe(false);
  });

  it('writes the missing-step halt as needs-human through the central halt seam', async () => {
    const projectRoot = await root();
    await writeSelfHostHalt(projectRoot, "required 'release-disposition' step is missing");

    await expect(Promise.all([
      readFile(join(projectRoot, '.pipeline', 'HALT'), 'utf8'),
      readFile(join(projectRoot, '.pipeline', 'HALT.class'), 'utf8'),
    ])).resolves.toEqual([
      expect.stringContaining('release-disposition'),
      'needs-human',
    ]);
  });

  it('keeps the conductor free of a release-disposition skill-directory activation literal', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../../../src/engine/conductor.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toContain('.agents/skills/release-disposition/SKILL.md');
  });
});
