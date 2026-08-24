import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  REGRADE_COUNTER_PATH,
  extractFlaggedPaths,
  incrementRegradeCounter,
  readRegradeCount,
  resetRegradeCounter,
} from '../../src/engine/build-review-disposition.js';

// `runScopeFailDisposition` is exercised end to end by
// test/acceptance/build-review-grades-plan-vs-diff-against-a-stale-o.acceptance.test.ts
// and is deliberately not repeated here.

describe('engine/build-review-disposition — extractFlaggedPaths', () => {
  it('extracts path-like tokens from reason prose', () => {
    expect(extractFlaggedPaths(['diff touches src/foo/bar.ts which is out of scope'])).toEqual(['src/foo/bar.ts']);
  });

  it('collects every distinct path across reasons in first-seen order and dedupes repeats', () => {
    expect(extractFlaggedPaths([
      'src/foo/bar.ts is out of scope; see also docs/guide.md',
      'also see src/foo/bar.ts again and test/foo.test.ts',
    ])).toEqual(['src/foo/bar.ts', 'docs/guide.md', 'test/foo.test.ts']);
  });

  it('returns empty for undefined, empty, or path-free reasons', () => {
    expect(extractFlaggedPaths(undefined)).toEqual([]);
    expect(extractFlaggedPaths([])).toEqual([]);
    expect(extractFlaggedPaths(['this change is too broad'])).toEqual([]);
  });
});

describe('engine/build-review-disposition — regrade counter persistence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'regrade-counter-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads 0 when no counter file exists yet', async () => {
    expect(await readRegradeCount(dir)).toBe(0);
  });

  it('persists each increment at the documented path and reads it back', async () => {
    expect(await incrementRegradeCounter(dir)).toBe(1);
    expect(await readRegradeCount(dir)).toBe(1);
    expect(await incrementRegradeCounter(dir)).toBe(2);
    expect(await readRegradeCount(dir)).toBe(2);
    expect(JSON.parse(await readFile(join(dir, REGRADE_COUNTER_PATH), 'utf-8'))).toEqual({ count: 2 });
  });

  it('resets an already-incremented counter to 0', async () => {
    await incrementRegradeCounter(dir);
    await incrementRegradeCounter(dir);

    await resetRegradeCounter(dir);

    expect(await readRegradeCount(dir)).toBe(0);
    expect(existsSync(join(dir, REGRADE_COUNTER_PATH))).toBe(true);
  });

  it('never creates .pipeline/ when resetting an absent counter (#505)', async () => {
    // An otherwise-empty `.pipeline/` is not inert: the pre-dispatch attribution
    // guard early-returns "intact" only when the directory is absent.
    expect(existsSync(join(dir, '.pipeline'))).toBe(false);

    await resetRegradeCounter(dir);

    expect(existsSync(join(dir, '.pipeline'))).toBe(false);
    expect(await readRegradeCount(dir)).toBe(0);
  });

  it('reads 0 for an unparseable or mis-shaped counter file', async () => {
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, REGRADE_COUNTER_PATH), 'not json', 'utf-8');
    expect(await readRegradeCount(dir)).toBe(0);

    await writeFile(join(dir, REGRADE_COUNTER_PATH), JSON.stringify({ count: 'two' }), 'utf-8');
    expect(await readRegradeCount(dir)).toBe(0);

    expect(await incrementRegradeCounter(dir)).toBe(1);
  });
});
