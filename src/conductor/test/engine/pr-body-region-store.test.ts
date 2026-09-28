// Covers: task:5
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  discardRegionCapture,
  PR_BODY_REGION_CAPTURES_PATH,
  readRegionCaptures,
  writeRegionCapture,
} from '../../src/engine/pr-body-region-store.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('PR body region capture store', () => {
  it('creates its pipeline directory and persists captures by pull request URL and step key', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'pr-body-region-store-'));
    dirs.push(worktree);
    const pullRequestUrl = 'https://github.com/example/repo/pull/12';

    await writeRegionCapture(worktree, pullRequestUrl, 'compliance-attest', '\nAttested-By: security-bot\n');
    await writeRegionCapture(worktree, pullRequestUrl, 'release-disposition', '\nRelease-Disposition: no-note\n');

    expect(await readRegionCaptures(worktree, pullRequestUrl)).toEqual({
      'compliance-attest': '\nAttested-By: security-bot\n',
      'release-disposition': '\nRelease-Disposition: no-note\n',
    });
    expect(JSON.parse(await readFile(join(worktree, PR_BODY_REGION_CAPTURES_PATH), 'utf8'))).toEqual({
      [pullRequestUrl]: {
        'compliance-attest': '\nAttested-By: security-bot\n',
        'release-disposition': '\nRelease-Disposition: no-note\n',
      },
    });
  });

  it('does not return a capture recorded for another pull request URL', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'pr-body-region-store-'));
    dirs.push(worktree);

    await writeRegionCapture(worktree, 'https://github.com/example/repo/pull/12', 'compliance-attest', '\nfirst PR\n');

    await expect(readRegionCaptures(worktree, 'https://github.com/example/repo/pull/13')).resolves.toEqual({});
  });

  it('discards only the redispatched owner capture', async () => {
    const worktree = await mkdtemp(join(tmpdir(), 'pr-body-region-store-'));
    dirs.push(worktree);
    const pullRequestUrl = 'https://github.com/example/repo/pull/12';
    await writeRegionCapture(worktree, pullRequestUrl, 'first-owner', '\nfirst\n');
    await writeRegionCapture(worktree, pullRequestUrl, 'second-owner', '\nsecond\n');

    await discardRegionCapture(worktree, pullRequestUrl, 'first-owner');

    await expect(readRegionCaptures(worktree, pullRequestUrl)).resolves.toEqual({
      'second-owner': '\nsecond\n',
    });
  });
});
