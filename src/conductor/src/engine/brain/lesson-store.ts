// LessonStore port + types (ADR-006, FR-5).
//
// This file defines the authoritative port interface for lesson retrieval and
// recording. The default JSONL adapter (createJsonlLessonStore) is also
// defined here (Task 11). Semantic adapters live in separate files.
//
// The LESSON_STORE_VERSION sentinel is a module-level export that allows tests
// and consumers to perform a runtime import (forcing module resolution) without
// depending on any concrete adapter.

import type { BrainStoreReader, BrainSignal } from '../brain-store.js';

/** Sentinel string — exported so tests can verify the module resolves at runtime. */
export const LESSON_STORE_VERSION = '1';

// ---------------------------------------------------------------------------
// Core record type — the payload passed to LessonStore.record()
// ---------------------------------------------------------------------------

/**
 * A lesson to be recorded. Carries the free-text body (`text`), the composite
 * `namespace` key ("project:feature" — adapter owns encoding), and arbitrary
 * `metadata` for downstream filtering.
 *
 * `score` and `validAt` are OPTIONAL; they are meaningful when importing
 * externally ranked lessons (e.g. from a semantic index) but need not be
 * provided for freshly created records.
 */
export interface LessonRecord {
  /** Free-text body of the lesson. */
  text: string;
  /** Composite "project:feature" key. The adapter owns namespace encoding. */
  namespace: string;
  /** Arbitrary metadata for equality/operator filtering. */
  metadata: Record<string, unknown>;
  /** OPTIONAL — relevance score (rank-by-position when absent). */
  score?: number;
  /** OPTIONAL — bi-temporal validity timestamp (ISO-8601). */
  validAt?: string;
}

// ---------------------------------------------------------------------------
// Query type — the payload passed to LessonStore.retrieve()
// ---------------------------------------------------------------------------

/**
 * Query parameters for lesson retrieval.
 *
 * Only `text` and `namespace` are required. All other fields are optional and
 * fall back to adapter-defined defaults when absent.
 */
export interface LessonQuery {
  /** The idea / plan context used for keyword or semantic matching. */
  text: string;
  /** Composite "project:feature" key (adapter owns encoding). */
  namespace: string;
  /** Maximum number of results to return. Adapter applies a default when absent. */
  topK?: number;
  /** Metadata equality / operator filters. */
  filters?: Record<string, unknown>;
  /**
   * When true the adapter widens the search beyond the current namespace.
   * Today this is always false; future semantic mode may enable it.
   */
  crossProject?: boolean;
}

// ---------------------------------------------------------------------------
// Retrieved lesson type — the shape returned by LessonStore.retrieve()
// ---------------------------------------------------------------------------

/**
 * A lesson returned from LessonStore.retrieve().
 *
 * `score` and `validAt` are OPTIONAL — consumers must fall back to
 * rank-by-position when `score` is absent, and treat absence of `validAt` as
 * "always valid".
 */
export interface RetrievedLesson {
  /** Unique identifier for the lesson (assigned by the adapter). */
  id: string;
  /** Free-text body of the lesson. */
  text: string;
  /** OPTIONAL — relevance score; fall back to rank-by-position when absent. */
  score?: number;
  /** Arbitrary metadata carried through from the stored record. */
  metadata: Record<string, unknown>;
  /** OPTIONAL — bi-temporal validity timestamp (ISO-8601). */
  validAt?: string;
}

// ---------------------------------------------------------------------------
// Port interface (ADR-006 pluggable boundary)
// ---------------------------------------------------------------------------

/**
 * LessonStore is the authoritative port for lesson recording and retrieval.
 *
 * Adapters implement this interface. The default adapter is JSONL-backed
 * (system of record); its `record()` no-ops the write step for callers that
 * only need retrieval. A semantic adapter may layer vector search on top.
 */
export interface LessonStore {
  /**
   * Persist a lesson. The JSONL adapter is the system of record; other
   * adapters may no-op this method.
   */
  record(lesson: LessonRecord): Promise<void>;

  /**
   * Retrieve lessons matching the query. Returns an ordered list of
   * RetrievedLesson objects; callers fall back to rank-by-position when
   * `score` is absent.
   */
  retrieve(query: LessonQuery): Promise<RetrievedLesson[]>;
}

// ---------------------------------------------------------------------------
// selectLessons + LessonDigest (Task 12, FR-5)
// ---------------------------------------------------------------------------

/**
 * A digested view of retrieved lessons, grouped by the type of signal they
 * represent. Each group holds zero or more deduplicated RetrievedLesson objects
 * so downstream callers can reason about patterns without re-scanning raw lists.
 *
 * Groups:
 *   kickbacks     — lessons whose text mentions a kickback event (step forced
 *                   back to a prior gate — keyword "kickback").
 *   halts         — lessons where metadata.outcome === 'halted' (gate loop
 *                   stopped before completion).
 *   retryHotspots — lessons whose text mentions retry or hotspot patterns
 *                   (keyword "retry" or "hotspot").
 *   narrativeRefs — lessons that carry a narrative reference in metadata
 *                   (metadata.narrativeRef is a non-empty string).
 *
 * A single lesson may appear in multiple groups (e.g. a halted run that also
 * has a narrative). Deduplication within each group ensures no id repeats.
 */
export interface LessonDigest {
  kickbacks: RetrievedLesson[];
  halts: RetrievedLesson[];
  retryHotspots: RetrievedLesson[];
  narrativeRefs: RetrievedLesson[];
}

/**
 * Options for `selectLessons`.
 *
 * `topK`  — maximum lessons to retrieve from the store. Defaults to 10 when
 *            absent or undefined. Passed to `store.retrieve` as-is so the
 *            adapter owns the cap enforcement.
 * `log`   — injectable logger called once with a message that includes the
 *            applied topK bound. Defaults to a no-op so callers that don't
 *            need observability pay zero overhead. Tests inject a spy here to
 *            assert the bound was logged.
 */
export interface SelectLessonsOpts {
  topK?: number;
  log?: (msg: string) => void;
}

const SELECT_DEFAULT_TOP_K = 10;

/**
 * Retrieve lessons for the given `idea` + `project` context, dedupe them, and
 * assemble a `LessonDigest` whose groups reflect the type of signal each
 * lesson represents.
 *
 * Categorisation logic (keyword scan on `.text` + metadata field checks):
 *   kickbacks     — text contains "kickback" (case-insensitive)
 *   halts         — metadata.outcome === 'halted'
 *   retryHotspots — text contains "retry" or "hotspot" (case-insensitive)
 *   narrativeRefs — metadata.narrativeRef is a non-empty string
 *
 * A lesson may match more than one group; deduplication is per-group so a
 * lesson stored twice by the adapter (e.g. after an unfortunate re-read)
 * appears at most once per group.
 *
 * The applied `topK` bound is always logged (once, before retrieval) via
 * `opts.log` so the cap is observable in production without grep-ing source.
 */
export async function selectLessons(
  idea: string,
  project: string,
  store: LessonStore,
  opts: SelectLessonsOpts = {},
): Promise<LessonDigest> {
  const bound = opts.topK ?? SELECT_DEFAULT_TOP_K;
  const log = opts.log ?? ((_msg: string) => { /* no-op */ });

  // Log the applied bound BEFORE retrieval so it's observable even when
  // retrieve() throws or the store is empty.
  log(`selectLessons: applying topK bound of ${bound} for project="${project}" idea="${idea}"`);

  // Short-circuit: a bound of 0 means no lessons are wanted.
  if (bound <= 0) {
    return { kickbacks: [], halts: [], retryHotspots: [], narrativeRefs: [] };
  }

  // Retrieve from the store using the namespace convention "project:*".
  // The adapter owns the topK enforcement; we pass through the bound.
  // We also slice to `bound` here as a defence-in-depth cap so that stub
  // stores (used in tests) that don't honour topK cannot inflate the digest.
  const retrieved = await store.retrieve({ text: idea, namespace: project, topK: bound });
  const raw = retrieved.slice(0, bound);

  // Dedupe by id across the entire result set before categorising.
  // Strategy: first-occurrence wins (rank-by-position is preserved).
  const seen = new Set<string>();
  const deduped: RetrievedLesson[] = [];
  for (const lesson of raw) {
    if (!seen.has(lesson.id)) {
      seen.add(lesson.id);
      deduped.push(lesson);
    }
  }

  // Per-group deduplication sets (a lesson can appear in multiple groups but
  // never twice within the same group).
  const kickbackIds = new Set<string>();
  const haltIds = new Set<string>();
  const retryIds = new Set<string>();
  const narrativeIds = new Set<string>();

  const digest: LessonDigest = {
    kickbacks: [],
    halts: [],
    retryHotspots: [],
    narrativeRefs: [],
  };

  for (const lesson of deduped) {
    const textLower = lesson.text.toLowerCase();

    // kickbacks: text contains "kickback"
    if (textLower.includes('kickback') && !kickbackIds.has(lesson.id)) {
      kickbackIds.add(lesson.id);
      digest.kickbacks.push(lesson);
    }

    // halts: metadata.outcome is 'halted'
    if (lesson.metadata['outcome'] === 'halted' && !haltIds.has(lesson.id)) {
      haltIds.add(lesson.id);
      digest.halts.push(lesson);
    }

    // retryHotspots: text contains "retry" or "hotspot"
    if ((textLower.includes('retry') || textLower.includes('hotspot')) && !retryIds.has(lesson.id)) {
      retryIds.add(lesson.id);
      digest.retryHotspots.push(lesson);
    }

    // narrativeRefs: metadata.narrativeRef is a non-empty string
    const narRef = lesson.metadata['narrativeRef'];
    if (typeof narRef === 'string' && narRef.trim() !== '' && !narrativeIds.has(lesson.id)) {
      narrativeIds.add(lesson.id);
      digest.narrativeRefs.push(lesson);
    }
  }

  return digest;
}

// ---------------------------------------------------------------------------
// Default adapter: keyword/recency over JSONL (Task 11, FR-5)
// ---------------------------------------------------------------------------

const DEFAULT_TOP_K = 10;

/**
 * Map a BrainSignal to a RetrievedLesson.
 *
 * Mapping strategy:
 *   id       → "<project>:<feature>:<runId>" — unique per run
 *   text     → "<feature>: <outcome>" — the most human-meaningful summary
 *              available in a BrainSignal without a narrative. If a
 *              narrativeRef is present it is noted; narrative body is not
 *              read here (lesson-store is a retrieval layer, not an I/O layer).
 *   score    → absent (rank-by-position per spec; no numeric score fabricated)
 *   metadata → all BrainSignal scalar fields for downstream filtering
 *   validAt  → signal's `ts` field (the moment the signal was assembled)
 */
function signalToLesson(sig: BrainSignal): RetrievedLesson {
  const id = `${sig.project}:${sig.feature}:${sig.runId}`;
  const text = sig.narrativeRef
    ? `${sig.feature}: ${sig.outcome} (narrative: ${sig.narrativeRef})`
    : `${sig.feature}: ${sig.outcome}`;
  return {
    id,
    text,
    // score intentionally absent — rank-by-position (insertion/recency order)
    metadata: {
      project: sig.project,
      feature: sig.feature,
      runId: sig.runId,
      outcome: sig.outcome,
      schemaVersion: sig.schemaVersion,
      ...(sig.narrativeRef !== undefined ? { narrativeRef: sig.narrativeRef } : {}),
    },
    validAt: sig.ts,
  };
}

/**
 * Keyword match: return true if the query text overlaps with any word in the
 * signal's project+feature+outcome text. Case-insensitive, word-boundary split.
 * Treats the entire signal as a bag of words — good enough for the JSONL tier
 * (a semantic adapter handles embeddings in a later task).
 */
function keywordMatches(sig: BrainSignal, queryText: string): boolean {
  if (!queryText.trim()) return true; // empty query → match all
  const haystack = `${sig.project} ${sig.feature} ${sig.outcome}`.toLowerCase();
  const needles = queryText.toLowerCase().split(/\s+/).filter(Boolean);
  return needles.some(needle => haystack.includes(needle));
}

/**
 * Create a `LessonStore` backed by the provided `BrainStoreReader`.
 *
 * Ranking: target-project lessons FIRST (by recency — newest first within the
 * bucket), then cross-project keyword/recency matches (newest first). Result
 * is bounded to `topK` (defaults to 10 when absent or undefined).
 *
 * `record()` is a no-op pass-through — the JSONL store is the system of
 * record; recording happens via `appendSignal` elsewhere.
 */
export function createJsonlLessonStore(reader: BrainStoreReader): LessonStore {
  return {
    // No-op: recording is owned by appendSignal in brain-store.ts (FR-5).
    async record(_lesson: LessonRecord): Promise<void> {
      // intentional no-op
    },

    async retrieve(query: LessonQuery): Promise<RetrievedLesson[]> {
      const limit = query.topK ?? DEFAULT_TOP_K;
      if (limit <= 0) return [];

      // Parse the namespace to extract the target project name.
      // namespace format: "project:feature" (adapter owns encoding per spec).
      const colonIdx = query.namespace.indexOf(':');
      const targetProject = colonIdx !== -1
        ? query.namespace.slice(0, colonIdx)
        : query.namespace;

      // Read all signals — no filter, we bucket manually below.
      const allSignals = await reader.readSignals();

      // Bucket 1: target-project signals (all of them, regardless of keyword)
      const targetSignals = allSignals.filter(s => s.project === targetProject);

      // Bucket 2: cross-project signals matching the query keywords (recency)
      // Excludes target-project signals to avoid duplication.
      const crossSignals = allSignals.filter(
        s => s.project !== targetProject && keywordMatches(s, query.text),
      );

      // Within each bucket sort newest-first (ts is ISO-8601, lexicographic sort works).
      const byRecencyDesc = (a: BrainSignal, b: BrainSignal): number =>
        b.ts.localeCompare(a.ts);

      targetSignals.sort(byRecencyDesc);
      crossSignals.sort(byRecencyDesc);

      // Concatenate: target-project first, then cross-project matches.
      const ranked = [...targetSignals, ...crossSignals];

      // Bound to topK and map to RetrievedLesson.
      return ranked.slice(0, limit).map(signalToLesson);
    },
  };
}
