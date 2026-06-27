import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';

describe('engine/daemon-backlog — discoverBacklog', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-backlog-'));
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] when there is no plans dir', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'empty-'));
    expect(await discoverBacklog(empty)).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });

  // Eligible specs must be APPROVED (stories Status: Accepted) and well-formed
  // (plan declares a dependency tree). Helpers keep fixtures valid by default.
  const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
  const planWithDeps = (storiesRef?: string) =>
    `# Plan\n${storiesRef ? `**Stories:** ${storiesRef}\n` : ''}\n### Task 1\n**Dependencies:** none\n`;

  it('includes a feature whose plan + stories both exist (via **Stories:** ref)', async () => {
    await writeFile(
      join(dir, '.docs/plans/feature-a.md'),
      planWithDeps('.docs/stories/feature-a.md'),
    );
    await writeFile(join(dir, '.docs/stories/feature-a.md'), APPROVED_STORIES);

    const backlog = await discoverBacklog(dir);
    expect(backlog).toHaveLength(1);
    expect(backlog[0].slug).toBe('feature-a');
    expect(backlog[0].planPath).toContain('feature-a.md');
    expect(backlog[0].storiesPath).toContain('stories/feature-a.md');
  });

  it('falls back to a same-stem stories file when no **Stories:** line', async () => {
    await writeFile(join(dir, '.docs/plans/feature-b.md'), planWithDeps());
    await writeFile(join(dir, '.docs/stories/feature-b.md'), APPROVED_STORIES);

    const backlog = await discoverBacklog(dir);
    expect(backlog.map((b) => b.slug)).toEqual(['feature-b']);
  });

  it('excludes a plan with no matching stories (daemon never authors specs)', async () => {
    await writeFile(join(dir, '.docs/plans/orphan.md'), '# Plan with no stories\n');
    const backlog = await discoverBacklog(dir);
    expect(backlog).toEqual([]);
  });

  it('skips features already marked processed', async () => {
    for (const slug of ['a', 'b']) {
      await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps());
      await writeFile(join(dir, `.docs/stories/${slug}.md`), APPROVED_STORIES);
    }
    const processed = new Set(['a']);
    const backlog = await discoverBacklog(dir, async (slug) => processed.has(slug));
    expect(backlog.map((b) => b.slug)).toEqual(['b']);
  });

  it('skips an UNAPPROVED feature (stories not Accepted / DRAFT)', async () => {
    await writeFile(join(dir, '.docs/plans/draft.md'), planWithDeps());
    await writeFile(
      join(dir, '.docs/stories/draft.md'),
      '# Stories\n**Status:** DRAFT\n',
    );
    const logs: string[] = [];
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m));
    expect(backlog).toEqual([]);
    expect(logs.join('\n')).toMatch(/draft.*not approved/i);
  });

  it('skips a plan with no dependency tree', async () => {
    await writeFile(
      join(dir, '.docs/plans/nodeps.md'),
      '# Plan\n**Stories:** .docs/stories/nodeps.md\n\n### Task 1\nDo the thing.\n',
    );
    await writeFile(join(dir, '.docs/stories/nodeps.md'), APPROVED_STORIES);
    const logs: string[] = [];
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m));
    expect(backlog).toEqual([]);
    expect(logs.join('\n')).toMatch(/nodeps.*dependency tree/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9.3 REDESIGN — FR-24: merging the spec PR is the build-ready signal.
//
// The daemon builds only specs present on `main` (so the human merge is the
// trigger), via the EXISTING build-ready predicate. These are coverage cases
// written directly from the FR-24 story text (Group D, verify-only): they may
// legitimately PASS, since the predicate already exists — that is acceptable.
// The "unmerged PR" case is modeled the way the daemon observes it: the
// artifacts are simply NOT on the scanned tree yet.
// ─────────────────────────────────────────────────────────────────────────────
describe('engine/daemon-backlog — FR-24 build-ready handoff invariant', () => {
  let dir: string;
  const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
  const planWithDeps = (storiesRef?: string) =>
    `# Plan\n${storiesRef ? `**Stories:** ${storiesRef}\n` : ''}\n### Task 1\n**Dependencies:** none\n`;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-backlog-fr24-'));
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('MERGED spec (Accepted stories + dependency-tree plan + not processed) → build-ready', async () => {
    await writeFile(join(dir, '.docs/plans/csv-export.md'), planWithDeps('.docs/stories/csv-export.md'));
    await writeFile(join(dir, '.docs/stories/csv-export.md'), APPROVED_STORIES);

    const backlog = await discoverBacklog(dir);
    expect(backlog.map((b) => b.slug)).toEqual(['csv-export']);
  });

  it('UNMERGED PR (artifacts absent from the scanned tree) → NOT build-ready (no build)', async () => {
    // The spec PR is open but unmerged → its plan/stories are not on the tree
    // the daemon scans. The predicate therefore finds nothing to build.
    const backlog = await discoverBacklog(dir);
    expect(backlog).toEqual([]);
  });

  it('MERGED spec whose stories are still Status: DRAFT → NOT build-ready (stub-regression guard)', async () => {
    await writeFile(join(dir, '.docs/plans/draft-feat.md'), planWithDeps('.docs/stories/draft-feat.md'));
    await writeFile(join(dir, '.docs/stories/draft-feat.md'), '# Stories\n**Status:** DRAFT\n');

    const logs: string[] = [];
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m));
    expect(backlog).toEqual([]);
    expect(logs.join('\n')).toMatch(/draft-feat.*not approved/i);
  });

  it('a slug already in .daemon/processed/ is skipped (no rebuild)', async () => {
    await writeFile(join(dir, '.docs/plans/shipped.md'), planWithDeps('.docs/stories/shipped.md'));
    await writeFile(join(dir, '.docs/stories/shipped.md'), APPROVED_STORIES);

    const processed = new Set(['shipped']);
    const backlog = await discoverBacklog(dir, async (slug) => processed.has(slug));
    expect(backlog).toEqual([]);
  });
});
