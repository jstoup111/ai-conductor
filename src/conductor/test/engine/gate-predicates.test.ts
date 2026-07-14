import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { checkGateCompletion } from '../../src/engine/gate-verdicts.js';
import { verdictFreshnessFloor } from '../../src/engine/artifacts.js';

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
  }

  const header = '# As-Built Architecture Review\n**Mode:** as-built\n';

  it('fails when no report is present', async () => {
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no \.pipeline\/architecture-review-as-built\.md/);
  });

  it('passes on a clean APPROVED verdict', async () => {
    await report(`${header}**Verdict:** APPROVED\n`);
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(true);
  });

  it('passes on APPROVED WITH DRIFT NOTES', async () => {
    await report(`${header}**Verdict:** APPROVED WITH DRIFT NOTES\n## Drift\n- diagram stale\n`);
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(true);
  });

  it('fails on a BLOCKED verdict', async () => {
    await report(`${header}**Verdict:** BLOCKED\n## Blocking Violations\n- violates adr-x\n`);
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/BLOCKED/);
  });

  // The reported random-number-api bug: a non-clean, non-BLOCKED verdict was
  // accepted as done by the old fail-OPEN predicate. Fail-closed rejects it.
  it('fails on an unrecognized verdict (not a clean APPROVED)', async () => {
    await report(`${header}**Verdict:** NEEDS REVIEW\n`);
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/not a clean APPROVED|NEEDS REVIEW/);
  });

  it('fails when the report has no Verdict line at all', async () => {
    await report(`${header}## Notes\nThere were no ADRs to check.\n`);
    const r = await checkGateCompletion(dir, 'architecture_review_as_built');
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no parseable .*Verdict|not a clean APPROVED/i);
  });

  // Task 1, session-fresh-verdict-artifacts (incident 2026-07-12-wiring-reachability-gate):
  // require the verdict artifact to be fresh relative to the per-attempt
  // judging session, not just the conductor-run session start.
  it('passes when artifact mtime >= attemptStartedAt', async () => {
    await report(`${header}**Verdict:** APPROVED\n`);
    const T = Date.now();
    const full = join(dir, '.pipeline/architecture-review-as-built.md');
    await utimes(full, new Date(T + 1000), new Date(T + 1000));
    const r = await checkGateCompletion(dir, 'architecture_review_as_built', {
      sessionStartedAt: T - 60_000,
      attemptStartedAt: T,
    });
    expect(r.done).toBe(true);
    expect(r.verdictFreshness).toMatchObject({ fresh: true, floorSource: 'attempt' });
  });

  it("scores no-fresh-verdict when mtime < attemptStartedAt though >= sessionStartedAt (the incident)", async () => {
    await report(`${header}**Verdict:** APPROVED\n`);
    const S = Date.now() - 60_000;
    const T = Date.now();
    const full = join(dir, '.pipeline/architecture-review-as-built.md');
    // mtime between S and T: fresh for the run session, stale for this attempt.
    await utimes(full, new Date(S + 30_000), new Date(S + 30_000));
    const r = await checkGateCompletion(dir, 'architecture_review_as_built', {
      sessionStartedAt: S,
      attemptStartedAt: T,
    });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no fresh verdict/i);
    expect(r.reason).not.toBe('as-built review has no parseable `Verdict:` line — expected APPROVED / APPROVED WITH DRIFT NOTES / BLOCKED; re-run the as-built review');
    expect(r.reason).not.toMatch(/^as-built review verdict is "BLOCKED"/);
    expect(r.verdictFreshness).toMatchObject({ fresh: false, floorSource: 'attempt' });
  });

  it('byte-identical rewrite this attempt still passes', async () => {
    const content = `${header}**Verdict:** APPROVED\n`;
    await report(content);
    const T = Date.now();
    const full = join(dir, '.pipeline/architecture-review-as-built.md');
    // Simulate a rewrite this attempt with identical bytes but a fresh mtime.
    await writeFile(full, content);
    await utimes(full, new Date(T + 1000), new Date(T + 1000));
    const r = await checkGateCompletion(dir, 'architecture_review_as_built', {
      sessionStartedAt: T - 60_000,
      attemptStartedAt: T,
    });
    expect(r.done).toBe(true);
  });

  it('verdictFreshnessFloor falls back to sessionStartedAt when attemptStartedAt is undefined', async () => {
    const S = Date.now() - 1000;
    expect(verdictFreshnessFloor({ sessionStartedAt: S })).toBe(S);
    expect(verdictFreshnessFloor({ sessionStartedAt: S, attemptStartedAt: undefined })).toBe(S);

    // Predicate outcome identical to pre-change: only sessionStartedAt present.
    await report(`${header}**Verdict:** APPROVED\n`);
    const r = await checkGateCompletion(dir, 'architecture_review_as_built', { sessionStartedAt: S });
    expect(r.done).toBe(true);
    expect(r.verdictFreshness).toMatchObject({ fresh: true, floorSource: 'session' });
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
  });

  it('passes on a fresh valid PASS verdict', async () => {
    await verdict({ verdict: 'PASS', rubric: { tautology: false, scope: false, rootCause: false } });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(true);
  });

  it('fails when the verdict file predates the session (stale)', async () => {
    const full = await verdict({
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false },
    });
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(full, old, old);
    const sessionStartedAt = Date.now();
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/no fresh verdict/i);
  });

  it('fails on a FAIL verdict and surfaces the reasons', async () => {
    await verdict({
      verdict: 'FAIL',
      reasons: ['tautological assertion in test', 'scope creep beyond acceptance criteria'],
      rubric: { tautology: true, scope: true, rootCause: false },
    });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
    expect(r.reason).toMatch(/tautological assertion in test/);
    expect(r.reason).toMatch(/scope creep beyond acceptance criteria/);
  });

  it('fails on malformed JSON', async () => {
    const full = join(dir, '.pipeline/build-review.json');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, 'not json');
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
  });

  it('fails on a verdict that fails validation (e.g. missing rubric)', async () => {
    await verdict({ verdict: 'PASS' });
    const sessionStartedAt = Date.now() - 1000;
    const r = await checkGateCompletion(dir, 'build_review', { sessionStartedAt });
    expect(r.done).toBe(false);
  });

  // Task 1, session-fresh-verdict-artifacts.
  it('reuses no stale PASS across attempts (mtime < attemptStartedAt)', async () => {
    const full = await verdict({
      verdict: 'PASS',
      rubric: { tautology: false, scope: false, rootCause: false },
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
      rubric: { tautology: false, scope: false, rootCause: false },
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
