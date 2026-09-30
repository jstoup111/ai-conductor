// Covers: task:14 — FINISH preserves release metadata through its owned region.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../test-conductor.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';
import { parseReleaseDisposition } from '../../../src/engine/release-metadata.js';
import { extractRegionBytes } from '../../../src/engine/pr-body-regions.js';
import { writeRegionCapture } from '../../../src/engine/pr-body-region-store.js';
import type { ConductState, StepName } from '../../../src/types/index.js';
import type { GithubOperationRequest, GithubOperationRunner } from '../../../src/engine/github-operations.js';

const roots: string[] = [];
const prUrl = 'https://github.com/acme/conductor/pull/14';
const releaseBytes = '\nRelease-Disposition: no-note\n';
const staleBytes = '\nRelease-Disposition: note\nRelease-Category: Fixed\nRelease-Semver: patch\nRelease-Note: stale snapshot\n';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('self-host release-disposition region', () => {
  it('restores the current release region before ready, ignoring a stale Release-* snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'release-disposition-region-'));
    roots.push(root);
    await writeRegionCapture(root, prUrl, 'release-disposition', releaseBytes);
    // A previous engine version could leave this file behind. It is deliberately
    // not an input to FINISH: only the capture keyed to this PR is authoritative.
    await writeFile(join(root, '.pipeline', 'release-metadata-snapshot.json'), JSON.stringify({
      prUrl,
      block: staleBytes,
    }));

    let body = '## Summary\n\nAuthor-rewritten reader prose';
    const edits: GithubOperationRequest[] = [];
    const operations: GithubOperationRunner = { run: async (request) => {
      edits.push(request);
      body = (request.payload as { body: string }).body;
      return {};
    } };
    const releaseGate = vi.fn(async () => ({ ok: true as const }));
    const finishPublication = { advance: vi.fn(async ({ dispatchAuthoring }) => {
      await dispatchAuthoring({ kind: 'author_pr_prose', pullRequestUrl: prUrl, revisionGuidance: undefined });
      // This is the production ordering boundary: no ready transition may
      // observe prose before the authoring repair has restored every capture.
      expect(parseReleaseDisposition(body)).toEqual({ disposition: 'no-note' });
      return { kind: 'complete' } as const;
    }) };
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'list') {
        return { stdout: JSON.stringify([{ url: prUrl, state: 'OPEN' }]) };
      }
      return { stdout: JSON.stringify({ body }) };
    });
    const conductor = new Conductor({
      stateFilePath: join(root, 'conduct-state.json'),
      stepRunner: { run: vi.fn(async () => ({ success: true })) },
      finishPublication,
      events: new ConductorEventEmitter(),
      projectRoot: root,
      daemon: true,
      selfHost: true,
      baseBranch: 'main',
      config: {
        harness_self_host: { release_artifact_gate: true },
        steps: { 'release-disposition': { skill: '.agents/skills/release-disposition/SKILL.md' } },
        pr_template_region_owners: { 'release-disposition': releaseBytes },
      } as never,
      gh,
      runGh: gh,
      git: async () => ({ stdout: '' }),
      selfHostGuardrails: {
        versionGate: vi.fn(async () => ({ ok: true as const })),
        releaseGate,
      } as never,
      resolveShipDraftPublicationDependencies: async () => ({ operations }) as never,
    });
    (conductor as unknown as { shipDraftPrUrl: string }).shipDraftPrUrl = prUrl;
    const state = { feature_desc: 'release region', worktree_branch: 'feat/release-region' } as ConductState;

    await (conductor as unknown as { runFinishPublication(state: ConductState, options: never): Promise<unknown> })
      .runFinishPublication(state, {} as never);
    await expect((conductor as any).runSelfHostFinishGates('feat/release-region')).resolves.toEqual({ ok: true });

    expect(edits).toHaveLength(1);
    expect(extractRegionBytes(body, 'release-disposition')).toBe(releaseBytes);
    expect(body).not.toContain('stale snapshot');
    expect(releaseGate).toHaveBeenCalledWith(expect.objectContaining({
      releaseMetadata: { disposition: 'no-note' },
    }));
  });

  it('halts the self-host run when release-disposition completes with an empty region', async () => {
    const root = await mkdtemp(join(tmpdir(), 'empty-release-disposition-region-'));
    roots.push(root);
    await writeFile(join(root, 'conduct-state.json'), JSON.stringify({
      feature_desc: 'empty release region',
      worktree_branch: 'feat/empty-release-region',
      build_review: 'done',
    }));
    const emptyBody = [
      '## Summary',
      '<!-- ai-conductor:step release-disposition -->',
      '<!-- placeholder -->',
      '<!-- /ai-conductor:step -->',
    ].join('\n');
    const gh = vi.fn(async (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'list') {
        return { stdout: JSON.stringify([{ url: prUrl, state: 'OPEN' }]) };
      }
      return { stdout: JSON.stringify({ body: emptyBody }) };
    });
    const runner = { run: vi.fn(async () => ({ success: true })) };
    const conductor = new Conductor({
      stateFilePath: join(root, 'conduct-state.json'),
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: root,
      daemon: true,
      selfHost: true,
      fromStep: 'release-disposition' as StepName,
      baseBranch: 'main',
      config: {
        harness_self_host: { release_artifact_gate: true },
        steps: {
          'release-disposition': {
            after: 'build_review',
            skill: '.agents/skills/release-disposition/SKILL.md',
          },
        },
        pr_template_region_owners: { 'release-disposition': releaseBytes },
      } as never,
      gh,
      runGh: gh,
      git: async () => ({ stdout: '' }),
      log: () => {},
    });
    (conductor as unknown as { shipDraftPrUrl: string }).shipDraftPrUrl = prUrl;

    await conductor.run();

    expect(runner.run).toHaveBeenCalledOnce();
    await expect(readFile(join(root, '.pipeline', 'HALT'), 'utf8')).resolves.toContain(
      'project-owned region capture for release-disposition failed: region is empty',
    );
    await expect(readFile(join(root, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
  });
});
