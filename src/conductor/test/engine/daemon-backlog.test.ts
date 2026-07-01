import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile as fsReadFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  discoverBacklog,
  type BacklogTreeSource,
} from '../../src/engine/daemon-backlog.js';
import { parseComplexityTier } from '../../src/engine/artifacts.js';

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
  const discover = (
    isProcessed?: (slug: string) => Promise<boolean>,
    log?: (m: string) => void,
  ) => discoverBacklog(dir, isProcessed, log, { treeSource: fsTreeSource(dir) });

  it('returns [] when there is no plans dir', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'empty-'));
    expect(await discoverBacklog(empty, undefined, undefined, { treeSource: fsTreeSource(empty) })).toEqual(
      [],
    );
    await rm(empty, { recursive: true, force: true });
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

    const backlog = await discoverBacklog(dir, undefined, undefined, { baseBranch });
    expect(backlog.map((b) => b.slug)).toEqual(['csv-export']);
  });

  it('UNCOMMITTED working-tree spec (engineer authored, not landed) → NOT build-ready', async () => {
    // The exact production bug: an Accepted, well-formed spec is sitting in the
    // working tree but has not been committed/merged. A working-tree scan would
    // build it; reading the base-branch tree must not.
    await writeSpec('note-grouping');

    const backlog = await discoverBacklog(dir, undefined, undefined, { baseBranch });
    expect(backlog).toEqual([]);
  });

  it('spec committed only on an unmerged spec/<slug> branch → NOT build-ready', async () => {
    await git(['checkout', '-q', '-b', 'spec/note-grouping']);
    await writeSpec('note-grouping');
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'spec: note-grouping']);
    await git(['checkout', '-q', baseBranch]); // base branch is clean of the spec

    const backlog = await discoverBacklog(dir, undefined, undefined, { baseBranch });
    expect(backlog).toEqual([]);
  });

  it('after the spec branch is MERGED into the base branch → build-ready', async () => {
    await git(['checkout', '-q', '-b', 'spec/note-grouping']);
    await writeSpec('note-grouping');
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'spec: note-grouping']);
    await git(['checkout', '-q', baseBranch]);
    await git(['merge', '-q', '--no-ff', '-m', 'merge spec', 'spec/note-grouping']);

    const backlog = await discoverBacklog(dir, undefined, undefined, { baseBranch });
    expect(backlog.map((b) => b.slug)).toEqual(['note-grouping']);
  });

  it('MERGED spec whose stories are still Status: DRAFT → NOT build-ready', async () => {
    await writeSpec('draft-feat', '# Stories\n**Status:** DRAFT\n');
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'merge spec: draft-feat']);

    const logs: string[] = [];
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m), { baseBranch });
    expect(backlog).toEqual([]);
    expect(logs.join('\n')).toMatch(/draft-feat.*not approved/i);
  });

  it('a slug already in .daemon/processed/ is skipped (no rebuild)', async () => {
    await writeSpec('shipped');
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'merge spec: shipped']);

    const processed = new Set(['shipped']);
    const backlog = await discoverBacklog(dir, async (slug) => processed.has(slug), undefined, {
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

  // Task 11 — baseline unchanged: passing the (unresolved) gate deps builds the
  // same set as today. The four injectables compile as opts and are inert here.
  it('Task 11: unresolved owner deps leave the baseline set unchanged', async () => {
    await writeSpec('feature-a');
    const backlog = await discoverBacklog(dir, undefined, undefined, {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: false },
      readStamp: async () => ({ present: false as const }),
      readMergeTime: async () => null,
      cutover: null,
    });
    expect(backlog).toEqual([{ slug: 'feature-a' }]);
  });

  // Task 12 — gate wired after content filters (FR-5/6/7).
  it('Task 12: a spec stamped with the daemon owner is pushed', async () => {
    await writeSpec('mine');
    const backlog = await discoverBacklog(dir, undefined, undefined, {
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
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
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

  it('Task 12: a content-ineligible spec is skipped for the content reason (gate never reached)', async () => {
    // Stories are DRAFT → content filter rejects BEFORE the gate. Even though the
    // stamp is other-owner, the log must cite the content reason, and readStamp is
    // never consulted.
    await writeSpec('draft-and-theirs', '# Stories\n**Status:** DRAFT\n');
    const logs: string[] = [];
    let stampCalls = 0;
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
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
    const backlog = await discoverBacklog(dir, undefined, undefined, {
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
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
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
    const backlog = await discoverBacklog(dir, async () => true, undefined, {
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

  // Task 14 — fail-open + warn-once (FR-3, FR-11).
  it('Task 14: an unresolved owner builds every content-eligible spec (incl. other-owner) with exactly one gate-inactive warn', async () => {
    await writeSpec('one');
    await writeSpec('two');
    const logs: string[] = [];
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: false },
      // Even an other-owner stamp must NOT gate anything out when unresolved.
      readStamp: async () => ({ present: true as const, id: 'bob' }),
      readMergeTime: async () => null,
      cutover: null,
    });
    expect(backlog.map((b) => b.slug).sort()).toEqual(['one', 'two']);
    const inactive = logs.filter((l) => /gate inactive/i.test(l));
    expect(inactive).toHaveLength(1); // warn-once per pass, not per-spec
    // Distinct from content-skip and ownership-skip wording.
    expect(inactive[0]).not.toMatch(/cannot build/);
  });

  it('Task 14: an absent daemonOwner emits NO gate log (legacy behavior)', async () => {
    await writeSpec('legacy-a');
    const logs: string[] = [];
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
    });
    expect(backlog.map((b) => b.slug)).toEqual(['legacy-a']);
    expect(logs.filter((l) => /gate inactive/i.test(l))).toHaveLength(0);
  });

  // Observability NFR — warn-once when the gate is ACTIVE but no grandfather
  // cutover is configured (the operator-accepted skip-default is easy to miss).
  // Distinct from the gate-inactive line; changes NO build/skip decision.
  it('warns exactly once per pass when the gate is active but no cutover is configured', async () => {
    await writeSpec('one');
    await writeSpec('two');
    const logs: string[] = [];
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
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

  it('is SILENT about the missing cutover when the gate is inactive (unresolved owner)', async () => {
    await writeSpec('inactive');
    const logs: string[] = [];
    await discoverBacklog(dir, undefined, (m) => logs.push(m), {
      treeSource: fsSource(dir),
      daemonOwner: { resolved: false },
      cutover: null,
    });
    expect(logs.filter((l) => /no owner_gate_cutover configured/i.test(l))).toHaveLength(0);
  });

  // Task 18 — ownership rotation (FR-13/14). Transfer is a RE-STAMP of the
  // committed marker; the daemon reads whatever owner the marker currently
  // carries each pass. There is no per-spec owner cache — the decision is a pure
  // function of (this pass's daemonOwner, the current stamp).
  const CUTOVER_18 = '2026-06-30T00:00:00Z';

  it('Task 18: a re-stamped marker (alice→bob) builds under bob and skips under alice', async () => {
    await writeSpec('transferred');
    const runWith = (ownerId: string) =>
      discoverBacklog(dir, undefined, undefined, {
        treeSource: fsSource(dir),
        daemonOwner: { resolved: true, id: ownerId },
        // Marker now carries bob (the new owner) after the transfer re-stamp.
        readStamp: async () => ({ present: true as const, id: 'bob' }),
        readMergeTime: async () => null,
        cutover: CUTOVER_18,
      });

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
    const backlog = await discoverBacklog(dir, async () => true, undefined, {
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
    const backlog = await discoverBacklog(dir, undefined, (m) => logs.push(m), {
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
});
