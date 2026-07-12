# ADR: Engine translates sha-anchored evidence citations through its own rebases

**Date:** 2026-07-12
**Status:** APPROVED
**Feature:** rebase-orphans-every-sha-anchored-evidence-citatio (jstoup111/ai-conductor#535)
**Deciders:** James Stoup (operator — capture mechanism + full scope selected in-session), engineer session
**Related (all APPROVED):** adr-001-rebase-insertion-mechanism;
adr-2026-07-03-post-rebase-force-with-lease;
adr-2026-07-08-post-rebase-gate-first-mechanical-reverify;
adr-2026-07-09-deterministic-evidence-attribution-enforcement;
adr-2026-07-10-evidence-range-anchor-resolution; #520/#581 judged-attribution.

## Context

Both engine-owned rebases rewrite commit SHAs; every sha-anchored evidence form that
referenced a rewritten commit then dangles. Verified stores and sites (read from source
2026-07-12):

- **Sites** funnel through one function: `performRebase` (`engine/rebase.ts:412`,
  `git rebase --autostash`), called by `runRebaseStep` (`conductor.ts:3832`, finish-time,
  daemon-only) and `resumeRebaseFirst` (`daemon-rekick.ts:361`, rekick pre-loop). The
  pre-rebase HEAD is already captured (`ORIG_HEAD`, rebase.ts:592).
- **Stores:** (1) task-evidence sidecar `.pipeline/task-evidence.json` — `EvidenceStamp.sha`,
  `citedShas[]`, `verdictAnchor` (`task-evidence.ts:16-22`); (2) task-status
  `.pipeline/task-status.json` — `commit` field, stored as **full** sha (`task-seed.ts:213`)
  **and** 7-char short sha (`autoheal.ts:202,822,1313`); (3) satisfied-by trailers
  (`Evidence: satisfied-by <sha>`) — immutable text in commit messages, consumed at
  `autoheal.ts:602-645`; (4) the #520 judged-stamp memo `.pipeline/attribution-memo.json`,
  keyed `${headSha}:${residueIds}` (`attribution-lane.ts:85-88`), with `verdictAnchor:headSha`
  stamps (`attribution-lane.ts:480`).

Aggravator (verified): `validateCitations` (`attribution-validate.ts:116-191`) already runs an
ancestry check (`merge-base --is-ancestor`, 143-147) in addition to object-existence
(`cat-file -e`, 136-140) — but the autoheal satisfied-by consumer's reachability check
(`autoheal.ts:621-639`) is the softer path, and lingering pre-rebase objects keep dangling
citations from failing cleanly. The trailer *body* survives rebase (re-derivation reads commit
messages, adr-2026-07-08), but every stored **target SHA** is stale.

No prior handling of `ORIG_HEAD` rewrite mapping, `post-rewrite`, or rewritten-list exists —
this is greenfield.

## Decision

Insert one deterministic translation step inside `performRebase`, gated on a file-changing
(`changed`) outcome, in a new module `engine/rebase-translate.ts`. It:

1. **Builds the old→new map by patch-id correspondence.** `pre = git rev-list {onto}..ORIG_HEAD`,
   `post = git rev-list {onto}..HEAD`; `map[old]=new` where `git patch-id --stable` of the two
   commits' diffs match. Both full and 7-char forms are indexed (task-status stores short shas).
   The map is persisted **transitively** to `.pipeline/rebase-rewrites.json` — a later rebase's
   `new→newer` repoints prior values so multi-rebase chains resolve.
2. **Rewrites file-backed stores in place** (atomic temp+rename): `task-evidence.json`
   (`sha`, `citedShas[]`, `verdictAnchor`), `task-status.json` (`commit`, both forms), and
   `attribution-memo.json` (translate `verdictAnchor` and recompute the memo key onto the new
   HEAD). Contents become self-consistent and diffable before/after.
3. **Resolves immutable trailer targets at read time.** Satisfied-by trailer text is never
   rewritten (that would require re-rewriting commits). Instead `validateCitations` and the
   autoheal satisfied-by consumer resolve every cited sha through the persisted map
   (`resolveThroughMap`, transitive closure) **before** the ancestry check.
4. **Surfaces residue loudly.** Pre-image commits with no patch-id match (dropped in rebase, or
   conflict-modified so the diff changed) are written to `.pipeline/rebase-residue.json` with
   the citing task ids and a reason, and emitted as a structured `rebase_citation_residue`
   event — never a silent dangle. A conflict-modified commit landing in residue is *correct*:
   its diff changed, which is exactly the case warranting re-verification.
5. **Holds the no-laundering invariant.** `resolveThroughMap` substitutes only SHAs that are
   keys in git's authoritative pre-image→post-image map. An unknown SHA (never on the branch
   pre-rebase, or forged) is returned unchanged and then fails the existing
   `merge-base --is-ancestor` check — refused, never repointed onto a live commit.

All git calls go through the injected `GitRunner` (`makeGitRunner`, rebase.ts:22-59) so tests
never touch a real rebase/remote. Absence of the capability (legacy callers, unit tests) is a
no-op → today's behavior, fail-closed.

## Options Considered

### Capture mechanism (operator-selected: A)
- **A. patch-id correspondence (CHOSEN).** No new git hook; backend-independent; conflict-modified
  commits fall to residue (a re-verify signal, folding filer hypothesis H2 into H1); fails safe
  (over-produces loud residue, never a wrong mapping). Weakness: cannot auto-map a
  conflict-modified commit — accepted, because surfacing it is the desired behavior.
- **B. worktree-local `post-rewrite` hook.** Git's authoritative pairs incl. conflict-modified
  commits, but adds a `hook wiring` migration-gate surface, must be installed in every
  (incl. consumer) worktree, and fails **silent** when uninstalled (git <2.20 / copy failure).
- **C. hybrid.** Most robust, largest surface (both mechanisms + hook wiring on the hot path).

### Trailer translation
- **Resolve-at-read via persisted map (CHOSEN)** — commit messages are immutable; rewriting them
  means re-rewriting commits (another force-push, breaks the force-with-lease reasoning of
  adr-2026-07-03). Rejected: in-place trailer rewrite.

### Scope (operator-selected: Full)
All four stores across both sites. "Both sites" is nearly free (single `performRebase` insertion);
only the memo re-key is incremental over a file-store-only slice, and leaving the memo HEAD-keyed
preserves the redundant-opus-re-judge symptom #535 explicitly calls out.

## Load-bearing assumptions (MUST verify in build — RED tests)

1. **Empty-commit `--empty` handling (HIGH impact).** `git rebase --autostash` may **drop
   already-empty commits**, which is how satisfied-by evidence is often carried. If the sanctioned
   rebase drops them, the trailer leg is moot for those tasks and they must resolve via the
   **mapped work-commit target** (the empty commit's own sha is unmappable by patch-id — empty
   diff). Task 1 verifies actual `--empty` behavior in a scratch repo; if empties are dropped and
   a task's only evidence was an empty commit, that task goes to residue (loud), and the fix may
   add `--empty=keep` to `performRebase` (confirm against the `featureCommitsPreserved` guard,
   rebase.ts:531-543). Confidence the target-translation path is sufficient for the common case:
   ~80% (inferred) — pinned by Task 1.
2. **patch-id stability across the sanctioned rebase (MED).** `--stable` patch-id is invariant
   under pure replay; confirmed by git docs, pinned by an end-to-end RED test that rebases a
   feature branch and asserts a full match set for unconflicted commits.
3. **Memo format stability (LOW).** `attribution-memo.json` key/shape (`attribution-lane.ts:85-88`)
   is owned by #520/#581 — the conflict-check binds re-verification of that anchor after those merge.

## Consequences

### Positive
- Verified work survives both sanctioned rebases with zero operator re-pointing; #535's ~30-90
  min/incident repair class is eliminated.
- The #520 memo re-keys instead of missing, killing the redundant opus re-judge on every rebase
  (compounding under #474's higher merge velocity).
- No-laundering is structurally enforced by the map-key gate + existing ancestry check.

### Negative / accepted
- Conflict-modified and dropped-empty commits become residue requiring re-verification rather
  than silent auto-translation — accepted (this is the intended signal).
- One new persisted store (`.pipeline/rebase-rewrites.json`) and one residue store; both are
  gitignored `.pipeline` artifacts, no consumer surface.
- Two read-time consumers (`validateCitations`, autoheal satisfied-by) gain a map-resolution
  step before ancestry — a bounded, deterministic lookup.

### Migration-gate note
Internal-only: no `bin/conduct CLI`, `settings.json schema`, `skill symlink targets`, or
`hook wiring` change (patch-id path adds **no** hook). The build must confirm from the actual
diff and, if the release-gate classifier flags a surface, commit an internal-only waiver per
adr-2026-07-06-migration-gate-waiver rather than an empty migration block.
