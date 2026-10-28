# ADR: A committed per-feature artifact manifest is the authority on where a feature's artifacts live

**Date:** 2026-10-24
**Status:** APPROVED
**Deciders:** James Stoup (operator) and the ai-conductor architecture review
**Feature:** decide-artifacts-are-too-repetitive-for-people-to- (jstoup111/ai-conductor#3405, spec 1 of 3)
**Related:** adr-2026-07-28-feature-aware-artifact-resolution (amended by this feature),
adr-2026-07-26-daemon-decide-preseed-ownership (amended by this feature),
adr-2026-08-09-operator-only-scoped-artifact-reseal,
adr-2026-08-23-committed-halt-record, adr-2026-07-22-phase-scoped-docs-write-guard,
adr-2026-09-29-plan-slice-manifest, `.agents/skills/event-spine/SKILL.md`

## Context

Reviewers cannot tell which spec artifacts to read, because bookkeeping and execution detail sit in
the same files and folders as the stories, architecture, decisions and plan (#3405). The agreed fix
moves new specs into `.docs/<slug>/1-review/` and `.docs/<slug>/2-machine/` (spec 3). That move is
unsafe today:

- About 140 engine sites build a feature artifact path themselves, or through one of four partial
  resolvers. They find the same artifact by plan stem, `feature_desc`, spec-branch slug or undated
  stem.
- `adr-2026-07-28-feature-aware-artifact-resolution` D3 made `resolveArtifactFiles` the shared
  feature-aware lookup but explicitly "no-manifest". It infers identity from file names, which a
  file named `2-stories.md` cannot satisfy.

The engine therefore needs an explicit record of which files belong to a feature, read by one
lookup, before any writer produces a new layout. This spec adds that record and lookup and moves no
file. Spec 2 moves path policy (seal, hooks, write allowlist, rebase, retention, drift checks) onto
the manifest.
Spec 3 changes the layout and content.

## Options Considered

### Option A: Committed per-feature manifest read by the existing lookup (chosen)
- **Pros:** Explicit authority; renames and layout changes stop being engine changes; reuses the
  approved `STEP_ARTIFACT_CONTRACTS` / `resolveArtifactFiles` seam; legacy specs untouched.
- **Cons:** A new committed file per feature that can drift from the files it lists, so it needs a
  single writer now and drift checks and file protection in spec 2.

### Option B: A path convention only (`.docs/<slug>/<fixed names>`), no manifest
- **Pros:** No new file.
- **Cons:** Every reader must still know every file name, so renumbering or renaming a review file is
  an engine change in about 140 places again.

### Option C: Unify legacy identity first (one slug key and one fallback rule), then move
- **Pros:** Cleaner legacy code.
- **Cons:** Reworks resolution that the manifest makes obsolete for every new spec; the operator
  declined it.

## Decision

1. **The artifact manifest is `.docs/<slug>/manifest.json`, durable state under event-spine exception C.**
   It is read by name as the authority on which files belong to a feature. Schema version 1 holds
   `schemaVersion`, `slug` and an `artifacts` list of `{kind, path}` entries. `path` is
   repository-relative and under `.docs/`. A kind may appear more than once. Entries are rendered
   sorted by kind, then path, with stable formatting, so the same content always produces the same
   bytes. The manifest carries no timestamps, counters, writer names or history.

2. **Kinds are a closed set:** `plan`, `stories`, `prd`, `track`, `complexity`, `conflicts`,
   `coherence`, `coherence-waiver`, `architecture`, `intake`, `applicability` and `decision`.
   A `decision` entry references an ADR the feature added or amended, and its path must be under
   `.docs/decisions/`. ADRs stay in that shared folder. One parser turns the file into a typed
   manifest. Each of these is a parse failure: an unknown schema version, an unknown field, an
   unknown kind, a path outside `.docs/`, a `decision` path outside `.docs/decisions/`, a `slug` that
   differs from its folder name, or anything other than exactly one `plan` entry.

3. **Not in the manifest:**
   - plan-review records, which are never committed
   - halted and shipped records, which are repository-wide indexes enumerated across features, like
     ADRs
   - release waivers, which the release gate finds by scanning the diff and BUILD agents write

4. **The slug is the plan stem.** For specs landed by the composer, land already requires the plan
   stem to equal the spec-branch slug, so every reader's existing key finds the manifest. Readers
   keep their existing keys; legacy identity rules are not reworked.

5. **The lookup is the existing seam, with a manifest rung first, for feature-scoped kinds only.**
   The feature-scoped kinds are every kind except `decision` and `architecture`. These readers ask
   the manifest first:
   - `resolveArtifactFiles`, for a contract pattern whose files map to one of those kinds (the prd,
     stories, conflicts, plan and coherence patterns)
   - the four feature resolvers
   - every hard-coded reader of one of those kinds in a landed feature

   Outcomes:
   - **Manifest present:** it is authoritative. A kind it does not list resolves to nothing, and
     legacy resolution is not consulted.
   - **No manifest:** the caller's existing resolution code runs unchanged. Specs from before this
     change, and consumer repositories, resolve exactly as today.
   - **Malformed manifest:** the reader fails closed and names the parse failure. It never falls back
     to legacy resolution.

   Contract patterns that map to no feature-scoped kind resolve exactly as today, whether or not a
   manifest exists. These are:
   - the repository-scoped ADR and architecture corpora (`adr-2026-07-28-feature-aware-artifact-resolution` D2)
   - the feature-scoped architecture-review and plan-review records
   - run-scoped evidence

   `decision` and `architecture` entries are recorded for spec 3's review layout; no reader in this
   spec consults them. With a manifest, a feature's stories come from its `stories` entry, not the
   plan's `**Stories:**` line.

   Land and the DECIDE-time gates that run before it are not routed. These are the land gates, the
   coherence and coherence-waiver validators, and the plan-review gate and runner. They read the
   idea's change set, which is the source land rebuilds the manifest from. Reading an earlier
   manifest there would let a stale or malformed one block its own replacement.

   One kind table maps each manifest kind to its legacy location and identity strategy, including
   the kinds `STEP_ARTIFACT_CONTRACTS` does not declare (track, complexity, intake, applicability,
   coherence-waiver). `STEP_ARTIFACT_CONTRACTS` itself is unchanged, so completion of steps that
   declare no artifact (explore, complexity) is unaffected.

6. **Composer land is the only writer in this spec.** The manifest module renders deterministically
   and is the only code that writes the file. Land **rebuilds** the manifest from the idea's current
   authored `.docs` change set, classified by the contract table, plus `decision` entries for ADRs
   the change set adds or amends, before land stages `.docs`. Any manifest already in the worktree,
   including land's own earlier output, is replaced, so a re-land after a file is removed or renamed
   stays correct. A land that changes the manifest emits `feature_artifacts_registered` (slug and the
   added `{kind, path}` entries) on the existing event spine.

   Operator `reseal` does not register files: it refuses any path absent from the seal
   (`adr-2026-08-09-operator-only-scoped-artifact-reseal` D1), so it cannot add one. The interactive
   `conduct` path writes no manifest in this spec: its DECIDE steps after the plan step (coherence,
   plan review) would leave an early manifest incomplete, and an incomplete manifest is
   authoritative. Without a manifest, `conduct` resolves exactly as today. Spec 3 owns `conduct`
   registration together with its `feature_desc`-keyed readers (assumption A3).

7. **Drift checks and manifest protection belong to spec 2.** Spec 1 adds no drift refusal. The
   phase-scoped docs write guard covers Edit, Write and NotebookEdit but not Bash, so a BUILD agent
   could still rewrite the manifest; spec 2, which owns the seal, hooks and build_review scope, makes
   the manifest a protected artifact and judges files added after land. Until then:
   - a malformed manifest fails closed at every reader (decision 5)
   - a file added after land is not listed, so a manifest-backed reader does not see it
     (assumption A4 holds that no BUILD step adds one)
   - `docs-prune` leaves a pruned feature's manifest on the default branch; post-prune audits read
     the parent commit, where manifest and files agree, and spec 2 moves retention onto the manifest

8. **Daemon discovery reads manifests.** Candidates are the slugs of `.docs/*/manifest.json` in the
   prefetched default-branch tree plus today's `.docs/plans/` stems, de-duplicated by slug. The
   shipped, processed and parked checks run before a manifest is parsed. A manifest-backed
   candidate reads its plan, stories, coherence, complexity, track, applicability and intake
   through the manifest; one whose listed plan is absent is not a candidate, as a deleted plan is
   not today. A malformed manifest blocks the candidate with reason `malformed-manifest` and a
   remedy naming the file. Legacy candidates are processed exactly as today. The discovery
   coherence check (`adr-2026-07-26-daemon-decide-preseed-ownership` D3) reads the manifest's
   `coherence` entry for a manifest-backed spec.

9. **No feature flag.** No file moves in this spec, and a manifest points at the same paths legacy
   resolution finds. Behavior is therefore preserved, and parity tests prove that each routed reader
   returns the same file with and without a manifest. Spec 3, which changes paths, carries its own
   switch.

10. **Delivery is three sequential specs.** Spec 1 is this decision. Spec 2 makes path policy decide
    ownership from the manifest. Spec 3 changes the layout and content. Spec 2 is blocked by spec 1,
    and spec 3 by spec 2.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Daemon discovery's single prefetch (`ls-tree -r .docs` on the default branch) already returns nested `.docs/<slug>/manifest.json` blobs. | verified | 95% | yes | Discovery needs a second read path. | n/a |
| A2 | Land stages the whole `.docs` tree (excluding plan-review), so a manifest written before staging is committed with the spec. | verified | 95% | yes | Land must stage the manifest explicitly. | n/a |
| A3 | Interactive `conduct` readers keyed by `feature_desc` may miss a manifest when `feature_desc` differs from the plan stem; in this spec they then fall back to legacy resolution, which finds the same file because nothing moves. | inferred | 80% | yes | Spec 3 must give those readers the plan stem before moving files. | APPROVED by operator 2026-10-24 |
| A4 | No BUILD step writes a new file of an in-scope kind; BUILD only edits the plan (remediation append, `remediate`). | inferred | 85% | yes | A file BUILD adds would be invisible to manifest-backed readers until spec 2; registration would be needed at that writer. | APPROVED by operator 2026-10-24 |

## Consequences

### Positive
- Where a feature's artifacts live becomes data, so spec 3's layout change, and later renames, need
  no engine change beyond the writers.
- Daemon discovery and every gate read one authority for new specs instead of guessing from names.
- Legacy specs and consumer repositories are untouched.

### Negative
- One more committed file per feature, which must stay in step with its files.
- Every hard-coded reader of an in-scope kind gains a manifest branch, and the legacy branch beside
  it stays until legacy specs age out.
- Path policy still matches by folder and basename until spec 2, and the manifest itself is not
  sealed or drift-checked until then.

### Follow-up Actions
- [ ] File spec 2 (path policy reads the manifest) and spec 3 (layout and content) as intakes, each
      blocked by its predecessor, after spec 1 lands.
