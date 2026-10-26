// Covers: task:12

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { buildPrdAuditProjection } from '../../src/engine/prd-audit-projection.js';
import { resolveFeatureRemoteMutation } from '../../src/engine/remote-git-operations.js';
import { resolveRunSourceRef } from '../../src/engine/run-provenance.js';
import { createShipDraftPublicationDependencies } from '../../src/engine/ship-draft-pr.js';
import { readMutationProvenance } from '../../src/engine/owner-gate/mutation-provenance.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function manifest(slug: string, artifacts: readonly { kind: string; path: string }[]): string {
  return JSON.stringify({ schemaVersion: 1, slug, artifacts });
}

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'manifest-routing-ship-'));
  roots.push(value);
  return value;
}

async function write(rootPath: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(rootPath, path)), { recursive: true });
  await writeFile(join(rootPath, path), content);
}

async function commitFixture(rootPath: string, branch = 'main'): Promise<void> {
  await execFile('git', ['init', '--initial-branch=main'], { cwd: rootPath });
  await execFile('git', ['config', 'user.email', 'fixture@example.test'], { cwd: rootPath });
  await execFile('git', ['config', 'user.name', 'Manifest fixture'], { cwd: rootPath });
  await execFile('git', ['add', '.'], { cwd: rootPath });
  await execFile('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: rootPath });
  if (branch !== 'main') await execFile('git', ['checkout', '--quiet', '-b', branch], { cwd: rootPath });
}

describe('SHIP manifest routing', () => {
  it('keeps the legacy intake lookup when no manifest or a legacy-path manifest exists, and treats omission as absent', async () => {
    const projectRoot = await root();
    await write(projectRoot, '.docs/plans/f.md', '# plan\n');
    await write(projectRoot, '.docs/intake/f.md', 'Source-Ref: org/repo#12\n');

    const noManifest = await resolveRunSourceRef(projectRoot, 'f');
    await write(projectRoot, '.docs/f/manifest.json', manifest('f', [
      { kind: 'plan', path: '.docs/plans/f.md' },
      { kind: 'intake', path: '.docs/intake/f.md' },
    ]));
    const legacyManifest = await resolveRunSourceRef(projectRoot, 'f');
    await write(projectRoot, '.docs/f/manifest.json', manifest('f', [{ kind: 'plan', path: '.docs/plans/f.md' }]));
    const omitted = await resolveRunSourceRef(projectRoot, 'f');

    expect({ noManifest, legacyManifest, omitted }).toEqual({
      noManifest: 'org/repo#12',
      legacyManifest: 'org/repo#12',
      omitted: undefined,
    });
  });

  it('uses a relocated coherence artifact for the PRD projection and treats an omitted coherence artifact as absent', async () => {
    const projectRoot = await root();
    await write(projectRoot, '.pipeline/engine-state.json', JSON.stringify({ feature_desc: 'f', activePlanPath: '.docs/plans/f.md' }));
    await write(projectRoot, '.docs/plans/f.md', `# Plan\n\n**Stories:** .docs/stories/f.md\n\n## Technical Approach\n\nKeep the projection available.\n\n### Task 1: projection\n\n**Story:** Story 1\n\n**Done when:**\n- projection remains available\n`);
    await write(projectRoot, '.docs/stories/f.md', `## Story 1: projection\n\n### Happy Path\n- Given an artifact, when it is routed, then the projection reads it.\n\n### Negative Paths\n- Given an omitted artifact, when it is routed, then the projection reports it absent.\n`);
    await write(projectRoot, '.docs/f/coherence.md', `| Row Class | Id | Cited Ids | Verdict | Quote |\n| --- | --- | --- | --- | --- |\n| story | 1 | 1 | covered | routed |\n`);
    await write(projectRoot, '.docs/f/manifest.json', manifest('f', [
      { kind: 'plan', path: '.docs/plans/f.md' },
      { kind: 'stories', path: '.docs/stories/f.md' },
      { kind: 'coherence', path: '.docs/f/coherence.md' },
    ]));
    await write(projectRoot, 'source.ts', 'export const version = 1;\n');
    await commitFixture(projectRoot, 'feature/f');
    await write(projectRoot, 'source.ts', 'export const version = 2;\n');

    const relocated = await buildPrdAuditProjection(projectRoot);
    await write(projectRoot, '.docs/f/manifest.json', manifest('f', [
      { kind: 'plan', path: '.docs/plans/f.md' },
      { kind: 'stories', path: '.docs/stories/f.md' },
    ]));
    const omitted = await buildPrdAuditProjection(projectRoot);

    expect(relocated).toMatchObject({ ok: true, projection: { coherence: [expect.objectContaining({ id: '1' })] } });
    expect(omitted).toMatchObject({ ok: true, projection: { coherence: { kind: 'absent' } } });
  });

  it('pins committed intake manifest resolution to the feature ref instead of mutable worktree files', async () => {
    const projectRoot = await root();
    await write(projectRoot, '.docs/f/manifest.json', manifest('f', [
      { kind: 'plan', path: '.docs/plans/f.md' },
      { kind: 'intake', path: '.docs/f/intake.md' },
    ]));
    await write(projectRoot, '.docs/plans/f.md', '# plan\n');
    await write(projectRoot, '.docs/f/intake.md', 'Owner: agent\nSource-Ref: org/repo#12\n');
    await write(projectRoot, '.docs/intake/f.md', 'Owner: legacy\nSource-Ref: org/repo#99\n');
    await commitFixture(projectRoot, 'feature/f');

    const git = async (args: string[]) => {
      if (args.join(' ') === 'config --get remote.origin.url') return { stdout: 'https://github.com/org/repo.git\n' };
      throw new Error(`unexpected injected git read: ${args.join(' ')}`);
    };
    const dependencies = await createShipDraftPublicationDependencies({
      cwd: projectRoot,
      branch: 'feature/f',
      baseBranch: 'main',
      featureDesc: 'f',
      git,
      gh: async () => ({ stdout: '' }),
    });
    await write(projectRoot, '.docs/f/manifest.json', manifest('f', [{ kind: 'intake', path: '.docs/intake/f.md' }]));
    await write(projectRoot, '.docs/intake/f.md', 'Owner: mutable\nSource-Ref: org/repo#100\n');

    const records = await dependencies!.remoteMutation.dependencies.provenanceDiscovery.readCommittedRecords({
      repository: 'org/repo',
      ref: 'feature/f',
    });
    expect({ marker: dependencies!.remoteMutation.provenance.featureMarker, records }).toEqual({
      marker: '.docs/f/intake.md',
      records: [{ path: '.docs/f/intake.md', content: 'Owner: agent\nSource-Ref: org/repo#12\n' }],
    });
  });

  it('preserves legacy committed-intake read failures for both remote mutation contexts', async () => {
    const projectRoot = await root();
    await write(projectRoot, '.docs/intake/f.md', 'Owner: agent\nSource-Ref: org/repo#12\n');
    await commitFixture(projectRoot, 'feature/f');
    const cases = [
      { error: new Error('git show failed'), reason: 'provenance-unreadable' },
      { error: Object.assign(new Error('git show timed out'), { code: 'ETIMEDOUT' }), reason: 'provenance-timeout' },
    ] as const;

    const results = await Promise.all(cases.flatMap(async ({ error, reason }) => {
      const git = async (args: string[]) => {
        if (args.join(' ') === 'remote get-url --push origin') return { stdout: 'https://github.com/org/repo.git\n' };
        if (args.join(' ') === 'symbolic-ref refs/remotes/origin/HEAD') return { stdout: 'refs/remotes/origin/main\n' };
        if (args[0] === 'config') return { stdout: 'https://github.com/org/repo.git\n' };
        if (args[0] === 'show') throw error;
        throw new Error(`unexpected injected git read: ${args.join(' ')}`);
      };
      const remote = await resolveFeatureRemoteMutation({
        cwd: projectRoot, slug: 'f', branch: 'feature/f', git, gh: async () => ({ stdout: '' }),
      });
      const ship = await createShipDraftPublicationDependencies({
        cwd: projectRoot, branch: 'feature/f', baseBranch: 'main', featureDesc: 'f', git, gh: async () => ({ stdout: '' }),
      });
      if (remote === undefined || ship === undefined) throw new Error('expected mutation contexts');

      return [
        await readMutationProvenance(remote.provenance, remote.dependencies.provenanceDiscovery),
        await readMutationProvenance(ship.remoteMutation.provenance, ship.remoteMutation.dependencies.provenanceDiscovery),
      ].map((result) => ({ reason, result }));
    }));

    expect(results.flat()).toEqual([
      { reason: 'provenance-unreadable', result: { kind: 'refused', reason: 'provenance-unreadable' } },
      { reason: 'provenance-unreadable', result: { kind: 'refused', reason: 'provenance-unreadable' } },
      { reason: 'provenance-timeout', result: { kind: 'refused', reason: 'provenance-timeout' } },
      { reason: 'provenance-timeout', result: { kind: 'refused', reason: 'provenance-timeout' } },
    ]);
  });
});
