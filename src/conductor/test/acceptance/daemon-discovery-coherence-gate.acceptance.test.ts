// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "DECIDE-phase coherence ownership at the daemon
// boundary" (#971) — Stories 4 and 5.
// .docs/stories/2026-07-26-daemon-decide-phase-coherence-ownership-971.md
// ADR D3/D4: .docs/decisions/adr-2026-07-26-daemon-decide-preseed-ownership.md
//
// These drive the REAL production entry point — `discoverBacklog` against the
// REAL git-backed tree source (no injected fake tree), the convention already
// established by shipped-work-dedup.acceptance.test.ts and
// daemon-backlog.test.ts. The observable artifact is the backlog itself: a
// warn-skipped spec never enters it, so no worktree is created and no build
// starts.
//
// Scope (ADR D4): discovery performs a PRESENCE-AND-SHAPE check only. The deep
// semantic validator (coherence-validator.ts) stays at `land` — it needs a git
// change set discovery does not have. These specs must therefore never assert
// semantic coverage verdicts, only presence/parseability.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';

const execFile = promisify(execFileCb);

let dir: string;
let baseBranch: string;

const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
const PLAN = (slug: string) =>
  `# Plan\n**Stories:** .docs/stories/${slug}.md\n\n### Task 1\n\n## Task Dependency Graph\n\n**Dependencies:** none\n`;

/** A minimal well-formed coherence artifact: a table with >= 1 data row. */
const COHERENCE_TABLE =
  '# Coherence\n\n' +
  '| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |\n' +
  '|---|---|---|---|---|\n' +
  '| story | story-1 | task-1 | covered | mapped |\n';

const git = async (args: string[]) => {
  const { stdout } = await execFile('git', args, { cwd: dir });
  return stdout.trim();
};

async function writeFileIn(rel: string, content: string): Promise<void> {
  const abs = join(dir, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, content);
}

/**
 * Commit a merged, otherwise-eligible spec on the base branch: approved
 * stories, a plan with a dependency tree, and a complexity marker at `tier`.
 * `coherence` writes `.docs/coherence/<slug>.md`; omit it for "no artifact".
 */
async function commitSpec(
  slug: string,
  opts: { tier?: string | null; coherence?: string; coherenceStem?: string } = {},
): Promise<void> {
  await writeFileIn(`.docs/plans/${slug}.md`, PLAN(slug));
  await writeFileIn(`.docs/stories/${slug}.md`, APPROVED_STORIES);
  if (opts.tier !== null) {
    await writeFileIn(`.docs/complexity/${slug}.md`, `# Complexity\n\nTier: ${opts.tier ?? 'M'}\n`);
  }
  if (opts.coherence !== undefined) {
    await writeFileIn(`.docs/coherence/${opts.coherenceStem ?? slug}.md`, opts.coherence);
  }
  await git(['add', '.docs']);
  await git(['commit', '-q', '-m', `merge spec: ${slug}`]);
}

async function discover(log: string[] = []) {
  return discoverBacklog(dir, async () => false, (m) => log.push(m), { baseBranch });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'daemon-coherence-gate-'));
  await execFile('git', ['init', '-b', 'main', '-q'], { cwd: dir });
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

// ─── Story 4 ─────────────────────────────────────────────────────────────────
// A missing or invalid required coherence artifact is rejected before BUILD.

describe('Story 4 — discovery rejects a missing or invalid required coherence artifact', () => {
  it('happy: an M-tier spec with a present, non-empty, parseable artifact is dispatched normally', async () => {
    await commitSpec('valid-m-spec', { tier: 'M', coherence: COHERENCE_TABLE });

    const { items } = await discover();

    expect(items.map((i) => i.slug)).toEqual(['valid-m-spec']);
  });

  it('negative: an M-tier spec with NO coherence artifact is warn-skipped and never enters the backlog', async () => {
    await commitSpec('no-artifact', { tier: 'M' });

    const log: string[] = [];
    const { items } = await discover(log);

    expect(items).toEqual([]);
    const warnings = log.filter((l) => /coherence/i.test(l));
    // Exactly one operator-visible line, naming slug, reason and remedy.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no-artifact');
    expect(warnings[0]).toMatch(/\.docs\/coherence\/no-artifact\.md/);
    expect(warnings[0], 'the remedy must be named').toMatch(/default branch/i);
  });

  it('negative: an empty or whitespace-only artifact is warn-skipped — presence alone does not satisfy the check', async () => {
    await commitSpec('empty-artifact', { tier: 'M', coherence: '' });
    await commitSpec('blank-artifact', { tier: 'M', coherence: '   \n\n\t\n' });

    const { items } = await discover();

    expect(items.map((i) => i.slug)).toEqual([]);
  });

  it('negative: an artifact with no parseable table is warn-skipped — unparseable is treated as absent', async () => {
    await commitSpec('prose-only', {
      tier: 'M',
      coherence: '# Coherence\n\nJust prose. No table here at all.\n',
    });

    const { items } = await discover();

    expect(items).toEqual([]);
  });

  it('negative: a table with a header but ZERO data rows is warn-skipped', async () => {
    await commitSpec('header-only', {
      tier: 'M',
      coherence:
        '# Coherence\n\n' +
        '| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |\n' +
        '|---|---|---|---|---|\n',
    });

    const { items } = await discover();

    expect(items).toEqual([]);
  });

  it('negative: an artifact under a NON-MATCHING stem does not satisfy the check', async () => {
    // The check resolves by plan stem only — an unrelated file in the same
    // directory must never satisfy it.
    await commitSpec('real-stem', {
      tier: 'M',
      coherence: COHERENCE_TABLE,
      coherenceStem: 'some-other-feature',
    });

    const { items } = await discover();

    expect(items).toEqual([]);
  });

  it('negative: the warning is emitted ONCE per slug via the durable marker channel, not on every poll', async () => {
    await commitSpec('warn-once', { tier: 'M' });

    const warned = new Set<string>();
    const log: string[] = [];
    const opts = {
      baseBranch,
      hasWarned: async (slug: string) => warned.has(slug),
      markWarned: async (slug: string) => {
        warned.add(slug);
      },
    } as Parameters<typeof discoverBacklog>[3];

    await discoverBacklog(dir, async () => false, (m) => log.push(m), opts);
    await discoverBacklog(dir, async () => false, (m) => log.push(m), opts);
    await discoverBacklog(dir, async () => false, (m) => log.push(m), opts);

    expect(log.filter((l) => /coherence/i.test(l))).toHaveLength(1);
    expect(warned.has('warn-once')).toBe(true);
  });

  it('negative: an ALREADY-SHIPPED spec is never warned about for a missing artifact — shipped dedup keeps precedence', async () => {
    await commitSpec('already-shipped', { tier: 'M' });
    await writeFileIn(
      '.docs/shipped/already-shipped.md',
      '---\nslug: already-shipped\nspec_hash: abc123\npr: https://example.test/pr/1\nshipped: 2026-07-01\n---\n',
    );
    await git(['add', '.docs/shipped']);
    await git(['commit', '-q', '-m', 'shipped record']);

    const log: string[] = [];
    const { items } = await discover(log);

    expect(items).toEqual([]);
    expect(
      log.filter((l) => /coherence/i.test(l)),
      'a shipped spec must be reported as shipped, never as a missing-coherence skip',
    ).toEqual([]);
  });
});

// ─── Story 5 ─────────────────────────────────────────────────────────────────
// The Small-tier exemption is preserved exactly.

describe('Story 5 — the Small-tier exemption is preserved exactly', () => {
  it('happy: an S-tier spec with NO coherence artifact enters the backlog normally', async () => {
    await commitSpec('small-no-artifact', { tier: 'S' });

    const log: string[] = [];
    const { items } = await discover(log);

    expect(items.map((i) => i.slug)).toEqual(['small-no-artifact']);
    expect(items[0].tier).toBe('S');
    expect(log.filter((l) => /coherence/i.test(l))).toEqual([]);
  });

  it('negative: an S-tier spec that DOES carry an artifact is still accepted — presence is never a failure', async () => {
    await commitSpec('small-with-artifact', { tier: 'S', coherence: COHERENCE_TABLE });

    const { items } = await discover();

    expect(items.map((i) => i.slug)).toEqual(['small-with-artifact']);
  });

  it('negative: an UNRESOLVED tier (no complexity marker) is NOT treated as S-exempt — the gate fails closed', async () => {
    await commitSpec('no-tier-marker', { tier: null });

    const log: string[] = [];
    const { items } = await discover(log);

    expect(items, 'a missing complexity marker must not bypass the coherence gate').toEqual([]);
    expect(log.filter((l) => /coherence/i.test(l))).toHaveLength(1);
  });

  it('negative: an UNPARSEABLE tier marker is NOT treated as S-exempt either', async () => {
    await writeFileIn('.docs/plans/garbled-tier.md', PLAN('garbled-tier'));
    await writeFileIn('.docs/stories/garbled-tier.md', APPROVED_STORIES);
    await writeFileIn('.docs/complexity/garbled-tier.md', '# Complexity\n\nnot a tier line at all\n');
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'merge spec: garbled-tier']);

    const { items } = await discover();

    expect(items).toEqual([]);
  });

  it('happy: an unresolved tier WITH a valid artifact still dispatches — the gate rejects on the artifact, not the marker', async () => {
    // Fail-closed must mean "require the artifact", not "reject the spec".
    await commitSpec('no-tier-but-coherent', { tier: null, coherence: COHERENCE_TABLE });

    const { items } = await discover();

    expect(items.map((i) => i.slug)).toEqual(['no-tier-but-coherent']);
  });
});
