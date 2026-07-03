import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "content-aware shipped-work dedup: never re-dispatch
// or re-kick specs whose implementation already merged" (#204, #205).
//
// These drive the REAL production entry point — `discoverBacklog` against the
// REAL git-backed `BacklogTreeSource` (no injected fake tree, exactly the FR-24
// convention already established in daemon-backlog.test.ts) — with an EMPTY
// local ledger (`isProcessed` always false), simulating the exact scenario the
// bug reports describe: a fresh clone / wiped `.daemon/` directory. If the
// daemon's only dedup memory is the local `.daemon/processed/` cache, these
// tests dispatch a spec that has already shipped — the production gap. Once
// `.docs/shipped/<stem>.md` (Story 2/3/4) exists, they must NOT.
//
// `specHash` (src/engine/shipped-record.ts) does not exist yet at RED time, so
// it is loaded dynamically per test rather than via a static top-level import —
// a static import of a missing module would error the whole file at
// collection time (not a valid RED), whereas a per-test dynamic import fails
// with a clean "not yet implemented" reason inside the test body.
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const SHIPPED_RECORD_MOD = '../../src/engine/shipped-record.js';

async function specHash(
  planBytes: string,
  storiesBytes: string | null,
): Promise<{ digest: string; storiesIncluded: boolean }> {
  const mod = (await import(SHIPPED_RECORD_MOD)) as Record<string, unknown>;
  const fn = mod.specHash;
  if (typeof fn !== 'function') {
    throw new Error('expected export "specHash" to be a function (not yet implemented)');
  }
  return (fn as (p: Buffer, s: Buffer | null) => { digest: string; storiesIncluded: boolean })(
    Buffer.from(planBytes),
    storiesBytes ? Buffer.from(storiesBytes) : null,
  );
}

let dir: string;
let baseBranch: string;

const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
const planWithDeps = (storiesRef?: string) =>
  `# Plan\n${storiesRef ? `**Stories:** ${storiesRef}\n` : ''}\n### Task 1\n**Dependencies:** none\n`;

const git = async (args: string[]) => {
  const { stdout } = await execFile('git', args, { cwd: dir });
  return stdout.trim();
};

/** Write a spec's plan + stories into the working tree (not committed yet). */
async function writeSpec(slug: string, stories = APPROVED_STORIES): Promise<void> {
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  await mkdir(join(dir, '.docs/stories'), { recursive: true });
  await writeFile(join(dir, `.docs/plans/${slug}.md`), planWithDeps(`.docs/stories/${slug}.md`));
  await writeFile(join(dir, `.docs/stories/${slug}.md`), stories);
}

/** Hand-author a shipped record per Story 2's committed frontmatter contract. */
function shippedRecordBody(fields: {
  slug: string;
  specHash: string;
  pr?: string;
  shipped?: string;
}): string {
  return (
    `---\n` +
    `slug: ${fields.slug}\n` +
    `spec_hash: ${fields.specHash}\n` +
    `pr: ${fields.pr ?? 'https://github.com/acme/repo/pull/999'}\n` +
    `shipped: ${fields.shipped ?? '2026-07-01'}\n` +
    `---\n`
  );
}

async function commitShippedRecord(
  stem: string,
  body: string,
  { commit = true }: { commit?: boolean } = {},
): Promise<void> {
  await mkdir(join(dir, '.docs/shipped'), { recursive: true });
  await writeFile(join(dir, `.docs/shipped/${stem}.md`), body);
  if (commit) {
    await git(['add', '.docs/shipped']);
    await git(['commit', '-q', '-m', `shipped record: ${stem}`]);
  }
}

async function commitSpec(slug: string, stories = APPROVED_STORIES): Promise<void> {
  await writeSpec(slug, stories);
  await git(['add', '.docs']);
  await git(['commit', '-q', '-m', `merge spec: ${slug}`]);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shipped-dedup-acceptance-'));
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

// Always-false isProcessed: the exact "fresh clone / wiped .daemon/" scenario —
// the local ledger has no memory at all, so ONLY the base-branch shipped record
// can prevent a replay.
const emptyLedger = async () => false;

describe('shipped-work dedup acceptance (#204): committed record never re-dispatches (real git)', () => {
  it('a shipped spec with an empty local ledger is skipped, and the cache is repaired', async () => {
    await commitSpec('billing-export');
    await commitShippedRecord('billing-export', shippedRecordBody({
      slug: 'billing-export',
      specHash: 'irrelevant-for-stem-match',
    }));

    const repaired: string[] = [];
    const backlog = await discoverBacklog(dir, emptyLedger, undefined, {
      baseBranch,
      repairProcessed: async (slug: string) => {
        repaired.push(slug);
      },
    } as Parameters<typeof discoverBacklog>[3]);

    expect(backlog).toEqual([]);
    expect(repaired).toContain('billing-export');
  });

  it('a shipped record that exists only in the WORKING TREE (uncommitted) is ignored — dispatch proceeds', async () => {
    // Mirrors the FR-24 rule already enforced for plans/stories: only the
    // base-branch tree is authoritative. An uncommitted shipped record must not
    // suppress dispatch of a spec that is otherwise eligible on the base branch.
    await commitSpec('uncommitted-feat');
    await commitShippedRecord(
      'uncommitted-feat',
      shippedRecordBody({ slug: 'uncommitted-feat', specHash: 'whatever' }),
      { commit: false },
    );

    const backlog = await discoverBacklog(dir, emptyLedger, undefined, { baseBranch });
    expect(backlog.map((b) => b.slug)).toEqual(['uncommitted-feat']);
  });

  it('a malformed shipped record (no frontmatter) still dedups by stem and does not crash discovery', async () => {
    await commitSpec('malformed-feat');
    await commitShippedRecord('malformed-feat', '# Not a shipped record\n\njust prose.\n');

    const log: string[] = [];
    const backlog = await discoverBacklog(dir, emptyLedger, (m) => log.push(m), { baseBranch });

    expect(backlog).toEqual([]);
    expect(log.some((l) => /malformed/i.test(l))).toBe(true);
  });

  it('a shipped record whose plan/stories were since deleted from the base branch dispatches nothing and does not crash', async () => {
    // Record exists but there is no candidate at all (plan/stories removed) —
    // an inert record must not blow up the scan of other candidates.
    await commitShippedRecord('ghost-feat', shippedRecordBody({ slug: 'ghost-feat', specHash: 'x' }));
    await commitSpec('other-feat');

    const backlog = await discoverBacklog(dir, emptyLedger, undefined, { baseBranch });
    expect(backlog.map((b) => b.slug)).toEqual(['other-feat']);
  });
});

describe('shipped-work dedup acceptance (#204, rename-proof): content-hash match across stems (real git)', () => {
  it('a candidate renamed after shipping is skipped by content hash, and both stems are logged', async () => {
    const planBytes = planWithDeps('.docs/stories/old-name.md');
    const storiesBytes = APPROVED_STORIES;
    const { digest } = await specHash(planBytes, storiesBytes);

    await commitShippedRecord('old-name', shippedRecordBody({ slug: 'old-name', specHash: digest }));

    // A DIFFERENT stem, but byte-identical plan+stories content → same hash.
    // A pure `git mv` of the plan file does NOT rewrite its content, so the
    // plan still references `.docs/stories/old-name.md` (which still exists) —
    // discovery resolves the stories via that ref and hashes the exact bytes
    // the shipped record hashed. A rename that ALSO rewrites internal refs is
    // "renamed AND content-edited" — the ADR's documented residual, asserted
    // separately below.
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
    await writeFile(join(dir, '.docs/plans/new-name.md'), planBytes);
    await writeFile(join(dir, '.docs/stories/old-name.md'), storiesBytes);
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'merge spec: new-name (renamed)']);

    const repaired: string[] = [];
    const log: string[] = [];
    const backlog = await discoverBacklog(dir, emptyLedger, (m) => log.push(m), {
      baseBranch,
      repairProcessed: async (slug: string) => {
        repaired.push(slug);
      },
    } as Parameters<typeof discoverBacklog>[3]);

    expect(backlog).toEqual([]);
    expect(repaired).toContain('new-name');
    expect(log.some((l) => l.includes('old-name') && l.includes('new-name'))).toBe(true);
  });

  it('a candidate whose content does NOT match any shipped hash proceeds normally (no false positive)', async () => {
    const planBytes = planWithDeps('.docs/stories/shipped-one.md');
    const { digest } = await specHash(planBytes, APPROVED_STORIES);
    await commitShippedRecord('shipped-one', shippedRecordBody({ slug: 'shipped-one', specHash: digest }));

    // Distinct stem AND distinct content — must not be caught by stem or hash.
    await commitSpec('unrelated-feat', APPROVED_STORIES);

    const backlog = await discoverBacklog(dir, emptyLedger, undefined, { baseBranch });
    expect(backlog.map((b) => b.slug)).toEqual(['unrelated-feat']);
  });

  it('a spec that was BOTH renamed and content-edited after shipping is dispatched (documented residual)', async () => {
    const planBytes = planWithDeps('.docs/stories/orig.md');
    const { digest } = await specHash(planBytes, APPROVED_STORIES);
    await commitShippedRecord('orig', shippedRecordBody({ slug: 'orig', specHash: digest }));

    // Renamed AND edited: neither stem nor hash matches the shipped record.
    await commitSpec('orig-v2', '# Stories\n**Status:** Accepted\n\nEdited after shipping.\n');

    const backlog = await discoverBacklog(dir, emptyLedger, undefined, { baseBranch });
    expect(backlog.map((b) => b.slug)).toEqual(['orig-v2']);
  });
});
