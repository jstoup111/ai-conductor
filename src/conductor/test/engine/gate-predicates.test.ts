import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { checkGateCompletion } from '../../src/engine/gate-verdicts.js';
import { verdictFreshnessFloor } from '../../src/engine/artifacts.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';

const AS_BUILT_POLICY: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'all tiers' },
  planGap: { enabled: true, reason: 'all tiers' },
  adrCompliance: { enabled: false, reason: 'not applicable' },
  diagramDrift: { enabled: false, reason: 'not applicable' },
};

// Mirrors the real repo convention: **Status:**, ### Happy Path / ### Negative
// Paths headings with Given/When/Then bullets. See gate-audit-2026-06-23.md.

describe('engine/artifacts — stories predicate', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stories-pred-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function story(path: string, content: string) {
    const full = join(dir, '.docs/stories', path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  it('fails when no stories present', async () => {
    const r = await checkGateCompletion(dir, 'stories');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no \.docs\/stories/);
  });

  it('passes a single-story file with happy + negative paths', async () => {
    await story(
      'features/foo/ST-001-foo.md',
      `# Story: Foo\n**Status:** Accepted\n\n## Acceptance Criteria\n\n### Happy Path\n- Given x, when y, then z\n\n### Negative Paths\n- Given a, when b, then error\n`,
    );
    const r = await checkGateCompletion(dir, 'stories');
    expect(r.done).toBe(true);
  });

  it('fails a DRAFT story', async () => {
    await story(
      'features/ST-002.md',
      `# Story\n**Status:** DRAFT\n\n### Happy Path\n- Given x when y then z\n\n### Negative Paths\n- Given a when b then error\n`,
    );
    const r = await checkGateCompletion(dir, 'stories');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/DRAFT/);
  });

  it('fails when a story has no negative path', async () => {
    await story(
      'features/ST-003.md',
      `# Story\n**Status:** Accepted\n\n### Happy Path\n- Given x when y then z\n`,
    );
    const r = await checkGateCompletion(dir, 'stories');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/negative path/i);
  });

  it('names the specific story in a multi-story file lacking a negative path', async () => {
    await story(
      'wave.md',
      `# Stories\n**Status:** Accepted\n\n## Story 1-1: ok\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then error\n\n## Story 1-2: bad\n### Happy Path\n- Given x when y then z\n`,
    );
    const r = await checkGateCompletion(dir, 'stories');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/1-2/);
  });
});

describe('engine/artifacts — plan predicate (per path-type coverage)', () => {
  let dir: string;
  const STORY = `# Stories\n**Status:** Accepted\n\n## Story 3.2-1: foo\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then error\n`;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plan-pred-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function story(content: string) {
    const full = join(dir, '.docs/stories/wave.md');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  async function plan(content: string) {
    const full = join(dir, '.docs/plans/p.md');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  it('fails when no plan present', async () => {
    await story(STORY);
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no \.docs\/plans/);
  });

  it('passes when happy + negative both covered by path-typed tasks', async () => {
    await story(STORY);
    await plan(
      `### Task 1\n**Story:** 3.2-1 (happy path — foo)\n**Dependencies:** none\n\n### Task 2\n**Story:** 3.2-1 (negative path — bar)\n**Dependencies:** Task 1\n`,
    );
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(true);
  });

  it('fails when the negative path is uncovered', async () => {
    await story(STORY);
    await plan(`### Task 1\n**Story:** 3.2-1 (happy path — foo)\n**Dependencies:** none\n`);
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/3\.2-1 negative/);
  });

  it('fails when the plan has no dependency tree (covered but no deps)', async () => {
    await story(STORY);
    await plan(
      `### Task 1\n**Story:** 3.2-1 (happy path)\n\n### Task 2\n**Story:** 3.2-1 (negative path)\n`,
    );
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/dependency tree/i);
  });

  it('story-level fallback: a bare **Story:** ref covers both paths', async () => {
    await story(STORY);
    await plan(`### Task 1\n**Story:** 3.2-1\n**Dependencies:** none\n`);
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(true);
  });

  it('a Coverage Check table satisfies coverage', async () => {
    await story(STORY);
    await plan(
      `## Coverage Check\n| Story | Criterion | Task(s) |\n|---|---|---|\n| 3.2-1 happy | x | T1 |\n| 3.2-1 negative | y | T2 |\n\n## Task Dependency Graph\n- T1 → none\n- T2 → T1\n`,
    );
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(true);
  });

  // Regression: the real generator emits `## Story 1:` headings (id `1`) and
  // tasks with `**Story:** Story 1 (FR-1, FR-2)` + a separate `**Type:**` line.
  // The old regex captured the literal word "Story" and read path type only
  // from the parens (which hold FR refs), so coverage never matched.
  it('covers the real `Story N` + `**Type:**` plan format', async () => {
    await story(
      `# Stories\n**Status:** Accepted\n\n` +
        `## Story 1: Shorten\n**Requirement:** FR-1, FR-2\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then error\n\n` +
        `## Story 2: Redirect\n**Requirement:** FR-3\n### Happy Path\n- Given x when y then z\n### Negative Paths\n- Given a when b then error\n`,
    );
    await plan(
      `### Task 1: infra\n**Story:** prerequisite for all tasks\n**Type:** infrastructure\n\n` +
        `### Task 2: POST happy\n**Story:** Story 1 (FR-1, FR-2) — "..."\n**Type:** happy-path\n\n` +
        `### Task 3: POST negative\n**Story:** Story 1 (FR-4) — "..."\n**Type:** negative-path\n\n` +
        `### Task 4: GET happy\n**Story:** Story 2 (FR-3) — "..."\n**Type:** happy-path\n\n` +
        `### Task 5: GET negative\n**Story:** Story 2 (FR-6) — "..."\n**Type:** negative-path\n\n` +
        `## Task Dependency Graph\n- Task 2,3 depend on Task 1; Task 4,5 depend on Task 1\n`,
    );
    const r = await checkGateCompletion(dir, 'plan');
    expect(r.done).toBe(true);
  });
});

describe('engine/artifacts — architecture_review_as_built predicate (fail-closed)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'asbuilt-pred-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function report(content: string) {
    const full = join(dir, '.pipeline/architecture-review-as-built.md');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
    return full;
  }

  async function persist(
    verdict: Parameters<typeof persistAsBuiltVerdict>[1],
    attemptId = 'attempt-1',
  ) {
    return persistAsBuiltVerdict(dir, verdict, {
      attemptId,
      codeStamp: null,
      policy: AS_BUILT_POLICY,
    });
  }

  it('fails when no typed verdict is present', async () => {
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no \.pipeline\/architecture-review-as-built\.json/);
    expect(r.routeClass).toBe('absent');
  });

  it('passes on a typed clean APPROVED verdict', async () => {
    await persist({ version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [] });
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(true);
    expect(r.routeClass).toBeUndefined();
    expect(r.verdictFreshness).toMatchObject({ fresh: true, floorSource: 'run-identity' });
  });

  it('passes on typed APPROVED WITH DRIFT NOTES', async () => {
    await persist({
      version: 'v1', verdict: 'APPROVED WITH DRIFT NOTES', reachability: [],
      driftNotes: [{ note: 'diagram stale' }],
    });
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(true);
  });

  it('fails on a typed BLOCKED design verdict', async () => {
    await persist({
      version: 'v1', verdict: 'BLOCKED', reachability: [], driftNotes: [],
      findings: [{ id: 'ARCH-1', class: 'DESIGN', summary: 'A decision is required.' }],
      violations: 'architecture conflict', resolution: 'make a decision',
    });
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/BLOCKED/);
    expect(r.routeClass).toBe('named-route');
  });

  it('does not treat a reviewer-written Markdown report as authority', async () => {
    await report('Verdict: APPROVED\n');
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/typed verdict/);
    expect(r.routeClass).toBe('absent');
  });

  it('fails closed when the typed envelope is unreadable', async () => {
    const full = join(dir, '.pipeline/architecture-review-as-built.json');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, '{not-json');
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/unreadable/);
    expect(r.routeClass).toBe('absent');
  });

  it('scores a prior attempt identity as no fresh verdict regardless of mtime', async () => {
    const stored = await persist({ version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [] }, 'prior-attempt');
    const old = new Date(Date.now() - 60 * 60 * 1000);
    const full = join(dir, '.pipeline/architecture-review-as-built.json');
    await utimes(full, old, old);
    const r = await checkGateCompletion(dir, 'architecture_review_as_built', { attemptRunId: 'current-attempt' });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no fresh verdict/i);
    expect(r.routeClass).toBe('absent');
    expect(r.verdictFreshness).toMatchObject({ fresh: false, floorSource: 'run-identity' });
    expect(stored.attemptId).toBe('prior-attempt');
  });

  it('passes a matching typed attempt identity even when its artifact mtime is old', async () => {
    await persist({ version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [] }, 'current-attempt');
    const full = join(dir, '.pipeline/architecture-review-as-built.json');
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(full, old, old);
    const r = await checkGateCompletion(dir, 'architecture_review_as_built', { attemptRunId: 'current-attempt' });
    expect(r.done).toBe(true);
    expect(r.verdictFreshness).toMatchObject({ fresh: true, floorSource: 'run-identity' });
  });
});

describe('engine/artifacts — build_review predicate (fail-closed)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-review-pred-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function verdict(obj: unknown) {
    const full = join(dir, '.pipeline/build-review.json');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(obj));
    return full;
  }

  it('fails when no verdict file is present', async () => {
    const r = await checkGateCompletion(dir, 'build_review');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no build-review verdict/i);
    expect(r.routeClass).toBe('absent');
  });

  it('passes on a fresh valid PASS verdict', async () => {
    await verdict({ verdict: 'PASS', rubric: { testQuality: false } });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(true);
    expect(r.routeClass).toBeUndefined();
  });

  it('fails when the verdict file predates the session (stale)', async () => {
    const full = await verdict({
      verdict: 'PASS',
      rubric: { testQuality: false },
    });
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(full, old, old);
    const sessionStartedAt = Date.now();
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no fresh verdict/i);
    expect(r.routeClass).toBe('absent');
  });

  it('fails on a FAIL verdict and surfaces the reasons', async () => {
    await verdict({
      verdict: 'FAIL',
      reasons: ['tautological assertion in test', 'scope creep beyond acceptance criteria'],
      rubric: { testQuality: true },
    });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/tautological assertion in test/);
    expect(r.reason).toMatch(/scope creep beyond acceptance criteria/);
    expect(r.routeClass).toBe('named-route');
  });

  it('fails on malformed JSON', async () => {
    const full = join(dir, '.pipeline/build-review.json');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, 'not json');
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.routeClass).toBe('absent');
  });

  it('fails on a verdict that fails validation (e.g. missing rubric)', async () => {
    await verdict({ verdict: 'PASS' });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.routeClass).toBe('absent');
  });

  it('fails closed when the PASS rubric omits testQuality', async () => {
      await verdict({ verdict: 'PASS', rubric: {} });

      const result = await checkGateCompletion(dir, 'build_review', {
        sessionStartedAt: Date.now() - 1_000,
      });

      expect(result.done).toBe(false);
      expect(result.routeClass).toBe('absent');
  });

  // Task 1, session-fresh-verdict-artifacts.
  it('reuses no stale PASS across attempts (mtime < attemptStartedAt)', async () => {
    const full = await verdict({
      verdict: 'PASS',
      rubric: { testQuality: false },
    });
    const S = Date.now() - 60_000;
    const T = Date.now();
    // Fresh for the run session but stale relative to this attempt's dispatch.
    await utimes(full, new Date(S + 30_000), new Date(S + 30_000));
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt: S, attemptStartedAt: T });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no fresh verdict/i);
    expect(r.verdictFreshness).toMatchObject({ fresh: false, floorSource: 'attempt' });
  });

  it('passes a fresh PASS verdict rewritten this attempt', async () => {
    const full = await verdict({
      verdict: 'PASS',
      rubric: { testQuality: false },
    });
    const T = Date.now();
    await utimes(full, new Date(T + 1000), new Date(T + 1000));
    const r = await checkGateCompletion(dir, 'build_review', {
      sessionStartedAt: T - 60_000,
      attemptStartedAt: T,
    });
    expect(r.done).toBe(true);
    expect(r.verdictFreshness).toMatchObject({ fresh: true, floorSource: 'attempt' });
  });
});

describe('engine/artifacts — prd_audit predicate (per-attempt verdict freshness)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'prd-audit-pred-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function report(content: string) {
    const full = join(dir, '.pipeline/prd-audit.md');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
    return full;
  }

  const aligned = '# PRD Audit\n\n| FR-1 | ALIGNED | n/a | foo.ts:1 | — |\n';

  it('reuses no stale ALIGNED report across attempts (mtime < attemptStartedAt)', async () => {
    const full = await report(aligned);
    const S = Date.now() - 60_000;
    const T = Date.now();
    await utimes(full, new Date(S + 30_000), new Date(S + 30_000));
    const r = await checkGateCompletion(dir, 'prd_audit', { sessionStartedAt: S, attemptStartedAt: T });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no fresh verdict/i);
    expect(r.verdictFreshness).toMatchObject({ fresh: false, floorSource: 'attempt' });
  });

  it('passes an ALIGNED report rewritten this attempt', async () => {
    const full = await report(aligned);
    const T = Date.now();
    await utimes(full, new Date(T + 1000), new Date(T + 1000));
    const r = await checkGateCompletion(dir, 'prd_audit', {
      sessionStartedAt: T - 60_000,
      attemptStartedAt: T,
    });
    expect(r.done).toBe(true);
    expect(r.verdictFreshness).toMatchObject({ fresh: true, floorSource: 'attempt' });
  });
});

// Task 3, session-fresh-verdict-artifacts: regression/fallback coverage for
// the verdict-freshness floor across all three predicates it touches.
describe('engine/artifacts — verdict-freshness floor regression/fallback', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'freshness-regress-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(path: string, content: string) {
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
    return full;
  }

  const prdAligned = '# PRD Audit\n\n| FR-1 | ALIGNED | n/a | foo.ts:1 | — |\n';
  async function buildReviewPass() {
    return write(
      '.pipeline/build-review.json',
      JSON.stringify({ verdict: 'PASS', rubric: { testQuality: false } }),
    );
  }

  it('(a) no attemptStartedAt: prd_audit behaves exactly as before against sessionStartedAt only', async () => {
    const full = await write('.pipeline/prd-audit.md', prdAligned);
    const S = Date.now() - 60_000;
    const r = await checkGateCompletion(dir, 'prd_audit', { sessionStartedAt: S });
    expect(r.done).toBe(true);
    expect(r.verdictFreshness).toMatchObject({ fresh: true, floorSource: 'session' });

    const old = new Date(S - 60_000);
    await utimes(full, old, old);
    const r2 = await checkGateCompletion(dir, 'prd_audit', { sessionStartedAt: S });
    expect(r2.done).toBe(false);
    expect(r2.verdictFreshness).toMatchObject({ fresh: false, floorSource: 'session' });
  });

  it('(a) no attemptStartedAt: build_review behaves exactly as before against sessionStartedAt only', async () => {
    const full = await buildReviewPass();
    const S = Date.now() - 60_000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt: S });
    expect(r.done).toBe(true);
    expect(r.verdictFreshness).toMatchObject({ fresh: true, floorSource: 'session' });

    const old = new Date(S - 60_000);
    await utimes(full, old, old);
    const r2 = await checkGateCompletion(dir, 'build_review', { sessionStartedAt: S });
    expect(r2.done).toBe(false);
    expect(r2.verdictFreshness).toMatchObject({ fresh: false, floorSource: 'session' });
  });

  it('(b) both attemptStartedAt and sessionStartedAt undefined: fail-open on presence for mtime predicates', async () => {
    await write('.pipeline/prd-audit.md', prdAligned);
    await buildReviewPass();

    const rPrd = await checkGateCompletion(dir, 'prd_audit', {});
    expect(rPrd.done).toBe(true);
    expect(rPrd.verdictFreshness).toMatchObject({ fresh: true, floorMs: undefined });

    const rBuild = await checkGateCompletion(dir, 'build_review', {});
    expect(rBuild.done).toBe(true);
    expect(rBuild.verdictFreshness).toMatchObject({ fresh: true, floorMs: undefined });
  });

  it('(b) verdictFreshnessFloor itself returns undefined when both are undefined', () => {
    expect(verdictFreshnessFloor({})).toBeUndefined();
    expect(verdictFreshnessFloor({ sessionStartedAt: undefined, attemptStartedAt: undefined })).toBeUndefined();
  });

  it('(c) idempotency: repeated evaluation of identical on-disk state yields an identical decision + reason', async () => {
    await persistAsBuiltVerdict(dir, {
      version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [],
    }, { attemptId: 'idempotent-attempt', codeStamp: null, policy: AS_BUILT_POLICY });
    const ctx = { attemptRunId: 'idempotent-attempt' };

    const r1 = await checkGateCompletion(dir, 'architecture_review_as_built', ctx);
    const r2 = await checkGateCompletion(dir, 'architecture_review_as_built', ctx);
    expect(r2.done).toBe(r1.done);
    expect(r2.reason).toBe(r1.reason);
    expect(r2.verdictFreshness).toEqual(r1.verdictFreshness);
  });

  it('(c) idempotency: repeated evaluation of an identical stale/no-fresh-verdict state yields an identical decision + reason', async () => {
    const full = await buildReviewPass();
    const S = Date.now() - 60_000;
    const T = Date.now();
    await utimes(full, new Date(S + 30_000), new Date(S + 30_000));
    const ctx = { sessionStartedAt: S, attemptStartedAt: T };

    const r1 = await checkGateCompletion(dir, 'build_review', ctx);
    const r2 = await checkGateCompletion(dir, 'build_review', ctx);
    expect(r2.done).toBe(r1.done);
    expect(r2.reason).toBe(r1.reason);
    expect(r2.verdictFreshness).toEqual(r1.verdictFreshness);
  });
});
