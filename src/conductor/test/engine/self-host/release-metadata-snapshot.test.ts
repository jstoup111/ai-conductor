// Covers: task:12, task:18
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { GithubOperationRunner } from '../../../src/engine/github-operations.js';
import { auditShippedGithubInvocationBoundary } from '../../../src/engine/github-invocation-audit.js';
import {
  restoreReleaseMetadata,
  snapshotReleaseMetadata,
} from '../../../src/engine/self-host/release-metadata-flow.js';
import type { GhRunner } from '../../../src/engine/tracker-client.js';

const prUrl = 'https://github.com/acme/conductor/pull/12';
const releaseBlock = [
  'Release-Disposition: note',
  'Release-Category: Fixed',
  'Release-Semver: patch',
  'Release-Note: Preserve this exact block.',
].join('\n');
const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'release-metadata-snapshot-'));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('self-host release metadata snapshots', () => {
  it('restores the captured release block byte-for-byte through the guarded GitHub operation', async () => {
    const projectRoot = await root();
    let body = `## Summary\n\nBefore finish.\n\n${releaseBlock}\n`;
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ body }) };
      throw new Error(`unexpected GitHub arguments: ${args.join(' ')}`);
    };
    const operations: GithubOperationRunner = {
      run: async (request) => {
        expect(request).toMatchObject({
          operation: 'pull-request.edit',
          target: { repository: 'acme/conductor', kind: 'pull-request', number: 12 },
          context: { actor: 'finish-release-metadata-restore' },
          payload: { body: `## Summary\n\nRewritten by finish.\n\n${releaseBlock}` },
        });
        body = (request.payload as { body: string }).body;
        return {};
      },
    };

    await snapshotReleaseMetadata({ gh, projectRoot, prUrl });
    const snapshot = await snapshotReleaseMetadata({ gh, projectRoot, prUrl });
    body = '## Summary\n\nRewritten by finish.\n';
    await restoreReleaseMetadata({ gh, projectRoot, prUrl, snapshot, operations });

    expect(calls).toEqual([
      ['pr', 'view', prUrl, '--json', 'body'],
      ['pr', 'view', prUrl, '--json', 'body'],
      ['pr', 'view', prUrl, '--json', 'body'],
    ]);
  });

  it('rejects a refused guarded edit without a raw GitHub fallback', async () => {
    const projectRoot = await root();
    let body = `## Summary\n\n${releaseBlock}\n`;
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      return { stdout: JSON.stringify({ body }) };
    };
    const snapshot = await snapshotReleaseMetadata({ gh, projectRoot, prUrl });
    body = '## Summary\n\nRewritten by finish.\n';
    const operations: GithubOperationRunner = {
      run: async () => ({ kind: 'refused', reason: 'other-owner' }),
    };

    await expect(restoreReleaseMetadata({ gh, projectRoot, prUrl, snapshot, operations }))
      .rejects.toThrow('post-finish restore unavailable: guarded release metadata restore was refused or failed');
    expect(calls).toEqual([
      ['pr', 'view', prUrl, '--json', 'body'],
      ['pr', 'view', prUrl, '--json', 'body'],
    ]);
  });

  it('rejects malformed release metadata before any GitHub edit', async () => {
    const projectRoot = await root();
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      return { stdout: JSON.stringify({ body: 'Release-Disposition: note\n' }) };
    };

    const error = await snapshotReleaseMetadata({ gh, projectRoot, prUrl }).catch(
      (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
    );

    expect({ error, calls }).toEqual({
      error: 'pre-finish snapshot unavailable: release metadata is malformed or non-canonical',
      calls: [['pr', 'view', prUrl, '--json', 'body']],
    });
  });

  it('keeps the moved GitHub boundary free of process-spawning imports', async () => {
    const source = await readFile(
      fileURLToPath(new URL('../../../src/engine/self-host/release-metadata-flow.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/from ['"]node:(?:child_process|process)['"]|from ['"]execa['"]/);
  });

  it('passes the shipped GitHub invocation-boundary audit', () => {
    const conductorRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const findings = auditShippedGithubInvocationBoundary(conductorRoot);
    expect(findings.filter((finding) => (
      finding.file === 'engine/self-host/release-metadata-flow.ts'
      || finding.file === 'engine/conductor.ts'
    ))).toEqual([]);
  });
});
