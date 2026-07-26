# Conflict Check: Durable Shipped-Record Enforcement and Backfill (#916, #936)

**Date:** 2026-07-25

**New stories:**
`.docs/stories/durable-shipped-record-enforcement-and-backfill-916-936.md`

**Result:** PASSED AFTER RESOLUTION — four blocking contradictions and one degrading ambiguity were
resolved from the operator-approved ADR/stories. Full re-check found zero blocking and zero
unaccepted degrading conflicts.

## Inventory and Scan

**Current-main amendment:** PR #937 already enforces the normal skill-driven producer ordering and
PR #943 proves that path can land implementation plus record atomically. The amended stories treat
that behavior as an existing prerequisite, not new implementation scope. This creates no
contradiction with the strict engine backstop: the producer writes evidence; the engine and GitHub
boundaries independently refuse to claim or merge shipment when evidence is absent.

The scan indexed all 196 files under `.docs/stories/`, all 35 files under `.docs/specs/`, and all 118
prior reports under `.docs/conflicts/`. Every pair type was evaluated: contradiction, behavioral
overlap, state conflict, resource contention, and sequencing conflict. The focused interaction set
covered shipped-record identity/writes, finish-choice/DONE, processed-cache/teardown, merged-PR and
rekick guards, required checks/docs-only CI, GitHub Actions, repair PRs, historical backfill, cost
rollups, halt closure, and daemon PR-label/CI feedback behavior.

The resolution source was already explicit: the operator approved
`adr-2026-07-25-fail-closed-durable-shipment-evidence` and accepted the new story file. No conflict
below introduced a new choice or changed that architecture.

## Blocking Conflict 1: Record-write failure could both ship and refuse shipment

**Stories involved:** `content-aware-shipped-work-dedup-never-re-dispatch.md` Story 2 vs
ST-916-1 and ST-936-2

**Type:** contradiction / state conflict

**Severity:** blocking

**Confidence:** 100%, verified from the acceptance text

The older story required a record write/commit failure to degrade to the local cache and allow ship.
The accepted new stories require every terminal boundary to refuse without strict-valid committed
and pushed record evidence. Both outcomes cannot hold for the same failure.

**Resolution options:**

1. Supersede only the old degradation clause and require preserved-work HALT with no ship side
   effects.
2. Retain cache fallback and weaken the new invariant.
3. Remove automatic record creation and rely only on the premerge Action.

**Recommendation and selected resolution:** Option 1, selected by the approved ADR/story
supersession. Story 2 now states the fail-closed outcome and its Done-When test rejects cache-only
shipment.

## Blocking Conflict 2: Historical backfill could both fabricate placeholders and forbid them

**Stories involved:** `content-aware-shipped-work-dedup-never-re-dispatch.md` Story 6 vs ST-916-5

**Type:** contradiction / data-integrity conflict

**Severity:** blocking

**Confidence:** 100%, verified from `spec_hash: unknown` and marker/count-driven criteria

The older story permitted records from local ledger/count evidence and placeholder PR/hash values.
The new accepted audit requires a proven merged implementation association and canonical plan
identity, reporting and skipping every unproven candidate.

**Resolution options:**

1. Retire the old permissive backfill story and route all historical behavior to ST-916-5.
2. Permit placeholders but tag them as lower confidence.
3. Exclude historical backfill from this feature.

**Recommendation and selected resolution:** Option 1. The old Story 6 is marked superseded and now
contains only the proven-only no-placeholder constraints.

## Blocking Conflict 3: A merged PR could both synthesize success and require a durable record

**Stories involved:** `2026-07-09-daemon-merged-pr-guard-on-retry.md` TS-1/TS-2/TS-3/TS-5 vs
ST-936-2 and ST-916-4

**Type:** state conflict / sequencing conflict

**Severity:** blocking

**Confidence:** 100%, verified from the synthetic-marker and processed-write criteria

The older guard treated live `MERGED` as sufficient proof for finish-choice/DONE, processed state,
and cleanup. The new invariant requires a matching valid record and routes a recordless merge to
visible repair without terminal success.

**Resolution options:**

1. Retain the existing guard checkpoints, but allow terminal/processed outcomes only when strict
   durable evidence also passes.
2. Delete the guard and let merged branches reach the ordinary rebase path.
3. Keep `MERGED` as standalone proof and exempt the guard from the new invariant.

**Recommendation and selected resolution:** Option 1. The older stories and Done-When fixtures now
pair `MERGED` with strict-valid evidence and add missing/invalid-record refusal cases. Guard cadence
and non-MERGED behavior remain unchanged.

## Blocking Conflict 4: PR/push proof could both suffice and be insufficient for terminal recording

**Stories involved:** `finish-step-fails-try-1-on-every-daemon-ship-skill.md` choice=pr story and
`daemon-false-ship-guard.md` Story 1 vs ST-916-1/ST-936-2

**Type:** behavioral overlap / state conflict

**Severity:** blocking

**Confidence:** 100%, verified from the marker-write and missing-injectable criteria

The earlier finish primitive wrote terminal markers after PR existence and push proof alone, while
the older daemon guard preserved a missing-injectable fail-open path. The accepted contract adds a
strict record verdict as a mandatory terminal precondition.

**Resolution options:**

1. Preserve the existing PR/push checks and add strict durable evidence as another mandatory
   precondition; missing legacy wiring can never bypass it.
2. Replace the finish primitive with a wholly new transaction.
3. Keep PR/push as sufficient and make strict record verification advisory.

**Recommendation and selected resolution:** Option 1. The older happy/negative paths and tests now
require strict-valid record evidence without discarding the existing PR/push guards.

## Degrading Conflict 5: `ci-gate` singular wording obscured an additional required context

**Stories involved:** `skip-full-ci-for-docs-only-changes.md` Story 2 vs ST-916-3

**Type:** behavioral overlap / resource coordination

**Severity:** degrading

**Confidence:** 95%, verified wording ambiguity; mechanisms are compatible

The earlier story called `ci-gate` “the designated required check.” The new story requires a separate
always-reporting shipped-record context. Treating the sentence as exclusivity would block the new
check; treating it as the aggregate for skippable heavy jobs allows both.

**Resolution options:**

1. Clarify `ci-gate` as the heavy-suite aggregate and allow separate always-reporting policy checks.
2. Fold shipped-record validation into `ci-gate`.
3. Leave shipped-record advisory and require only `ci-gate`.

**Recommendation and selected resolution:** Option 1. It preserves the docs-only anti-wedge contract
and keeps evidence policy independent from heavy-suite orchestration.

## Examined-Clean Interactions

- **Per-feature cost accounting:** missing/unreadable cost telemetry may remain non-blocking because
  the writer can produce valid record identity/frontmatter without a Cost block. Record identity
  failure itself remains blocking.
- **Finish presentation repair:** title/draft reads retain their scoped fail-open behavior; they do
  not supply or bypass the separate durable-evidence verdict.
- **Discovery dedup:** permissive stem/hash/cache discovery remains intentionally distinct from
  strict terminal completion. A cache hit may suppress redispatch but cannot prove a new shipment.
- **Docs-only CI:** both `ci-gate` and shipped-record always report for their respective policies;
  repair/spec/plan-only PRs receive shipped-record `not-applicable`, so neither check wedges them.
- **Daemon PR labels and ship-CI feedback:** the new check simply participates in the existing check
  rollup; failed/pending/green classification and mergeable-watch behavior remain coherent.
- **Halt-monitor closure:** consuming durable records or legacy processed markers after the fact does
  not create a terminal ship path and therefore does not bypass the new engine invariant.
- **Repair concurrency:** deterministic implementation-PR/slug identity serializes retries onto one
  branch/PR; no story claims exclusive use of a shared mutable branch.
- **Active product specs:** no functional requirement authorizes cache-only completion, placeholder
  shipped records, synthetic recordless merge success, or exclusive ownership of the new status
  context.

## Re-check

After the five resolutions, all related stories were re-scanned across all five conflict types.
Every terminal success now requires strict-valid durable evidence; historical writes require proven
association; existing discovery/cost/presentation behavior remains scoped; required checks compose.

**Final:** zero blocking conflicts, zero unaccepted degrading conflicts, no ADR amendment required.
The #937/#943 scope reduction was also checked across contradiction, overlap, state, resource, and
sequencing categories; it removes duplicate producer work without weakening any accepted negative
path.
