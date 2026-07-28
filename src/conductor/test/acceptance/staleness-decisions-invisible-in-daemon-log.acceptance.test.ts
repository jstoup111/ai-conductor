/**
 * RED acceptance specs for jstoup111/ai-conductor#982 (desired outcome 5),
 * stem `staleness-decisions-invisible-in-daemon-log`.
 *
 * Stories: `.docs/stories/staleness-decisions-invisible-in-daemon-log.md`
 * Plan:    `.docs/plans/staleness-decisions-invisible-in-daemon-log.md`
 * ADR:     `.docs/decisions/adr-2026-07-26-event-sink-registry-exhaustiveness.md`
 *
 * Two independent defects keep a staleness decision invisible today, and both
 * are exercised here through REAL production entry points rather than through
 * the new primitives the plan introduces (writing-system-tests §3b/§3d):
 *
 *   1. The payload cannot express the distinction. `verdictFreshness` carries a
 *      boolean `fresh`; the diff-preserve path and the genuinely-rewritten path
 *      both report `fresh: true`, and three of the four preserve short-circuits
 *      populate nothing at all. Driven via `checkStepCompletion` — the real
 *      dispatcher over `CUSTOM_COMPLETION_PREDICATES` — never via a predicate
 *      helper in isolation, so an implementation that adds an `outcome` field
 *      but forgets a return site still shows RED.
 *   2. No payload reaches a sink. Driven via the real `AuditTrailWriter`
 *      subscription, the real `EventPersister` subscription, and the real
 *      exported `renderDaemonEvent` — the three sinks named by the ADR.
 *
 * §3d call-site enumeration for the reporting path (the derivation is
 * "which staleness class applied"; its production call sites are):
 *   - src/engine/artifacts.ts:1657   manual_test preserve short-circuit
 *   - src/engine/artifacts.ts:1836   prd_audit preserve short-circuit
 *   - src/engine/artifacts.ts:1870   prd_audit mtime-stale reject
 *   - src/engine/artifacts.ts:1889   prd_audit pass
 *   - src/engine/artifacts.ts:1928   architecture_review_as_built preserve
 *   - src/engine/artifacts.ts:1960   architecture_review_as_built mtime-stale
 *   - src/engine/artifacts.ts:1990   architecture_review_as_built pass
 *   - src/engine/artifacts.ts:2026   build_review preserve
 *   - src/engine/artifacts.ts:2046   build_review mtime-stale / missing
 *   - src/engine/artifacts.ts:2080   build_review pass
 *   - src/engine/conductor.ts:4414   the sole `verdict_freshness` emit
 *   - src/daemon-cli.ts:1956         renderDaemonEventUnsafe (the switch)
 *   - src/daemon-cli.ts:856-865      `renderableEvents` — the per-feature
 *     subscription literal. NOTE: this is a SECOND hand-maintained list, held
 *     separately from both the switch and the plan's `EVENT_SINKS` registry.
 *     Adding `case 'verdict_freshness'` to the switch alone leaves the line
 *     unreachable in a real daemon run, which is precisely the Story 1
 *     observable. The last spec below pins that wiring.
 *
 * Real scratch git repos are required (not a fake `getHeadSha`) because the
 * preserve decision runs a real `git diff`/ancestry check; the fixture mirrors
 * `test/engine/redispatch-gate-validity.acceptance.test.ts`, whose encoding
 * findings (sidecar paths, clean-PASS marker shape, `origin/main..HEAD` feature
 * surface derivation) are reused verbatim.
 *
 * Story 3 (registry totality fails `tsc`) and Story 4 (derived sink sets equal
 * the pre-refactor literals) are deliberately NOT covered here: both are
 * single-module, compile-time/pure-comparison assertions with no multi-step
 * flow, so per writing-system-tests §3a they belong to the plan's Task 1/3/4
 * unit tests, not to an acceptance spec.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, utimes, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import chalk from 'chalk';

import {
  checkStepCompletion,
  PRD_AUDIT_CODE_STAMP,
  ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP,
  MANUAL_TEST_FAIL_EVIDENCE,
} from '../../src/engine/artifacts.js';
import { currentCommitSha } from '../../src/engine/project-prelude.js';
import { AuditTrailWriter, type AuditRecord } from '../../src/engine/audit-trail.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';
import type { ConductorEvent } from '../../src/types/index.js';

const execFile = promisify(execFileCb);

const OLD_MTIME = new Date(2000, 0, 1);

/**
 * The three-way discriminator this feature introduces
 * (`VerdictFreshnessOutcome`, plan Task 2). Declared locally rather than
 * imported so these specs COMPILE against today's tree and fail at RUNTIME on
 * the missing value — a spec that failed to typecheck would be a collection
 * error, which writing-system-tests §6 explicitly rejects as non-RED.
 */
type ExpectedOutcome = 'rewritten' | 'preserved_surface_miss' | 'stale_invalidated';

/** Reads the outcome discriminator off a completion result without assuming it exists yet. */
function outcomeOf(result: { verdictFreshness?: Record<string, unknown> }): ExpectedOutcome | undefined {
  return result.verdictFreshness?.outcome as ExpectedOutcome | undefined;
}

/** Builds a `verdict_freshness` event carrying the not-yet-declared `outcome` field. */
function verdictFreshnessEvent(
  outcome: ExpectedOutcome,
  overrides: Partial<Record<string, unknown>> = {},
): ConductorEvent {
  return {
    type: 'verdict_freshness',
    step: 'build_review',
    artifact: '/repo/.pipeline/build-review.json',
    fresh: outcome !== 'stale_invalidated',
    floorSource: 'attempt',
    mtimeMs: 1_700_000_000_000,
    floorMs: 1_700_000_001_000,
    outcome,
    ...overrides,
  } as unknown as ConductorEvent;
}

interface Scratch {
  repo: string;
  g: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  origin?: string;
}

const scratches: string[] = [];
afterEach(async () => {
  while (scratches.length) {
    await rm(scratches.pop()!, { recursive: true, force: true });
  }
});

async function makeRepo(): Promise<Scratch> {
  const repo = await mkdtemp(join(tmpdir(), 'staleness-report-'));
  scratches.push(repo);
  const g = (args: string[]) => execFile('git', args, { cwd: repo, encoding: 'utf8' as const });
  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  await g(['config', 'user.email', 't@t.com']);
  await g(['config', 'user.name', 'T']);
  await g(['config', 'commit.gpgsign', 'false']);
  await mkdir(join(repo, '.pipeline'), { recursive: true });
  // `.pipeline/` is run evidence, not code — gitignore it so `git add .` never
  // sweeps a just-written verdict into the delta under test and self-
  // invalidates a surface-miss scenario.
  await writeFile(join(repo, '.gitignore'), '.pipeline/\n');
  await g(['add', '.gitignore']);
  await g(['commit', '-q', '-m', 'chore: gitignore .pipeline']);
  return { repo, g };
}

async function commit(
  { repo, g }: Scratch,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(repo, rel);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, content);
  }
  await g(['add', '.']);
  await g(['commit', '-q', '-m', message]);
  return (await g(['rev-parse', 'HEAD'])).stdout.trim();
}

/**
 * `deriveFeatureSurface` resolves the feature's own runtime surface `F` from
 * `origin/<default>..HEAD`, reading `refs/remotes/origin/HEAD` — without a real
 * origin it fails open to `F = []` and every feature-runtime case would read as
 * a surface MISS regardless of what changed.
 */
async function setupOrigin(s: Scratch): Promise<void> {
  const bare = await mkdtemp(join(tmpdir(), 'staleness-report-origin-'));
  scratches.push(bare);
  await execFile('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  await s.g(['remote', 'add', 'origin', bare]);
  await s.g(['push', '-q', 'origin', 'HEAD:main']);
  await s.g(['fetch', '-q', 'origin']);
  await s.g(['remote', 'set-head', 'origin', '-a']);
  s.origin = bare;
}

/**
 * Lands a commit on `origin/main` and merges it back — the only way to put a
 * path in the delta while keeping it OUTSIDE the feature surface `F`, since
 * anything committed straight onto the feature branch is part of `F` by
 * construction.
 */
async function pushForeignCommit(
  s: Scratch & { origin: string },
  files: Record<string, string>,
  message: string,
): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'staleness-report-foreign-'));
  scratches.push(tmp);
  await execFile('git', ['clone', '-q', s.origin, tmp]);
  const g2 = (args: string[]) => execFile('git', args, { cwd: tmp });
  await g2(['config', 'user.email', 't@t.com']);
  await g2(['config', 'user.name', 'T']);
  await g2(['config', 'commit.gpgsign', 'false']);
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(tmp, rel);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, content);
  }
  await g2(['add', '.']);
  await g2(['commit', '-q', '-m', message]);
  await g2(['push', '-q', 'origin', 'HEAD:main']);
  await s.g(['fetch', '-q', 'origin']);
  await s.g(['merge', '-q', '--no-edit', 'origin/main']);
}

/** A feature branch whose own file (`featureA.ts`) is introduced solely by it. */
async function featureRepo(): Promise<{ s: Scratch; baseline: string }> {
  const s = await makeRepo();
  await commit(s, { 'base.ts': 'base\n' }, 'main: init');
  await setupOrigin(s);
  const baseline = await commit(s, { 'featureA.ts': 'f1\n' }, 'feat: add featureA');
  return { s, baseline };
}

function ctxFor(repo: string, extra: Record<string, unknown> = {}) {
  return {
    sessionStartedAt: Date.now(),
    attemptStartedAt: Date.now(),
    getHeadSha: () => currentCommitSha(repo),
    ...extra,
  };
}

/** build-review.json holds its codeStamp INLINE; backdated so only a stamp can preserve it. */
async function writeBuildReviewVerdict(
  repo: string,
  verdict: 'PASS' | 'FAIL',
  codeStamp?: string,
  mtime: Date | null = OLD_MTIME,
): Promise<string> {
  const path = join(repo, '.pipeline/build-review.json');
  const body: Record<string, unknown> = { verdict, rubric: {} };
  if (codeStamp) body.codeStamp = codeStamp;
  await writeFile(path, JSON.stringify(body, null, 2));
  if (mtime) await utimes(path, mtime, mtime);
  return path;
}

/** prd_audit / as_built keep their codeStamp in a SEPARATE sidecar, never in the report body. */
async function writeMdVerdict(
  repo: string,
  relPath: string,
  body: string,
  codeStamp: string | undefined,
  sidecarRelPath: string,
): Promise<string> {
  const path = join(repo, relPath);
  await writeFile(path, body);
  await utimes(path, OLD_MTIME, OLD_MTIME);
  if (codeStamp) {
    const sidecarPath = join(repo, sidecarRelPath);
    await mkdir(join(sidecarPath, '..'), { recursive: true });
    await writeFile(sidecarPath, JSON.stringify({ codeStamp }, null, 2));
  }
  return path;
}

/** A "clean PASS" manual-test marker: codeStamp set, no headSha, no failRows. */
async function writeManualTestVerdict(repo: string, codeStamp?: string): Promise<void> {
  const path = join(repo, '.pipeline/manual-test-results.md');
  await writeFile(path, MANUAL_TEST_PASS);
  await utimes(path, OLD_MTIME, OLD_MTIME);
  if (codeStamp) {
    await writeFile(join(repo, MANUAL_TEST_FAIL_EVIDENCE), JSON.stringify({ codeStamp }, null, 2));
  }
}

const PRD_HEADER = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|----|----|----|----|----|\n';
const PRD_ALIGNED = PRD_HEADER + '| FR-1 | ALIGNED | n/a | foo.ts:1 | — |\n';
const ARCH_APPROVED = '# As-Built Review\n\nVerdict: APPROVED\n';
const MANUAL_TEST_PASS =
  '# Manual Test Results\n\n## Attempt 1 — 2026-07-22T10:00:00Z\n\n' +
  '| Story | Result |\n|---|---|\n| Foo | PASS |\n';

// ---------------------------------------------------------------------------
// Story 1 — a preserved verdict is reported, not silent
// ---------------------------------------------------------------------------

describe('Story 1: a preserve is reported as preserved_surface_miss, never as a plain pass', () => {
  it('build_review preserve reports preserved_surface_miss, not rewritten', async () => {
    const s = await makeRepo();
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeBuildReviewVerdict(s.repo, 'PASS', baseline);

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));

    expect(result.done).toBe(true);
    // Fails today: the preserve path reports `fresh: true`, exactly like a
    // genuinely rewritten verdict — the two are indistinguishable downstream.
    expect(outcomeOf(result)).toBe('preserved_surface_miss');
  });

  it('a genuinely rewritten build_review verdict reports rewritten, not preserved', async () => {
    const s = await makeRepo();
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    // Fresh mtime, no codeStamp: passes on freshness, never on preservation.
    await writeBuildReviewVerdict(s.repo, 'PASS', undefined, null);

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));

    expect(result.done).toBe(true);
    expect(outcomeOf(result)).toBe('rewritten');
  });

  it('a genuinely fresh prd_audit ALIGNED report reports rewritten', async () => {
    const s = await makeRepo();
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    const artifact = await writeMdVerdict(
      s.repo,
      '.pipeline/prd-audit.md',
      PRD_ALIGNED,
      undefined,
      PRD_AUDIT_CODE_STAMP,
    );
    const freshMtime = new Date(Date.now() + 5000);
    await utimes(artifact, freshMtime, freshMtime);

    const result = await checkStepCompletion(s.repo, 'prd_audit', ctxFor(s.repo));

    expect({ done: result.done, outcome: outcomeOf(result) }).toEqual({
      done: true,
      outcome: 'rewritten',
    });
  });

  it('a genuinely fresh architecture_review_as_built APPROVED report reports rewritten', async () => {
    const s = await makeRepo();
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    const artifact = await writeMdVerdict(
      s.repo,
      '.pipeline/architecture-review-as-built.md',
      ARCH_APPROVED,
      undefined,
      ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP,
    );
    const freshMtime = new Date(Date.now() + 5000);
    await utimes(artifact, freshMtime, freshMtime);

    const result = await checkStepCompletion(
      s.repo,
      'architecture_review_as_built',
      ctxFor(s.repo),
    );

    expect({ done: result.done, outcome: outcomeOf(result) }).toEqual({
      done: true,
      outcome: 'rewritten',
    });
  });

  it('prd_audit preserve populates the facet instead of returning a bare done:true', async () => {
    const { s, baseline } = await featureRepo();
    await writeMdVerdict(s.repo, '.pipeline/prd-audit.md', PRD_ALIGNED, baseline, PRD_AUDIT_CODE_STAMP);
    await pushForeignCommit(s as Scratch & { origin: string }, { 'foreign.ts': 'foreign1\n' }, 'foreign work');

    const result = await checkStepCompletion(s.repo, 'prd_audit', ctxFor(s.repo));

    expect(result.done).toBe(true);
    // Fails today: this short-circuit returns `{ done: true }` and populates
    // nothing, so the preserve is invisible to every sink.
    expect(result.verdictFreshness).toBeDefined();
    expect(outcomeOf(result)).toBe('preserved_surface_miss');
    expect(result.verdictFreshness?.artifact).toContain('prd-audit.md');
  });

  it('architecture_review_as_built preserve populates the facet instead of a bare done:true', async () => {
    const { s, baseline } = await featureRepo();
    await writeMdVerdict(
      s.repo,
      '.pipeline/architecture-review-as-built.md',
      ARCH_APPROVED,
      baseline,
      ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP,
    );
    await pushForeignCommit(s as Scratch & { origin: string }, { 'foreign.ts': 'foreign1\n' }, 'foreign work');

    const result = await checkStepCompletion(s.repo, 'architecture_review_as_built', ctxFor(s.repo));

    expect(result.done).toBe(true);
    expect(result.verdictFreshness).toBeDefined();
    expect(outcomeOf(result)).toBe('preserved_surface_miss');
    expect(result.verdictFreshness?.artifact).toContain('architecture-review-as-built.md');
  });

  it('manual_test preserve populates the facet instead of a bare done:true', async () => {
    const s = await makeRepo();
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeManualTestVerdict(s.repo, baseline);
    // manual_test's surface is all-runtime, so a docs-only delta is its miss.
    await commit(s, { '.docs/notes.md': 'note\n' }, 'docs only');

    const result = await checkStepCompletion(s.repo, 'manual_test', ctxFor(s.repo));

    expect(result.done).toBe(true);
    expect(result.verdictFreshness).toBeDefined();
    expect(outcomeOf(result)).toBe('preserved_surface_miss');
  });
});

// ---------------------------------------------------------------------------
// Story 2 — an invalidated verdict is reported as a real rejection
// ---------------------------------------------------------------------------

describe('Story 2: every rejection reports stale_invalidated, and routing is unchanged', () => {
  it('build_review reports stale_invalidated when the delta hits its own surface', async () => {
    const s = await makeRepo();
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeBuildReviewVerdict(s.repo, 'PASS', baseline);
    await commit(s, { 'src/a.ts': 'a2\n' }, 'kickback fix');

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));

    expect(result.done).toBe(false);
    expect(outcomeOf(result)).toBe('stale_invalidated');
    // The existing rejection reason and retry/kickback routing are unchanged.
    expect(result.routeClass).toBe('absent');
  });

  it('prd_audit reports stale_invalidated on the plain mtime floor', async () => {
    const s = await makeRepo();
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeMdVerdict(s.repo, '.pipeline/prd-audit.md', PRD_ALIGNED, undefined, PRD_AUDIT_CODE_STAMP);

    const result = await checkStepCompletion(s.repo, 'prd_audit', ctxFor(s.repo));

    expect(result.done).toBe(false);
    expect(outcomeOf(result)).toBe('stale_invalidated');
  });

  it('architecture_review_as_built reports stale_invalidated on the plain mtime floor', async () => {
    const s = await makeRepo();
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeMdVerdict(
      s.repo,
      '.pipeline/architecture-review-as-built.md',
      ARCH_APPROVED,
      undefined,
      ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP,
    );

    const result = await checkStepCompletion(s.repo, 'architecture_review_as_built', ctxFor(s.repo));

    expect(result.done).toBe(false);
    expect(outcomeOf(result)).toBe('stale_invalidated');
  });

  it('reports stale_invalidated even when gate-code-validity is disabled', async () => {
    const s = await makeRepo();
    const baseline = await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeBuildReviewVerdict(s.repo, 'PASS', baseline);

    const result = await checkStepCompletion(
      s.repo,
      'build_review',
      ctxFor(s.repo, { config: { gate_code_validity: { enabled: false } } }),
    );

    // With the preserve overlay off, the stamped PASS falls to the mtime floor
    // and is rejected — and that rejection must still name its class.
    expect(result.done).toBe(false);
    expect(outcomeOf(result)).toBe('stale_invalidated');
  });

  it('reports stale_invalidated when the artifact carries no code stamp at all', async () => {
    const s = await makeRepo();
    await commit(s, { 'src/a.ts': 'a\n' }, 'init');
    await writeBuildReviewVerdict(s.repo, 'PASS', undefined);

    const result = await checkStepCompletion(s.repo, 'build_review', ctxFor(s.repo));

    expect(result.done).toBe(false);
    expect(outcomeOf(result)).toBe('stale_invalidated');
  });
});

// ---------------------------------------------------------------------------
// Story 5 — the audit trail records the outcome its doc comment promised
// ---------------------------------------------------------------------------

describe('Story 5: verdict_freshness reaches the audit trail with its outcome', () => {
  let dir: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'staleness-audit-'));
    scratches.push(dir);
    events = new ConductorEventEmitter();
  });

  function records(): AuditRecord[] {
    const path = join(dir, '.pipeline', 'audit-trail', 'events.jsonl');
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      return [];
    }
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as AuditRecord);
  }

  it('records a preserved verdict with its step, artifact and outcome', async () => {
    new AuditTrailWriter(dir).subscribe(events);

    await events.emit(
      verdictFreshnessEvent('preserved_surface_miss', {
        step: 'prd_audit',
        artifact: join(dir, '.pipeline/prd-audit.md'),
      }),
    );

    // Fails today twice over: verdict_freshness is not in
    // SUBSCRIBED_EVENT_TYPES, and toRecordInput has no case for it.
    const written = records();
    expect(written).toHaveLength(1);
    expect(written[0] as AuditRecord & { artifact: string; outcome: string }).toMatchObject({
      step: 'prd_audit',
      event: 'verdict_freshness',
      artifact: join(dir, '.pipeline/prd-audit.md'),
      outcome: 'preserved_surface_miss',
    });
  });

  it('records an invalidated verdict distinguishably from a preserved one', async () => {
    new AuditTrailWriter(dir).subscribe(events);

    await events.emit(
      verdictFreshnessEvent('stale_invalidated', {
        step: 'build_review',
        artifact: join(dir, '.pipeline/build-review.json'),
      }),
    );

    const written = records();
    expect(written).toHaveLength(1);
    expect(written[0] as AuditRecord & { artifact: string; outcome: string }).toMatchObject({
      step: 'build_review',
      event: 'verdict_freshness',
      artifact: join(dir, '.pipeline/build-review.json'),
      outcome: 'stale_invalidated',
    });
    expect(JSON.stringify(written[0])).not.toContain('preserved_surface_miss');
  });

  it('skips an event with no toRecordInput mapping without throwing', async () => {
    new AuditTrailWriter(dir).subscribe(events);

    await expect(events.emit({ type: 'dashboard_refresh' })).resolves.toBeUndefined();
    expect(records()).toHaveLength(0);
  });

  it('persists verdict_freshness to the run event log', async () => {
    const logPath = join(dir, 'events.jsonl');
    const persister = new EventPersister(logPath, events);
    persister.start();
    try {
      await events.emit(verdictFreshnessEvent('preserved_surface_miss'));
    } finally {
      persister.stop();
    }

    // Fails today: verdict_freshness is absent from ALL_EVENT_TYPES, so the
    // persister never subscribes and the file is never created.
    const raw = await readFile(logPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).outcome).toBe('preserved_surface_miss');
  });
});

// ---------------------------------------------------------------------------
// Stories 1 & 2 — the observable: a distinguishable line in .daemon/daemon.log
// ---------------------------------------------------------------------------

describe('Stories 1 & 2: the daemon log distinguishes the two staleness classes', () => {
  const originalLevel = chalk.level;
  beforeEach(() => {
    // Byte-exact assertions independent of the runner's TTY / FORCE_COLOR.
    chalk.level = 0;
  });
  afterEach(() => {
    chalk.level = originalLevel;
  });

  function lines(event: ConductorEvent): string[] {
    const out: string[] = [];
    renderDaemonEvent(event, (m) => out.push(m));
    return out;
  }

  it('renders a rewritten verdict as a current non-failure line naming the step and artifact', () => {
    const out = lines(
      verdictFreshnessEvent('rewritten', {
        step: 'prd_audit',
        artifact: '/repo/.pipeline/prd-audit.md',
      }),
    );

    expect(out).toEqual([
      expect.stringMatching(
        /^(?!.*✗)(?!.*preserv)(?!.*invalidat)(?=.*prd_audit)(?=.*prd-audit\.md)(?=.*(?:rewritten|fresh|current)).+$/i,
      ),
    ]);
  });

  it('renders a preserved verdict as a non-failure line naming the step and artifact', () => {
    const out = lines(
      verdictFreshnessEvent('preserved_surface_miss', {
        step: 'build_review',
        artifact: '/repo/.pipeline/build-review.json',
      }),
    );

    // Fails today: renderDaemonEventUnsafe has no case, so nothing is logged.
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('build_review');
    expect(out[0]).toContain(basename('/repo/.pipeline/build-review.json'));
    expect(out[0].toLowerCase()).toContain('preserv');
    // A preserved verdict is not a failure and must not read as one.
    expect(out[0]).not.toContain('✗');
  });

  it('renders an invalidated verdict as a rejection, distinct from the preserved line', () => {
    const invalidated = lines(
      verdictFreshnessEvent('stale_invalidated', {
        step: 'build_review',
        artifact: '/repo/.pipeline/build-review.json',
      }),
    );
    const preserved = lines(
      verdictFreshnessEvent('preserved_surface_miss', {
        step: 'build_review',
        artifact: '/repo/.pipeline/build-review.json',
      }),
    );

    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]).toContain('build_review');
    expect(invalidated[0]).toContain(basename('/repo/.pipeline/build-review.json'));
    expect(invalidated[0].toLowerCase()).toContain('invalidated');
    // The whole point of the feature: an operator can tell them apart.
    expect(invalidated[0]).not.toEqual(preserved[0]);
  });

  it('a malformed verdict_freshness payload still never crashes the renderer', () => {
    expect(() =>
      lines({ type: 'verdict_freshness' } as unknown as ConductorEvent),
    ).not.toThrow();
  });

  /**
   * §3d wiring spec. `renderDaemonEventUnsafe`'s switch is NOT the daemon's
   * subscription: `beginFeatureRun` subscribes a separate hand-maintained
   * `renderableEvents` literal (daemon-cli.ts:856-865). An implementation that
   * adds the switch case but leaves that list alone renders nothing in a real
   * run — the Story 1 observable ("`.daemon/daemon.log` contains a line") would
   * still be unmet with every other spec in this file green.
   *
   * Asserted at the source level because the list is a function-local const
   * with no runtime seam. The `EVENT_SINKS` registry is the subscription
   * authority, so `beginFeatureRun` must derive this list from
   * `renderedEventTypes()`.
   */
  it('the daemon subscribes verdict_freshness for per-feature rendering', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../../src/daemon-cli.ts'), 'utf8');
    const beginFeatureRunStart = source.indexOf('const beginFeatureRun =');
    const beginFeatureRunEnd = source.indexOf('\n  // Resolve the active memory provider', beginFeatureRunStart);
    const beginFeatureRunSource = source.slice(beginFeatureRunStart, beginFeatureRunEnd);

    expect(beginFeatureRunSource).toMatch(
      /renderableEvents(?:\s*:\s*ConductorEvent\['type'\]\[\])?\s*=\s*renderedEventTypes\(\)/,
    );
  });
});
