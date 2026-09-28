// Covers: task:7 — capture persistence and exact region-byte authority.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractRegionBytes, isEmptyRegion, restoreRegion } from '../../src/engine/pr-body-regions.js';
import { readRegionCaptures, writeRegionCapture } from '../../src/engine/pr-body-region-store.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe('project-owned region capture', () => {
  it('persists exact non-empty bytes and a re-dispatch replacement wins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'region-capture-')); dirs.push(dir);
    const url = 'https://github.com/example/repo/pull/1';
    const first = '\nAttested-By: first\n';
    const second = '\nAttested-By: second\n';
    expect(extractRegionBytes(restoreRegion('body', { key: 'compliance-attest', bytes: first }), 'compliance-attest')).toBe(first);
    await writeRegionCapture(dir, url, 'compliance-attest', first);
    await writeRegionCapture(dir, url, 'compliance-attest', second);
    await expect(readRegionCaptures(dir, url)).resolves.toEqual({ 'compliance-attest': second });
  });

  it('rejects an empty captured region before it becomes authoritative', () => {
    expect(isEmptyRegion('\n<!-- placeholder -->\n')).toBe(true);
    expect(isEmptyRegion('\nAttested-By: security-bot\n')).toBe(false);
  });
});
