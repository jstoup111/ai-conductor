// ─────────────────────────────────────────────────────────────────────────────
// Test: stories/plan gate predicates are scoped to the FEATURE's docs (#441).
//
// The gates previously validated every file in .docs/stories (and read
// coverage across every plan). Legacy landed artifacts predate the structural
// convention — 49 story blocks on main fail it — so any feature whose loop
// re-selected the stories gate was permanently unsatisfiable, dispatched
// against files outside its feature. Scoping mirrors resolveFeaturePlanPath
// (#407): singleton corpus → featureDesc stem → plan stem → explicit failure,
// never a corpus-wide fallback.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  GATE_ONLY_PREDICATES,
  resolveFeatureStoriesPath,
} from '../../src/engine/artifacts.js';

const FEATURE = 'my-feature';

const VALID_STORIES = `# Stories

**Status:** Accepted

## Story 1 — does the thing

### Happy Path
- **Given** a thing, **When** it runs, **Then** it works.

### Negative Paths
- **Given** a broken thing, **When** it runs, **Then** it fails loudly.
`;

// Legacy shape: happy path as intro prose, no "### Happy Path" heading —
// the exact structure that halted finish-step-fails-try-1 (#441).
const LEGACY_STORIES = `# Stories

**Status:** Accepted

## Story 2 — legacy shape

**Given** old conventions, **When** validated, **Then** this has no Happy Path heading.

### Negative path 2a
- **Given** x, **When** y, **Then** z.
`;

const COVERING_PLAN = `# Plan

## Task Dependency Graph
- 1: none

### Task 1: Implementation
**Story:** Story 1
**Type:** happy-path + negative-path
`;

describe('stories gate scoping (#441)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gate-scope-441-'));
    await mkdir(join(root, '.docs/stories'), { recursive: true });
    await mkdir(join(root, '.docs/plans'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('legacy offender in the corpus does NOT fail the gate when the feature doc is valid', async () => {
    await writeFile(join(root, `.docs/stories/${FEATURE}.md`), VALID_STORIES);
    await writeFile(join(root, '.docs/stories/legacy-feature.md'), LEGACY_STORIES);

    const result = await GATE_ONLY_PREDICATES.stories!(root, { featureDesc: FEATURE });
    expect(result.done).toBe(true);
  });

  it("the feature's OWN invalid doc still fails, naming only it", async () => {
    await writeFile(join(root, `.docs/stories/${FEATURE}.md`), LEGACY_STORIES);
    await writeFile(join(root, '.docs/stories/other-feature.md'), VALID_STORIES);

    const result = await GATE_ONLY_PREDICATES.stories!(root, { featureDesc: FEATURE });
    expect(result.done).toBe(false);
    expect(result.reason).toContain(`${FEATURE}.md`);
    expect(result.reason).toContain('missing a happy path');
  });

  it('unresolvable feature doc fails explicitly instead of scanning the corpus', async () => {
    await writeFile(join(root, '.docs/stories/a.md'), VALID_STORIES);
    await writeFile(join(root, '.docs/stories/b.md'), LEGACY_STORIES);

    const result = await GATE_ONLY_PREDICATES.stories!(root, { featureDesc: 'no-such-stem' });
    expect(result.done).toBe(false);
    expect(result.reason).toContain('refusing to validate the whole stories corpus');
    // Must not blame a file it had no business validating.
    expect(result.reason).not.toContain('b.md');
  });

  it('singleton corpus is validated without a featureDesc (back-compat)', async () => {
    await writeFile(join(root, '.docs/stories/only.md'), VALID_STORIES);

    const result = await GATE_ONLY_PREDICATES.stories!(root, {});
    expect(result.done).toBe(true);
  });

  it('DRAFT status on the scoped doc still blocks', async () => {
    await writeFile(
      join(root, `.docs/stories/${FEATURE}.md`),
      VALID_STORIES.replace('**Status:** Accepted', '**Status:** DRAFT'),
    );
    await writeFile(join(root, '.docs/stories/other.md'), VALID_STORIES);

    const result = await GATE_ONLY_PREDICATES.stories!(root, { featureDesc: FEATURE });
    expect(result.done).toBe(false);
    expect(result.reason).toContain('DRAFT');
  });
});

describe('plan gate scoping (#441)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gate-scope-441-plan-'));
    await mkdir(join(root, '.docs/stories'), { recursive: true });
    await mkdir(join(root, '.docs/plans'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("legacy stories' uncovered units do not fail the feature's plan", async () => {
    await writeFile(join(root, `.docs/stories/${FEATURE}.md`), VALID_STORIES);
    await writeFile(join(root, `.docs/plans/${FEATURE}.md`), COVERING_PLAN);
    // Legacy feature declares Story 9 happy+negative; nothing covers it.
    await writeFile(
      join(root, '.docs/stories/legacy-feature.md'),
      VALID_STORIES.replace('## Story 1', '## Story 9'),
    );

    const result = await GATE_ONLY_PREDICATES.plan!(root, { featureDesc: FEATURE });
    expect(result.done).toBe(true);
  });

  it("cross-file story-ID collisions no longer let a legacy plan cover the feature's story", async () => {
    // Feature's plan covers nothing; a legacy plan references "Story 1" which
    // under corpus-wide coverage would (wrongly) satisfy the feature's Story 1.
    await writeFile(join(root, `.docs/stories/${FEATURE}.md`), VALID_STORIES);
    await writeFile(
      join(root, `.docs/plans/${FEATURE}.md`),
      '# Plan\n\n## Task Dependency Graph\n- 1: none\n\n### Task 1: Implementation\nNo story refs.\n',
    );
    await writeFile(join(root, '.docs/plans/legacy-feature.md'), COVERING_PLAN);
    await writeFile(join(root, '.docs/stories/legacy-feature.md'), VALID_STORIES);

    const result = await GATE_ONLY_PREDICATES.plan!(root, { featureDesc: FEATURE });
    expect(result.done).toBe(false);
    expect(result.reason).toContain('plan does not cover');
  });

  it('unresolvable plan among many fails explicitly', async () => {
    await writeFile(join(root, '.docs/plans/a.md'), COVERING_PLAN);
    await writeFile(join(root, '.docs/plans/b.md'), COVERING_PLAN);
    await writeFile(join(root, '.docs/stories/a.md'), VALID_STORIES);

    const result = await GATE_ONLY_PREDICATES.plan!(root, { featureDesc: 'no-such-stem' });
    expect(result.done).toBe(false);
    expect(result.reason).toContain('refusing corpus-wide coverage check');
  });
});

describe('resolveFeatureStoriesPath ladder (#441)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gate-scope-441-resolve-'));
    await mkdir(join(root, '.docs/stories'), { recursive: true });
    await mkdir(join(root, '.docs/plans'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('empty corpus → undefined', async () => {
    expect(await resolveFeatureStoriesPath(root, FEATURE)).toBeUndefined();
  });

  it('singleton wins regardless of stem', async () => {
    await writeFile(join(root, '.docs/stories/whatever.md'), VALID_STORIES);
    expect(await resolveFeatureStoriesPath(root, FEATURE)).toContain('whatever.md');
  });

  it('featureDesc stem match wins among many', async () => {
    await writeFile(join(root, `.docs/stories/${FEATURE}.md`), VALID_STORIES);
    await writeFile(join(root, '.docs/stories/other.md'), VALID_STORIES);
    expect(await resolveFeatureStoriesPath(root, FEATURE)).toContain(`${FEATURE}.md`);
  });

  it('falls back to the resolved plan stem when featureDesc differs', async () => {
    // Engine state records the active plan; stories share its stem.
    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(
      join(root, '.pipeline/engine-state.json'),
      JSON.stringify({ activePlanPath: '.docs/plans/renamed-slug.md' }),
    );
    await writeFile(join(root, '.docs/plans/renamed-slug.md'), COVERING_PLAN);
    await writeFile(join(root, '.docs/stories/renamed-slug.md'), VALID_STORIES);
    await writeFile(join(root, '.docs/stories/other.md'), VALID_STORIES);

    expect(await resolveFeatureStoriesPath(root, 'human words desc')).toContain(
      'renamed-slug.md',
    );
  });

  it('ambiguous with no match → undefined (never guesses)', async () => {
    await writeFile(join(root, '.docs/stories/a.md'), VALID_STORIES);
    await writeFile(join(root, '.docs/stories/b.md'), VALID_STORIES);
    expect(await resolveFeatureStoriesPath(root, 'nope')).toBeUndefined();
  });
});
