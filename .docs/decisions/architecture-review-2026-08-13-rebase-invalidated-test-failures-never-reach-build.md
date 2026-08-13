# Architecture Review: Rebase-invalidated test failures never reach build_review as repair context

**Date:** 2026-08-13
**Intake:** jstoup111/ai-conductor#1535
**Tier:** Medium — lightweight mode (Feasibility + Alignment; complexity and domain pre-check
delegated per the skill's Medium-tier rules)
**Stories reviewed:** none yet — this review runs before `/stories`, against the technical intent
in `.docs/track/rebase-invalidated-test-failures-never-reach-build.md` (as amended)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. No new dependency, service, or infrastructure. Every mechanism — the event spine, the JSON repair ledger, the lock primitive — already exists and is in use. |
| **Prerequisites** | Two sink flags flip to `persist: true` (`event-sinks.ts:65,68`). Nothing else must exist first. No migration, no config key. |
| **Integration surface** | Six modules: `rebase.ts`, `event-sinks.ts`, `types/events.ts`, `test-suite-remediation.ts`, `conductor.ts`, `build-review-inputs.ts`. Above the 3-boundary flag, but they form one existing call chain rather than three independent domains, and the change follows that chain end to end. |
| **Data implications** | One `.pipeline/` JSON ledger changes shape: `consumedInvalidations: number[]` is replaced by `(advance, failure)` keying. `.pipeline/` is run evidence, gitignored, and rebuilt per feature — no migration or backfill. A ledger written by the current engine must read as empty rather than as malformed; see Condition 3. |
| **Performance risk** | Negligible. The join reads an append-only file already written in the same worktree, once per gate failure — an infrequent path. No new subprocess: `emitRebaseEvent` already computes the delta. |
| **Worktree isolation** | Clean and materially improved. Every artifact — `events.jsonl`, the repair ledger, its lock — is per-worktree under `.pipeline/`. `.pipeline/` is in `MACHINERY_AUTHORED_PATHS` (`build-review-inputs.ts:66`), so none of it enters the graded diff. |

## Alignment

**Event-spine principle — satisfied, and this is the review's central alignment finding.**
The repository's stated principle is to extend the existing spine and never add a parallel channel.
The base-advance concern is *already* modelled on the spine: `rebase_changed` and
`rebase_gate_invalidated` exist in the `ConductorEvent` union (`types/events.ts:560-591`). They are
simply declared `persist: false` (`event-sinks.ts:65,68`) and so never reach
`.pipeline/events.jsonl`. The change is a sink-flag flip plus one added field — the
schema-not-file test passes, and no new channel is introduced. Rejecting the sidecar-file
alternative was mandatory, not discretionary.

**Deterministic-where-possible — satisfied.** The join is engine code over an engine-written record;
no LLM participates in deriving attribution. The grader still judges whether a hunk implements a
recorded repair, which is genuine judgement and correctly left to it. Approach C (hand the grader
the raw delta and let it decide) was rejected on exactly this principle.

**Pattern consistency — satisfied.** `adr-2026-08-12-removal-anchored-tautology-exemption.md`
established the shape one day earlier: engine-computed evidence, rendered as its own block beside
`repairContext` and `acceptedWidenings`, framed as evidence and not exemption. This change reuses
that shape verbatim for the block that ADR was modelled on in the first place.

**Fail direction — satisfied, and load-bearing.** Every degradation path lands on today's behavior:
a dropped emission, a diagnostic that names no path, an unrecognized failure shape. None of them
can manufacture a repair record, so none can launder an unplanned deletion. This is the property
that makes the causal join acceptable at all.

**State management — one concern, resolved.** Attribution today lives in a field that
`computeAndWriteVerdict` rewrites on every gate run, which is the root cause. Moving it to an
append-only record removes the invalid state ("the fact was true but its carrier was overwritten")
rather than defending against it. Correct direction.

**Consumer-facing determination.** `isCodeOrTestPath` is shipped engine code, so the classifier
inversion changes behavior for every consumer project, not just this repository. It is governed by
its own ADR, carries a release note, and is not a repo-only change. Flagged because the rest of
this feature *is* repo-internal and the distinction is easy to lose.

**No ADR violated.** `adr-2026-07-20-post-rebase-delta-aware-invalidation.md` owns
`changedCodePaths` and gate invalidation. This change deliberately leaves both intact: the new
field is additive and the classifier fix changes what the predicate classifies, not how the
classifier's output is used.

## Wiring Surface

Design-time commitments — where each new or changed production surface will be called from.

| Surface | Production caller |
|---|---|
| `rebase_changed` gains an unfiltered-delta field | Emitted by `emitRebaseEvent` (`rebase.ts:1296`), already reached from the rebase step; read by the new join |
| `rebase_changed` / `rebase_gate_invalidated` become `persist: true` | Consumed by `EventPersister.start()` (`event-persister.ts:59-62`), which subscribes to `persistedEventTypes()` |
| Base-advance reader over `events.jsonl` | Called by the repair recorder in `test-suite-remediation.ts`, itself called from `conductor.ts` |
| Gate-agnostic `recordGateRepair` (replaces `recordTestSuiteRemediation`) | Called from `conductor.ts:4705` and `:7206`, the existing deterministic-failure paths, with the observing gate passed in |
| Grading-provenance event | Emitted from the `build_review` input-assembly path (`build-review-inputs.ts`), persisted via the same sink mechanism |
| Inverted `isCodeOrTestPath` | Already called by `filterCodeOrTestPaths` (`rebase.ts:394`) and `isRuntimeSourcePath` (`gate-invalidation.ts:27`); no new caller needed |

`wasInvalidatedByRebase` is removed along with its tests — a deletion, not a new surface.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| ~~`emitRebaseEvent` writes to a non-feature-scoped emitter~~ | Technical | — | — | **RETIRED 2026-08-13** — verified false; see Condition 1. A story still asserts the record is readable from the feature worktree, as regression cover |
| Emission is best-effort (`rebase.ts:1275` swallows errors), so a dropped event yields no repair record | Technical | Low | Medium | Accepted. Degrades to today's grading; D4's provenance record makes the absence visible rather than silent |
| A failure diagnostic names no path, so the join cannot match | Technical | Medium | Low | Accepted by design — fails to "no record", never to a false record. A story covers the no-join path explicitly |
| Classifier inversion causes more re-verification laps than expected on doc-adjacent advances | Performance | Medium | Low | Bounded at one lap per advance; measured at retro |
| A consumer project relies on markdown being excluded and sees new invalidation after upgrading | Integration | Low | Low | Release note; degrades to extra laps, never an incorrect verdict |
| Collision with in-flight `repeated-build-review-semantic-failures-can-churn-`, which edits `build-review-inputs.ts` and `build-review-prompt.ts` to add a parallel `removalContext` block | Integration | **High** | Medium | Condition 2 — complementary, not duplicative, but the two must not both restructure the same render site |

## ADRs Created

Both created at `Status: APPROVED` per the engineer loop's no-DRAFT gate.

- `adr-2026-08-13-durable-base-advance-attribution.md` — attribution moves from a transient
  gate-verdict field to a durable spine record; the join requires path overlap; recording becomes
  gate-agnostic and unbounded per advance; grading provenance is recorded.
  *Structural basis:* state/data architecture and an event-store boundary — it changes which
  durable store is authoritative for base-advance attribution and promotes two event types to
  persisted spine members.
- `adr-2026-08-13-markdown-default-inversion.md` — documentation becomes an enumerated exclusion
  and everything else, markdown included, is runtime source.
  *Structural basis:* it revises the system-wide boundary between runtime source and
  documentation, which every gate-invalidation decision is computed from, and the change is
  consumer-visible.

**Governing-ADR reuse check.** `adr-2026-07-23-build-review-fresh-base-disposition.md` introduced
the rebase-repair exception but governs base *freshness* and FAIL disposition, not the attribution
carrier — it is cited and applied, not duplicated.
`adr-2026-07-20-post-rebase-delta-aware-invalidation.md` governs gate invalidation and is
explicitly left unchanged. No existing ADR covers either decision recorded here.

## Conditions

1. ~~**Confirm the emitter binding before implementation.**~~ **DISCHARGED 2026-08-13** by the
   `/verify-claims` pass at `.pipeline/verify-claims-architecture-review-1535.md`, run at operator
   request before `/stories`. The chain is verified end to end — `daemon-cli.ts:910` →
   `daemon-runner.ts:394-399` → `new Conductor({events: featureEvents, projectRoot: wt.path})`
   (`daemon-cli.ts:1000-1010`), with the pre-loop re-kick path agreeing
   (`daemon-cli.ts:1079-1082` → `daemon-rekick.ts:563`). `projectRoot`, the `EventPersister`
   target, and `featureRoot` all resolve to the same `wt.path`. No path disagreement exists and
   the mechanism cannot ship inert for this reason.

   That pass also falsified a framing claim in this review: the in-loop `rebase` step runs at
   `steps.ts:271`, **after** `build_review` at `:181`, so a base advance is observed by the grader
   on the *following* lap. The design is unaffected because the join reads the feature's whole
   append-only history, but a lap-scoped join would have been inert. Recorded in the ADR.

2. **Sequence against `repeated-build-review-semantic-failures-can-churn-`.** That spec is merged
   as a spec but unshipped, and adds a `removalContext` block to the same two files. The two
   changes are complementary — it narrows the Tautology rubric with removal evidence; this one
   repairs the `repairContext` channel — but `/conflict-check` must confirm neither restructures
   the other's render site, and `/plan` must not assume a block count.

3. **The ledger shape change must read forward-compatibly.** A repair ledger written by the current
   engine (carrying `consumedInvalidations`) must read as *empty*, never as malformed, so an
   in-flight feature gets a fresh mechanism rather than a crash or a spurious record. Mirrors the
   normalization contract `adr-2026-08-12-cumulative-build-review-convergence-bound.md` adopted for
   the same class of problem.

## Notes

**Overlap scan.** `conduct-ts overlap-scan` was run over the Wiring Surface paths. It reported
overlaps against essentially every historical `spec/*` branch for
`test-suite-remediation.ts`, which is not a usable signal — the file is old enough that every
retained spec branch contains it. Treated as uninformative rather than as a clean result; the
substantive overlap (Condition 2) was found by reading `.docs/plans/` directly. The scan's
low signal-to-noise on long-lived files is worth its own intake.

**Excluded by the operator, and correctly so.** The kickback convergence bound — the counter that
resets on tree movement, which is why this churn never self-terminated — is out of scope here and
is already addressed by `adr-2026-08-12-cumulative-build-review-convergence-bound.md` in the
in-flight sibling spec. This spec removes the *cause* of the churn; that one bounds its *duration*.
Both are needed and neither subsumes the other.
