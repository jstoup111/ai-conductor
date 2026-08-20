# Architecture Review: Recoverable build review when the blocker is mechanical, not judgement

**Date:** 2026-08-18
**Feature:** review-infrastructure-failures-are-operator-unreco (intake jstoup111/ai-conductor#1629)
**Tier:** M — lightweight mode (§2 Feasibility and §4 Alignment run in full; §3, §5 skipped)
**Input reviewed:** `.docs/specs/2026-08-18-review-infrastructure-failures-are-operator-unreco.md`
(FR-1..FR-15, Approved) and `.docs/architecture/review-infrastructure-failures-are-operator-unreco.md`.
Stories and plan do not exist yet.
**Scope boundary (binding, from `.docs/track/…`):** both filed outcomes; operator-only and
interactive; no daemon self-clear; a genuine semantic FAIL blocks exactly as today.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency, service, or infrastructure. Every seam exists: the reducer, the leased disposition store, the kickback ledger, the `absent`-verdict re-dispatch path, the external event writer, and the publication renderer. |
| Prerequisites | None external. One internal prerequisite is load-bearing and is why D2 exists: the branch→result reason mapping currently discards the closed cause (`step-runners.ts:1863-1869` folds everything to `provider-error`), so identity work cannot proceed before it is fixed. |
| Integration surface | Six engine modules plus docs — `build-review-domain.ts` (record kind + mapping), `build-review-aggregate.ts` (one reducer relaxation), `build-review-dispositions.ts` (second record kind), `build-review-cli.ts` (report + new action), `step-runners.ts` (kind-based no-publish), `conductor.ts` (allowance check, halt body). Crosses no domain boundary this feature does not already own. |
| Data implications | No schema migration. The disposition store gains a record kind; `adr-2026-08-13` §2's parser is exact-keys and versioned, so the new kind must be additive and legacy records must continue to parse — asserted as Condition 3. The ledger gains one counter, read-tolerantly, exactly as `adr-2026-08-12` D1 and `adr-2026-08-17` D1 both did. |
| Performance risk | Negative cost: D3 removes provider spend on laps that today publish a FAIL and dispatch rework. No new I/O in a hot path; all reads ride the existing lease. |
| Worktree isolation | All state is worktree-local `.pipeline/`; no ports, no shared services, no cross-worktree coupling. Deleting a worktree fails open (recorded in the ADR's Known limitation). |

## Alignment

**Repo-wide ADR sweep — performed, not narrowed.** All 286 ADRs in `.docs/decisions/` were enumerated
by status and title, and 12 were read in full for governing constraints. Findings:

| ADR | Bearing on this design | Resolution |
|---|---|---|
| `adr-2026-08-13-stable-build-review-finding-dispositions` (APPROVED) | **Contradicted the originally chosen approach.** §2: "infrastructure findings remain blocking"; §4: `accept` "refuses … infrastructure failures"; "One action accepts exactly one finding". | Escalated to the operator with both texts. Operator directed a **distinct record kind sharing the store**, so no approved decision is amended and §4's refusal list stands verbatim. ADR D6. |
| `adr-2026-08-17-build-review-rubric-repetition-short-circuit` (APPROVED) | D3 explicitly reserves this lane: "A rubric that settled as an infrastructure failure does not tick either — that is #1629's territory". Its `rubricFailures` tally lands on the same ledger entry. | Honored by construction: D3's no-publish means the tally is never reached on a mechanical lap. Additive field co-existence flagged for conflict-check. |
| `adr-2026-08-16-closed-build-review-finding-vocabularies` (APPROVED) | D1: no identity input may be free text. D3 step 4: a surviving contract violation classifies `absent`, "No kickback budget is consumed and no cap advances". | D7 keys identity on two closed vocabularies only; D3 reuses the approved `absent` path rather than inventing a lane. |
| `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` (APPROVED) | A non-charging re-entry must carry its own allowance and a `needs-human` halt; a per-transition cap is a diagnostic refinement, not required. | D4 adopts this shape and its holding on the second counter. |
| `adr-2026-07-13-retry-classify-rerun-vs-route` (APPROVED) | Establishes build_review's "missing/stale/malformed → `absent`" mapping. | D3 is an application of it, not an exception to it. |
| `adr-2026-07-28-total-halt-classification-legacy-boundary`; `daemon-rekick` behavior via `adr-2026-08-17` D4 | Only `needs-human` or `mechanical` are permitted; the daemon auto-clears `mechanical`. | D5 takes `needs-human`, for the stated reason. |
| `adr-2026-08-12-cumulative-build-review-convergence-bound` (APPROVED) | Owns `cumulative`'s value; its PASS reset is superseded by `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` D1. | Cap value untouched; D4's counter follows that ADR's D6 — no PASS reset, credited by an invalidating rebase. |
| `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` (APPROVED) | Owns the ledger, the per-tree reset, and the finding that reason strings are never byte-stable across laps. | D1 routes on result **kind**, never reason text, so that finding cannot bite. |
| `adr-2026-07-01-machine-scoped-operator-identity`; `adr-2026-08-09-operator-only-scoped-artifact-reseal` | The operator-only authority standard. | Reused unchanged by D6; no new authority model (NFR-3). |
| `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`; `adr-2026-08-08-finish-human-required-halt-rendering` | Every terminal state names its lever and renders reason/next action. | D5's halt body. |
| `adr-2026-08-11-halt-events-ride-the-persisted-spine`; `adr-2026-07-26-event-sink-registry-exhaustiveness` | No per-emit-site payloads; additive field sink decisions must be explicit. | D10. |
| `adr-2026-08-13` §5/§6 | External same-schema writer; one publication renderer, fail-closed. | D9/D10 reuse both. |

**No approved ADR is violated by the design as amended.** One was in direct conflict and was resolved
by operator direction rather than by downgrading it.

**Event spine.** Verdict: extend, do not add a channel. Occurrences (mechanical-fault lap, allowance
exhaustion, acceptance, refusal) are `ConductorEvent` members reusing the existing external writer;
the allowance counter and the decision records are durable state under exception C, legitimate only
because the occurrences are also emitted — the identical reasoning `adr-2026-08-17` D8 applied.
No sidecar file, no new ledger, no timestamp read back as a signal.

**State management.** The design removes an unrepresentable-state defect rather than adding one: today
a mechanical fault and a semantic FAIL are indistinguishable to the counter that routes them. Routing
moves onto the existing discriminated union's `kind`, and no boolean flag is introduced.

**Pattern consistency.** Every mechanism is an extension of an existing, approved one. The one genuine
departure — a second record kind in a store whose ADR describes only findings — is the operator's
explicit direction and is recorded in ADR D6 with its conformance argument.

**Diagram accuracy.** `.docs/architecture/review-infrastructure-failures-are-operator-unreco.md`
matches this decision, with one correction folded in: its "operator records the decision through the
existing acceptance action" reading is superseded by D6's distinct action. The diagram's own legend
already scopes the decision to one rubric per review, so no structural redraw is required; the
sequence's `Op->>Disp` step is the distinct action.

## Domain Integrity

Skipped per lightweight mode (TDD's per-cycle domain reviewer covers it). Two design-time notes
carried forward for BUILD: the new record kind must be a discriminated union member, not an optional
field on the finding record; and the branch→result reason mapping (D2) must be exhaustive at the type
level, not a `default` case.

## Wiring Surface

Design-time commitments. No `file:line` is owed yet; §12's as-built sweep verifies the shipped code
independently.

| New production surface | Where it is called from in production |
|---|---|
| Kind-based mechanical-fault classification | replaces the `detail`-prefix test in the `build_review` step runner's post-coordination branch handling, on the path every lap already takes |
| Branch→closed-reason mapping (D2) | the same post-coordination result construction in the step runner; every non-cache branch flows through it |
| Mechanical allowance counter + check | read and written beside the existing kickback-ledger access in the conductor's `build_review` FAIL/absent handling; checked before the step re-dispatches |
| `needs-human` halt on exhaustion | the conductor's existing `writeHaltMarker` + `emitLoopHalt` call sites, with a pure body renderer per `adr-2026-08-08` |
| Reduced-coverage record kind | persisted and read through the existing `BuildReviewDispositionStore` lease; read by the effective-verdict reducer's disposition-aware entry point, which the step runner and the CLI both already call |
| Reducer relaxation for covered infrastructure branches | inside `deriveEffectiveBuildReviewVerdict`, consumed by every existing caller unchanged |
| New operator CLI action | the pre-boot `build-review` command family the CLI dispatcher already registers alongside `findings` and `accept` |
| Reduced-coverage rendering | `adr-2026-08-13` §6's existing publication/shipped-record renderer, and the `findings` report |
| New/extended events | the existing emitter and the external same-schema writer; sink registration is explicit per `adr-2026-07-26` |

**Early overlap scan (advisory, non-blocking).** `conduct-ts overlap-scan` over these paths returned
288 "overlaps" for a single file — every unmerged `spec/*` branch. The result is uninformative here
(spec branches carry only `.docs/`), so it was not used to shape the task breakdown. The substantive
overlap risk is instead named in Risks below and handed to `/conflict-check`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `adr-2026-08-17`'s `rubricFailures` lands on the same `KickbackGateEntry` concurrently | Integration | Medium | Medium | Both are additive, read-tolerant fields; `/conflict-check` owns the sequencing call. Re-read the ledger at BUILD rather than trusting this review's snapshot. |
| Unmerged specs targeting the same build_review area (e.g. `stuck-features-cycle-build-review-with-no-way-to-d`, `repeated-build-review-semantic-failures-can-churn-`) overlap in substance | Integration | Medium | Medium | Handed to `/conflict-check` explicitly, since the overlap scan could not discriminate. |
| The mechanical allowance of 3 halts a healthy feature on a genuinely transient fault | Technical | Low | Medium | Halt body names the cause and the constant; ADR records the 70% confidence and the revisit trigger. |
| D2's mapping mis-names a fault class, making a reduced-coverage decision broader than intended | Technical | Low | **High** | Total, closed, type-level mapping with no `default`; Condition 1. |
| A reduced-coverage decision silently covers a later different fault of the same class | Technical | Medium | Medium | Accepted and stated in ADR D7; mitigated by the per-lap re-stamp (D9) so evidence always names the fault actually present. |
| A record-kind addition breaks parsing of existing disposition state | Data | Low | **High** | Condition 3 — a legacy-state parse test is a required acceptance criterion (FR-15). |
| Reduced coverage passes review but never reaches the shipped record | Data | Low | **High** | `adr-2026-08-13` §6's fail-closed rule is inherited: an unrenderable known record blocks completion. Condition 2. |

## ADRs Created

- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane.md` — **DRAFT**, pending operator
  approval. Resolves PRD OQ-1 (D7), OQ-2 (D3), OQ-3 (D4), OQ-4 (D5), OQ-5 (D9). Structural
  prerequisite met on two counts: it establishes a durable state-transition design (the mechanical
  lane and its allowance) and revises the data architecture of an existing durable store (a second
  record kind). No existing ADR governs either; `adr-2026-08-13` governs the adjacent finding case
  and is cited and conformed to rather than duplicated or superseded.

## Conditions

1. **D2 before D7.** The branch→result reason mapping must preserve the closed cause before any
   identity work lands. An identity keyed on a reason that is always `provider-error` does not
   discriminate, and shipping D7 on top of the current mapping would produce a decision far broader
   than the ADR claims. The plan must order these tasks accordingly.
2. **Reduced coverage must reach the shipped record, fail-closed.** FR-11 is satisfied only when a
   known reduced-coverage record that cannot be rendered blocks completion, matching
   `adr-2026-08-13` §6. A best-effort render is not acceptance.
3. **Legacy-state parse coverage is required.** FR-15 must be demonstrated by a test that reads a
   disposition store and a kickback ledger written before this change and observes unchanged behavior.
4. **No new authority surface.** No config key, env var, or flag may grant the daemon the ability to
   record reduced coverage (NFR-3). A test asserting the non-interactive refusal is required.
5. **Re-derive, never reuse.** The coverage decision's effect must be resolved from the current lap's
   join under the existing lease, never concluded from a prior lap's artifact — per
   `adr-2026-08-03-build-repair-member-reuse-validity`.

## PRD amendment

`.docs/specs/2026-08-18-…` Key Decisions asserted "One operator concept, not two." That assertion is
falsified by `adr-2026-08-13` §4 and by operator direction; an amendment note has been added beside
it in place, preserving the original per
`adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts`.
