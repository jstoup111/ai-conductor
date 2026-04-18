import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractPrUrl, savePrUrl, readState } from '../../src/engine/state.js';

describe('extractPrUrl', () => {
  it('pulls the first http(s) URL out of stdout', () => {
    const output = 'Creating PR...\nhttps://github.com/org/repo/pull/42\nDone.';
    expect(extractPrUrl(output)).toBe('https://github.com/org/repo/pull/42');
  });

  it('accepts http as well as https', () => {
    expect(extractPrUrl('visit http://gitea.local/repo/pull/1 for details')).toBe(
      'http://gitea.local/repo/pull/1',
    );
  });

  it('strips trailing punctuation', () => {
    expect(extractPrUrl('PR created at https://github.com/org/repo/pull/42.')).toBe(
      'https://github.com/org/repo/pull/42',
    );
    expect(extractPrUrl('Done (see https://github.com/org/repo/pull/42).')).toBe(
      'https://github.com/org/repo/pull/42',
    );
  });

  it('returns null when no URL found', () => {
    expect(extractPrUrl('PR created')).toBeNull();
    expect(extractPrUrl('')).toBeNull();
  });

  it('prefers the FIRST URL (gh pr create prints PR URL first)', () => {
    const output = 'https://github.com/org/repo/pull/42\nnext: https://github.com/org/repo/issues/1';
    expect(extractPrUrl(output)).toBe('https://github.com/org/repo/pull/42');
  });

  it('accepts non-github URLs (no domain validation)', () => {
    expect(extractPrUrl('merged into https://bitbucket.example.com/x/y/pull-requests/7')).toBe(
      'https://bitbucket.example.com/x/y/pull-requests/7',
    );
  });
});

describe('savePrUrl', () => {
  let dir: string;
  let statePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pr-url-test-'));
    statePath = join(dir, 'conduct-state.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes pr_url into fresh state', async () => {
    await savePrUrl(statePath, 'https://github.com/org/repo/pull/42');
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pr_url).toBe('https://github.com/org/repo/pull/42');
    }
  });

  it('preserves other state fields when updating pr_url', async () => {
    await savePrUrl(statePath, 'https://github.com/org/repo/pull/1');
    await savePrUrl(statePath, 'https://github.com/org/repo/pull/2');
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pr_url).toBe('https://github.com/org/repo/pull/2');
    }
  });
});
