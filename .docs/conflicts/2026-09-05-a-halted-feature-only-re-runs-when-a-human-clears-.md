# Conflict Check: Retry at the raiser, and operator budget recovery (#2190)

**Date:** 2026-09-05
**Inventory:** all story files in `.docs/stories/` (keyword scan narrowed semantic comparison to the 33 files touching kickback ledger, halt classes, validation-group join, test_suite verification, re-kick sweep, daemon halted-feature boundary, and operator CLI); spec PR #2197's stories read from its branch; all prior conflict reports scanned for the kickback/halt family.
**ADR corpus:** `conflict_check.adr_corpus: repo_wide`. All 305 `adr-*.md` were read in this DECIDE pass (architecture-review, 2026-09-05); the narrowed set is the 69-row table in `.docs/decisions/architecture-review-2026-09-05-a-halted-feature-only-re-runs-when-a-human-clears-.md`, which records examined and narrowed-out ADRs. Supersession parsing: `adr-2026-08-29-operator-authorized-kickback-budget-recovery` is partially superseded (halt-class naming only) and was **retained**; no ADR was excluded as fully superseded.
**Result:** **PASS — zero blocking conflicts remain.** One blocking overlap was found and resolved by the architecture-review condition that already governs it; one story-level gap was found and fixed in place; one phrasing that read as an oscillation was clarified. No degrading conflict is accepted.

## Conflict: Two accepted specs describe the same `kickback-budget` command family

**Stories involved:** Stories 4–7 of this feature vs Stories 1–10 of “cumulative kickback budget recovery”
**Files:** `.docs/stories/a-halted-feature-only-re-runs-when-a-human-clears-.md` vs `.docs/stories/the-cumulative-kickback-cap-never-resets-so-a-reco.md`
**Type:** overlap (resource contention on one CLI surface and one ledger shape)
**Severity:** blocking
**Confidence:** 100% — both files are `Status: Accepted` on the same base and both specify `kickback-budget inspect|reset|raise`, the ledger's effective limit, the staged adjustment, and the daemon-side clear; the older one is `build_review`-only, this one adds `--gate` (adr-2026-08-29 D2/D3 amended 2026-09-05 by #2190).

**Description:** With both specs merged, the daemon backlog carries two plans for one surface. The older feature's implementation (PR #2106) was closed 2026-09-02 "pending a re-plan" after 137% plan growth, and the feature is operator-parked; the operator chose in this DECIDE pass to absorb its re-plan here (#1760 → duplicate of #2190). Behaviorally the new stories are a strict superset: every older criterion holds under `--gate build_review`.

**Resolution Options:**
1. Retire the older spec's `.docs/` set on main in a companion PR and close #1760 as a duplicate; leave this feature's stories as the single authority.
2. Narrow this feature to R1–R4 and re-plan #1760 separately.
3. Keep both and rely on parking to keep the older one from dispatching.

**Resolution:** Option 1 — already recorded as architecture-review condition 3. The older stories file is a foreign stem and cannot be edited from this spec branch (land stem gate); it is retired, not amended. Nothing in this feature's stories needed to change.

## Gap fixed in place: typed cap evidence does not exist yet

**Stories involved:** Story 5 (raise) and Story 7 (daemon clear) vs the engine at `260c95abb`
**Type:** state-conflict (a precondition the stories assumed was absent)
**Severity:** blocking until fixed
**Confidence:** 100% — `grep` for cap-evidence, halt-generation, resume-authorization, or pending-adjustment symbols in `src/conductor/src` returns nothing; adr-2026-08-29 D1 ("It is written before the human halt") was #1760's undelivered work.

**Resolution:** Story 5 gains a happy-path criterion and a Done-When requiring all three cap terminals (`build_review` cumulative, `prd_audit` lap, `architecture_review_as_built` lap) to persist typed cap evidence with a fresh halt generation before the marker. Story 7's generation-match criteria now have a producer.

## Phrasing clarified: retention vs authorized clear

**Stories involved:** Story 3 (judgement halts never retried automatically) vs Story 7 (daemon clears on authorization)
**Type:** oscillating (as first written)
**Severity:** degrading as written, none after the edit
**Confidence:** 90% — "any automatic path retains the halt" read as forbidding the authorized clear, which adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D3 defines as "operator-authorized daemon work, not an autonomous re-kick".

**Resolution:** Story 3's third criterion now reads "and no operator resume authorization in the feature's ledger". Both directions verified: a fully-retaining sweep still honours an explicit authorization, and an authorized clear never touches a halt with no authorization.

## Pairs examined and found compatible

- Story 1 vs `parallel-validation-phase-fan-out-manual-test-prd-` — the older stories require no-verdict → group failure → halt; they pin no member attempt count. Story 1 keeps the exhaustion outcome and changes only the budget. Both directions hold.
- Story 2 vs `deterministic-test-suite-step` ("the incomplete branch is retryable, and absence is never converted into a passing result") and `full-suite-verification-gate-940` (drift categories re-run) — a bounded in-step re-run satisfies both; neither pins an immediate halt on infrastructure failure.
- Story 3 vs `gate-kickback-counter-resets-every-dispatch-so-no-` — that feature converted the `build_review` and `wiring_check` cap halts to `needs-human`; this feature converts three different sites (manual-test cap, test_suite cap, per-gate remediation budget). No double count, same class.
- Story 3 vs `every-as-built-blocked-verdict-halts-needs-human-i` and `plan-growth-allowance-is-spent-on-work-existing-ta` (#2119, merged as #2189) — those seal `kickback-cap` at the as-built/prd_audit lap and growth terminals; Story 3 leaves those classes untouched and Story 5 accepts `kickback-cap` with typed evidence.
- Story 3 vs `a-gate-halt-marks-a-completed-build-failed-and-the` — seal halts keep `protected-artifact`; this feature excludes them.
- Story 3 vs `most-conductor-halts-carry-no-class-sidecar-so-the` — "ambiguous retry safety → `needs-human`" is exactly R3's rule.
- Stories 1–7 vs spec #2197 (`remediable-as-built-blocked-verdict-halts-needs-hu`) — #2197 changes only as-built halt reason text and the planner no-plan cause; this feature never touches those. Textual overlap in `conductor.ts` only; #2197 merges first (review condition 4).
- Story 5 (`--gate prd_audit`) vs #2119's `remediationGateAppendBudget` — #2119 is on main; the feature-local lap cap is an additive input to that resolution.
- Stories 1–7 vs the in-flight `a-coverage-claim-can-name-a-task-whose-done-when-d` (#2088, build 44/44 at the time of this check) — its `conductor.ts` hunks sit at the import block, `StepRunResult`, the refusal-facet seam, and one later site; none of this feature's six sites (two group-member dispatches, the suite-infra branch, the three budget halts) is touched. It adds a `coverage_binding` step, halts `needs-human` through the existing class set, and retries its own infrastructure faults under the ordinary ladder. Shared files are `types/events.ts` and `event-sinks.ts` (both add members). Textual merge only; whichever lands second rebases.
