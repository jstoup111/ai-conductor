import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';
import { renderShippedRecord, specHash } from '../../src/engine/shipped-record.js';

// ─────────────────────────────────────────────────────────────────────────────
// Final integration gate for "Content-aware shipped-work dedup: never
// re-dispatch or re-kick specs whose implementation already merged" (#204,
// #205) — Task 14 (final task).
//
// Fixture: the exact post-merge state Story 6's Done-When targets — a fresh
// clone (or a wiped `.daemon/` cache) of a repo where every spec on the base
// branch has ALREADY shipped and has a committed `.docs/shipped/<stem>.md`
// record, but the local `.daemon/processed/` ledger is completely empty.
//
// Because `isProcessed` here is the always-false "empty ledger" resolver (no
// `.daemon/processed/` marker will ever hit), the ONLY thing that can prevent
// a replay is the base-branch `.docs/shipped/` record dedup wired in Story 3.
// This test proves that end-to-end: `discoverBacklog` must return an EMPTY
// backlog even though 24 specs exist on the base branch, because every one of
// them already has a matching shipped record.
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';

const planWithDeps = (storiesRef: string) =>
  `# Plan\n**Stories:** ${storiesRef}\n\n### Task 1\n**Dependencies:** none\n`;

// Simulates a fresh clone / wiped `.daemon/` directory: the local ledger has
// no memory of anything at all.
const emptyLedger = async () => false;

let dir: string;
let baseBranch: string;

const git = async (args: string[]) => {
  const { stdout } = await execFile('git', args, { cwd: dir });
  return stdout.trim();
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'empty-ledger-replay-guard-'));
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

describe('empty-ledger replay guard (Task 14, final): 24 shipped specs, empty .daemon/processed', () => {
  it('discoverBacklog returns zero backlog items when every candidate already has a committed shipped record', async () => {
    await mkdir(join(dir, '.docs/plans'), { recursive: true });
    await mkdir(join(dir, '.docs/stories'), { recursive: true });
    await mkdir(join(dir, '.docs/shipped'), { recursive: true });

    const stems = Array.from({ length: 24 }, (_, i) => `already-shipped-spec-${i}`);

    for (const stem of stems) {
      const storiesRef = `.docs/stories/${stem}.md`;
      const planBytes = planWithDeps(storiesRef);
      await writeFile(join(dir, `.docs/plans/${stem}.md`), planBytes);
      await writeFile(join(dir, `.docs/stories/${stem}.md`), APPROVED_STORIES);

      const { digest } = specHash(Buffer.from(planBytes), Buffer.from(APPROVED_STORIES));
      const recordContent = renderShippedRecord({
        slug: stem,
        specHash: digest,
        pr: `https://github.com/acme/repo/pull/${1000 + stems.indexOf(stem)}`,
        shipped: '2026-07-01',
      });
      await writeFile(join(dir, `.docs/shipped/${stem}.md`), recordContent);
    }

    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'merge 24 already-shipped specs + their shipped records']);

    // The local ledger is EMPTY — no `.daemon/processed/` directory exists at
    // all, mirroring a fresh clone. `isProcessed` always resolves false.
    const { items: backlog } = await discoverBacklog(dir, emptyLedger, undefined, { baseBranch });

    expect(backlog).toEqual([]);
  });
});
