**Status:** Accepted

# Stories: content-aware shipped-work dedup (never re-dispatch shipped specs)

Technical track. Derived from `adr-2026-07-03-committed-shipped-record-dispatch-dedup.md`
(APPROVED) and the conditions in
`architecture-review-2026-07-03-content-aware-shipped-work-dedup.md`. Fixes #204, #205.

---

## Story 1: Shared spec-hash function

As the daemon engine, I want one canonical `specHash(planBytes, storiesBytes)` function so that
the finish writer and the discovery matcher can never disagree about a spec's identity.

### Acceptance Criteria

#### Happy Path
- Given a plan file and its stories file as committed bytes, when `specHash` is computed twice
  (once by the finish writer, once by the discovery matcher), then both produce the identical
  SHA-256 hex digest.
- Given the same content with and without a single trailing newline, when hashed, then the
  digests are equal (trailing-newline trim is the only canonicalization).

#### Negative Paths
- Given plan content that differs by one interior byte, when hashed, then the digests differ
  (no over-normalization masks real edits).
- Given a missing stories file (null), when hashed, then `specHash` returns a digest computed
  over the plan alone and a `storiesIncluded: false` flag — it does not throw and does not
  silently equal the plan+stories digest of identical plan content.
- Given CRLF vs LF variants of the same content, when hashed, then the digests DIFFER and a
  unit test pins this choice (bytes are authoritative; git's eol config is the normalization
  layer, not ours).

### Done When
- [ ] `specHash` exists in one module; `grep` shows the finish flow and `discoverBacklog` both
      import it and no second hashing implementation exists.
- [ ] Unit tests pin: determinism, trailing-newline equivalence, interior-byte sensitivity,
      null-stories flag, CRLF/LF distinctness.

---

## Story 2: Finish flow commits the shipped record onto the implementation branch

As the daemon, I want finishing a feature to commit `.docs/shipped/<stem>.md` on the
implementation PR branch so that the human merge lands the code and the shipped-fact atomically.

### Acceptance Criteria

#### Happy Path
- Given a feature passing its finish gates with choice `pr`, when the PR branch is finalized,
  then `.docs/shipped/<stem>.md` is committed on that branch before/with the push, with
  frontmatter `slug`, `spec_hash` (via Story 1's function over the base-branch plan+stories),
  `pr` (the PR URL), and `shipped` (ISO date).
- Given finish choice `merge-local`, when the merge completes, then the shipped record is part
  of the merged commits (the `pr` field is `local`) — the record is not skipped on the no-PR
  branch (invariant side-effect on the alternate branch).

#### Negative Paths
- Given the shipped-record write or commit fails (fs error, git error), when finish continues,
  then the ship completes exactly as today (cache marker written, PR opened), a single
  `shipped-record write failed — dedup degraded to local cache for <stem>` warn is logged, and
  the failure is NOT retried in a loop and does NOT fail the finish step.
- Given finish choice `discard` or `keep` (nothing ships), when the flow completes, then NO
  shipped record is written anywhere.
- Given a re-run of finish after a partial prior attempt already committed the record, when the
  record content would be identical, then the write is idempotent (no duplicate commit, no
  error).

### Done When
- [ ] Integration test: finished feature's branch contains `.docs/shipped/<stem>.md` with all
      four frontmatter fields; `merge-local` variant asserted separately.
- [ ] Injected-failure test: write failure → ship still succeeds, warn logged once, no marker
      committed.
- [ ] `discard`/`keep` paths assert absence of the record.

---

## Story 3: Discovery skips on a base-branch shipped record (stem match) and repairs the cache

As the daemon, I want `discoverBacklog` to treat a `.docs/shipped/<stem>.md` on the base branch
as authoritative so that a fresh clone or wiped `.daemon/` never replays a shipped spec.

### Acceptance Criteria

#### Happy Path
- Given a candidate plan `foo.md` and a committed `.docs/shipped/foo.md` on the base branch and
  NO local `.daemon/processed/foo`, when discovery runs, then `foo` is skipped AND
  `.daemon/processed/foo` is written (cache repair) so subsequent polls take the fast path.
- Given a local cache hit, when discovery runs, then the base-branch record is not read at all
  (fast path unchanged).

#### Negative Paths
- Given a shipped record exists only in the WORKING TREE (uncommitted) or on an unmerged
  branch, when discovery runs, then it is ignored — only the base-branch tree counts (same
  source-of-truth rule the backlog already uses for plans).
- Given `.docs/shipped/foo.md` exists but `foo`'s plan/stories were since deleted from the base
  branch, when discovery runs, then nothing is dispatched and nothing crashes (record without
  candidate is inert).
- Given a malformed shipped record (missing frontmatter), when discovery runs, then the stem
  match still skips (stem is the filename), a warn-once notes the malformed record, and
  discovery continues with other candidates.
- Given the cache-repair write fails (read-only fs), when discovery runs, then the spec is
  still skipped this poll and every poll (correctness never depends on the repair).

### Done When
- [ ] Unit tests with injected tree source cover: skip+repair, fast-path short-circuit,
      working-tree-only record ignored, malformed record, repair-failure still skips.
- [ ] Dedup check demonstrably precedes the owner gate: a shipped spec with unresolved daemon
      identity is skipped as SHIPPED (not fail-closed) and with a foreign owner stamp is
      skipped as SHIPPED (not owner-gated) — asserted by log line.

---

## Story 4: Discovery skips on content-hash match across different stems (rename-proof)

As the daemon, I want a candidate whose `spec_hash` matches ANY shipped record to be skipped so
that renaming a spec's stem after shipping cannot cause a replay (the PR #82 case).

### Acceptance Criteria

#### Happy Path
- Given shipped record `old-name.md` with hash H and a candidate `new-name.md` whose
  plan+stories hash to H, when discovery runs, then `new-name` is skipped, a warn-once logs
  `shipped under 'old-name', candidate 'new-name' matches by content` naming both stems, and
  `.daemon/processed/new-name` is written (cache repair under the NEW slug).

#### Negative Paths
- Given a candidate whose content hashes to H′ ≠ every shipped hash, when discovery runs, then
  it proceeds to the owner gate normally (no false positive from stem similarity — matching is
  hash-or-stem only, never fuzzy).
- Given two DISTINCT specs that legitimately share identical plan+stories bytes (template
  copy-paste), when the second is discovered after the first shipped, then it IS skipped and
  the warn-once names both stems — accepted residual; the warn is the operator's signal to
  differentiate the spec (dedup-key false-positive path is explicit, logged, and documented).
- Given a shipped spec that was BOTH renamed and content-edited afterward, when discovery runs,
  then it is dispatched (neither stem nor hash matches) — the documented residual gap; the test
  pins this as expected behavior, not a regression.

### Done When
- [ ] Unit tests: rename skip + both-stems warn + new-slug cache repair; no-match passthrough;
      identical-content skip; renamed+edited dispatches.
- [ ] Hash comparison reads shipped records once per poll (single directory listing, no
      per-candidate re-read of every record).

---

## Story 5: rekickSweep consults isProcessed before re-kicking

As the daemon, I want the main-advance re-kick sweep to skip processed slugs so that a parked
duplicate of shipped work stops burning an abort/clear/re-park cycle on every base advance (#205).

### Acceptance Criteria

#### Happy Path
- Given a halted worktree whose slug `isProcessed` resolves true (cache or shipped record), when
  `rekickSweep` runs on a base advance, then the worktree is NOT re-kicked: no rebase abort, no
  marker clear, no REKICK sentinel; a one-time `skipping re-kick: <slug> already shipped` line
  is logged and the slug is counted in `skipped`.
- Given a halted worktree whose slug is not processed, when the sweep runs, then behavior is
  byte-identical to today (FR-7/FR-9 semantics of adr-013 untouched).

#### Negative Paths
- Given `isProcessed` throws (corrupt marker, fs error), when the sweep evaluates that slug,
  then the sweep treats it as NOT processed (fail-open to today's behavior), logs the read
  error, and continues with remaining slugs — a dedup-check failure never wedges the sweep.
- Given a processed slug skipped on SHA X, when the base advances to SHA Y, then the skip
  repeats (still no re-kick) and the log does not repeat per-poll (warn-once semantics per
  slug, not per advance).

### Done When
- [ ] Unit tests via injected `RekickSweepDeps`: processed → skipped with no abort/clear calls;
      unprocessed → unchanged flow; throwing `isProcessed` → fail-open + isolation; log dedup.
- [ ] `RekickSweepDeps` gains `isProcessed` wired in `daemon-cli.ts` to the same
      ledger-or-shipped-record resolver discovery uses (one resolver, two call sites).

---

## Story 6: One-time backfill of shipped records

As the operator, I want shipped records backfilled for everything that already shipped so that
protection is retroactive the day this merges.

### Acceptance Criteria

#### Happy Path
- Given the implementation PR, when it merges, then `.docs/shipped/` contains a record for
  every current `.daemon/processed/` entry (16) and the known shipped-but-unmarked specs
  (technical-assessment, phase-2-language-evaluation, pluggable-harness-architecture,
  phase-9.3-engineer-redesign, mermaid-renderer, harness-self-host-guardrails,
  multi-operator-ownership-hardening), each with `spec_hash` computed from current base-branch
  content and `pr` pointing at the known implementation PR (or `unknown` where none is
  recorded).

#### Negative Paths
- Given a backfilled spec whose current base-branch content has drifted from its as-shipped
  content, when discovery runs post-merge, then the stem match alone still dedups it (Story 3)
  — hash staleness in backfilled records is harmless and pinned by a test.
- Given a ledger entry whose plan file no longer exists on the base branch, when the backfill
  is generated, then a record is still written from the ledger data (stem + PR URL,
  `spec_hash: unknown`) so the slug stays dead if the spec ever reappears.

### Done When
- [ ] `.docs/shipped/` in the PR contains ≥ 23 records; a test asserts every
      `.daemon/processed/` slug in the fixture set has a matching record.
- [ ] Post-merge dry run: `discoverBacklog` against the merged tree with an EMPTY local ledger
      dispatches zero already-shipped specs.
