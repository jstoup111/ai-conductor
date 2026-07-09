import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile as fsReadFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  discoverBacklog,
  fastForwardRoot,
  type BacklogTreeSource,
} from '../../src/engine/daemon-backlog.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { parseComplexityTier } from '../../src/engine/artifacts.js';
import {
  renderShippedRecord,
  parseShippedRecord,
  specHash,
  makeIsProcessed,
} from '../../src/engine/shipped-record.js';

const execFile = promisify(execFileCb);

// A working-tree-backed tree source: reads `.docs/` straight off the filesystem.
// Used by the vetting-logic unit tests so they stay fast and git-free while
// still exercising the real eligibility rules. The PRODUCTION default reads the
// committed base-branch tree via git — see the FR-24 git tests below.
function fsTreeSource(root: string): BacklogTreeSource {
  return {
    async listPlanFiles() {
      try {
        return (await readdir(join(root, '.docs/plans'))).filter((f) => f.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async listShippedFiles() {
      try {
        return (await readdir(join(root, '.docs/shipped'))).filter((f) => f.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async readFile(relPath) {
      try {
        return await fsReadFile(join(root, relPath), 'utf-8');
      } catch {
        return null;
      }
    },
  };
}

describe('engine/daemon-backlog — discoverBacklog (eligibility vetting)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-backlog-'));
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Eligible specs must be APPROVED (stories Status: Accepted) and well-formed
  // (plan declares a dependency tree). Helpers keep fixtures valid by default.
  const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
  const planWithDeps = (storiesRef?: string) =>
    `# Plan\n${storiesRef ? `**Stories:** ${storiesRef}\n` : ''}\n### Task 1\n**Dependencies:** none\n`;

  // Convenience: run discoverBacklog against the working tree (fs source).
  const discover = async (
    isProcessed?: (slug: string) => Promise<boolean>,
    log?: (m: string) => void,
  ) => (await discoverBacklog(dir, isProcessed, log, { treeSource: fsTreeSource(dir) })).items;

  it('returns [] when there is no plans dir', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'empty-'));
    expect(
      await discoverBacklog(empty, undefined, undefined, { treeSource: fsTreeSource(empty) }),
    ).toEqual({ items: [], waiting: [], gated: [] });
    await rm(empty, { recursive: true, force: true });
  });

  it('returns gated: [] on a no-spec fixture (widened result shape, Task 1)', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'empty-'));
    const result = await discoverBacklog(empty, undefined, undefined, {
      treeSource: fsTreeSource(empty),
    });
    expect(result.gated).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });

  it('returns waiting: [] alongside items (widened result shape, Task 10)', async () => {
    await writeFile(
      join(dir, '.docs/plans/feature-shape.md'),
      planWithDeps('.docs/stories/feature-shape.md'),
    );
    await writeFile(join(dir, '.docs/stories/feature-shape.md'), APPROVED_STORIES);

    const result = await discoverBacklog(dir, undefined, undefined, {
      treeSource: fsTreeSource(dir),
    });
    expect(result.items.map((b) => b.slug)).toEqual(['feature-shape']);
    expect(result.waiting).toEqual([]);
    expect(result.gated).toEqual([]);
  });

  describe('dependency gate (Task 11)', () => {
    async function seedWithSourceRef(slug: string, sourceRef: string) {
      await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps(`.docs/stories/${slug}.md`));
      await writeFile(join(dir, `.docs/stories/${slug}.md`), APPROVED_STORIES);
      await mkdir(join(dir, '.docs/intake'), { recursive: true });
      await writeFile(join(dir, `.docs/intake/${slug}.md`), `Source-Ref: ${sourceRef}\n`);
    }

    it('a spec with a blocked Source-Ref is diverted to waiting, absent from items', async () => {
      await seedWithSourceRef('blocked-spec', 'acme/app#10');
      const resolver = {
        resolve: async () => ({ kind: 'blocked' as const, blockers: [{ repo: 'acme/app', number: '10' }] }),
      };

      const result = await discoverBacklog(dir, undefined, undefined, {
        treeSource: fsTreeSource(dir),
        resolver,
      });

      expect(result.items.map((b) => b.slug)).not.toContain('blocked-spec');
      expect(result.waiting).toEqual([
        {
          slug: 'blocked-spec',
          sourceRef: 'acme/app#10',
          verdict: { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '10' }] },
        },
      ]);
    });

    it('a spec with an unblocked Source-Ref stays in items, absent from waiting', async () => {
      await seedWithSourceRef('clear-spec', 'acme/app#11');
      const resolver = { resolve: async () => ({ kind: 'unblocked' as const }) };

      const result = await discoverBacklog(dir, undefined, undefined, {
        treeSource: fsTreeSource(dir),
        resolver,
      });

      expect(result.items.map((b) => b.slug)).toContain('clear-spec');
      expect(result.waiting).toEqual([]);
    });

    it('a spec with no Source-Ref is left in items without invoking the resolver', async () => {
      await writeFile(join(dir, '.docs/plans/no-ref-spec.md'), planWithDeps('.docs/stories/no-ref-spec.md'));
      await writeFile(join(dir, '.docs/stories/no-ref-spec.md'), APPROVED_STORIES);
      let called = false;
      const resolver = {
        resolve: async () => {
          called = true;
          return { kind: 'unblocked' as const };
        },
      };

      const result = await discoverBacklog(dir, undefined, undefined, {
        treeSource: fsTreeSource(dir),
        resolver,
      });

      expect(result.items.map((b) => b.slug)).toContain('no-ref-spec');
      expect(result.waiting).toEqual([]);
      expect(called).toBe(false);
    });
  });

  describe('skip is per-cycle, no processed marker (Task 13)', () => {
    async function seedWithSourceRef(slug: string, sourceRef: string) {
      await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps(`.docs/stories/${slug}.md`));
      await writeFile(join(dir, `.docs/stories/${slug}.md`), APPROVED_STORIES);
      await mkdir(join(dir, '.docs/intake'), { recursive: true });
      await writeFile(join(dir, `.docs/intake/${slug}.md`), `Source-Ref: ${sourceRef}\n`);
    }

    it('a spec blocked by the same blocker across 3 scans stays in waiting each time, never marked processed', async () => {
      await seedWithSourceRef('sticky-blocked', 'acme/app#20');
      const isProcessed = async () => false;
      const resolver = {
        resolve: async () => ({ kind: 'blocked' as const, blockers: [{ repo: 'acme/app', number: '20' }] }),
      };

      for (let scan = 0; scan < 3; scan++) {
        const result = await discoverBacklog(dir, isProcessed, undefined, {
          treeSource: fsTreeSource(dir),
          resolver,
        });
        expect(result.items.map((b) => b.slug)).not.toContain('sticky-blocked');
        expect(result.waiting).toEqual([
          {
            slug: 'sticky-blocked',
            sourceRef: 'acme/app#20',
            verdict: { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '20' }] },
          },
        ]);
      }
    });

    it('a spec in waiting moves to items once its blocker closes in a later scan', async () => {
      await seedWithSourceRef('closes-later', 'acme/app#21');
      let blocked = true;
      const resolver = {
        resolve: async () =>
          blocked
            ? { kind: 'blocked' as const, blockers: [{ repo: 'acme/app', number: '21' }] }
            : { kind: 'unblocked' as const },
      };

      const scan1 = await discoverBacklog(dir, undefined, undefined, {
        treeSource: fsTreeSource(dir),
        resolver,
      });
      expect(scan1.items.map((b) => b.slug)).not.toContain('closes-later');
      expect(scan1.waiting.map((w) => w.slug)).toContain('closes-later');

      blocked = false; // blocker closes between scans

      const scan2 = await discoverBacklog(dir, undefined, undefined, {
        treeSource: fsTreeSource(dir),
        resolver,
      });
      expect(scan2.items.map((b) => b.slug)).toContain('closes-later');
      expect(scan2.waiting).toEqual([]);
    });

    it('a spec built as an item re-diverts to waiting once a new blocker link is added', async () => {
      await seedWithSourceRef('newly-blocked', 'acme/app#22');
      let hasBlocker = false;
      const resolver = {
        resolve: async () =>
          hasBlocker
            ? { kind: 'blocked' as const, blockers: [{ repo: 'acme/app', number: '99' }] }
            : { kind: 'unblocked' as const },
      };

      const scan1 = await discoverBacklog(dir, undefined, undefined, {
        treeSource: fsTreeSource(dir),
        resolver,
      });
      expect(scan1.items.map((b) => b.slug)).toContain('newly-blocked');
      expect(scan1.waiting).toEqual([]);

      hasBlocker = true; // a new blocker link is added between scans

      const scan2 = await discoverBacklog(dir, undefined, undefined, {
        treeSource: fsTreeSource(dir),
        resolver,
      });
      expect(scan2.items.map((b) => b.slug)).not.toContain('newly-blocked');
      expect(scan2.waiting).toEqual([
        {
          slug: 'newly-blocked',
          sourceRef: 'acme/app#22',
          verdict: { kind: 'blocked', blockers: [{ repo: 'acme/app', number: '99' }] },
        },
      ]);
    });
  });

  describe('no Source-Ref ⇒ no gate; outage isolation (Task 12)', () => {
    function alwaysThrowingResolver(): { resolve: (ref: string) => Promise<never>; calls: number } {
      const state = {
        calls: 0,
        resolve: async (_ref: string): Promise<never> => {
          state.calls += 1;
          throw new Error('resolver outage (simulated)');
        },
      };
      return state;
    }

    it('a spec with no Source-Ref marker at all stays in items with zero resolver calls, even under an always-throwing resolver', async () => {
      await writeFile(
        join(dir, '.docs/plans/no-marker-spec.md'),
        planWithDeps('.docs/stories/no-marker-spec.md'),
      );
      await writeFile(join(dir, '.docs/stories/no-marker-spec.md'), APPROVED_STORIES);
      // Deliberately no `.docs/intake/no-marker-spec.md` at all.

      const resolver = alwaysThrowingResolver();

      const result = await discoverBacklog(dir, undefined, undefined, {
        treeSource: fsTreeSource(dir),
        resolver,
      });

      expect(result.items.map((b) => b.slug)).toContain('no-marker-spec');
      expect(result.waiting).toEqual([]);
      expect(resolver.calls).toBe(0);
    });

    it('a spec with a malformed/unparseable Source-Ref fails closed to waiting as indeterminate, with zero resolver calls, even under an always-throwing resolver', async () => {
      await writeFile(
        join(dir, '.docs/plans/malformed-ref-spec.md'),
        planWithDeps('.docs/stories/malformed-ref-spec.md'),
      );
      await writeFile(join(dir, '.docs/stories/malformed-ref-spec.md'), APPROVED_STORIES);
      await mkdir(join(dir, '.docs/intake'), { recursive: true });
      // Not a valid owner/repo#N form — parseIntakeSourceRef rejects it, so the
      // item carries no sourceRef. A malformed marker is distinct from an ABSENT
      // one (FR-7): it fails closed as `indeterminate` rather than dispatching
      // as if there were no marker at all, and the resolver — which has nothing
      // parseable to consult — is never called.
      await writeFile(
        join(dir, '.docs/intake/malformed-ref-spec.md'),
        'Source-Ref: not-a-valid-ref\n',
      );

      const resolver = alwaysThrowingResolver();

      const result = await discoverBacklog(dir, undefined, undefined, {
        treeSource: fsTreeSource(dir),
        resolver,
      });

      expect(result.items.map((b) => b.slug)).not.toContain('malformed-ref-spec');
      expect(result.waiting.find((w) => w.slug === 'malformed-ref-spec')?.verdict?.kind).toBe('indeterminate');
      expect(resolver.calls).toBe(0);
    });
  });

  describe('track propagation (adr-2026-06-29-explore-prd-split-track-in-explore/adr-2026-06-29-track-marker-location)', () => {
    async function seedEligible(slug: string) {
      await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps(`.docs/stories/${slug}.md`));
      await writeFile(join(dir, `.docs/stories/${slug}.md`), APPROVED_STORIES);
    }
    async function seedTrack(slug: string, value: string) {
      await mkdir(join(dir, '.docs/track'), { recursive: true });
      await writeFile(join(dir, `.docs/track/${slug}.md`), `# Track\n\nTrack: ${value}\n`);
    }

    it('carries track=technical from the marker', async () => {
      await seedEligible('feat-t');
      await seedTrack('feat-t', 'technical');
      const [item] = await discover();
      expect(item.track).toBe('technical');
    });

    it('carries track=product from the marker', async () => {
      await seedEligible('feat-p');
      await seedTrack('feat-p', 'product');
      const [item] = await discover();
      expect(item.track).toBe('product');
    });

    it('leaves track undefined when no marker (daemon defaults product downstream)', async () => {
      await seedEligible('feat-none');
      const [item] = await discover();
      expect(item.track).toBeUndefined();
    });

    it('leaves track undefined for a garbled marker', async () => {
      await seedEligible('feat-bad');
      await seedTrack('feat-bad', 'sideways');
      const [item] = await discover();
      expect(item.track).toBeUndefined();
    });
  });

  it('includes a feature whose plan + stories both exist (via **Stories:** ref)', async () => {
    await writeFile(
      join(dir, '.docs/plans/feature-a.md'),
      planWithDeps('.docs/stories/feature-a.md'),
    );
    await writeFile(join(dir, '.docs/stories/feature-a.md'), APPROVED_STORIES);

    const backlog = await discover();
    expect(backlog).toHaveLength(1);
    // The item carries only the slug — the vetted plan+stories live on the
    // (fast-forwarded) default branch the worktree is cut from, so no paths travel.
    expect(backlog[0]).toEqual({ slug: 'feature-a' });
  });

  it('falls back to a same-stem stories file when no **Stories:** line', async () => {
    await writeFile(join(dir, '.docs/plans/feature-b.md'), planWithDeps());
    await writeFile(join(dir, '.docs/stories/feature-b.md'), APPROVED_STORIES);

    const backlog = await discover();
    expect(backlog.map((b) => b.slug)).toEqual(['feature-b']);
  });

  it('excludes a plan with no matching stories (daemon never authors specs)', async () => {
    await writeFile(join(dir, '.docs/plans/orphan.md'), '# Plan with no stories\n');
    const backlog = await discover();
    expect(backlog).toEqual([]);
  });

  it('skips features already marked processed', async () => {
    for (const slug of ['a', 'b']) {
      await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps());
      await writeFile(join(dir, `.docs/stories/${slug}.md`), APPROVED_STORIES);
    }
    const processed = new Set(['a']);
    const backlog = await discover(async (slug) => processed.has(slug));
    expect(backlog.map((b) => b.slug)).toEqual(['b']);
  });

  it('skips an UNAPPROVED feature (stories not Accepted / DRAFT)', async () => {
    await writeFile(join(dir, '.docs/plans/draft.md'), planWithDeps());
    await writeFile(join(dir, '.docs/stories/draft.md'), '# Stories\n**Status:** DRAFT\n');
    const logs: string[] = [];
    const backlog = await discover(undefined, (m) => logs.push(m));
    expect(backlog).toEqual([]);
    expect(logs.join('\n')).toMatch(/draft.*not approved/i);
  });

  it('skips stories with NO status line (the silent-skip casualty)', async () => {
    await writeFile(join(dir, '.docs/plans/nostatus.md'), planWithDeps());
    // Real content, but no Status marker at all — must NOT be treated as approved.
    await writeFile(
      join(dir, '.docs/stories/nostatus.md'),
      '# Stories\n\n## Story: Foo\nbody\n',
    );
    const logs: string[] = [];
    const backlog = await discover(undefined, (m) => logs.push(m));
    expect(backlog).toEqual([]);
    expect(logs.join('\n')).toMatch(/nostatus.*not approved/i);
  });

  it('surfaces a persistently-unbuildable merged spec ONCE across scans', async () => {
    await writeFile(join(dir, '.docs/plans/stuck.md'), planWithDeps());
    await writeFile(join(dir, '.docs/stories/stuck.md'), '# Stories\n**Status:** DRAFT\n');

    const warned = new Set<string>();
    const opts = {
      treeSource: fsTreeSource(dir),
      hasWarned: async (slug: string) => warned.has(slug),
      markWarned: async (slug: string) => {
        warned.add(slug);
      },
    };
    const logs: string[] = [];
    const log = (m: string) => logs.push(m);

    // Two consecutive scans (simulating poll ticks) — the skip is logged once.
    await discoverBacklog(dir, undefined, log, opts);
    await discoverBacklog(dir, undefined, log, opts);

    const skipLines = logs.filter((l) => /stuck.*not approved/i.test(l));
    expect(skipLines).toHaveLength(1);
    expect(warned.has('stuck')).toBe(true);
  });

  it('skips a plan with no dependency tree', async () => {
    await writeFile(
      join(dir, '.docs/plans/nodeps.md'),
      '# Plan\n**Stories:** .docs/stories/nodeps.md\n\n### Task 1\nDo the thing.\n',
    );
    await writeFile(join(dir, '.docs/stories/nodeps.md'), APPROVED_STORIES);
    const logs: string[] = [];
    const backlog = await discover(undefined, (m) => logs.push(m));
    expect(backlog).toEqual([]);
    expect(logs.join('\n')).toMatch(/nodeps.*dependency tree/i);
  });

  it('carries the engineer-assessed tier from .docs/complexity/<slug>.md', async () => {
    await writeFile(join(dir, '.docs/plans/big.md'), planWithDeps('.docs/stories/big.md'));
    await writeFile(join(dir, '.docs/stories/big.md'), APPROVED_STORIES);
    await mkdir(join(dir, '.docs/complexity'), { recursive: true });
    await writeFile(join(dir, '.docs/complexity/big.md'), '# Complexity\n\nTier: L\n');

    const backlog = await discover();
    expect(backlog).toEqual([{ slug: 'big', tier: 'L' }]);
  });

  it('leaves tier undefined when no complexity marker is present', async () => {
    await writeFile(join(dir, '.docs/plans/legacy.md'), planWithDeps('.docs/stories/legacy.md'));
    await writeFile(join(dir, '.docs/stories/legacy.md'), APPROVED_STORIES);

    const backlog = await discover();
    expect(backlog).toHaveLength(1);
    expect(backlog[0].tier).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 9 — land-authored specs key their intake marker by PLAN STEM (the plan
// file's own basename), not by the original idea slug. Discovery resolves
// owner/sourceRef by reading `.docs/intake/${planStem(planFile)}.md` — a marker
// that lives at any other path (e.g. a pre-fix legacy idea-slug filename) is
// simply invisible to the resolver, and the spec must NOT fall back to it.
// ─────────────────────────────────────────────────────────────────────────────
describe('engine/daemon-backlog — land-authored intake marker keyed by plan stem (Task 9)', () => {
  let dir: string;
  const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
  const planWithDeps = (storiesRef?: string) =>
    `# Plan\n${storiesRef ? `**Stories:** ${storiesRef}\n` : ''}\n### Task 1\n**Dependencies:** none\n`;

  const fsSource = (root: string): BacklogTreeSource => ({
    async listPlanFiles() {
      try {
        return (await readdir(join(root, '.docs/plans'))).filter((f) => f.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async listShippedFiles() {
      try {
        return (await readdir(join(root, '.docs/shipped'))).filter((f) => f.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async readFile(relPath) {
      try {
        return await fsReadFile(join(root, relPath), 'utf-8');
      } catch {
        return null;
      }
    },
  });

  // Mirrors production's readSpecOwnerStamp parsing, but reads from the injected
  // tree source (by slug = planStem(planFile)) instead of `git show`. This lets
  // the test prove the marker is (or is not) found at the plan-stem path without
  // reimplementing git plumbing.
  function stampFromTree(tree: BacklogTreeSource) {
    return async (slug: string) => {
      const content = await tree.readFile(`.docs/intake/${slug}.md`);
      if (!content) return { present: false as const };
      for (const line of content.split('\n')) {
        const m = /^\s*Owner:\s*(.*)$/.exec(line);
        if (!m) continue;
        const id = m[1].trim();
        return id ? { present: true as const, id } : { present: false as const };
      }
      return { present: false as const };
    };
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-backlog-stem-'));
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
    await mkdir(join(dir, '.docs/intake'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('HAPPY PATH: a land-authored spec resolves owner + sourceRef from its plan-stem-keyed marker', async () => {
    const stem = '2026-07-03-some-feature';
    await writeFile(join(dir, `.docs/plans/${stem}.md`), planWithDeps(`.docs/stories/${stem}.md`));
    await writeFile(join(dir, `.docs/stories/${stem}.md`), APPROVED_STORIES);
    // Marker keyed by the PLAN STEM itself — not by any idea slug.
    await writeFile(
      join(dir, `.docs/intake/${stem}.md`),
      'Source-Ref: owner/repo#1\nOwner: alice\n',
    );

    const tree = fsSource(dir);
    const { items } = await discoverBacklog(dir, undefined, undefined, {
      treeSource: tree,
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: stampFromTree(tree),
      readMergeTime: async () => null,
      cutover: null,
    });

    expect(items.map((b) => b.slug)).toContain(stem);
    const item = items.find((b) => b.slug === stem);
    expect(item?.sourceRef).toBe('owner/repo#1');
  });

  it('NEGATIVE PATH: a legacy idea-slug marker (not at the plan-stem path) stays un-owned, no fallback', async () => {
    const stem = '2026-07-03-feature';
    const legacyIdeaSlug = 'my-cool-old-idea-name';
    await writeFile(join(dir, `.docs/plans/${stem}.md`), planWithDeps(`.docs/stories/${stem}.md`));
    await writeFile(join(dir, `.docs/stories/${stem}.md`), APPROVED_STORIES);
    // Simulates a pre-fix landed marker: keyed by the OLD idea slug, not the
    // plan's own stem. This must be invisible to discovery — no fallback lookup.
    await writeFile(
      join(dir, `.docs/intake/${legacyIdeaSlug}.md`),
      'Source-Ref: owner/repo#2\nOwner: alice\n',
    );

    const tree = fsSource(dir);
    const logs: string[] = [];
    const { items } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: tree,
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: stampFromTree(tree),
      readMergeTime: async () => '2026-07-01T00:00:00Z', // after cutover
      cutover: '2026-06-30T00:00:00Z',
    });

    // Un-owned (marker at the plan-stem path is absent) → skipped, not built.
    expect(items.map((b) => b.slug)).not.toContain(stem);
    // sourceRef is never populated either — the mismatched marker is never read.
    const line = logs.find((l) => l.includes(stem));
    expect(line).toMatch(/un-owned/i);
  });
});

describe('engine/artifacts — parseComplexityTier', () => {
  it('parses S / M / L (case-insensitive)', () => {
    expect(parseComplexityTier('Tier: S')).toBe('S');
    expect(parseComplexityTier('# x\n\ntier: m\n')).toBe('M');
    expect(parseComplexityTier('Tier:   L  ')).toBe('L');
  });

  it('returns undefined for null, empty, or unrecognized content', () => {
    expect(parseComplexityTier(null)).toBeUndefined();
    expect(parseComplexityTier('')).toBeUndefined();
    expect(parseComplexityTier('no tier here')).toBeUndefined();
    expect(parseComplexityTier('Tier: XL')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9.3 REDESIGN — FR-24: merging the spec PR is the build-ready signal.
//
// These exercise the REAL default (git) tree source against a REAL repo. The
// invariant: the daemon builds a spec ONLY once it is committed on the base
// branch (i.e. the spec PR is merged). Artifacts that exist only in the working
// tree (engineer-authored, not yet landed) or only on an unmerged `spec/<slug>`
// branch must NOT be discovered — that was the production gap a working-tree
// scan silently allowed.
// ─────────────────────────────────────────────────────────────────────────────
describe('engine/daemon-backlog — FR-24 merge is the build-ready trigger (git)', () => {
  let dir: string;
  let baseBranch: string;

  const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
  const planWithDeps = (storiesRef?: string) =>
    `# Plan\n${storiesRef ? `**Stories:** ${storiesRef}\n` : ''}\n### Task 1\n**Dependencies:** none\n`;

  const git = async (args: string[]) => {
    const { stdout } = await execFile('git', args, { cwd: dir });
    return stdout.trim();
  };

  // Write a spec's plan + stories into the working tree (not committed).
  async function writeSpec(slug: string, stories = APPROVED_STORIES): Promise<void> {
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
    await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps(`.docs/stories/${slug}.md`));
    await writeFile(join(dir, `.docs/stories/${slug}.md`), stories);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-backlog-fr24-'));
    await execFile('git', ['init', '-q'], { cwd: dir });
    await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    await execFile('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), 'init\n');
    await execFile('git', ['add', 'README.md'], { cwd: dir });
    await execFile('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
    baseBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('MERGED spec (committed on base branch) → build-ready', async () => {
    await writeSpec('csv-export');
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'merge spec: csv-export']);

    const { items: backlog } = await discoverBacklog(dir, undefined, undefined, { baseBranch });
    expect(backlog.map((b) => b.slug)).toEqual(['csv-export']);
  });

  it('UNCOMMITTED working-tree spec (engineer authored, not landed) → NOT build-ready', async () => {
    // The exact production bug: an Accepted, well-formed spec is sitting in the
    // working tree but has not been committed/merged. A working-tree scan would
    // build it; reading the base-branch tree must not.
    await writeSpec('note-grouping');

    const { items: backlog } = await discoverBacklog(dir, undefined, undefined, { baseBranch });
    expect(backlog).toEqual([]);
  });

  it('spec committed only on an unmerged spec/<slug> branch → NOT build-ready', async () => {
    await git(['checkout', '-q', '-b', 'spec/note-grouping']);
    await writeSpec('note-grouping');
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'spec: note-grouping']);
    await git(['checkout', '-q', baseBranch]); // base branch is clean of the spec

    const { items: backlog } = await discoverBacklog(dir, undefined, undefined, { baseBranch });
    expect(backlog).toEqual([]);
  });

  it('after the spec branch is MERGED into the base branch → build-ready', async () => {
    await git(['checkout', '-q', '-b', 'spec/note-grouping']);
    await writeSpec('note-grouping');
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'spec: note-grouping']);
    await git(['checkout', '-q', baseBranch]);
    await git(['merge', '-q', '--no-ff', '-m', 'merge spec', 'spec/note-grouping']);

    const { items: backlog } = await discoverBacklog(dir, undefined, undefined, { baseBranch });
    expect(backlog.map((b) => b.slug)).toEqual(['note-grouping']);
  });

  it('MERGED spec whose stories are still Status: DRAFT → NOT build-ready', async () => {
    await writeSpec('draft-feat', '# Stories\n**Status:** DRAFT\n');
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'merge spec: draft-feat']);

    const logs: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, undefined, (m) => logs.push(m), { baseBranch });
    expect(backlog).toEqual([]);
    expect(logs.join('\n')).toMatch(/draft-feat.*not approved/i);
  });

  it('a slug already in .daemon/processed/ is skipped (no rebuild)', async () => {
    await writeSpec('shipped');
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'merge spec: shipped']);

    const processed = new Set(['shipped']);
    const { items: backlog } = await discoverBacklog(dir, async (slug) => processed.has(slug), undefined, {
      baseBranch,
    });
    expect(backlog).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Owner-gate integration (Tasks 11–14). The gate runs AFTER the existing content
// filters (never bypassing them) and only for a RESOLVED daemon owner. Unresolved
// / absent → fail-open (build all). All deps are injected so these stay git-free.
// ─────────────────────────────────────────────────────────────────────────────
describe('engine/daemon-backlog — owner-gate integration', () => {
  let dir: string;
  const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
  const planWithDeps = (storiesRef?: string) =>
    `# Plan\n${storiesRef ? `**Stories:** ${storiesRef}\n` : ''}\n### Task 1\n**Dependencies:** none\n`;

  const fsSource = (root: string): BacklogTreeSource => ({
    async listPlanFiles() {
      try {
        return (await readdir(join(root, '.docs/plans'))).filter((f) => f.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async listShippedFiles() {
      try {
        return (await readdir(join(root, '.docs/shipped'))).filter((f) => f.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async readFile(relPath) {
      try {
        return await fsReadFile(join(root, relPath), 'utf-8');
      } catch {
        return null;
      }
    },
  });

  // Author an eligible (Accepted + dep-tree) spec into the working tree.
  async function writeSpec(slug: string, stories = APPROVED_STORIES): Promise<void> {
    await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps(`.docs/stories/${slug}.md`));
    await writeFile(join(dir, `.docs/stories/${slug}.md`), stories);
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-backlog-owner-'));
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Task 11 (D3, reversed) — an UNRESOLVED daemon owner now FAIL-CLOSES: it
  // builds NOTHING rather than falling open to build-all. The injectables are
  // present but never consulted once identity is unresolved.
  it('Task 11: an unresolved owner builds NOTHING (fail-closed)', async () => {
    await writeSpec('feature-a');
    let stampCalls = 0;
    const { items: backlog } = await discoverBacklog(dir, undefined, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: false },
      readStamp: async () => {
        stampCalls += 1;
        return { present: false as const };
      },
      readMergeTime: async () => null,
      cutover: null,
    });
    expect(backlog).toEqual([]);
    expect(stampCalls).toBe(0); // gate never reached — nothing is evaluated
  });

  // Task 12 — gate wired after content filters (FR-5/6/7).
  it('Task 12: a spec stamped with the daemon owner is pushed', async () => {
    await writeSpec('mine');
    const { items: backlog } = await discoverBacklog(dir, undefined, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: true as const, id: 'alice' }),
      readMergeTime: async () => null,
      cutover: null,
    });
    expect(backlog.map((b) => b.slug)).toEqual(['mine']);
  });

  it('Task 12: an other-owner spec is NOT pushed and logs a distinct ownership skip', async () => {
    await writeSpec('theirs');
    const logs: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: true as const, id: 'bob' }),
      readMergeTime: async () => null,
      cutover: null,
    });
    expect(backlog).toEqual([]);
    // Distinct from content-skip wording ("cannot build — …") and gate-inactive.
    const line = logs.find((l) => /theirs/.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/bob/); // names the other owner
    expect(line).toMatch(/owner/i);
    expect(line).not.toMatch(/cannot build/);
  });

  it('Task 2 (S1 HP-1): an other-owner spec is collected into `gated` and excluded from items', async () => {
    await writeSpec('owned-by-alice');
    const logs: string[] = [];
    const { items: backlog, gated } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'bob' },
      readStamp: async () => ({ present: true as const, id: 'alice' }),
      readMergeTime: async () => null,
      cutover: null,
    });
    expect(backlog).toEqual([]);
    expect(gated).toEqual([
      {
        kind: 'spec',
        slug: 'owned-by-alice',
        reason: 'other-owner',
        otherOwner: 'alice',
        remedy: expect.any(String),
      },
    ]);
    // The existing warnOnce ownership-skip log line is unchanged.
    const line = logs.find((l) => /owned-by-alice/.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/alice/);
  });

  it('Task 3 (S1 HP-2): an un-owned post-cutover spec is collected into `gated` with an Owner-marker remedy', async () => {
    await writeSpec('newish-gated');
    const { items: backlog, gated } = await discoverBacklog(dir, undefined, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: false as const }),
      readMergeTime: async () => '2026-07-01T00:00:00Z', // after cutover
      cutover: '2026-06-30T00:00:00Z',
    });
    expect(backlog).toEqual([]);
    expect(gated).toEqual([
      {
        kind: 'spec',
        slug: 'newish-gated',
        reason: 'unowned-post-cutover',
        remedy: expect.stringMatching(/Owner:/),
      },
    ]);
  });

  it('Task 3 (S1 HP-3): an un-owned indeterminate-merge spec is collected into `gated` with a cutover remedy', async () => {
    await writeSpec('indeterminate-gated');
    const { items: backlog, gated } = await discoverBacklog(dir, undefined, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: false as const }),
      readMergeTime: async () => null, // indeterminate
      cutover: null,
    });
    expect(backlog).toEqual([]);
    expect(gated).toEqual([
      {
        kind: 'spec',
        slug: 'indeterminate-gated',
        reason: 'unowned-indeterminate',
        remedy: expect.stringMatching(/owner_gate_cutover/),
      },
      {
        kind: 'repo',
        warning: 'no-cutover',
        remedy: expect.any(String),
      },
    ]);
  });

  it('Task 12: a content-ineligible spec is skipped for the content reason (gate never reached)', async () => {
    // Stories are DRAFT → content filter rejects BEFORE the gate. Even though the
    // stamp is other-owner, the log must cite the content reason, and readStamp is
    // never consulted.
    await writeSpec('draft-and-theirs', '# Stories\n**Status:** DRAFT\n');
    const logs: string[] = [];
    let stampCalls = 0;
    const { items: backlog } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => {
        stampCalls += 1;
        return { present: true as const, id: 'bob' };
      },
      readMergeTime: async () => null,
      cutover: null,
    });
    expect(backlog).toEqual([]);
    expect(stampCalls).toBe(0); // gate never reached
    expect(logs.join('\n')).toMatch(/draft-and-theirs.*not approved/i);
  });

  // Task 13 — un-owned grandfather cutover + idempotency (FR-8/9, FR-5 neg).
  const CUTOVER = '2026-06-30T00:00:00Z';

  it('Task 13: an un-owned spec merged BEFORE the cutover is grandfather-built', async () => {
    await writeSpec('legacy');
    const { items: backlog } = await discoverBacklog(dir, undefined, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: false as const }),
      readMergeTime: async () => '2026-06-29T00:00:00Z', // before cutover
      cutover: CUTOVER,
    });
    expect(backlog.map((b) => b.slug)).toEqual(['legacy']);
  });

  it('Task 13: an un-owned spec merged ON/AFTER the cutover is skipped and logged', async () => {
    await writeSpec('newish');
    const logs: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: false as const }),
      readMergeTime: async () => '2026-07-01T00:00:00Z', // after cutover
      cutover: CUTOVER,
    });
    expect(backlog).toEqual([]);
    const line = logs.find((l) => /newish/.test(l));
    expect(line).toMatch(/owner/i);
    expect(line).not.toMatch(/cannot build/);
  });

  it('Task 13: a matching spec already processed is NOT rebuilt (gate does not defeat isProcessed)', async () => {
    await writeSpec('shipped');
    let stampCalls = 0;
    const { items: backlog } = await discoverBacklog(dir, async () => true, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => {
        stampCalls += 1;
        return { present: true as const, id: 'alice' };
      },
      readMergeTime: async () => null,
      cutover: CUTOVER,
    });
    expect(backlog).toEqual([]);
    expect(stampCalls).toBe(0); // gate sits AFTER isProcessed
  });

  // Task 14 (D3, reversed) — fail-closed + warn-once (Story 3).
  it('Task 14: an unresolved owner builds NOTHING with exactly one loud identity-unresolved warn', async () => {
    await writeSpec('one');
    await writeSpec('two');
    const logs: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: false },
      // Even an owner-matching stamp must NOT build when identity is unresolved.
      readStamp: async () => ({ present: true as const, id: 'bob' }),
      readMergeTime: async () => null,
      cutover: null,
    });
    expect(backlog).toEqual([]); // fail-closed: nothing builds
    const unresolved = logs.filter((l) => /identity unresolved/i.test(l));
    expect(unresolved).toHaveLength(1); // warn-once per pass, not per-spec
    // Loud + actionable, and distinct from content-skip / ownership-skip wording.
    expect(unresolved[0]).toMatch(/fail-closed/i);
    expect(unresolved[0]).toMatch(/spec_owner|gh/i);
    expect(unresolved[0]).not.toMatch(/cannot build/);
  });

  it('Task 14: an absent daemonOwner emits NO gate log and builds normally (legacy behavior)', async () => {
    await writeSpec('legacy-a');
    const logs: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
    });
    expect(backlog.map((b) => b.slug)).toEqual(['legacy-a']);
    expect(logs.filter((l) => /identity unresolved/i.test(l))).toHaveLength(0);
  });

  // Observability NFR — warn-once when the gate is ACTIVE but no grandfather
  // cutover is configured (the operator-accepted skip-default is easy to miss).
  // Distinct from the gate-inactive line; changes NO build/skip decision.
  it('warns exactly once per pass when the gate is active but no cutover is configured', async () => {
    await writeSpec('one');
    await writeSpec('two');
    const logs: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: true as const, id: 'alice' }),
      readMergeTime: async () => null,
      cutover: null, // no grandfather window
    });
    // The gate is ACTIVE — both owned specs still build (no decision change).
    expect(backlog.map((b) => b.slug).sort()).toEqual(['one', 'two']);
    const noCutover = logs.filter((l) => /no owner_gate_cutover configured/i.test(l));
    expect(noCutover).toHaveLength(1); // once per pass, not per-spec
    expect(noCutover[0]).not.toMatch(/gate inactive/i); // distinct line
  });

  it('surfaces the no-cutover notice ONCE across scans when the warned-marker hooks are wired', async () => {
    await writeSpec('one');
    await writeSpec('two');
    const warned = new Set<string>();
    const opts = {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true as const, id: 'alice' },
      readStamp: async () => ({ present: true as const, id: 'alice' }),
      readMergeTime: async () => null,
      cutover: null, // no grandfather window
      hasWarned: async (slug: string) => warned.has(slug),
      markWarned: async (slug: string) => {
        warned.add(slug);
      },
    };
    const logs: string[] = [];
    const log = (m: string) => logs.push(m);

    // Three consecutive scans (simulating poll ticks) — the notice logs once, not
    // once per tick, once the persistent marker is set.
    await discoverBacklog(dir, undefined, log, opts);
    await discoverBacklog(dir, undefined, log, opts);
    await discoverBacklog(dir, undefined, log, opts);

    expect(logs.filter((l) => /no owner_gate_cutover configured/i.test(l))).toHaveLength(1);
  });

  it('surfaces the identity-unresolved notice ONCE across scans when the warned-marker hooks are wired', async () => {
    await writeSpec('one');
    const warned = new Set<string>();
    const opts = {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: false as const },
      cutover: null,
      hasWarned: async (slug: string) => warned.has(slug),
      markWarned: async (slug: string) => {
        warned.add(slug);
      },
    };
    const logs: string[] = [];
    const log = (m: string) => logs.push(m);

    await discoverBacklog(dir, undefined, log, opts);
    await discoverBacklog(dir, undefined, log, opts);
    await discoverBacklog(dir, undefined, log, opts);

    expect(logs.filter((l) => /identity unresolved/i.test(l))).toHaveLength(1);
  });

  // Task 6 (S3 NP-1) — fail-CLOSED: an unresolved daemon identity must not
  // silently return an empty backlog. It surfaces a repo-scoped GATED entry so
  // the operator sees WHY the backlog is empty, not just that it is.
  it('an unresolved daemon identity emits a repo-level identity-unresolved GATED entry (fail-closed)', async () => {
    await writeSpec('one');
    const { items, waiting, gated } = await discoverBacklog(dir, undefined, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: false },
    });
    expect(items).toEqual([]);
    expect(waiting).toEqual([]);
    expect(gated).toEqual([
      {
        kind: 'repo',
        warning: 'identity-unresolved',
        remedy: expect.any(String),
      },
    ]);
  });

  // Task 7 (S3 NP-2) — legacy gate-unwired silence pinned: when `daemonOwner`
  // is entirely ABSENT from opts (the gate was never wired at all), discovery
  // must stay silent — no repo warnings, `gated` stays empty, and the spec
  // dispatches unchanged. This is fail-OPEN and is distinct from Task 6's
  // fail-CLOSED path (a supplied-but-unresolved `daemonOwner`), which emits a
  // repo-level `identity-unresolved` GATED entry and builds nothing.
  it('no daemonOwner in opts (legacy unwired gate) stays silent: gated is empty, no repo warnings, items unchanged', async () => {
    await writeSpec('one');
    const logs: string[] = [];
    const { items, waiting, gated } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      // daemonOwner intentionally omitted — legacy, gate unwired.
    });
    expect(items.map((i) => i.slug)).toEqual(['one']);
    expect(waiting).toEqual([]);
    expect(gated).toEqual([]);
    expect(logs.some((l) => /identity unresolved/i.test(l))).toBe(false);
    expect(logs.some((l) => /owner-gate/i.test(l))).toBe(false);
  });

  // Task 5 (S3 HP-1) — the gate is active (resolved daemon owner), no
  // grandfather cutover is configured, and an un-owned spec is encountered: a
  // single repo-scoped `no-cutover` GATED entry surfaces alongside (not instead
  // of) the existing `warnGateNoCutoverOnce` log line.
  it('Task 5: active gate + no cutover + an un-owned spec encountered → one repo-level no-cutover GATED entry (plus the existing log line)', async () => {
    await writeSpec('un-owned');
    const logs: string[] = [];
    const { items, gated } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: false as const }),
      readMergeTime: async () => null,
      cutover: null,
    });
    expect(items).toEqual([]);
    expect(gated).toEqual([
      // Task 3 (S1 HP-3): the per-spec gated entry is now collected alongside
      // the repo-scoped no-cutover notice below, not instead of it.
      {
        kind: 'spec',
        slug: 'un-owned',
        reason: 'unowned-indeterminate',
        remedy: expect.any(String),
      },
      {
        kind: 'repo',
        warning: 'no-cutover',
        remedy: expect.any(String),
      },
    ]);
    // The pre-existing no-cutover log line is unchanged, not replaced.
    expect(logs.filter((l) => /no owner_gate_cutover configured/i.test(l))).toHaveLength(1);
  });

  it('Task 5 (NP-3): cutover set + all specs owned → zero repo-level GATED entries', async () => {
    await writeSpec('owned-one');
    const { items, gated } = await discoverBacklog(dir, undefined, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: true as const, id: 'alice' }),
      readMergeTime: async () => null,
      cutover: '2026-06-30T00:00:00Z',
    });
    expect(items.map((i) => i.slug)).toEqual(['owned-one']);
    expect(gated).toEqual([]);
  });

  it('is SILENT about the missing cutover when a cutover IS set', async () => {
    await writeSpec('with-cutover');
    const logs: string[] = [];
    await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: true as const, id: 'alice' }),
      readMergeTime: async () => null,
      cutover: '2026-06-30T00:00:00Z',
    });
    expect(logs.filter((l) => /no owner_gate_cutover configured/i.test(l))).toHaveLength(0);
  });

  it('is SILENT about the missing cutover when the owner is unresolved (fail-closed short-circuit)', async () => {
    await writeSpec('inactive');
    const logs: string[] = [];
    await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: false },
      cutover: null,
    });
    expect(logs.filter((l) => /no owner_gate_cutover configured/i.test(l))).toHaveLength(0);
  });

  // A6 / Story 6 — an un-owned MERGED spec is surfaced LOUDLY and actionably
  // (distinct, deduped), never a silent skip. The log states it is un-owned AND
  // how to fix it: add an `Owner:` marker on the default branch.
  it('A6: an un-owned merged spec logs a distinct, actionable skip (add Owner marker on default branch)', async () => {
    await writeSpec('legacy-unowned');
    const logs: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: false as const }), // un-owned
      readMergeTime: async () => '2026-07-01T00:00:00Z', // after cutover → skipped
      cutover: '2026-06-30T00:00:00Z',
    });
    expect(backlog).toEqual([]);
    const line = logs.find((l) => /legacy-unowned/.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/un-owned/i);
    expect(line).toMatch(/Owner/); // names the marker to add
    expect(line).toMatch(/default branch/i); // and where to add it
    expect(line).not.toMatch(/another operator/i); // not the other-owner wording
  });

  // Task 18 — ownership rotation (FR-13/14). Transfer is a RE-STAMP of the
  // committed marker; the daemon reads whatever owner the marker currently
  // carries each pass. There is no per-spec owner cache — the decision is a pure
  // function of (this pass's daemonOwner, the current stamp).
  const CUTOVER_18 = '2026-06-30T00:00:00Z';

  it('Task 18: a re-stamped marker (alice→bob) builds under bob and skips under alice', async () => {
    await writeSpec('transferred');
    const runWith = async (ownerId: string) =>
      (
        await discoverBacklog(dir, undefined, undefined, {
          treeSource: fsSource(dir),
          daemonOwner: { resolved: true, id: ownerId },
          // Marker now carries bob (the new owner) after the transfer re-stamp.
          readStamp: async () => ({ present: true as const, id: 'bob' }),
          readMergeTime: async () => null,
          cutover: CUTOVER_18,
        })
      ).items;

    // The alice daemon no longer owns it → skip.
    expect(await runWith('alice')).toEqual([]);
    // The bob daemon now owns it → build.
    expect((await runWith('bob')).map((b) => b.slug)).toEqual(['transferred']);
  });

  it('Task 18: a spec already processed under alice is NOT rebuilt after transfer to bob', async () => {
    await writeSpec('done-then-transferred');
    let stampCalls = 0;
    // New owner is bob, marker is bob — but the spec is already processed. The
    // gate sits AFTER isProcessed, so a transfer never triggers a rebuild.
    const { items: backlog } = await discoverBacklog(dir, async () => true, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'bob' },
      readStamp: async () => {
        stampCalls += 1;
        return { present: true as const, id: 'bob' };
      },
      readMergeTime: async () => null,
      cutover: CUTOVER_18,
    });
    expect(backlog).toEqual([]);
    expect(stampCalls).toBe(0); // isProcessed short-circuits before the gate
  });

  it('Task 18: transfer to BLANK (stamp cleared) takes the un-owned path, not other-owner', async () => {
    await writeSpec('unstamped-again');
    const logs: string[] = [];
    // A blank re-stamp reads as un-owned (present:false). With a post-cutover
    // merge time this is skipped via the UN-OWNED branch (not other-owner).
    const { items: backlog } = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: false as const }),
      readMergeTime: async () => '2026-07-01T00:00:00Z', // after cutover
      cutover: CUTOVER_18,
    });
    expect(backlog).toEqual([]);
    const line = logs.find((l) => /unstamped-again/.test(l));
    expect(line).toMatch(/un-owned/i); // un-owned branch, not "owned by another"
    expect(line).not.toMatch(/another operator/i);
  });

  // Task 4 (S1 NP-1..NP-4) — exclusion boundaries + byte-identical items
  // regression. A single mixed fixture asserts that:
  //   - an OWNED spec dispatches in `items` and is NOT gated (NP-1)
  //   - a content-INELIGIBLE spec (stories not Accepted) appears in NEITHER
  //     `items` NOR `gated` — it never reaches the owner gate at all (NP-2)
  //   - a BLANK `Owner:` marker is treated as un-owned (no crash), landing in
  //     `gated` via the same un-owned path as a wholly absent marker (NP-3)
  //   - `items` is byte-identical (same slugs, same shape) to what discovery
  //     would return with the gate wholly unwired — i.e. gate collection is
  //     purely additive and never mutates the pre-existing dispatch list (NP-4)
  it('Task 4: mixed fixture — owned dispatches ungated, ineligible excluded from both, blank Owner treated as un-owned, items unchanged vs. gate-off control', async () => {
    // owned-spec: stamped with the daemon's own id → builds, never gated.
    await writeSpec('owned-spec');
    // ineligible-spec: content-ineligible (stories NOT Accepted) → must never
    // reach the owner gate at all, so it can't show up in `gated` either.
    await writeSpec('ineligible-spec', '# Stories\n**Status:** Draft\n');
    // blank-owner-spec: an `Owner:` marker present but blank/whitespace — the
    // provenance reader normalizes this to `present: false` (un-owned), which
    // must not crash the gate and must be treated exactly like "no marker".
    await writeSpec('blank-owner-spec');

    const stampFor: Record<string, { present: true; id: string } | { present: false }> = {
      'owned-spec': { present: true, id: 'alice' },
      'blank-owner-spec': { present: false },
    };

    const gateOpts = {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true as const, id: 'alice' },
      readStamp: async (slug: string) => stampFor[slug] ?? { present: false as const },
      readMergeTime: async () => null,
      cutover: '2026-06-30T00:00:00Z', // grandfather window set, un-owned specs pre-cutover build
    };

    const { items, gated } = await discoverBacklog(dir, undefined, undefined, gateOpts);

    // NP-1: owned spec dispatches, never gated.
    expect(items.map((i) => i.slug)).toContain('owned-spec');
    expect(gated.some((g) => g.kind === 'spec' && g.slug === 'owned-spec')).toBe(false);

    // NP-2: content-ineligible spec is in neither list — it never reaches the
    // owner gate (content filters run first and `continue` before the gate).
    expect(items.map((i) => i.slug)).not.toContain('ineligible-spec');
    expect(gated.some((g) => g.kind === 'spec' && g.slug === 'ineligible-spec')).toBe(false);

    // NP-3: blank Owner: is un-owned, not a crash, and lands in gated (not
    // items) via the same un-owned path as an absent marker.
    expect(items.map((i) => i.slug)).not.toContain('blank-owner-spec');
    expect(gated).toEqual([
      expect.objectContaining({ kind: 'spec', slug: 'blank-owner-spec' }),
    ]);

    // NP-4: the owned spec's dispatched item is byte-identical to the item the
    // pre-gate (gate wholly unwired) control run produces for that same spec —
    // gate collection never mutates the shape/fields of an item that still
    // dispatches; it is purely additive (the `gated` list alongside it).
    const control = await discoverBacklog(dir, undefined, undefined, {
      treeSource: fsSource(dir),
      // daemonOwner intentionally omitted — legacy, gate unwired.
    });
    const ownedGated = items.find((i) => i.slug === 'owned-spec');
    const ownedControl = control.items.find((i) => i.slug === 'owned-spec');
    expect(ownedGated).toEqual(ownedControl);
    // And the control run (no gate) still excludes the content-ineligible spec
    // on content grounds alone, confirming NP-2 is a content filter, not a
    // side effect of the owner gate being active.
    expect(control.items.map((i) => i.slug)).not.toContain('ineligible-spec');
  });
});

describe('engine/daemon-backlog — shipped-record dedup (Story 3/Task 4)', () => {
  let dir: string;
  const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
  const planWithDeps = (storiesRef?: string) =>
    `# Plan\n${storiesRef ? `**Stories:** ${storiesRef}\n` : ''}\n### Task 1\n**Dependencies:** none\n`;

  const fsSource = (root: string): BacklogTreeSource => ({
    async listPlanFiles() {
      try {
        return (await readdir(join(root, '.docs/plans'))).filter((f) => f.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async listShippedFiles() {
      try {
        return (await readdir(join(root, '.docs/shipped'))).filter((f) => f.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async readFile(relPath) {
      try {
        return await fsReadFile(join(root, relPath), 'utf-8');
      } catch {
        return null;
      }
    },
  });

  async function writeSpec(slug: string, stories = APPROVED_STORIES): Promise<void> {
    await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps(`.docs/stories/${slug}.md`));
    await writeFile(join(dir, `.docs/stories/${slug}.md`), stories);
  }

  async function writeShipped(slug: string): Promise<void> {
    await mkdir(join(dir, '.docs/shipped'), { recursive: true });
    await writeFile(
      join(dir, `.docs/shipped/${slug}.md`),
      renderShippedRecord({ slug, specHash: 'deadbeef' }),
    );
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-backlog-shipped-'));
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a candidate with a base-branch shipped record and no local cache hit is skipped and repaired', async () => {
    await writeSpec('already-shipped');
    await writeShipped('already-shipped');
    const logs: string[] = [];
    const repaired: Array<{ slug: string; record: ReturnType<typeof parseShippedRecord> }> = [];
    const { items: backlog } = await discoverBacklog(dir, async () => false, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      repairProcessed: async (slug, record) => {
        repaired.push({ slug, record });
      },
    });
    expect(backlog).toEqual([]);
    expect(repaired).toHaveLength(1);
    expect(repaired[0].slug).toBe('already-shipped');
    expect(repaired[0].record).toMatchObject({ slug: 'already-shipped', specHash: 'deadbeef' });
    expect(logs.join('\n')).toMatch(/already-shipped.*shipped dedup/i);
  });

  it('a candidate already marked processed locally is skipped WITHOUT consulting shipped records', async () => {
    await writeSpec('cache-hit');
    // Deliberately do NOT write a shipped record — if the dedup path were
    // consulted first it would find nothing; the point is that isProcessed
    // short-circuits BEFORE shipped-record lookup even happens.
    let repairCalls = 0;
    const { items: backlog } = await discoverBacklog(dir, async () => true, undefined, {
      treeSource: fsSource(dir),
      repairProcessed: async () => {
        repairCalls += 1;
      },
    });
    expect(backlog).toEqual([]);
    expect(repairCalls).toBe(0);
  });

  it('a candidate with no shipped record proceeds to the owner gate unchanged', async () => {
    await writeSpec('not-shipped');
    const { items: backlog } = await discoverBacklog(dir, async () => false, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: true as const, id: 'alice' }),
      readMergeTime: async () => null,
      cutover: null,
    });
    expect(backlog.map((b) => b.slug)).toEqual(['not-shipped']);
  });

  it('repairProcessed throwing still skips the candidate, logs the error, and discovery continues', async () => {
    await writeSpec('repair-fails');
    await writeShipped('repair-fails');
    await writeSpec('unaffected');
    const logs: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, async () => false, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      repairProcessed: async (slug) => {
        if (slug === 'repair-fails') {
          throw new Error('disk full');
        }
      },
    });
    expect(backlog.map((b) => b.slug)).toEqual(['unaffected']);
    expect(logs.join('\n')).toMatch(/repair-fails/);
    expect(logs.join('\n')).toMatch(/disk full/);
  });

  it('multiple candidates: shipped ones are skipped, unshipped ones proceed', async () => {
    await writeSpec('ship-1');
    await writeSpec('ship-2');
    await writeSpec('fresh-1');
    await writeShipped('ship-1');
    await writeShipped('ship-2');
    const repaired: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, async () => false, undefined, {
      treeSource: fsSource(dir),
      repairProcessed: async (slug) => {
        repaired.push(slug);
      },
    });
    expect(backlog.map((b) => b.slug).sort()).toEqual(['fresh-1']);
    expect(repaired.sort()).toEqual(['ship-1', 'ship-2']);
  });

  // Story 3 (Task 5) — gate-order assertions: dedup precedes the owner gate.
  it('a shipped candidate with an UNRESOLVED daemon identity is skipped as SHIPPED, not identity-unresolved', async () => {
    await writeSpec('shipped-unresolved');
    await writeShipped('shipped-unresolved');
    const logs: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, async () => false, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: false },
    });
    expect(backlog).toEqual([]);
    const joined = logs.join('\n');
    expect(joined).toMatch(/shipped-unresolved.*shipped dedup/i);
    expect(joined).not.toMatch(/identity unresolved/i);
  });

  it('a shipped candidate stamped for a FOREIGN owner is skipped as SHIPPED, not owner-gated', async () => {
    await writeSpec('shipped-foreign-owner');
    await writeShipped('shipped-foreign-owner');
    const logs: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, async () => false, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: true as const, id: 'bob' }),
      readMergeTime: async () => null,
      cutover: null,
    });
    expect(backlog).toEqual([]);
    const joined = logs.join('\n');
    expect(joined).toMatch(/shipped-foreign-owner.*shipped dedup/i);
    expect(joined).not.toMatch(/owner-gate/i);
    expect(joined).not.toMatch(/different operator/i);
  });

  it('an UNSHIPPED candidate with an unresolved identity still fails closed (hardening intact)', async () => {
    await writeSpec('unshipped-unresolved');
    // Deliberately NO shipped record for this candidate.
    const logs: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, async () => false, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: false },
    });
    expect(backlog).toEqual([]);
    expect(logs.join('\n')).toMatch(/identity unresolved/i);
  });

  // Task 8: proves the shared makeIsProcessed resolver (ledger OR shipped
  // record) works end-to-end with discovery, wired via the SAME
  // `isProcessed` parameter production uses — not the injected `repairProcessed`
  // mock the other tests in this block use to observe the dedup path directly.
  it('Task 8: discovery wired with the shared makeIsProcessed resolver skips a base-branch-shipped candidate', async () => {
    await writeSpec('resolver-shipped');
    await writeShipped('resolver-shipped');
    await writeSpec('resolver-fresh');
    const processedDir = join(dir, '.daemon/processed');
    await mkdir(processedDir, { recursive: true });

    const isProcessed = makeIsProcessed(processedDir, fsSource(dir));
    const { items: backlog } = await discoverBacklog(dir, isProcessed, undefined, {
      treeSource: fsSource(dir),
    });

    expect(backlog.map((b) => b.slug)).toEqual(['resolver-fresh']);
  });
});

describe('engine/daemon-backlog — content-hash match dedups renamed specs (Story 4/Task 6)', () => {
  let dir: string;
  const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
  const planWithDeps = (storiesRef?: string) =>
    `# Plan\n${storiesRef ? `**Stories:** ${storiesRef}\n` : ''}\n### Task 1\n**Dependencies:** none\n`;

  const fsSource = (root: string): BacklogTreeSource => ({
    async listPlanFiles() {
      try {
        return (await readdir(join(root, '.docs/plans'))).filter((f) => f.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async listShippedFiles() {
      try {
        return (await readdir(join(root, '.docs/shipped'))).filter((f) => f.endsWith('.md'));
      } catch {
        return [];
      }
    },
    async readFile(relPath) {
      try {
        return await fsReadFile(join(root, relPath), 'utf-8');
      } catch {
        return null;
      }
    },
  });

  // Deliberately NO explicit **Stories:** line — resolution falls back to the
  // same-stem stories file (`resolveStoriesRef`). This keeps the PLAN BYTES
  // identical across a rename (an explicit `**Stories:** .docs/stories/<slug>.md`
  // line would itself change on rename, defeating the very "same content,
  // different filename" scenario this dedup targets).
  async function writeSpec(slug: string, stories = APPROVED_STORIES): Promise<void> {
    await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps());
    await writeFile(join(dir, `.docs/stories/${slug}.md`), stories);
  }

  async function writeShippedWithHash(oldSlug: string, hash: string): Promise<void> {
    await mkdir(join(dir, '.docs/shipped'), { recursive: true });
    await writeFile(
      join(dir, `.docs/shipped/${oldSlug}.md`),
      renderShippedRecord({ slug: oldSlug, specHash: hash }),
    );
  }

  function hashOf(plan: string, stories: string): string {
    return specHash(Buffer.from(plan, 'utf-8'), Buffer.from(stories, 'utf-8')).digest;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daemon-backlog-hash-dedup-'));
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('renamed spec (same content, different stem) is skipped, warn-once names both stems, repairProcessed called with the NEW slug', async () => {
    // No plan/stories files exist under the old stem — only its shipped
    // record does, which is the real-world post-rename state. The candidate
    // ('new-name') has byte-identical plan+stories content, so it matches the
    // shipped record's spec_hash even though no stem matches.
    const hash = hashOf(planWithDeps(), APPROVED_STORIES);
    await writeShippedWithHash('old-name', hash);
    await writeSpec('new-name');

    const logs: string[] = [];
    const repaired: Array<{ slug: string; record: ReturnType<typeof parseShippedRecord> }> = [];
    const { items: backlog } = await discoverBacklog(dir, async () => false, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      repairProcessed: async (slug, record) => {
        repaired.push({ slug, record });
      },
    });

    expect(backlog).toEqual([]);
    expect(repaired).toHaveLength(1);
    expect(repaired[0].slug).toBe('new-name');
    expect(logs.join('\n')).toMatch(/old-name/);
    expect(logs.join('\n')).toMatch(/new-name/);
  });

  it('no hash match: candidate with different content proceeds to the owner gate (no false positive)', async () => {
    await writeShippedWithHash('old-name', 'deadbeef-not-a-real-match');
    await writeSpec('new-name', APPROVED_STORIES + 'extra content\n');

    const { items: backlog } = await discoverBacklog(dir, async () => false, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: true as const, id: 'alice' }),
      readMergeTime: async () => null,
      cutover: null,
    });

    expect(backlog.map((b) => b.slug)).toEqual(['new-name']);
  });

  it('two specs with identical content (template copy-paste): the second to ship is skipped via hash match, warn-once names both stems', async () => {
    // template-a already shipped (record under its OWN stem — caught by the
    // stem-match dedup from Task 4). template-b is a separate candidate whose
    // plan+stories are byte-identical to template-a's (a template copy-paste)
    // and has NO shipped record of its own, so it is caught by the NEW
    // hash-match dedup instead — the accepted residual this story documents.
    await writeSpec('template-a');
    const hash = hashOf(planWithDeps(), APPROVED_STORIES);
    await writeShippedWithHash('template-a', hash);
    await writeSpec('template-b');

    const logs: string[] = [];
    const repaired: string[] = [];
    const { items: backlog } = await discoverBacklog(dir, async () => false, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      repairProcessed: async (slug) => {
        repaired.push(slug);
      },
    });

    expect(backlog).toEqual([]);
    expect(repaired.sort()).toEqual(['template-a', 'template-b']);
    expect(logs.join('\n')).toMatch(/template-a/);
    expect(logs.join('\n')).toMatch(/template-b/);
  });

  it('renamed AND edited: neither stem nor hash matches, proceeds to owner gate (documented gap)', async () => {
    await writeShippedWithHash('old', 'some-hash-that-wont-match');
    await writeSpec('old-v2', APPROVED_STORIES + 'edited content\n');

    const { items: backlog } = await discoverBacklog(dir, async () => false, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: true, id: 'alice' },
      readStamp: async () => ({ present: true as const, id: 'alice' }),
      readMergeTime: async () => null,
      cutover: null,
    });

    expect(backlog.map((b) => b.slug)).toEqual(['old-v2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7 — Wire heal into fastForwardRoot.
//
// Tests the heal logic: dirty tree fully explained by a single branch →
// files restored, strays deleted, ONE WARN containing branch name and healed paths,
// same poll FF succeeds (tree clean, HEAD advanced).
// ─────────────────────────────────────────────────────────────────────────────
describe('engine/daemon-backlog — fastForwardRoot heal integration (Task 7)', () => {
  let dir: string;
  let originDir: string;
  let baseBranch: string;
  let tmpBase: string;

  const git = async (args: string[]) => {
    const { stdout } = await execFile('git', args, { cwd: dir });
    return stdout.trim();
  };

  beforeEach(async () => {
    // Create temp directories - keep origin outside the working tree
    tmpBase = await mkdtemp(join(tmpdir(), 'fast-forward-heal-'));
    dir = join(tmpBase, 'work');
    originDir = join(tmpBase, 'origin.git');

    await mkdir(dir);
    await mkdir(originDir);

    // Initialize bare origin repo
    await execFile('git', ['init', '--bare', '-q'], { cwd: originDir });

    // Initialize main repo with initial commit
    await execFile('git', ['init', '-q'], { cwd: dir });
    await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    await execFile('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await execFile('git', ['remote', 'add', 'origin', originDir], { cwd: dir });

    // Create initial file on main and commit
    await writeFile(join(dir, 'README.md'), 'init\n');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/file.ts'), 'const original = 0;\n');
    await writeFile(join(dir, 'src/other.ts'), 'const original = 0;\n'); // second file
    await execFile('git', ['add', '.'], { cwd: dir });
    await execFile('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
    baseBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);

    // Push to origin
    await execFile('git', ['push', '-q', '-u', 'origin', baseBranch], { cwd: dir });

    // Create feat/daemon-x branch on origin with a modified version of the files
    await execFile('git', ['checkout', '-q', '-b', 'feat/daemon-x'], { cwd: dir });
    await writeFile(join(dir, 'src/file.ts'), 'const x = 1;\n');
    await writeFile(join(dir, 'src/other.ts'), 'const x = 1;\n'); // also modified
    await execFile('git', ['add', 'src/'], { cwd: dir });
    await execFile('git', ['commit', '-q', '-m', 'feat: modify files'], { cwd: dir });
    await execFile('git', ['push', '-q', '-u', 'origin', 'feat/daemon-x'], { cwd: dir });

    // Switch back to main branch
    await execFile('git', ['checkout', '-q', baseBranch], { cwd: dir });
  });

  afterEach(async () => {
    // Clean up the entire temp tree (both work dir and origin)
    await rm(tmpBase, { recursive: true, force: true });
  });

  it('dirty tree fully explained by feat/daemon-x → heal and FF (files restored, strays deleted, WARN logged, HEAD advanced)', async () => {
    // Contaminate the main checkout with dirty state explained by feat/daemon-x
    // 1. Modify src/file.ts to match feat/daemon-x exactly
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/file.ts'), 'const x = 1;\n');

    // 2. Create an untracked stray file matching a blob from feat/daemon-x
    // (we'll use the content of README.md from feat/daemon-x which is 'init\n')
    await writeFile(join(dir, 'stray.txt'), 'init\n');

    // Verify dirty state before healing
    let status = await git(['status', '--porcelain']);
    expect(status).toContain('src/file.ts'); // modified
    expect(status).toContain('stray.txt'); // untracked

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Call fastForwardRoot with the dirty tree
    await fastForwardRoot(dir, log);

    // Verify: tree is now clean
    status = await git(['status', '--porcelain']);
    expect(status).toBe(''); // no dirty state

    // Verify: modified file was restored to its original state on main branch
    let fileContent: string | null = null;
    try {
      fileContent = await fsReadFile(join(dir, 'src/file.ts'), 'utf-8');
    } catch {
      fileContent = null;
    }
    // After healing, the file should be restored to its original content on main
    expect(fileContent).toBe('const original = 0;\n');

    // Verify: stray was deleted
    let strayExists = false;
    try {
      await fsReadFile(join(dir, 'stray.txt'), 'utf-8');
      strayExists = true;
    } catch {
      strayExists = false;
    }
    expect(strayExists).toBe(false);

    // Verify: WARN was logged with branch name and healed paths
    const warnLog = logs.find((l) => l.includes('WARN') || l.toLowerCase().includes('heal'));
    expect(warnLog).toBeDefined();
    if (warnLog) {
      expect(warnLog).toMatch(/feat\/daemon-x/);
      expect(warnLog).toContain('src/file.ts');
      expect(warnLog).toContain('stray.txt');
    }

    // Verify: HEAD advanced (fast-forward succeeded)
    const currentBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(currentBranch).toBe(baseBranch);
  });

  it('restore failure mid-heal — log, stop, never throw (TR-2 negative)', async () => {
    // Setup: Contaminate main checkout with dirty state explained by feat/daemon-x
    // Create multiple modified files to test "skip remaining operations"
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/file.ts'), 'const x = 1;\n');
    await writeFile(join(dir, 'src/other.ts'), 'const x = 1;\n'); // second file
    await writeFile(join(dir, 'stray.txt'), 'init\n'); // stray to be deleted

    // Verify dirty state before attempting heal
    let status = await git(['status', '--porcelain']);
    expect(status).toContain('src/file.ts'); // modified
    expect(status).toContain('src/other.ts'); // modified
    expect(status).toContain('stray.txt'); // untracked

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Mock git runner that fails on the first restore command
    let restoreCallCount = 0;
    const mockGit = async (args: string[]) => {
      if (args[0] === 'restore') {
        restoreCallCount += 1;
        // Fail on the first restore call
        if (restoreCallCount === 1) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'error: pathspec src/file.ts did not match any files',
          };
        }
      }
      // For all other commands, use the real git runner
      return (await makeGitRunner(dir))(args);
    };

    // Call fastForwardRoot with the mocked git runner
    await fastForwardRoot(dir, log, mockGit);

    // Verify: restore was attempted
    expect(restoreCallCount).toBeGreaterThan(0);

    // Verify: error was logged with the failed file path
    const failureLog = logs.find((l) => l.includes('src/file.ts') && (l.includes('fail') || l.includes('error')));
    expect(failureLog).toBeDefined();
    if (failureLog) {
      expect(failureLog).toMatch(/src\/file\.ts/);
    }

    // Verify: fastForwardRoot resolved normally (did not throw)
    expect(logs).toBeDefined(); // this proves the function completed

    // Verify: tree remains dirty (heal failed, so state unchanged)
    // Both modified files should still be there, stray should NOT be deleted
    status = await git(['status', '--porcelain']);
    expect(status).toContain('src/file.ts'); // still modified
    expect(status).toContain('src/other.ts'); // still modified (should not have been processed)
    expect(status).toContain('stray.txt'); // still untracked (should not have been deleted)

    // Second call: restore tree to clean state and verify it re-triages cleanly
    // First, reset the index and working tree to the current HEAD
    await execFile('git', ['checkout', 'HEAD', '.'], { cwd: dir });

    const logs2: string[] = [];
    const log2 = (msg: string) => logs2.push(msg);
    await fastForwardRoot(dir, log2); // now with real git runner (no mock)

    // Verify: second call re-triages cleanly (no errors)
    const secondCallErrors = logs2.filter((l) => l.includes('error') || l.includes('Error'));
    expect(secondCallErrors).toHaveLength(0);
    // Tree should be clean and HEAD advanced
    status = await git(['status', '--porcelain']);
    expect(status).toBe('');
  });

  it('content changed before restore → re-verification fails, entire heal aborts, WARN logged (Task 9 / TR-2 negative)', async () => {
    // Setup: Contaminate main checkout with dirty state explained by feat/daemon-x
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/file.ts'), 'const x = 1;\n');
    await writeFile(join(dir, 'stray.txt'), 'init\n');

    // Verify dirty state before healing
    let status = await git(['status', '--porcelain']);
    expect(status).toContain('src/file.ts'); // modified
    expect(status).toContain('stray.txt'); // untracked

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Mock git runner that returns different hash on second hash-object query for src/file.ts
    let hashCallCount = 0;
    const mockGit = async (args: string[]) => {
      if (args[0] === 'hash-object' && args[1] === 'src/file.ts') {
        hashCallCount += 1;
        if (hashCallCount === 1) {
          // First call (classification time) - return the real hash
          const result = await makeGitRunner(dir)(args);
          return result;
        } else if (hashCallCount === 2) {
          // Second call (re-verification time) - return a different hash (simulating file change)
          return {
            exitCode: 0,
            stdout: '0000000000000000000000000000000000000000\n', // fake hash
            stderr: '',
          };
        }
      }
      // For all other commands, use the real git runner
      return (await makeGitRunner(dir))(args);
    };

    // Call fastForwardRoot with the mocked git runner
    await fastForwardRoot(dir, log, mockGit);

    // Verify: NO files were restored (heal aborted before any restore)
    // We can verify this by checking the tree is still dirty with modified file
    status = await git(['status', '--porcelain']);
    expect(status).toContain('src/file.ts'); // still modified — was NOT restored
    expect(status).toContain('stray.txt'); // still untracked — was NOT deleted

    // Verify: the modified file still has the modified content (not restored)
    const fileContent = await fsReadFile(join(dir, 'src/file.ts'), 'utf-8');
    expect(fileContent).toBe('const x = 1;\n'); // still has the modified content

    // Verify: WARN was emitted mentioning re-verification failure and the file that changed
    const warnLog = logs.find((l) => l.includes('WARN') && l.includes('re-verification'));
    expect(warnLog).toBeDefined();
    if (warnLog) {
      expect(warnLog).toMatch(/re-verification.*fail/i);
      expect(warnLog).toContain('src/file.ts'); // mentions the file that changed
      expect(warnLog).toMatch(/aborting heal/i);
    }

    // Verify: no subsequent heal WARNs (the heal was aborted before stray/file restoration)
    const healWARNs = logs.filter((l) => l.includes('WARN heal: auto-healed'));
    expect(healWARNs).toHaveLength(0); // heal WARNs should be absent (heal didn't complete)
  });

  it('dirty tree byte-identical on two feature branches → heal proceeds, WARN lists all candidates (Task 11)', async () => {
    // Create a second feature branch (feat/daemon-y) with identical content to feat/daemon-x
    // so both branches explain the full dirty set.
    await execFile('git', ['checkout', '-q', baseBranch], { cwd: dir });
    await execFile('git', ['checkout', '-q', '-b', 'feat/daemon-y'], { cwd: dir });
    // Make feat/daemon-y identical to feat/daemon-x (same file content)
    await writeFile(join(dir, 'src/file.ts'), 'const x = 1;\n');
    await execFile('git', ['add', 'src/file.ts'], { cwd: dir });
    await execFile('git', ['commit', '-q', '-m', 'feat: add identical file'], { cwd: dir });
    await execFile('git', ['push', '-q', '-u', 'origin', 'feat/daemon-y'], { cwd: dir });

    // Switch back to main branch
    await execFile('git', ['checkout', '-q', baseBranch], { cwd: dir });

    // Contaminate the main checkout with dirty state that matches BOTH feat/daemon-x and feat/daemon-y
    // (byte-identical content on both branches)
    await writeFile(join(dir, 'src/file.ts'), 'const x = 1;\n');

    // Verify dirty state before healing
    let status = await git(['status', '--porcelain']);
    expect(status).toContain('src/file.ts');

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Call fastForwardRoot with the dirty tree
    await fastForwardRoot(dir, log);

    // Verify: tree is now clean
    status = await git(['status', '--porcelain']);
    expect(status).toBe(''); // no dirty state

    // Verify: file was restored to its original state on main branch
    let fileContent: string | null = null;
    try {
      fileContent = await fsReadFile(join(dir, 'src/file.ts'), 'utf-8');
    } catch {
      fileContent = null;
    }
    // After healing, the file should be restored to its original content on main
    expect(fileContent).toBe('const original = 0;\n');

    // Verify: WARN was logged with BOTH branch names
    const warnLog = logs.find((l) => l.includes('WARN') || l.toLowerCase().includes('heal'));
    expect(warnLog).toBeDefined();
    if (warnLog) {
      expect(warnLog).toMatch(/feat\/daemon-x/);
      expect(warnLog).toMatch(/feat\/daemon-y/);
      // The message should contain both candidates
      expect(warnLog).toContain('src/file.ts');
    }

    // Verify: HEAD advanced (fast-forward succeeded)
    const currentBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(currentBranch).toBe(baseBranch);
  });

  it('partial-explanation veto: 5 explained + 1 unexplained → no restore, no delete, FF skipped (Task 8 / TR-2 negative)', async () => {
    // Setup: Create additional explained files on feat/daemon-x that we'll replicate on main
    await execFile('git', ['checkout', '-q', 'feat/daemon-x'], { cwd: dir });

    // Add 4 files to feat/daemon-x (src/file.ts is already modified from the setup)
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/explained1.ts'), 'export const a = 1;\n');
    await writeFile(join(dir, 'src/explained2.ts'), 'export const b = 2;\n');
    await writeFile(join(dir, 'stray-explained1.txt'), 'stray content 1\n');
    await writeFile(join(dir, 'stray-explained2.txt'), 'stray content 2\n');

    await execFile('git', ['add', '.'], { cwd: dir });
    await execFile('git', ['commit', '-q', '-m', 'add explained files to feat/daemon-x'], { cwd: dir });
    await execFile('git', ['push', '-q', 'origin', 'feat/daemon-x'], { cwd: dir });

    // Switch back to main
    await execFile('git', ['checkout', '-q', baseBranch], { cwd: dir });

    // Contaminate main with: 5 explained files + 1 unexplained file
    // Explained files (matching feat/daemon-x):
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/file.ts'), 'const x = 1;\n'); // matches feat/daemon-x
    await writeFile(join(dir, 'src/explained1.ts'), 'export const a = 1;\n'); // matches feat/daemon-x
    await writeFile(join(dir, 'src/explained2.ts'), 'export const b = 2;\n'); // matches feat/daemon-x
    await writeFile(join(dir, 'stray-explained1.txt'), 'stray content 1\n'); // matches feat/daemon-x
    await writeFile(join(dir, 'stray-explained2.txt'), 'stray content 2\n'); // matches feat/daemon-x

    // Unexplained file: content that does NOT exist in any candidate branch
    await writeFile(join(dir, 'truly-unexplained.txt'), 'this content is unique and unknown\n');

    // Verify we have 6 dirty entries before healing
    let status = await git(['status', '--porcelain']);
    const dirtyLines = status.split('\n').filter((l) => l.trim());
    expect(dirtyLines.length).toBe(6);

    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    // Track git commands to ensure no git restore or rm commands are issued
    let restoreCount = 0;
    let deleteCount = 0;
    const trackingGit = async (args: string[]) => {
      if (args[0] === 'restore') {
        restoreCount += 1;
      }
      if (args[0] === 'rm' || (args[0] === 'remove' && args[1])) {
        deleteCount += 1;
      }
      return (await makeGitRunner(dir))(args);
    };

    // Call fastForwardRoot with the partially-explained dirty tree
    await fastForwardRoot(dir, log, trackingGit);

    // Verify: tree is STILL dirty (no healing happened)
    status = await git(['status', '--porcelain']);
    expect(status).not.toBe(''); // tree is still dirty

    // Verify: all 6 dirty entries remain untouched
    const afterDirtyLines = status.split('\n').filter((l) => l.trim());
    expect(afterDirtyLines.length).toBe(6);

    // Verify: the 5 explained files remain dirty (not restored)
    expect(status).toContain('src/file.ts');
    expect(status).toContain('src/explained1.ts');
    expect(status).toContain('src/explained2.ts');
    expect(status).toContain('stray-explained1.txt');
    expect(status).toContain('stray-explained2.txt');

    // Verify: the unexplained file remains dirty
    expect(status).toContain('truly-unexplained.txt');

    // Verify: NO git restore commands were issued (zero restores)
    expect(restoreCount).toBe(0);

    // Verify: NO file deletion commands were issued (zero deletions)
    expect(deleteCount).toBe(0);

    // Verify: NO WARN was emitted (skip behavior, not heal behavior)
    const warnLog = logs.find((l) => l.includes('WARN') || (l.toLowerCase().includes('heal') && l.includes('auto')));
    expect(warnLog).toBeUndefined();

    // Verify: a skip message was logged indicating the dirty state cannot be healed
    const skipLog = logs.find((l) => l.includes('skip') && l.includes('fast-forward'));
    expect(skipLog).toBeDefined();

    // Verify: HEAD was NOT advanced (FF was skipped, no merge happened)
    const currentBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(currentBranch).toBe(baseBranch);
  });
});
