# Conflict Check: Setup fix-session repairs must converge (#1346)

**Date:** 2026-08-29
**Stories checked:** `.docs/stories/bin-setup-quarantines-a-fix-session-s-repair-inste.md`
against the complete story/spec corpus and the narrowed repo-wide ADR corpus below
**Result:** 2 blocking conflicts found, both resolved by the operator-selected exact-state
correction in the approved ADR and the feature-scoped compatibility amendment; re-check PASSED
with zero blocking and zero degrading conflicts

## Corpus

- Inventoried and full-text scanned all 382 files under `.docs/stories/`, all 52 files under
  `.docs/specs/`, and all 236 prior reports under `.docs/conflicts/` present before this report.
- `conflict_check.adr_corpus` is `repo_wide`. All 296 `adr-*.md` files were inventoried and
  supersession statuses parsed. The overlapping approved or partially amended decisions examined
  were: `adr-2026-07-03-harness-daemon-profile`,
  `adr-2026-07-09-setup-failure-triage`,
  `adr-2026-07-21-demote-task-stamping-to-telemetry`,
  `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation`,
  `adr-2026-07-26-event-sink-registry-exhaustiveness`,
  `adr-2026-08-02-plan-scope-containment-at-commit-boundary`,
  `adr-2026-08-03-uncommitted-work-floor-under-build-completion`,
  `adr-2026-08-06-honest-park-termination-boundary`,
  `adr-2026-08-07-project-teardown-hook-contract-and-containment`,
  `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts`,
  `adr-2026-08-09-non-blocking-plan-scope-containment`,
  `adr-2026-08-09-worktree-local-provider-scratch`,
  `adr-2026-08-11-halt-events-ride-the-persisted-spine`, and
  `adr-2026-08-26-setup-once-per-worktree-marker`.
- Narrowed out were ADRs whose remaining decisions concern intake, release/versioning, PR and
  labels, provider authentication/routing, rubric policy, rebase semantics, observability outside
  the event-sink contract, or unrelated worktree removal. They share no setup-repair acceptance
  state, quarantine ref, commit boundary, park transition, or event field with these stories.
  No partially superseded ADR in the overlapping set was excluded.

## Conflict 1: Stable uncommitted repair must both HALT and proceed — RESOLVED

**Stories involved:** #1346 Story 1, “A verified uncommitted repair becomes durable branch
history” vs #446 TS-3, “Committed breakage gets exactly one mechanically-verified fix-session”
**Files:** `.docs/stories/bin-setup-quarantines-a-fix-session-s-repair-inste.md` vs
`.docs/stories/setup-before-dispatch-wedge-deterministic-setup-fa.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — the two criteria selected opposite terminal outcomes for the same state

**Description:** Before resolution, #446 said: “Given the fix-session leaves uncommitted changes
(setup passes but tree dirty), when the engine verifies the contract, then the contract fails (an
unverifiable half-fix is not a pass) and the HALT path is taken with the dirty paths named.” #1346
Story 1 requires that same repair, when captured before setup and unchanged by setup, to become one
exact engine commit and return `fixed-pass`. Satisfying either assertion broke the other. This also
meets the two-direction oscillation heuristic, but is classified as a contradiction because the
new approved ADR amendment deliberately supersedes the old terminal rule.

**Resolution Options:**
1. Replace #446's superseded dirty-means-HALT criterion with the exact-state partition: a stable
   captured repair is engine-committed; ambiguous or changed attempts preserve and park.
2. Revert #1346 Story 1 and keep quarantining every uncommitted repair.
3. Add a configuration switch selecting the two outcomes per repository.

**Recommendation:** Option 1. It removes the observed non-convergence while retaining fail-closed
handling for every state the engine cannot prove stable.

**Operator selection and applied resolution:** Option 1. The governing ADR and the accepted #1346
story now carry a dated feature-scoped compatibility amendment that expressly supersedes #446's
old dirty-means-HALT terminal rule. The inherited file remains a historical record because the
land-time feature-identity gate forbids one spec branch from rewriting another feature's story
artifact.

## Conflict 2: The #582 fixture must both be quarantined and committed — RESOLVED

**Stories involved:** #1346 Story 1 vs #582 Stories 1–2
**Files:** `.docs/stories/bin-setup-quarantines-a-fix-session-s-repair-inste.md` vs
`.docs/stories/setup-triage-must-not-report-setup-failed-park-whe.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — both stories name the same `conductor.ts` dirty-after-success fixture and
required opposing branch outcomes

**Description:** Before resolution, #582 required a successful setup followed by dirty porcelain
to return `kind:'park'` / `dirty-tree-uncleaned`, commit the dirty state to the quarantine ref, and
reset it from the feature branch. #1346 requires the pre-captured, setup-stable subset of that
state to become an exact engine commit and return `fixed-pass`. The old text did not distinguish
setup-stable repair content from setup-added drift, so no implementation could satisfy both.

**Resolution Options:**
1. Narrow #582 to the proof boundary: stable captured repairs proceed through an exact engine
   commit; setup drift, mixed commits plus residue, rewritten history, and failures preserve and
   park.
2. Keep #582 unchanged and abandon the #1346 convergence outcome.
3. Add separate “quarantine” and “commit” modes selected by configuration.

**Recommendation:** Option 1. It preserves #582's accurate reporting and no-data-loss intent while
stopping a validated repair from being removed from the feature branch.

**Operator selection and applied resolution:** Option 1. The approved ADR and the accepted #1346
story's compatibility amendment expressly replace #582's old terminal outcome with the exact-state
partition. The inherited story and track files remain historical records under the land-time
feature-identity gate; no new or superseding ADR is required.

## Re-check: passed

Every shared subject was re-tested in both directions after the corrections:

- **Stable repair vs rejected repair:** mutually exclusive evidence partitions. Satisfying the
  exact-tree commit path leaves every rejected-state criterion intact; satisfying preserve-and-park
  cannot accept a candidate that failed an exact-state postcondition. No oscillation remains.
- **Setup-once marker:** triage verification still uses the forced setup path, so marker skipping
  cannot produce a false repair acceptance.
- **Automatic park:** rejected attempts still create the existing durable park and subsequent
  scans dispatch no additional fix-session until explicit clear/unpark. `fixed-pass` attempts do
  not create a park marker.
- **Engine commit and attribution:** `CONDUCT_ENGINE_COMMIT=1` is an established exemption for
  engine bookkeeping commits; task trailers are telemetry, not mutation authority. Semantic scope
  remains owned by downstream acceptance, review, and SHIP gates.
- **Uncommitted-work floor:** it governs BUILD completion. The repair commit occurs before BUILD
  and returns a clean worktree, so it strengthens rather than bypasses that floor.
- **Event spine:** `setup_repair` is an additive occurrence on the existing `ConductorEvent`
  union, with render and persistence declared in the exhaustive sink registry. It does not create
  a second channel or alter halt-event ownership.
- **Quarantine resource:** the existing slug-scoped ref remains the single preservation target.
  Refresh is serial inside one triage attempt; failure to refresh performs no reset, so there is no
  resource-contention or impossible-state path.
- **Sequencing:** original HEAD and candidate tree are captured before forced setup; rejected state
  is preserved before restoration; repair postconditions precede `fixed-pass`. No story assumes a
  conflicting first step or creates a dependency cycle.

All six conflict classes were checked: contradiction (the two items above, resolved), behavioral
overlap, state conflict, resource contention, sequencing, and oscillation. **Zero blocking and zero
degrading conflicts remain.**
