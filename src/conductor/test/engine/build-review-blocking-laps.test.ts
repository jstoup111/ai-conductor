// Covers: task:1, task:3
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/engine/config.js';
import { resolveBuildReviewConfig } from '../../src/engine/resolved-config.js';
import { buildReviewScopeDeclarationFingerprint } from '../../src/engine/build-review-review-frontier.js';
import {
  buildReviewBlockingLapLimits,
  lapLimitedBuildReviewRubrics,
  readBuildReviewBlockingLaps,
  recordBuildReviewBlockingLaps,
} from '../../src/engine/build-review-blocking-laps.js';
import { parseChildId } from '../../src/engine/child-context.js';
import type { HarnessConfig } from '../../src/types/config.js';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const portable = { skill: 'portable-policy', question: 'Does this preserve the portable policy boundary?' };

describe('build_review max_blocking_laps config', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'blocking-laps-config-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function load(yaml: string) {
    await mkdir(join(root, '.ai-conductor'), { recursive: true });
    await writeFile(join(root, '.ai-conductor', 'config.yml'), yaml);
    return loadConfig(root);
  }

  it('defaults implementationQuality to 2 and every other rubric to unlimited, with explicit overrides', () => {
    const defaults = resolveBuildReviewConfig({
      build_review: { custom_rubrics: { portable: { ...portable, enabled: true } } },
    } as HarnessConfig);
    expect(defaults.rubrics.implementationQuality.max_blocking_laps).toBe(2);
    expect(defaults.rubrics.testQuality).not.toHaveProperty('max_blocking_laps');
    expect(defaults.rubrics.security).not.toHaveProperty('max_blocking_laps');
    expect(defaults.catalog.find((entry) => entry.id === 'portable')?.policy).not.toHaveProperty('max_blocking_laps');

    const overridden = resolveBuildReviewConfig({
      build_review: {
        rubrics: { testQuality: { max_blocking_laps: 3 }, implementationQuality: { max_blocking_laps: 0 } },
        custom_rubrics: { portable: { ...portable, enabled: true, max_blocking_laps: 1 } },
      },
    } as HarnessConfig);
    expect(overridden.rubrics.testQuality.max_blocking_laps).toBe(3);
    expect(overridden.rubrics.implementationQuality).not.toHaveProperty('max_blocking_laps');
    expect(overridden.catalog.find((entry) => entry.id === 'portable')?.policy.max_blocking_laps).toBe(1);

    const testQualityOnly = resolveBuildReviewConfig({
      build_review: { rubrics: { testQuality: { max_blocking_laps: 3 } } },
    } as HarnessConfig);
    expect(testQualityOnly.rubrics.implementationQuality.max_blocking_laps).toBe(2);
  });

  it.each([
    [
      'build_review:\n  rubrics:\n    implementationQuality:\n      max_blocking_laps: -1\n',
      'build_review.rubrics.implementationQuality.max_blocking_laps must be a non-negative integer',
    ],
    [
      'build_review:\n  rubrics:\n    security:\n      max_blocking_laps: 1.5\n',
      'build_review.rubrics.security.max_blocking_laps',
    ],
    [
      'build_review:\n  rubrics:\n    security:\n      max_blocking_laps: "2"\n',
      'build_review.rubrics.security.max_blocking_laps',
    ],
    [
      'build_review:\n  custom_rubrics:\n    portable:\n      skill: portable-policy\n      question: Check.\n      max_blocking_laps: -2\n',
      'build_review.custom_rubrics.portable.max_blocking_laps must be a non-negative integer',
    ],
  ])('rejects an invalid max_blocking_laps %#', async (yaml, message) => {
    const result = await load(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain(message);
  });

  it("resolves this repository's own config to testQuality 3, implementationQuality 2, and unlimited security", async () => {
    const result = await loadConfig(REPOSITORY_ROOT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resolved = resolveBuildReviewConfig(result.config);
    expect(resolved.rubrics.testQuality.max_blocking_laps).toBe(3);
    expect(resolved.rubrics.implementationQuality.max_blocking_laps).toBe(2);
    expect(resolved.rubrics.security).not.toHaveProperty('max_blocking_laps');
  });

  it('keeps the lap-scope declaration fingerprint independent of max_blocking_laps', () => {
    const resolved = resolveBuildReviewConfig({
      build_review: { rubrics: { implementationQuality: { max_blocking_laps: 0 } } },
    } as HarnessConfig);
    const policy = resolved.rubrics.implementationQuality;
    expect(policy).not.toHaveProperty('max_blocking_laps');
    const expected = `sha256:${createHash('sha256').update(JSON.stringify(policy)).digest('hex')}`;
    expect(buildReviewScopeDeclarationFingerprint(policy)).toBe(expected);
    expect(buildReviewScopeDeclarationFingerprint({ ...policy, max_blocking_laps: 5 })).toBe(expected);
  });
});

describe('build_review blocking-lap state', () => {
  let root: string;
  const statePath = () => join(root, '.pipeline', 'engine-state.json');
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'blocking-laps-state-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('records a lap once per rubric and preserves unrelated engine-state keys', async () => {
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(statePath(), JSON.stringify({ activePlanPath: '.docs/plans/<feature>.md' }));

    expect(await recordBuildReviewBlockingLaps(root, undefined, 'lap-a', ['implementationQuality'])).toEqual({
      ok: true,
    });
    expect(await recordBuildReviewBlockingLaps(root, undefined, 'lap-a', ['implementationQuality'])).toEqual({
      ok: true,
    });

    const state = JSON.parse(await readFile(statePath(), 'utf8'));
    expect(state.activePlanPath).toBe('.docs/plans/<feature>.md');
    expect(state.buildReviewBlockingLaps.feature.implementationQuality).toEqual(['lap-a']);
    expect(await readBuildReviewBlockingLaps(root, undefined)).toEqual({ implementationQuality: ['lap-a'] });
  });

  it('scopes laps per stacked child', async () => {
    const childOne = parseChildId(1)!;
    const childTwo = parseChildId(2)!;
    await recordBuildReviewBlockingLaps(root, childOne, 'lap-c1', ['implementationQuality']);

    const state = JSON.parse(await readFile(statePath(), 'utf8'));
    expect(state.buildReviewBlockingLaps['child-1'].implementationQuality).toEqual(['lap-c1']);
    expect(await readBuildReviewBlockingLaps(root, childTwo)).toEqual({});
    expect(await readBuildReviewBlockingLaps(root, undefined)).toEqual({});
  });

  it('counts no laps for absent, malformed, or invalid state and never overwrites malformed JSON', async () => {
    expect(await readBuildReviewBlockingLaps(root, undefined)).toEqual({});

    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(
      statePath(),
      JSON.stringify({
        buildReviewBlockingLaps: { feature: { implementationQuality: ['lap-a', 7, null], testQuality: 'lap-b' } },
      }),
    );
    expect(await readBuildReviewBlockingLaps(root, undefined)).toEqual({ implementationQuality: ['lap-a'] });

    await writeFile(statePath(), '{not json');
    expect(await readBuildReviewBlockingLaps(root, undefined)).toEqual({});
    const recorded = await recordBuildReviewBlockingLaps(root, undefined, 'lap-c', ['implementationQuality']);
    expect(recorded.ok).toBe(false);
    expect(await readFile(statePath(), 'utf8')).toBe('{not json');
  });

  it('limits a rubric only after it blocked its limit of other laps', () => {
    const limits = { implementationQuality: 2 };
    expect(
      lapLimitedBuildReviewRubrics({ limits, laps: { implementationQuality: ['lap-a', 'lap-b'] }, lapId: 'lap-c' }),
    ).toEqual([{ rubric: 'implementationQuality', blockingLaps: 2, limit: 2 }]);
    expect(
      lapLimitedBuildReviewRubrics({ limits, laps: { implementationQuality: ['lap-a'] }, lapId: 'lap-c' }),
    ).toEqual([]);
    expect(
      lapLimitedBuildReviewRubrics({ limits, laps: { implementationQuality: ['lap-a', 'lap-c'] }, lapId: 'lap-c' }),
    ).toEqual([]);
  });

  it('never limits a rubric whose limit is explicitly unlimited', () => {
    const limits = buildReviewBlockingLapLimits(
      resolveBuildReviewConfig({
        build_review: { rubrics: { implementationQuality: { max_blocking_laps: 0 } } },
      } as HarnessConfig),
    );
    expect(limits).not.toHaveProperty('implementationQuality');
    const tenLaps = Array.from({ length: 10 }, (_, index) => `lap-${index}`);
    expect(
      lapLimitedBuildReviewRubrics({ limits, laps: { implementationQuality: tenLaps }, lapId: 'lap-next' }),
    ).toEqual([]);
  });
});
