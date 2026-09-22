// Covers: task:12
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
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
  it('restores the captured release block byte-for-byte through the injected GitHub runner', async () => {
    const projectRoot = await root();
    let body = `## Summary\n\nBefore finish.\n\n${releaseBlock}\n`;
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ body }) };
      if (args[0] === 'pr' && args[1] === 'edit') {
        body = args[args.indexOf('--body') + 1]!;
        return { stdout: '' };
      }
      throw new Error(`unexpected GitHub arguments: ${args.join(' ')}`);
    };

    await snapshotReleaseMetadata({ gh, projectRoot, prUrl });
    const snapshot = await snapshotReleaseMetadata({ gh, projectRoot, prUrl });
    body = '## Summary\n\nRewritten by finish.\n';
    await restoreReleaseMetadata({ gh, projectRoot, prUrl, snapshot });

    expect(calls).toEqual([
      ['pr', 'view', prUrl, '--json', 'body'],
      ['pr', 'view', prUrl, '--json', 'body'],
      ['pr', 'edit', prUrl, '--body', `## Summary\n\nRewritten by finish.\n\n${releaseBlock}`],
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
});
