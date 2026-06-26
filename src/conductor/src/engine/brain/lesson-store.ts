// LessonStore port + types (ADR-006, FR-5).
//
// This file defines the authoritative port interface for lesson retrieval and
// recording. Only the interface contract lives here — adapters (JSONL default,
// semantic, etc.) are defined in separate files (later tasks).
//
// The LESSON_STORE_VERSION sentinel is a module-level export that allows tests
// and consumers to perform a runtime import (forcing module resolution) without
// depending on any concrete adapter.

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
