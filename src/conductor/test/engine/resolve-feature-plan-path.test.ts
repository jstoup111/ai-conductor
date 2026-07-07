// ─────────────────────────────────────────────────────────────────────────────
// Test: resolveFeaturePlanPath — feature-scoped plan resolution for the build
// completion gate (#407).
//
// `.docs/plans/` is shared across in-flight features by design (plans land on
// the base branch, every worktree checks them all out), so `completionCtx`
// taking `.docs/plans/*.md`[0] picked whichever plan sorted first. In the
// incident, `2026-03-30-technical-assessment.md` ('2' < 'a') beat
// `audit-trail-write-completeness-for-retro-under-fre.md`, its 9 tasks were
// upserted as pending into the feature's task-status.json, and the build gate
// reported "9/9 tasks pending" forever — on every daemon auto re-kick.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveFeaturePlanPath } from '../../src/engine/artifacts.js';

const FEATURE = 'audit-trail-write-completeness-for-retro-under-fre';
const ALIEN_PLAN = '2026-03-30-technical-assessment.md';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'plan-scope-'));
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.pipeline'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const addPlan = (name: string) =>
  writeFile(join(root, '.docs', 'plans', name), `### Task 1: something\n`);

describe('resolveFeaturePlanPath (#407 — build gate must never evaluate another feature\'s plan)', () => {
  it('#407 scenario: picks the slug-named plan over an alphabetically-earlier unrelated one', async () => {
    await addPlan(ALIEN_PLAN); // sorts first: '2' < 'a'
    await addPlan(`${FEATURE}.md`);

    const resolved = await resolveFeaturePlanPath(root, FEATURE);
    expect(resolved).toBe(join(root, '.docs', 'plans', `${FEATURE}.md`));
  });

  it('prefers the engine-recorded activePlanPath over everything else', async () => {
    await addPlan(ALIEN_PLAN);
    await addPlan(`${FEATURE}.md`);
    await addPlan('recorded-plan.md');
    await writeFile(
      join(root, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath: '.docs/plans/recorded-plan.md' }),
    );

    const resolved = await resolveFeaturePlanPath(root, FEATURE);
    expect(resolved).toBe(join(root, '.docs/plans/recorded-plan.md'));
  });

  it('single plan on disk resolves regardless of its name', async () => {
    await addPlan(ALIEN_PLAN);

    const resolved = await resolveFeaturePlanPath(root, FEATURE);
    expect(resolved).toBe(join(root, '.docs', 'plans', ALIEN_PLAN));
  });

  it('multiple plans, none matching the feature, no engine state → undefined (never guess)', async () => {
    await addPlan(ALIEN_PLAN);
    await addPlan('some-other-feature.md');

    expect(await resolveFeaturePlanPath(root, FEATURE)).toBeUndefined();
  });

  it('multiple plans and no featureDesc at all → undefined (never guess)', async () => {
    await addPlan(ALIEN_PLAN);
    await addPlan('some-other-feature.md');

    expect(await resolveFeaturePlanPath(root, undefined)).toBeUndefined();
  });

  it('no plans at all → undefined', async () => {
    expect(await resolveFeaturePlanPath(root, FEATURE)).toBeUndefined();
  });

  it('corrupt engine-state.json falls through to convention-based resolution', async () => {
    await writeFile(join(root, '.pipeline', 'engine-state.json'), '{not json');
    await addPlan(ALIEN_PLAN);
    await addPlan(`${FEATURE}.md`);

    const resolved = await resolveFeaturePlanPath(root, FEATURE);
    expect(resolved).toBe(join(root, '.docs', 'plans', `${FEATURE}.md`));
  });

  it('blank activePlanPath is ignored (falls through, not returned)', async () => {
    await writeFile(
      join(root, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath: '  ' }),
    );
    await addPlan(`${FEATURE}.md`);

    const resolved = await resolveFeaturePlanPath(root, FEATURE);
    expect(resolved).toBe(join(root, '.docs', 'plans', `${FEATURE}.md`));
  });

  it('absolute recorded activePlanPath is returned as-is', async () => {
    const abs = join(root, '.docs', 'plans', 'recorded.md');
    await writeFile(
      join(root, '.pipeline', 'engine-state.json'),
      JSON.stringify({ activePlanPath: abs }),
    );

    expect(await resolveFeaturePlanPath(root, FEATURE)).toBe(abs);
  });
});
