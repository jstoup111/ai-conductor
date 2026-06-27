// Test: LessonStore port + types (Task 10, FR-5, ADR-006)
// Task 11: createJsonlLessonStore default adapter
// FR-8: selectLessons — relevant surfaced, unrelated empty, corrupt-store safe
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEngineerStoreReader } from '../../../src/engine/engineer-store.js';
import { createJsonlLessonStore, selectLessons } from '../../../src/engine/engineer/lesson-store.js';
import type {
  LessonStore,
  LessonRecord,
  LessonQuery,
  RetrievedLesson,
} from '../../../src/engine/engineer/lesson-store.js';
// Value import to force module resolution at runtime (RED fails if file absent)
import { LESSON_STORE_VERSION } from '../../../src/engine/engineer/lesson-store.js';

// --- In-test stub implementing the LessonStore port ---
// If LessonStore, LessonRecord, LessonQuery, or RetrievedLesson are missing or
// have incorrect shapes, TypeScript will reject this file at compile time.

const stubLesson: RetrievedLesson = {
  id: 'lesson-001',
  text: 'always write tests first',
  metadata: { source: 'retro', phase: 'tdd' },
};

class StubLessonStore implements LessonStore {
  private _recorded: LessonRecord[] = [];

  async record(lesson: LessonRecord): Promise<void> {
    this._recorded.push(lesson);
  }

  async retrieve(_query: LessonQuery): Promise<RetrievedLesson[]> {
    return [stubLesson];
  }

  get recorded(): LessonRecord[] {
    return this._recorded;
  }
}

describe('LessonStore port + LessonQuery/RetrievedLesson types', () => {
  it('LESSON_STORE_VERSION sentinel is exported and is a string', () => {
    // This forces the module to exist at runtime; if lesson-store.ts is missing
    // the import above will throw and all tests in this file fail (RED).
    expect(typeof LESSON_STORE_VERSION).toBe('string');
    expect(LESSON_STORE_VERSION.length).toBeGreaterThan(0);
  });


  it('stub implementing LessonStore compiles and record() returns Promise<void>', async () => {
    const store = new StubLessonStore();
    const result = store.record({
      text: 'keep commits small',
      namespace: 'my-project:feature-x',
      metadata: { author: 'tdd-agent' },
    });
    // record() must return a Promise (thenable)
    expect(result).toBeInstanceOf(Promise);
    await result; // must resolve without throwing
    expect(store.recorded).toHaveLength(1);
    expect(store.recorded[0].text).toBe('keep commits small');
  });

  it('retrieve() returns RetrievedLesson[]', async () => {
    const store = new StubLessonStore();
    const query: LessonQuery = { text: 'tdd approach', namespace: 'my-project:feature-x' };
    const results = await store.retrieve(query);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('lesson-001');
    expect(results[0].text).toBe('always write tests first');
    expect(results[0].metadata).toEqual({ source: 'retro', phase: 'tdd' });
  });

  it('RetrievedLesson without score/validAt is still valid (optional fields)', () => {
    // A RetrievedLesson with only required fields — no score, no validAt
    const lesson: RetrievedLesson = {
      id: 'lesson-002',
      text: 'minimal lesson',
      metadata: {},
    };
    // If score and validAt were required, TypeScript would error above.
    // Runtime sanity: the object has the expected shape.
    expect(lesson.id).toBe('lesson-002');
    expect(lesson.score).toBeUndefined();
    expect(lesson.validAt).toBeUndefined();
  });

  it('LessonQuery with only {text, namespace} is valid (optional topK/filters/crossProject)', () => {
    // A query with only the two required fields — no topK, no filters, no crossProject
    const query: LessonQuery = {
      text: 'how to structure a retro',
      namespace: 'project-a:retro-feature',
    };
    expect(query.text).toBe('how to structure a retro');
    expect(query.topK).toBeUndefined();
    expect(query.filters).toBeUndefined();
    expect(query.crossProject).toBeUndefined();
  });

  it('LessonRecord carries text, namespace, and metadata', () => {
    const rec: LessonRecord = {
      text: 'adversarial inputs must be tested',
      namespace: 'harness:tdd',
      metadata: { severity: 'critical', tags: ['security'] },
    };
    expect(rec.text).toBe('adversarial inputs must be tested');
    expect(rec.namespace).toBe('harness:tdd');
    expect(rec.metadata['severity']).toBe('critical');
  });

  it('LessonRecord score and validAt are optional', () => {
    // Both optional fields may be omitted — if required, TypeScript would reject this.
    const rec: LessonRecord = {
      text: 'minimal record',
      namespace: 'proj:feat',
      metadata: {},
    };
    expect(rec.score).toBeUndefined();
    expect(rec.validAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Task 11: createJsonlLessonStore — default keyword/recency adapter (FR-5)
// ---------------------------------------------------------------------------

/** Minimal valid EngineerSignal JSON for test seeding. */
function makeSignalLine(
  project: string,
  feature: string,
  text: string,
  ts: string,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    ts,
    project,
    feature,
    runId: `run-${project}-${feature}`,
    outcome: 'done',
    kickbacks: [],
    halts: [],
    retryHotspots: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    durationByStep: {},
    // We embed a "narrative" as the feature name for keyword matching.
    // The signal's feature field acts as the lesson text for ranking.
  });
}

describe('createJsonlLessonStore — default JSONL adapter (Task 11, FR-5)', () => {
  let engineerDir: string;

  beforeEach(async () => {
    engineerDir = await mkdtemp(join(tmpdir(), 'engineer-test-'));
    await mkdir(engineerDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup is best-effort; temp dirs accumulate harmlessly in CI.
  });

  /**
   * Seed signals.jsonl with signals across projA (2 entries) and projB (2 entries).
   * Timestamps are spread to test recency ordering within each bucket.
   */
  async function seedSignals(): Promise<void> {
    const lines = [
      // projA signals (target project) — two distinct features
      makeSignalLine('projA', 'auth-feature', 'auth login flow', '2026-06-25T10:00:00Z'),
      makeSignalLine('projA', 'search-feature', 'search results pagination', '2026-06-25T11:00:00Z'),
      // projB signals (cross-project) — two distinct features
      makeSignalLine('projB', 'auth-module', 'auth token refresh', '2026-06-25T09:00:00Z'),
      makeSignalLine('projB', 'checkout-feature', 'checkout payment flow', '2026-06-25T08:00:00Z'),
    ];
    await writeFile(join(engineerDir, 'signals.jsonl'), lines.join('\n') + '\n', 'utf-8');
  }

  it('retrieve: target-project (projA) lessons come FIRST', async () => {
    await seedSignals();
    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    const results = await store.retrieve({
      text: 'auth',
      namespace: 'projA:auth-feature',
      topK: 10,
    });

    // First result must be from projA
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.metadata['project']).toBe('projA');
  });

  it('retrieve: all projA results precede any projB results', async () => {
    await seedSignals();
    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    const results = await store.retrieve({
      text: 'feature',
      namespace: 'projA:search-feature',
      topK: 10,
    });

    // Find first projB result index; every projA must precede it.
    const firstProjBIndex = results.findIndex(r => r.metadata['project'] === 'projB');
    if (firstProjBIndex !== -1) {
      const projAAfterProjB = results
        .slice(firstProjBIndex)
        .filter(r => r.metadata['project'] === 'projA');
      expect(projAAfterProjB).toHaveLength(0);
    }
  });

  it('retrieve: result length is bounded by topK', async () => {
    await seedSignals();
    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    const topK = 2;
    const results = await store.retrieve({
      text: 'auth',
      namespace: 'projA:auth-feature',
      topK,
    });

    expect(results.length).toBeLessThanOrEqual(topK);
  });

  it('retrieve: topK=1 returns exactly one result (most relevant / target-project first)', async () => {
    await seedSignals();
    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    const results = await store.retrieve({
      text: 'auth',
      namespace: 'projA:auth-feature',
      topK: 1,
    });

    expect(results).toHaveLength(1);
  });

  it('retrieve: cross-project keyword matches appear after target-project results', async () => {
    await seedSignals();
    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    // "auth" keyword matches both projA:auth-feature and projB:auth-module
    const results = await store.retrieve({
      text: 'auth',
      namespace: 'projA:auth-feature',
      topK: 10,
    });

    const projAResults = results.filter(r => r.metadata['project'] === 'projA');
    const projBResults = results.filter(r => r.metadata['project'] === 'projB');

    // projA results should be present
    expect(projAResults.length).toBeGreaterThan(0);

    // If projB results appear, they must all come AFTER projA results
    if (projBResults.length > 0) {
      const lastProjAIndex = results.map(r => r.metadata['project']).lastIndexOf('projA');
      const firstProjBIndex = results.findIndex(r => r.metadata['project'] === 'projB');
      expect(firstProjBIndex).toBeGreaterThan(lastProjAIndex);
    }
  });

  it('retrieve: target-project zero-keyword-overlap lesson ranks before cross-project keyword match', async () => {
    // Falsifiable: under the dropped-target-bucket bug this test fails because
    // the projA lesson is excluded (no keyword overlap with "auth") and projB
    // ranks first instead.
    //
    // Seed:
    //   projA / search-feature / outcome=pagination results (ts=newer, NO "auth" keyword)
    //   projB / auth-module    / outcome=auth login          (ts=older, HAS "auth" keyword)
    //
    // Query: text='auth', namespace='projA:something'
    // Expected: projA lesson is present AND appears before the projB lesson.
    const authEngineerDir = await mkdtemp(join(tmpdir(), 'engineer-ordering-'));
    await mkdir(authEngineerDir, { recursive: true });

    const lines = [
      // Target-project signal with ZERO keyword overlap with "auth"
      makeSignalLine('projA', 'search-feature', 'pagination results', '2026-06-25T12:00:00Z'),
      // Cross-project signal that FULLY matches the "auth" keyword
      makeSignalLine('projB', 'auth-module', 'auth login', '2026-06-25T08:00:00Z'),
    ];
    await writeFile(join(authEngineerDir, 'signals.jsonl'), lines.join('\n') + '\n', 'utf-8');

    const reader = createEngineerStoreReader({ engineerDir: authEngineerDir });
    const store = createJsonlLessonStore(reader);

    const results = await store.retrieve({
      text: 'auth',
      namespace: 'projA:something',
      topK: 10,
    });

    // The projA (zero-overlap) lesson must be present
    const projAIndex = results.findIndex(r => r.metadata['project'] === 'projA');
    expect(projAIndex).toBeGreaterThanOrEqual(0);

    // The projA lesson must rank BEFORE the projB keyword-matching lesson
    expect(results[0]!.metadata['project']).toBe('projA');

    const projBIndex = results.findIndex(r => r.metadata['project'] === 'projB');
    if (projBIndex !== -1) {
      expect(projAIndex).toBeLessThan(projBIndex);
    }
  });

  it('retrieve: each result has required RetrievedLesson fields (id, text, metadata)', async () => {
    await seedSignals();
    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    const results = await store.retrieve({
      text: 'auth',
      namespace: 'projA:auth-feature',
      topK: 10,
    });

    for (const lesson of results) {
      expect(typeof lesson.id).toBe('string');
      expect(lesson.id.length).toBeGreaterThan(0);
      expect(typeof lesson.text).toBe('string');
      expect(lesson.text.length).toBeGreaterThan(0);
      expect(typeof lesson.metadata).toBe('object');
      expect(lesson.metadata).not.toBeNull();
    }
  });

  it('record() is a no-op: does not throw and does not mutate signals.jsonl', async () => {
    await seedSignals();
    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    const before = await readFile(join(engineerDir, 'signals.jsonl'), 'utf-8');

    // Calling record() must not throw
    await expect(
      store.record({
        text: 'should not appear',
        namespace: 'projA:test',
        metadata: { injected: true },
      }),
    ).resolves.toBeUndefined();

    // signals.jsonl must be unchanged
    const after = await readFile(join(engineerDir, 'signals.jsonl'), 'utf-8');
    expect(after).toBe(before);
  });

  it('retrieve: empty store returns empty array (no crash on missing file)', async () => {
    // Don't seed — engineerDir exists but signals.jsonl does not
    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    const results = await store.retrieve({
      text: 'auth',
      namespace: 'projA:auth-feature',
      topK: 5,
    });

    expect(results).toEqual([]);
  });

  it('retrieve: returns empty array when topK=0', async () => {
    await seedSignals();
    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    const results = await store.retrieve({
      text: 'auth',
      namespace: 'projA:auth-feature',
      topK: 0,
    });

    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FR-8: selectLessons — flywheel read (relevant/unrelated/corrupt-store-safe)
// ---------------------------------------------------------------------------

/**
 * Build a minimal EngineerSignal JSONL line for seeding selectLessons fixtures.
 * The signal's outcome, kickbacks, halts, retryHotspots, and narrativeRef fields
 * determine which digest groups it lands in.
 */
function makeSignalForSelect(opts: {
  project: string;
  feature: string;
  ts: string;
  outcome?: string;
  kickbacks?: unknown[];
  halts?: unknown[];
  retryHotspots?: unknown[];
  narrativeRef?: string;
}): string {
  const sig: Record<string, unknown> = {
    schemaVersion: 1,
    ts: opts.ts,
    project: opts.project,
    feature: opts.feature,
    runId: `run-${opts.project}-${opts.feature}`,
    outcome: opts.outcome ?? 'done',
    kickbacks: opts.kickbacks ?? [],
    halts: opts.halts ?? [],
    retryHotspots: opts.retryHotspots ?? [],
    tokens: { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 },
    durationByStep: {},
  };
  if (opts.narrativeRef !== undefined) {
    sig['narrativeRef'] = opts.narrativeRef;
  }
  return JSON.stringify(sig);
}

describe('selectLessons — FR-8 flywheel read', () => {
  let engineerDir: string;

  beforeEach(async () => {
    engineerDir = await mkdtemp(join(tmpdir(), 'select-lessons-test-'));
    await mkdir(engineerDir, { recursive: true });
  });

  // ── Happy path: relevant idea surfaces lessons ─────────────────────────────

  it('surfaces lessons when the idea keyword matches stored signals (related idea)', async () => {
    // Seed: one signal in "proj-auth" for "login-feature" — a kickback signal
    const lines = [
      makeSignalForSelect({
        project: 'proj-auth',
        feature: 'login-feature',
        ts: '2026-06-25T10:00:00Z',
        kickbacks: [{ from: 'gate', to: 'tdd', reason: 'test failure' }],
      }),
    ];
    await writeFile(join(engineerDir, 'signals.jsonl'), lines.join('\n') + '\n', 'utf-8');

    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    // idea "login auth" is related to "login-feature" in "proj-auth"
    const digest = await selectLessons('login auth', 'proj-auth', store);

    // At least one group must be populated (kickback expanded lesson matches)
    const totalLessons =
      digest.kickbacks.length +
      digest.halts.length +
      digest.retryHotspots.length +
      digest.narrativeRefs.length;
    expect(totalLessons).toBeGreaterThan(0);
    // isEmpty sentinel must be absent when lessons are found
    expect(digest.isEmpty).toBeUndefined();
    expect(digest.empty).toBeUndefined();
  });

  it('surfaces kickback lessons in the kickbacks group for a matching signal', async () => {
    const lines = [
      makeSignalForSelect({
        project: 'proj-x',
        feature: 'payment-feature',
        ts: '2026-06-25T10:00:00Z',
        kickbacks: [{ from: 'gate', to: 'tdd', reason: 'assertion failed' }],
      }),
    ];
    await writeFile(join(engineerDir, 'signals.jsonl'), lines.join('\n') + '\n', 'utf-8');

    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    const digest = await selectLessons('payment checkout', 'proj-x', store);

    // The kickback expanded lesson text starts with "kickback:" — must be categorised
    expect(digest.kickbacks.length).toBeGreaterThan(0);
  });

  // ── Negative: UNRELATED idea surfaces NONE ────────────────────────────────

  it('surfaces NO lessons when the idea is completely unrelated (isEmpty set)', async () => {
    // Seed signal for "proj-auth" / "login-feature" — no cross-project keyword overlap
    const lines = [
      makeSignalForSelect({
        project: 'proj-auth',
        feature: 'login-feature',
        ts: '2026-06-25T10:00:00Z',
      }),
    ];
    await writeFile(join(engineerDir, 'signals.jsonl'), lines.join('\n') + '\n', 'utf-8');

    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    // Querying a completely different project with an unrelated idea
    // proj-billing does not appear in the store, and idea "billing invoice"
    // has NO keyword overlap with "login-feature" in the store.
    const digest = await selectLessons('billing invoice xyz', 'proj-billing', store);

    // All groups must be empty
    expect(digest.kickbacks).toHaveLength(0);
    expect(digest.halts).toHaveLength(0);
    expect(digest.retryHotspots).toHaveLength(0);
    expect(digest.narrativeRefs).toHaveLength(0);
    // isEmpty sentinel must be set
    expect(digest.isEmpty).toBe(true);
    expect(digest.empty).toBe(true);
  });

  it('surfaces NONE when the store is completely empty (isEmpty set, no crash)', async () => {
    // No signals.jsonl — reader returns empty array
    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    const digest = await selectLessons('any idea', 'any-project', store);

    expect(digest.kickbacks).toHaveLength(0);
    expect(digest.isEmpty).toBe(true);
  });

  // ── Negative: CORRUPT store → zero lessons + warning, no crash ────────────

  it('returns zero lessons (isEmpty) and logs a warning when store.retrieve() throws (corrupt store)', async () => {
    // Construct a store that always throws from retrieve() — simulates a
    // corrupt or inaccessible backing store.
    const corruptStore: LessonStore = {
      async record(_lesson: LessonRecord): Promise<void> { /* no-op */ },
      async retrieve(_query: LessonQuery): Promise<RetrievedLesson[]> {
        throw new Error('CORRUPT: cannot read backing store');
      },
    };

    const warnings: string[] = [];
    const logSpy = (msg: string) => { warnings.push(msg); };

    // Must NOT throw
    const digest = await selectLessons('any idea', 'any-project', corruptStore, { log: logSpy });

    // All groups empty — corrupt store → empty digest
    expect(digest.kickbacks).toHaveLength(0);
    expect(digest.halts).toHaveLength(0);
    expect(digest.retryHotspots).toHaveLength(0);
    expect(digest.narrativeRefs).toHaveLength(0);
    expect(digest.isEmpty).toBe(true);
    expect(digest.empty).toBe(true);

    // A warning must have been logged (contains the error message)
    const warningLogged = warnings.some(w => w.includes('CORRUPT'));
    expect(warningLogged).toBe(true);
  });

  it('does not crash when store.retrieve() throws with a non-Error value (string thrown)', async () => {
    // Adversarial: some callers throw raw strings, not Error instances.
    const weirdStore: LessonStore = {
      async record(_lesson: LessonRecord): Promise<void> { /* no-op */ },
      async retrieve(_query: LessonQuery): Promise<RetrievedLesson[]> {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'string error from store';
      },
    };

    const warnings: string[] = [];
    await expect(
      selectLessons('idea', 'project', weirdStore, { log: (m) => { warnings.push(m); } }),
    ).resolves.toMatchObject({ isEmpty: true });

    expect(warnings.some(w => w.includes('string error from store'))).toBe(true);
  });
});
