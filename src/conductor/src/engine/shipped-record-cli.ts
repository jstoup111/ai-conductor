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
//
// Stream discipline: success and progress go to STDOUT; only genuine failures
// (usage, degraded rollups, the write-failed warn) go to STDERR. The daemon
// calls `dispatchShippedRecord` IN-PROCESS (finish-publication-production.ts),
// and `daemon-cli.ts` tees `console.error` into `.daemon/daemon.log` stamped
// `[error]` — so a success line written to stderr makes every completed ship
// read as a failure in the operator's log.

import { readFile, readdir } from 'node:fs/promises';
import { join, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import {
  appendTimingSection,
  appendBuildReviewAcceptedRisk,
  appendBuildReviewMetrics,
  specHash,
  renderShippedRecord,
  renderShippedRecordWithCost,
  resolveEngineVersion,
  writeShippedRecord,
} from './shipped-record.js';
import { BuildReviewDispositionStore } from './build-review-dispositions.js';
import { computeCostRollup } from './cost-rollup.js';
import { computeTimingRollup } from './timing-rollup.js';
import { withEngineCommitEnv } from './engine-commit-env.js';
import { resolveShipmentIdentity } from './shipment-identity.js';
import { resolveMainRepoRoot } from './park-marker.js';
import { computeBuildReviewMetrics, readMergedFeatureEvents } from './build-tail-rollup.js';

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

  const { slug: requestedSlug, pr } = cmd;
  try {
    const planPaths = (await readdir(join(cwd, '.docs/plans')))
      .filter((name) => name.endsWith('.md'))
      .map((name) => join('.docs/plans', name));
    const resolution = resolveShipmentIdentity(requestedSlug, planPaths);
    if (resolution.kind !== 'resolved') {
      const detail = resolution.kind === 'ambiguous'
        ? `ambiguous plan candidates: ${resolution.candidates.join(', ')}`
        : `plan not found: ${resolution.expected}`;
      throw new Error(detail);
    }
    const { identity } = resolution;
    const planBytes = await readFile(join(cwd, identity.planPath));
    const storiesBytes = await readStoriesBytes(cwd, identity.slug, planBytes.toString('utf-8'));
    const { digest } = specHash(planBytes, storiesBytes);

    const relPath = identity.recordPath;
    // Cost accounting must NEVER block ship: if the rollup itself throws for
    // any reason, fall back to the plain frontmatter-only record (no Cost
    // block) rather than let the error propagate into the outer catch (which
    // would still exit 0, but would also skip the record entirely).
    // Stamp the engine build that shipped this feature, so daemon-version KPIs
    // can attribute each ship to a build. Resolved from this module's own path
    // (a fresh `conduct shipped-record` process has no pidfile to read) and
    // never throws — see resolveEngineVersion.
    const engineVersion = resolveEngineVersion(dirname(fileURLToPath(import.meta.url)));
    const fields = {
      slug: identity.slug,
      specHash: digest,
      pr,
      shipped: todayIso(),
      engineVersion,
    };

    let recordBody: string;
    try {
      const rollup = await computeCostRollup(cwd);
      recordBody = renderShippedRecordWithCost(fields, rollup);
    } catch (err) {
      console.error(
        `cost rollup failed — shipped record written without a Cost block for ${identity.slug}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      recordBody = renderShippedRecord(fields);
    }

    // Timing has an independent degrade-never-block boundary: a missing or
    // unreadable ledger must not discard a safe Cost result, and a Cost
    // failure must not prevent timing from being computed and committed.
    try {
      recordBody = appendTimingSection(
        recordBody,
        await computeTimingRollup(cwd),
      );
    } catch (err) {
      console.error(
        `timing rollup failed — shipped record written with unavailable Time for ${identity.slug}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      recordBody = appendTimingSection(recordBody, { state: 'unavailable' });
    }
    try {
      recordBody = appendBuildReviewMetrics(
        recordBody,
        computeBuildReviewMetrics(await readMergedFeatureEvents(cwd) ?? []),
      );
    } catch (err) {
      console.error(
        `build-review rollup failed — shipped record written without a Build Review block for ${identity.slug}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    // The feature worktree owns its disposition ledger; repository identity
    // is deliberately canonical so a linked checkout cannot forge a separate
    // accepted-risk namespace.
    // Accepted-risk evidence is part of the retained shipment contract.  It
    // therefore deliberately differs from the legacy Cost/Time best-effort
    // rollups above: unreadable or unrenderable disposition state must stop
    // FINISH rather than silently produce an incomplete record.
    try {
      const repository = await resolveMainRepoRoot(cwd);
      const dispositions = await new BuildReviewDispositionStore(cwd).list({
        version: 'v1', repository, feature: identity.slug,
      });
      if (!dispositions.ok) throw new Error(dispositions.message);
      recordBody = appendBuildReviewAcceptedRisk(recordBody, dispositions.records);
    } catch (err) {
      console.error(
        `shipped-record accepted-risk evidence failed for ${identity.slug}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 1;
    }
    await writeShippedRecord(join(cwd, relPath), recordBody);

    await execa('git', ['add', relPath], { cwd });
    // Only commit when the add actually staged a change — an idempotent re-run
    // (identical content already committed) must not create a duplicate commit.
    const staged = await execa('git', ['diff', '--cached', '--quiet', '--', relPath], {
      cwd,
      reject: false,
    });
    if (staged.exitCode !== 0) {
      await execa('git', ['commit', '-m', `shipped record: ${identity.slug}`, '--no-verify'], {
        cwd,
        env: withEngineCommitEnv(),
      });
      console.log(`  ✓ shipped record committed: ${relPath}`);
    } else {
      console.log(`  ✓ shipped record already committed: ${relPath}`);
    }
    return 0;
  } catch (err) {
    // Story 2 negative path: one canonical warn, exit 0 — the ship must
    // proceed; dedup degrades to the local ledger cache for this slug.
    console.error(
      `shipped-record write failed — dedup degraded to local cache for ${requestedSlug}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 0;
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
