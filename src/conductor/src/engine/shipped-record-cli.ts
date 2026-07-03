// `conduct shipped-record --slug <slug> --pr <url|local>` — write and commit the
// `.docs/shipped/<slug>.md` record on the CURRENT branch (ADR
// adr-2026-07-03-committed-shipped-record-dispatch-dedup, Decision 1 / Story 2).
//
// Invoked by the /finish skill inside the feature worktree, on the
// implementation branch, BEFORE the branch's final push — so the human merge
// that lands the code atomically lands the "this spec shipped" fact. Never
// invoked for `discard`/`keep` finishes (nothing ships → no record).
//
// Degrade-never-block (Story 2 negative path): ANY failure — unreadable plan,
// fs error, git error — prints a single canonical warn and exits 0. A missing
// record only means dedup falls back to the local `.daemon/processed/` cache;
// it must never fail an otherwise successful ship.

import { readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { execa } from 'execa';
import {
  specHash,
  renderShippedRecord,
  writeShippedRecord,
} from './shipped-record.js';

export type ShippedRecordDispatch =
  | { kind: 'write'; slug: string; pr: string }
  | { kind: 'guide' };

/**
 * Parse argv for the `shipped-record` subcommand.
 *   conduct shipped-record --slug <slug> --pr <url|local> → {kind:'write', ...}
 *   conduct shipped-record [anything malformed]           → {kind:'guide'}
 *   (any other sub)                                       → null
 *
 * Malformed args return `guide` (never null): a recognized-but-misused
 * subcommand must never fall through to the pipeline launcher (the
 * `render-diagrams` lesson, bug #178).
 */
export function detectShippedRecordCommand(argv: string[]): ShippedRecordDispatch | null {
  if (argv[2] !== 'shipped-record') return null;
  const rest = argv.slice(3);
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    if (i === -1) return undefined;
    const v = rest[i + 1];
    return v && !v.startsWith('--') ? v : undefined;
  };
  const slug = flag('--slug');
  const pr = flag('--pr');
  if (!slug || !pr) return { kind: 'guide' };
  return { kind: 'write', slug, pr };
}

/** The stories file the record's hash covers: the plan's `**Stories:**` ref
 * when it resolves, else the same-stem fallback — the SAME resolution order
 * `discoverBacklog` uses, so a record hash and a candidate hash computed from
 * identical committed bytes always agree. */
async function readStoriesBytes(
  cwd: string,
  slug: string,
  planContent: string,
): Promise<Buffer | null> {
  const m = planContent.match(/^\s*\*\*Stories:\*\*\s*`?([^\s`]+)`?/im);
  if (m && !isAbsolute(m[1])) {
    try {
      return await readFile(join(cwd, m[1]));
    } catch {
      /* fall through to the stem fallback */
    }
  }
  try {
    return await readFile(join(cwd, '.docs/stories', `${slug}.md`));
  } catch {
    return null;
  }
}

export async function dispatchShippedRecord(
  cmd: ShippedRecordDispatch,
  cwd: string,
): Promise<number> {
  if (cmd.kind === 'guide') {
    console.error(
      'conduct shipped-record --slug <slug> --pr <url|local>\n' +
        '  Writes and commits .docs/shipped/<slug>.md on the CURRENT branch, hashing\n' +
        '  .docs/plans/<slug>.md (+ its stories file) so the daemon never re-dispatches\n' +
        '  this spec once the branch merges. Run by /finish on the implementation\n' +
        '  branch before its final push; pass --pr local for merge-local finishes.',
    );
    return 1;
  }

  const { slug, pr } = cmd;
  try {
    const planBytes = await readFile(join(cwd, '.docs/plans', `${slug}.md`));
    const storiesBytes = await readStoriesBytes(cwd, slug, planBytes.toString('utf-8'));
    const { digest } = specHash(planBytes, storiesBytes);

    const relPath = join('.docs', 'shipped', `${slug}.md`);
    await writeShippedRecord(
      join(cwd, relPath),
      renderShippedRecord({ slug, specHash: digest, pr, shipped: todayIso() }),
    );

    await execa('git', ['add', relPath], { cwd });
    // Only commit when the add actually staged a change — an idempotent re-run
    // (identical content already committed) must not create a duplicate commit.
    const staged = await execa('git', ['diff', '--cached', '--quiet', '--', relPath], {
      cwd,
      reject: false,
    });
    if (staged.exitCode !== 0) {
      await execa('git', ['commit', '-m', `shipped record: ${slug}`, '--no-verify'], { cwd });
      console.error(`  ✓ shipped record committed: ${relPath}`);
    } else {
      console.error(`  ✓ shipped record already committed: ${relPath}`);
    }
    return 0;
  } catch (err) {
    // Story 2 negative path: one canonical warn, exit 0 — the ship must
    // proceed; dedup degrades to the local ledger cache for this slug.
    console.error(
      `shipped-record write failed — dedup degraded to local cache for ${slug}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 0;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
