# ADR 006: Flywheel — lesson selection + brain-planned provenance

**Date:** 2026-06-25
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** Phase 9.3 — supervisor/brain (capstone)
**Decision surfaces:** DS-3 (lesson selection, FR-5), DS-6 (brain-planned provenance, FR-12)
**Source gap:** conflict report `2026-06-25-phase-9.3-supervisor-brain.md` (FR-12 × 9.1 schema)

## Context

The flywheel is the whole point of the brain (PRD Key Decision #5): at plan time it must surface
the **relevant** prior lessons from the 9.1 store into DECIDE (FR-5), and it must be able to show
that kickback/halt/retry rates **fall across successive brain-planned features** (FR-12) — so we can
tell it is learning, not accumulating noise.

Two forces:
1. **Relevance, not volume.** Dumping every signal into planning is noise; selection must be scoped
   and bounded, or planning context blows out.
2. **Provenance gap (from conflict-check).** 9.1's `BrainSignal` schema
   (`{project, feature, runId, outcome, kickbacks[], halts[], retryHotspots[], tokens, …}`) has
   **no field** marking a signal as brain-planned. The daemon emits a signal for *every* feature it
   builds, however planned. FR-12 must measure brain-planned features **specifically** and exclude
   non-brain daemon work — with no data field to filter on.

## Options Considered

### Lesson selection (DS-3) — strategy
- **A per-project + keyword/recency, bounded top-N (logged).** *Pros:* cheap, deterministic,
  explainable; bound prevents context blowout. *Cons:* keyword similarity is coarse.
- **B embedding / semantic similarity over narratives (e.g. via an agent-memory backend).** *Pros:*
  better semantic + cross-project recall. *Cons:* new dependency + index; premature at current store
  size (dozens-to-hundreds of signals at solo scale).

### Lesson selection (DS-3) — architecture (selected: behind a port either way)
Whichever strategy ships, selection sits behind a **narrow `LessonStore` port** so the strategy can
be swapped without touching the planner. This was validated against the current (2025/2026)
agent-memory landscape (Mem0, Letta, Zep/Graphiti, Cognee, LangMem, plus baseline vector stores):
they **converge** on `add(item, scope, metadata)` to write and
`search(text, {namespace, topK, filters}) → ranked [{id, text, score?, metadata}]` to read, so a
single read port is a faithful lowest-common-denominator. Three findings shape the port so it will
**not** need rewriting on adoption:
1. **Write is async + LLM-mediated in real backends** (Mem0 `add` does fact-extraction + embedding;
   Graphiti runs an extraction/resolution pipeline; some return a job ack, not the stored record).
   → keep the **9.1 JSONL as the system of record**; treat any memory backend as a *replayable,
   async-indexed projection*; `record()` returns `Promise<void>` and "written ≠ instantly
   searchable" is assumed.
2. **No backend has a native two-level `(project, feature)` namespace** (Zep `graph_id`, Graphiti
   `group_id`, Mem0 `run_id`/`agent_id`, Letta tags are all single-level). → the port takes
   `namespace: string` (the composite `project:feature` key) **+** a `filters` bag, never a
   structured `{project, feature}` object — the adapter owns the encoding, and cross-project recall
   becomes "widen the namespace/filter," not "change the signature."
3. **`score` is not universal** (Letta's `passages.search` returns rank-ordered results with **no**
   score field). → `score?` is **optional**; rank-by-position is the fallback so a scoreless backend
   can't break digest assembly. (Bi-temporal `validAt?` is likewise optional — only Zep/Graphiti
   populate it.)

### Brain-planned provenance (DS-6)
- **A authored-keys intersection — brain keeps its own record of `(project, feature)` it planned;
  intersect with store signals.** *Pros:* no 9.1 schema change; self-contained in 9.3; the brain
  already knows what it authored (FR-6/7). *Cons:* the ledger must persist across sessions to be
  durable.
- **B add a `source`/`planner` field to the 9.1 signal schema.** *Pros:* provenance travels with the
  signal. *Cons:* cross-phase schema change to a merged component; the daemon would need to learn
  whether a spec was brain-authored — coupling the producer to the brain.

## Decision

**Selection strategy = Option A (per-project + keyword/recency, bounded top-N, bound logged),
behind a pluggable `LessonStore` port (semantic Option B is a future adapter, not a rewrite).
Provenance = Option A (authored-keys intersection), with B deferred.**

**Mechanism (locked):**
- **Pluggable selection boundary:** the planner depends only on a narrow port; the default
  keyword/recency strategy is one adapter, a future embedding/MCP-backed retriever is another behind
  the **same** signature. Swapping backends is one adapter class — no caller changes.
  ```ts
  interface LessonStore {
    // WRITE — used by the retro/ingest path, not the planner. JSONL stays the system of record;
    // a memory backend is a replayable, async-indexed projection (Promise<void>, may index later).
    record(lesson: LessonRecord): Promise<void>;
    // READ — the only thing the planner needs.
    retrieve(query: LessonQuery): Promise<RetrievedLesson[]>;
  }
  interface LessonQuery {
    text: string;                          // the idea / plan context — universal query input
    namespace: string;                     // composite "project:feature" key (adapter owns encoding)
    topK?: number;                         // default bound (logged)
    filters?: Record<string, unknown>;     // metadata equality/operators (kind, recency window)
    crossProject?: boolean;                // today false; semantic mode widens namespace/filter
  }
  interface RetrievedLesson {
    id: string;
    text: string;
    score?: number;                        // OPTIONAL — Letta omits it; fall back to rank-by-position
    metadata: Record<string, unknown>;     // kind, project, feature, timestamps, token-spend
    validAt?: string;                      // OPTIONAL bi-temporal field — only Zep/Graphiti populate
  }
  ```
  The default adapter implements `retrieve` over the 9.1 JSONL via keyword/recency; `record` is a
  no-op pass-through for the default (the JSONL is already the store). The convenience
  `selectLessons(idea, project, store): Promise<LessonDigest>` calls `store.retrieve(...)`, ranks/
  dedupes, and assembles the digest — its signature is stable across all backends.
- **Flywheel read (FR-5):** via the port, scope candidate signals to the **target project**
  (`namespace`) first, then add cross-project signals by **keyword/recency similarity** to the idea;
  take a **bounded top-N** (`topK`) and **log the bound**. Inject a concise digest
  (kickbacks/halts/retry-hotspots + narrative refs) into the DECIDE planning context — observably
  present in the planning artifact, not just logged. No relevant signals → inject an explicit "no
  prior lessons" (never pad with unrelated noise). A malformed signal line is skipped (9.1
  resilient-parse convention), never aborting the read.
- **Provenance (FR-12):** the brain maintains an **authored-keys ledger** of the `(project, feature)`
  pairs it has planned (recorded at spec-PR open, FR-6/7) and computes the flywheel trend over
  `store signals ∩ ledger` — **no 9.1 schema change**. Non-brain daemon work is excluded because it
  is not in the ledger. A brain-planned feature with no emitted signal yet is simply absent (no
  fabricated zero). **9.1 schema `source` marker (Option B) is deferred**; the intersection is the
  source of truth until/unless it proves insufficient.
- **Shared rate computation:** FR-9 (governor) and FR-12 (trend) use **one** rate-computation
  function aligned to 9.1's metric definition (resolves conflict-check FR-9×FR-12). `<2` features →
  "insufficient data"; zero-denominator features → excluded/N-A (no divide-by-zero).

## Consequences

### Positive
- Flywheel measurable without touching a merged upstream component; relevance bounded → planning
  context stays lean; one rate function → no divergent numbers between report and trend.
- The `LessonStore` port means adopting a memory framework later (Mem0 the most likely fit — only
  mature first-party TS SDK, self-hostable with local embeddings, namespaces that map to the
  `project:feature` key) is a **localized adapter change**, not a planner rewrite. The brain becomes
  the first concrete consumer of `draft-memory-mcp-service.md` (its `memory.recall`/`memory.trends`
  map onto FR-5/FR-12) — convergence, not a parallel path.

### Negative
- Keyword similarity may miss semantically-related lessons (escalation path: a semantic adapter
  behind the same port — Option B).
- The authored-keys ledger needs durable storage to survive across brain sessions.
- The port adds one indirection now for a benefit realized only on adoption — accepted: the cost is
  an interface + one thin adapter, and it removes the rewrite risk the research flagged (async write,
  namespace shape, optional score).

### Follow-up Actions
- [ ] `LessonStore` port (`record`/`retrieve`) + `LessonQuery`/`RetrievedLesson` types; `namespace`
      as composite `project:feature` string + `filters`; `score?`/`validAt?` optional.
- [ ] Default adapter: keyword/recency over 9.1 JSONL (JSONL = system of record); bounded top-N,
      bound logged; digest injector. `selectLessons(idea, project, store)` convenience fn.
- [ ] Authored-keys ledger (durable) written at spec-PR open; intersection for FR-12.
- [ ] Single shared rate-computation (per 9.1 metric) used by FR-9 + FR-12.
- [ ] Decide ledger storage location (brain session state vs a `ProjectRecord` field) at build.
- [ ] (Deferred) Semantic adapter behind the same port when store size justifies it; cross-reference
      `draft-memory-mcp-service.md`. Re-verify backend versions at integration (research is fast-moving).
