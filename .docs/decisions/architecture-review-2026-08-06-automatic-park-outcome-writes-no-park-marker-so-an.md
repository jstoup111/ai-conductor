# Architecture Review: Automatic park outcome writes no park marker

**Date:** 2026-08-06
**Mode:** Lightweight (Medium tier — Sections 2 and 4 only, per the tier rules)
**Track:** technical
**Source:** intake jstoup111/ai-conductor#1328
**Stories reviewed:** none yet — this review runs before `/stories`, against the track marker,
the complexity marker, and the architecture diagrams for this slug.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. The marker writer (`park-marker.ts`), the HALT writer (`halt-marker.ts`), and the triage type (`setup-triage.ts`) all exist. |
| Prerequisites | None. No migration, no config key, no external account. |
| Integration surface | One module changes (`daemon-runner.ts`); one existing module is called (`park-marker.ts`). Readers (`daemon-backlog.ts`, `park-reconciliation.ts`, `daemon-rekick.ts`) are unchanged — they already honor the marker. |
| Data implications | One additional file per parked feature under `.daemon/parked/`. `writeAutoPark` is idempotent on `EEXIST`, so repeat termination is safe. |
| Performance risk | None. One `mkdir` plus one exclusive `open` per terminated feature, on a path already taken once per feature run. |
| Worktree isolation | Safe, and this is the point of the design. `writeAutoPark` resolves the main repository root via `git rev-parse --git-common-dir`, so the marker lands in the shared root regardless of which worktree calls it. Two worktrees terminating concurrently contend only on distinct per-slug filenames. |

Feasibility is not in question. The primitive being introduced is a composition of two writers
that already exist and are already honored by every reader.

## Alignment

**Domain boundaries.** The change respects the existing ownership split: `park-marker.ts` remains
the sole writer of `.daemon/parked/`, and `daemon-runner.ts` remains the sole owner of the
termination boundary. No new module claims either responsibility. This was the specific risk raised
as assumption A3 — that the primitive might duplicate `daemon-auto-park.ts` — and it is resolved by
calling `park-marker.ts` directly rather than routing through the empty-plan park path, whose #612
contradiction guard is scoped to plan emptiness and does not apply to a setup failure.

**Pattern consistency.** `park-marker.ts`'s header states it exists as "the single source of truth"
for the marker, mirroring `halt-marker.ts`. Routing the automatic park through it is the documented
pattern, not a departure. The new primitive is a boundary composition in the same file as the
callers it serves, consistent with how `writeErrorHalt` is already structured.

**State management.** This is the substantive architectural point and the reason an ADR was written
rather than the review simply approving. Today the system can represent an invalid state: a HALT
note asserting `parked` while no marker exists. The approved design makes that state
unrepresentable by deriving the note from the write result rather than authoring the two facts
independently. This satisfies the "invalid states unrepresentable" principle at the boundary where
it actually failed in production.

The park intent is a two-valued decision passed explicitly by each caller rather than inferred from
`status` or from the triage outcome's shape. That is deliberate: `status: 'error'` is produced by
three sites with different park semantics, so inferring intent from it would reintroduce the
coupling this change removes.

**Diagram accuracy.** `.docs/architecture/2026-08-06-honest-park-termination-boundary.md` and
`.docs/architecture/sequences/2026-08-06-automatic-park-marker-write.md` were authored for this
change and match the design as approved, including the marker-write-failure path. Both render
clean under `conduct-ts render-diagrams --check` (6 Mermaid blocks, exit 0).

**Security boundaries.** No new endpoint, input, or credential surface. The marker body carries a
reason string derived from `triageOutcome.outputTail`, which already reaches `.pipeline/HALT`
today, so no new data reaches disk that did not already.

**Production DI defaults.** No dependency-injection default changes. No in-memory store is
introduced for stateful data; the change moves state from a worktree-local file to a durable
main-root file, which is the correct direction.

## Adjudicated Assumptions

| Id | Assumption | Verdict | Confidence | Impact if wrong |
|---|---|---|---|---|
| A1 | Only site `:356` writes a marker; `:484`, `:536`, `:556` get honest wording and no marker | **Confirmed.** `:484` returns `status: 'halted'`; `daemon.ts:885` treats `halted` and `error` identically, so it needs no distinct treatment. The partition is required by the stated outcome that non-park errors still dispatch. | 90%, verified | Over-parking would strand features that should retry |
| A2 | Site `:556` receives `SetupFailureError` in daemon mode when no triage handler is wired, so it must park too | **Refuted.** `runSetupTriage` is unconditionally constructed at `daemon-cli.ts:1149` and passed at `:1242`, consumed at `daemon-deps.ts:171`. A daemon-mode setup failure always routes to triage at `:344`. | 95%, verified | Would have added an unnecessary requirement |
| A3 | The primitive should reuse rather than parallel the existing park writer | **Confirmed, with a correction.** Reuse `park-marker.ts` directly; do *not* route through `daemon-auto-park.ts`, whose #612 contradiction guard is scoped to empty/missing plans. | 90%, verified | A second marker writer would recreate the split-brain being fixed |
| A4 | An automatic park interacts cleanly with re-kick and operator unpark | **Confirmed.** `daemon-rekick.ts:132` checks `isOperatorParked` first and unconditionally, ahead of `isProcessed` and the SHA guard. `park-reconciliation` distinguishes provenance by the `auto-parked:` body prefix. `conduct-ts daemon unpark` removes the marker. | 90%, verified | A park the re-kick sweep ignored would not stop the loop |
| U1 | The mechanism by which the reported feature was re-dispatched *despite* a `needs-human` HALT | **Unresolved.** `writeErrorHalt` writes `HALT.class = 'needs-human'` (`:621`); `daemon-rekick.ts:184` skips that class; `daemon.ts:155` parks live-HALT slugs across restarts; all wired (`daemon-cli.ts:1462`). So the HALT was absent, not ignored. Two unconfirmed candidates: the swallowed write-verification failure at `:627-634`, and worktree-local storage being lost on recreation. | ~40% on any single explanation | Does not change this design — the marker is main-root and survives all candidates. Escalated to the operator, who scoped it out of this spec and into the condition below. |

U1 was presented to the operator as a blocking scope question before this review was finalized.
The operator's decision was to ship the approved design plus the loud-write-failure condition, and
to route the root-cause question to a separate intake.

## Wiring Surface

| New production surface | Where it is called from in production |
|---|---|
| The termination primitive (park intent + reason in, rendered note out) | `daemon-runner.ts`'s four existing termination sites — `:356` (triage park), `:484` (false-ship guard), `:536` (no DONE/HALT), `:556` (catch-all throw) — replacing their direct `writeErrorHalt` calls. Reached in production via the daemon feature runner constructed by `makeFeatureRunnerDeps` (`daemon-deps.ts`) and driven by `runDaemonMode` (`daemon-cli.ts`). |
| The park write inside that primitive | Calls the existing exported `writeAutoPark` (`park-marker.ts:231`). No new export on the marker module. |
| The `auto-parked:` marker for a triage-park slug | Consumed by `daemon-backlog.ts:846` (`isOperatorParked`, dispatch eligibility), `daemon-rekick.ts:132` (re-kick skip), and `park-reconciliation.ts` (sweep count and provenance classification). All three are existing readers; none require changes. |
| The park-failure note variant | Rendered into `.pipeline/HALT` by the same primitive; read by the operator and by `daemon-rekick.ts`'s `readHaltReason`. |

No new `conduct-ts` subcommand, config key, hook, or scheduled job is introduced, so no new
consumer-facing surface requires registration.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Over-parking: a transient setup failure now needs an operator unpark instead of self-healing on the next scan | Technical | Medium | Medium | Accepted and documented in the ADR's Negative consequences — it is the mechanism that stops the burn. Bounded by keeping park intent to site `:356` only. |
| The park/no-park partition is inferred from `status` by a future contributor, reintroducing the coupling | Knowledge | Medium | High | The ADR fixes intent as an explicit caller-supplied argument and states why inference is rejected. A story must cover a non-park error still dispatching, so the partition is test-pinned. |
| The marker write fails and the feature silently keeps looping | Technical | Low | High | Addressed by the operator-approved condition below: the failure is rendered into the note and named, never swallowed. |
| U1's unidentified HALT-loss mechanism also affects some artifact this design relies on | Technical | Low | High | The design relies only on `.daemon/parked/<slug>` in the main repository root, outside every worktree. Follow-up intake tracks the root cause. |
| `daemon-dashboard.ts` presents an automatic park identically to an operator park, confusing recovery | Knowledge | Medium | Low | Provenance is already distinguishable via the `auto-parked:` prefix; ADR follow-up action checks the rendering during BUILD. |

## ADRs Created

- `adr-2026-08-06-honest-park-termination-boundary.md` — **APPROVED**. Category: Cross-Cutting
  Concerns (error handling and resilience patterns) and Infrastructure (dispatch-control boundary).

No existing ADR is superseded. `adr-2026-07-09-setup-failure-triage` (cited in `daemon-deps.ts:62`)
is unaffected: this change consumes the triage outcome it defines and does not alter triage
classification.

## Conditions

1. **The marker write must fail loud.** The existing swallow at `daemon-runner.ts:627-634` must not
   be extended to the park write. A park whose durable marker could not be written renders a note
   that says the park failed, names the underlying error, and directs the operator to
   `conduct-ts daemon park <slug>`. Operator-approved during this review.
2. **Ordering is normative.** The marker write precedes note rendering, and the note is derived
   from the write result. A story must pin this ordering, not merely the end state — the end state
   is satisfiable by two independent writes, which is the defect being removed.
3. **The non-park path must be test-pinned.** At least one story covers a feature that errors at a
   non-park site and is still listed dispatchable on the next scan, so the fix cannot regress into
   parking everything.
4. **Follow-up intake for U1.** File the HALT-loss root-cause issue. Not blocking this spec; the
   ADR records it as a follow-up action.
