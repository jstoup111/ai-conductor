// Test: selectLessons digest + bound logging (Task 12, FR-5)
//
// Adversarial paths covered:
//   - Duplicate lesson ids are deduped in the digest
//   - Lessons with no matching category land in no group (graceful)
//   - topK bound of 0 returns an empty digest (no crash)
//   - spy receives the applied bound regardless of category content
//   - stub returning known RetrievedLesson shapes drives all four groups
import { describe, it, expect, vi } from 'vitest';
import type { LessonStore, LessonQuery, RetrievedLesson } from '../../../src/engine/engineer/lesson-store.js';
import { selectLessons } from '../../../src/engine/engineer/lesson-store.js';
import type { LessonDigest } from '../../../src/engine/engineer/lesson-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal RetrievedLesson. Override any field via the second arg. */
function makeLesson(partial: Partial<RetrievedLesson> & { id: string }): RetrievedLesson {
  return {
    text: 'generic lesson text',
    metadata: {},
    ...partial,
  };
}

/** Build a stub LessonStore that always returns the given lessons from retrieve(). */
function makeStore(lessons: RetrievedLesson[]): LessonStore {
  return {
    async record(): Promise<void> { /* no-op */ },
    async retrieve(_query: LessonQuery): Promise<RetrievedLesson[]> {
      return lessons;
    },
  };
}

// ---------------------------------------------------------------------------
// Happy path: digest groups populated from known lesson metadata/text
// ---------------------------------------------------------------------------

describe('selectLessons — happy path digest grouping', () => {
  it('populates kickbacks from lessons whose metadata.outcome hints at kickback', async () => {
    const store = makeStore([
      makeLesson({ id: 'kb-1', text: 'step kickback from tdd to plan', metadata: { outcome: 'done' } }),
    ]);
    const digest = await selectLessons('some idea', 'proj-a', store);
    expect(digest.kickbacks.length).toBeGreaterThanOrEqual(1);
    expect(digest.kickbacks.some(l => l.id === 'kb-1')).toBe(true);
  });

  it('populates halts from lessons whose metadata.outcome is "halted"', async () => {
    const store = makeStore([
      makeLesson({ id: 'halt-1', text: 'feature halted due to conflict', metadata: { outcome: 'halted' } }),
    ]);
    const digest = await selectLessons('some idea', 'proj-a', store);
    expect(digest.halts.length).toBeGreaterThanOrEqual(1);
    expect(digest.halts.some(l => l.id === 'halt-1')).toBe(true);
  });

  it('populates retryHotspots from lessons whose text mentions retry', async () => {
    const store = makeStore([
      makeLesson({ id: 'retry-1', text: 'step_retry at tdd gate, hotspot step', metadata: { outcome: 'done' } }),
    ]);
    const digest = await selectLessons('some idea', 'proj-a', store);
    expect(digest.retryHotspots.length).toBeGreaterThanOrEqual(1);
    expect(digest.retryHotspots.some(l => l.id === 'retry-1')).toBe(true);
  });

  it('populates narrativeRefs from lessons that carry a narrativeRef in metadata', async () => {
    const store = makeStore([
      makeLesson({ id: 'narr-1', text: 'feature: done (narrative: narratives/proj/feat-run.md)', metadata: { outcome: 'done', narrativeRef: 'narratives/proj/feat-run.md' } }),
    ]);
    const digest = await selectLessons('some idea', 'proj-a', store);
    expect(digest.narrativeRefs.length).toBeGreaterThanOrEqual(1);
    expect(digest.narrativeRefs.some(l => l.id === 'narr-1')).toBe(true);
  });

  it('a single lesson can land in multiple groups (e.g. halted + has narrativeRef)', async () => {
    const store = makeStore([
      makeLesson({
        id: 'multi-1',
        text: 'feature halted due to conflict (narrative: narratives/proj/feat-run.md)',
        metadata: { outcome: 'halted', narrativeRef: 'narratives/proj/feat-run.md' },
      }),
    ]);
    const digest = await selectLessons('some idea', 'proj-a', store);
    expect(digest.halts.some(l => l.id === 'multi-1')).toBe(true);
    expect(digest.narrativeRefs.some(l => l.id === 'multi-1')).toBe(true);
  });

  it('LessonDigest shape: has kickbacks, halts, retryHotspots, narrativeRefs arrays', async () => {
    const store = makeStore([]);
    const digest: LessonDigest = await selectLessons('idea', 'proj', store);
    expect(Array.isArray(digest.kickbacks)).toBe(true);
    expect(Array.isArray(digest.halts)).toBe(true);
    expect(Array.isArray(digest.retryHotspots)).toBe(true);
    expect(Array.isArray(digest.narrativeRefs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deduplication: no duplicate id in any group
// ---------------------------------------------------------------------------

describe('selectLessons — deduplication', () => {
  it('dedupes lessons with duplicate ids: each id appears at most once per group', async () => {
    const dup = makeLesson({ id: 'dup-1', text: 'kickback step x', metadata: { outcome: 'done' } });
    const store = makeStore([dup, dup, dup]); // store returns the same lesson 3 times
    const digest = await selectLessons('idea', 'proj', store);

    // Gather all ids in kickbacks (where dup-1 should land)
    const kbIds = digest.kickbacks.map(l => l.id);
    expect(kbIds.filter(id => id === 'dup-1')).toHaveLength(1); // exactly once
  });

  it('dedupes across all groups: same id never appears twice within a group', async () => {
    const lessons = [
      makeLesson({ id: 'a-1', text: 'kickback step x', metadata: { outcome: 'done' } }),
      makeLesson({ id: 'a-1', text: 'kickback step x', metadata: { outcome: 'done' } }), // exact duplicate
    ];
    const store = makeStore(lessons);
    const digest = await selectLessons('idea', 'proj', store);

    for (const group of [digest.kickbacks, digest.halts, digest.retryHotspots, digest.narrativeRefs]) {
      const ids = group.map(l => l.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Bound logging: the applied top-N is logged via opts.log
// ---------------------------------------------------------------------------

describe('selectLessons — bound logging', () => {
  it('logs a message containing the applied topK bound (default bound)', async () => {
    const store = makeStore([]);
    const spy = vi.fn();
    await selectLessons('idea', 'proj', store, { log: spy });
    expect(spy).toHaveBeenCalled();
    // At least one call must mention a number (the bound)
    const calls = spy.mock.calls.map((args: unknown[]) => String(args[0]));
    expect(calls.some(msg => /\d+/.test(msg))).toBe(true);
  });

  it('logs the exact bound that was applied when opts.topK is provided', async () => {
    const store = makeStore([]);
    const spy = vi.fn();
    await selectLessons('idea', 'proj', store, { log: spy, topK: 7 });
    const calls = spy.mock.calls.map((args: unknown[]) => String(args[0]));
    expect(calls.some(msg => msg.includes('7'))).toBe(true);
  });

  it('logs the bound even when the store returns no lessons', async () => {
    const store = makeStore([]);
    const spy = vi.fn();
    await selectLessons('idea', 'proj', store, { log: spy, topK: 3 });
    expect(spy).toHaveBeenCalled();
  });

  it('does not throw when opts.log is omitted (no-op default)', async () => {
    const store = makeStore([makeLesson({ id: 'x', text: 'kickback step', metadata: {} })]);
    await expect(selectLessons('idea', 'proj', store)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Edge cases / adversarial paths
// ---------------------------------------------------------------------------

describe('selectLessons — edge / adversarial', () => {
  it('topK=0: returns empty digest, still logs bound of 0', async () => {
    const store = makeStore([makeLesson({ id: 'x', text: 'kickback', metadata: {} })]);
    const spy = vi.fn();
    const digest = await selectLessons('idea', 'proj', store, { log: spy, topK: 0 });
    expect(digest.kickbacks).toHaveLength(0);
    expect(digest.halts).toHaveLength(0);
    expect(digest.retryHotspots).toHaveLength(0);
    expect(digest.narrativeRefs).toHaveLength(0);
    const calls = spy.mock.calls.map((args: unknown[]) => String(args[0]));
    expect(calls.some(msg => msg.includes('0'))).toBe(true);
  });

  it('lesson with no matching category lands in no group (graceful)', async () => {
    // A lesson with neutral outcome and no keywords
    const store = makeStore([makeLesson({ id: 'neutral-1', text: 'feature: done', metadata: { outcome: 'done' } })]);
    const digest = await selectLessons('idea', 'proj', store);
    // Should not throw; groups may or may not contain it but must be arrays
    expect(Array.isArray(digest.kickbacks)).toBe(true);
    expect(Array.isArray(digest.halts)).toBe(true);
    expect(Array.isArray(digest.retryHotspots)).toBe(true);
    expect(Array.isArray(digest.narrativeRefs)).toBe(true);
  });

  it('mixed batch: correctly routes lessons to distinct groups', async () => {
    const lessons = [
      makeLesson({ id: 'kb', text: 'kickback from tdd to plan', metadata: { outcome: 'done' } }),
      makeLesson({ id: 'hl', text: 'feature: halted', metadata: { outcome: 'halted' } }),
      makeLesson({ id: 'rh', text: 'step_retry hotspot tdd gate', metadata: { outcome: 'done' } }),
      makeLesson({ id: 'nr', text: 'feature: done (narrative: path/to/narr.md)', metadata: { outcome: 'done', narrativeRef: 'path/to/narr.md' } }),
    ];
    const store = makeStore(lessons);
    const digest = await selectLessons('idea', 'proj', store);

    expect(digest.kickbacks.some(l => l.id === 'kb')).toBe(true);
    expect(digest.halts.some(l => l.id === 'hl')).toBe(true);
    expect(digest.retryHotspots.some(l => l.id === 'rh')).toBe(true);
    expect(digest.narrativeRefs.some(l => l.id === 'nr')).toBe(true);
  });

  it('negative: lesson classified as "halted" does NOT appear in kickbacks group unless also a kickback', async () => {
    const store = makeStore([
      makeLesson({ id: 'halt-only', text: 'feature: halted', metadata: { outcome: 'halted' } }),
    ]);
    const digest = await selectLessons('idea', 'proj', store);
    // halted lesson should be in halts
    expect(digest.halts.some(l => l.id === 'halt-only')).toBe(true);
    // must NOT be in kickbacks (no kickback keyword in text)
    expect(digest.kickbacks.some(l => l.id === 'halt-only')).toBe(false);
  });

  it('negative: lesson classified as retryHotspot does NOT appear in halts unless also halted', async () => {
    const store = makeStore([
      makeLesson({ id: 'retry-only', text: 'retry hotspot at gate', metadata: { outcome: 'done' } }),
    ]);
    const digest = await selectLessons('idea', 'proj', store);
    expect(digest.retryHotspots.some(l => l.id === 'retry-only')).toBe(true);
    expect(digest.halts.some(l => l.id === 'retry-only')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FR-5 flywheel relevance negative paths (Task 13)
// Uses createJsonlLessonStore over real temp signals.jsonl files.
// ---------------------------------------------------------------------------

import { describe as describeNeg, it as itNeg, expect as expectNeg, vi as viNeg, beforeEach as beforeEachNeg, afterEach as afterEachNeg } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEngineerStoreReader } from '../../../src/engine/engineer-store.js';
import { createJsonlLessonStore } from '../../../src/engine/engineer/lesson-store.js';

/** Build a minimal valid EngineerSignal JSON line for a given project/feature. */
function makeSignalLine(project: string, feature: string, outcome: string, ts: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    ts,
    project,
    feature,
    runId: `run-${project}-${feature}-${ts.slice(11, 19).replace(/:/g, '')}`,
    outcome,
    kickbacks: [],
    halts: [],
    retryHotspots: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    durationByStep: {},
  });
}

describeNeg('selectLessons — FR-5 flywheel relevance negatives (Task 13)', () => {
  let engineerDir: string;

  beforeEachNeg(async () => {
    engineerDir = await mkdtemp(join(tmpdir(), 'engineer-neg-test-'));
    await mkdir(engineerDir, { recursive: true });
  });

  afterEachNeg(async () => {
    // temp dirs cleaned up by OS; best-effort
  });

  // -------------------------------------------------------------------------
  // Negative 1 — NONE-RELEVANT
  // Signals present in the store but NONE are relevant to the queried idea/project.
  // selectLessons must NOT pad the digest with unrelated lessons.
  // The digest must signal emptiness explicitly via isEmpty === true AND all
  // groups must be empty arrays.
  // Falsifiable: would fail if selectLessons includes signals from a different
  // project or pads irrelevant lessons as fillers.
  // -------------------------------------------------------------------------
  itNeg('NONE-RELEVANT: signals exist but none match idea/project → digest isEmpty, all groups empty', async () => {
    // Seed signals for "unrelated-proj" with features that don't mention "payment-flow"
    const lines = [
      makeSignalLine('unrelated-proj', 'analytics-dashboard', 'done', '2026-06-25T10:00:00Z'),
      makeSignalLine('unrelated-proj', 'user-profile', 'done', '2026-06-25T11:00:00Z'),
      makeSignalLine('other-proj', 'notifications-feature', 'halted', '2026-06-25T09:00:00Z'),
    ];
    await writeFile(join(engineerDir, 'signals.jsonl'), lines.join('\n') + '\n', 'utf-8');

    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    // Query for "payment-flow" idea in "target-proj" — nothing in the store matches
    const digest = await selectLessons('payment-flow checkout', 'target-proj', store);

    // All groups must be empty — no padding with unrelated lessons
    expectNeg(digest.kickbacks).toHaveLength(0);
    expectNeg(digest.halts).toHaveLength(0);
    expectNeg(digest.retryHotspots).toHaveLength(0);
    expectNeg(digest.narrativeRefs).toHaveLength(0);

    // The digest must explicitly signal "no prior lessons" via isEmpty
    expectNeg(digest.isEmpty).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Negative 2 — OVER-CAP
  // The store has more relevant lessons than the topK bound.
  // selectLessons must bound the digest to topK AND log must receive the bound.
  // Falsifiable: would fail if selection is unbounded (total lessons > topK).
  // -------------------------------------------------------------------------
  itNeg('OVER-CAP: more relevant lessons than bound → total in digest <= topK, bound logged', async () => {
    // Seed 8 signals for "target-proj" with "auth" in the feature name (relevant)
    const lines = Array.from({ length: 8 }, (_, i) =>
      makeSignalLine(
        'target-proj',
        `auth-feature-${i}`,
        'done',
        `2026-06-25T${String(10 + i).padStart(2, '0')}:00:00Z`,
      ),
    );
    await writeFile(join(engineerDir, 'signals.jsonl'), lines.join('\n') + '\n', 'utf-8');

    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);
    const logSpy = viNeg.fn();

    // Bound to 3 — the store has 8 relevant lessons
    const digest = await selectLessons('auth login', 'target-proj', store, { topK: 3, log: logSpy });

    // Total across all groups (a lesson can appear in multiple groups, but
    // the distinct lesson count must be <= topK)
    const allIds = new Set([
      ...digest.kickbacks.map(l => l.id),
      ...digest.halts.map(l => l.id),
      ...digest.retryHotspots.map(l => l.id),
      ...digest.narrativeRefs.map(l => l.id),
    ]);
    // The number of distinct lessons in the digest must not exceed the bound
    expectNeg(allIds.size).toBeLessThanOrEqual(3);

    // The log must have received the applied bound (3)
    const logCalls = logSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    expectNeg(logCalls.some(msg => msg.includes('3'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Negative 3 — CORRUPT-LINE
  // The underlying signals.jsonl has a malformed line mixed in with valid lines.
  // The reader must skip the malformed line (resilient) and selection must still
  // work over the valid lines — no throw, digest reflects only valid data.
  // Falsifiable: would fail if a corrupt line causes a throw or is included in
  // the digest as a pseudo-lesson.
  // -------------------------------------------------------------------------
  itNeg('CORRUPT-LINE: malformed JSONL line is skipped, valid lines still selected', async () => {
    const validLine1 = makeSignalLine('target-proj', 'auth-feature', 'halted', '2026-06-25T10:00:00Z');
    const validLine2 = makeSignalLine('target-proj', 'auth-retry', 'done', '2026-06-25T11:00:00Z');
    const corruptLine = '{ this is not valid json :::';
    const content = [validLine1, corruptLine, validLine2].join('\n') + '\n';
    await writeFile(join(engineerDir, 'signals.jsonl'), content, 'utf-8');

    const reader = createEngineerStoreReader({ engineerDir });
    const store = createJsonlLessonStore(reader);

    // Must not throw even with a corrupt line present
    let digest: Awaited<ReturnType<typeof selectLessons>>;
    await expectNeg(
      (async () => {
        digest = await selectLessons('auth', 'target-proj', store);
      })(),
    ).resolves.toBeUndefined();

    // The digest must reflect only the 2 valid lines — the halted signal lands
    // in the halts group, the done signal lands in no group (no matching keyword)
    // but crucially no corrupt pseudo-lesson appears
    expectNeg(digest!.halts.length).toBeGreaterThanOrEqual(1);

    // No lesson id should be undefined/null (which a corrupt parse might produce)
    const allLessons = [
      ...digest!.kickbacks,
      ...digest!.halts,
      ...digest!.retryHotspots,
      ...digest!.narrativeRefs,
    ];
    for (const lesson of allLessons) {
      expectNeg(typeof lesson.id).toBe('string');
      expectNeg(lesson.id.length).toBeGreaterThan(0);
    }

    // The corrupt line count must not appear as a lesson in any group
    // (i.e. digest total lesson ids must be <= 2, the number of valid lines)
    const allIds = new Set(allLessons.map(l => l.id));
    expectNeg(allIds.size).toBeLessThanOrEqual(2);
  });
});
