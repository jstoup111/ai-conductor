# Architecture Review: Rubric-repetition short-circuit for build_review

**Date:** 2026-08-17
**Status:** APPROVED WITH CONDITIONS
**Feature:** jstoup111/ai-conductor#1652
**Reviews:** `adr-2026-08-17-build-review-rubric-repetition-short-circuit.md`
**Sweep:** repo-wide, all 481 files in `.docs/decisions/` read (4 partitions; one partition re-run
after an API failure). Base `f5a2b29c8`.

## Verdict

The design is architecturally sound **as revised twice**. Three of the intake's four load-bearing
choices were withdrawn during review, and the fourth — the key — was replaced after the first
revision failed a measurement. The survivor is placed correctly against a dense set of approved
constraints and is the key `adr-2026-08-12` itself nominated as its strongest follow-up. Approval is
conditional on the six mechanical conditions in §4.

The design's central claim is now **measured rather than assumed**, which is the material change
since the first review pass.

## 1. What review changed, in order

Each revision is recorded because each was a correct-looking design that a decision or a measurement
falsified.

**Reversal 1 — the rate window (forbidden).** `adr-2026-08-12` rejected deriving a control decision
by parsing persisted history; `adr-2026-07-10-intra-step-build-progress-events` confines the engine's
only wall-clock threshold to observability; a rate trigger is not reproducible run-to-run.

**Reversal 2 — the counting unit (falsified).** `adr-2026-08-13` D7 re-stamps a cache hit's prior
result into the current lap's artifact. A provenance census found 36 of 44 rubric artifacts on the
incident feature, and 20 of 20 on another, were re-stamps. **A design measured against `lap-*`
directory counts measures the rubric cache.** The revised design ticks on consumed kickbacks.

**Reversal 3 — the key (falsified).** The first revision keyed a per-site tally on the typed anchor
subject. Replayed over 11 features reconstructed from persisted event ledgers it fired on **2 of the
5** that spun and missed `finish-publication`, the episode #1652 reports. The measured comparison:

| key | threshold | spin | healthy | kickbacks avoided |
|---|---|---|---|---|
| per-rubric failures | 4 | 5/5 | 0/6 | 14 |
| per-rubric failures | 3 | 5/5 | 2/6 | 21 |
| per-rubric failures | 5 | 4/5 | 0/6 | 9 |
| consecutive same-rubric run | 4 | 5/5 | 0/6 | 10 |
| per-site repetition | 3 | 2/5 | 0/6 | 6 |

This is the review's most important finding and it discharges the bar
`review-2026-08-11-remove-wiring-check-gate-1496` sets: a deterministic proxy must be shown to
measure the property it claims, or it is the failure that got `wiring_check` deleted. The site key
could not be shown to; the rubric key can.

**Incidental finding, recorded not acted on.** Across the same corpus the cumulative cap fired on
**2 of 11** features although 5 exceeded its nominal threshold, because one `build_review` PASS
resets `cumulative` (`adr-2026-08-12` D2). That reset is deliberate and this feature does not touch
it — the design was verified to perform identically with and without it. Whether `cumulative` should
also carry a never-reset floor is `adr-2026-08-12`'s question.

## 2. Constraint conformance

| Constraint | Source | Verdict |
|---|---|---|
| No second bound may silently re-derive the cumulative one | `adr-2026-08-12` | **Pass** — this is the refinement that ADR nominated: "the strongest candidate … it composes with this bound rather than replacing it" |
| Bound key may not be grader prose | `adr-2026-07-26` D3 | **Pass** — the rubric name is engine-supplied from the registry; no grader-authored field reaches the counting path |
| `evidenceLocations` is presentation, not identity | `adr-2026-08-13-stable-…`, `adr-2026-08-16` | **Pass after revision 1** — an earlier draft keyed on it; withdrawn |
| Path/site collapse rejected for identity | `adr-2026-08-16` Option B | **Pass after revision 2** — no longer engaged at all; the rubric key touches no identity, disposition, or immunity decision |
| Control state belongs in the state file | `adr-2026-08-12` rejected alt. | **Pass** — tally on `KickbackGateEntry`, not a scan |
| No on-disk verdict is sufficient authority alone | `adr-2026-08-03` | **Pass** — unresolved-ness re-derived from the current lap's join |
| Fresh-base disposition precedes any kickback spend | `adr-2026-07-23` | **Pass** — new exit placed after it (D6) |
| Cap-first ordering | `adr-2026-07-27`, `adr-2026-08-16` D6 | **Pass** — cap wins on a tie, and D7 renders into its body |
| PASS-reset semantics unchanged | `adr-2026-08-12` D2 | **Pass** — verified by a twin sweep with identical results |
| Exit set grep-derived; predicate consulted at each exit | `adr-2026-08-16` D6 | **Condition C1** |
| Distinct reason and explicit class per HALT | `adr-2026-06-30`, `adr-2026-08-16` D6 | **Pass** |
| Only `needs-human` survives the re-kick sweep | `daemon-rekick.ts:173-193`, `adr-2026-07-28` | **Pass** — chosen, with reasoning stated |
| New HALT reuses marker → PR surfacing → `loop_halt` | `architecture-review-2026-07-04` cond. 2 | **Condition C2** |
| `writeHaltMarker`'s result must be consumed | `adr-2026-08-11` | **Condition C2** |
| No per-emit-site halt payload variant | `adr-2026-08-11` | **Pass** — additive field on `kickback` |
| Durable counter legal only if the occurrence is emitted | event-spine exception C, `adr-2026-08-12` D5 | **Pass** — D8 |
| New event field needs an explicit sink decision | `adr-2026-07-26-event-sink-registry-exhaustiveness` | **Condition C3** |
| New bound config-gated, inert when off | `adr-2026-08-12` D4, `adr-2026-07-03-pr-timing-config-key` | **Pass** — D5/Story 5, fail-closed validation |
| Legacy ledger entries must read clean | `adr-2026-08-12` D1 | **Condition C4** |
| No LLM in the bound's decision path | `adr-2026-08-12` consequences | **Pass** — pure module, no dispatch |
| A deterministic proxy must faithfully measure its property | `review-2026-08-11-remove-wiring-check-gate-1496` | **Pass** — §1 reversal 3 is the evidence |
| Halt reason may assert only what evidence established | `adr-2026-08-05-worktree-classification-…` | **Condition C5** |

## 3. Risks

**R1 — Corpus size and label quality (Medium impact, Medium likelihood).** The threshold separates
perfectly at 4, but over eleven features whose spin/healthy labels come from operator reports and cap
terminations rather than an independent oracle. This is materially better evidenced than the
withdrawn design's 55% and than `adr-2026-08-12`'s own cap of 5 at 70%, but it is not a large sample.
Mitigated by plan task 1 re-deriving in-tree with an instruction to halt rather than ship an
unsupported number, by Story 5's gate, and by Story 6's persisted tallies keeping the number
checkable. **Downgraded from the first review pass**, where the threshold was the dominant risk at
55% confidence.

**R2 — Coarseness (Low impact, accepted by design).** The bound names a rubric, not a defect, so it
cannot tell an operator *which* finding is stuck. That is deliberate — outcome-2 asks the operator to
rule on substance, and D7 renders the recent sites for exactly that. The former R2 (site collapse
granting false immunity) is **resolved, not mitigated**: the rubric key touches no identity or
immunity path.

**R3 — The bound is silent on most features (Low impact, High likelihood, expected).** It fires on 5
of 11. That is not a failure — D7's diagnosis ships on the cap path regardless, and outcome-2 and
outcome-3 are delivered independently of whether the bound trips. Story 6's telemetry must
distinguish "never fired" from "fired correctly".

**R4 — Adjacent unfixed gap (Medium impact, out of scope).** The cumulative cap is defeated by a
single PASS, so 5 of 11 features exceeded its threshold without it firing. This feature does not
depend on that being fixed, but an operator reading "cap 5" should not assume it bounds anything.
Belongs to `adr-2026-08-12`.

## 4. Conditions

- **C1.** The FAIL block's exit set is **derived by grep at implementation time**, not from this
  document's or the ADR's enumeration, and the effective-verdict predicate is consulted **at** each
  exit rather than hoisted once — `adr-2026-08-16` D6, verbatim.
- **C2.** The new halt reuses the **exact** sequence beside it — `writeHaltMarker` with its result
  consumed and its failure logged, then `surfaceRemediationPr`, then `emitLoopHalt` — matching the
  cumulative-cap halt at `conductor.ts:7607-7617`. No bare marker write.
- **C3.** `rubricFailures` is added to `EVENT_SINKS` with an explicit render/persist/audit decision;
  it must persist, since R1's mitigation reads it back.
- **C4.** A regression test pins that a ledger entry written before this change loads clean and
  yields an empty tally, mirroring `test/engine/kickback-ledger.test.ts`'s existing legacy-`cumulative`
  coverage.
- **C5.** Three regression tests: repeated cache-hit laps do not advance the tally (§1 reversal 2
  encoded as a test); the halt body states only observed counts and never asserts the run is spinning
  or cannot converge; and the tally is never read by any identity, disposition, or immunity path.
- **C6.** `docs/explanation/gates.md`, `docs/reference/configuration.md`, and
  `docs/runbooks/stalled-or-stuck-feature.md` are updated in the same PR. The configuration reference
  must carry the corpus evidence behind the threshold, not just the number.

## 5. Out of scope, confirmed against the sweep

`test_suite` per-round history (the data does not exist); substance equivalence across re-worded
findings (#1611, spec landed, unimplemented); cross-rubric arbitration (#1630); infrastructure budget
lanes (#1629); `prd_audit` and `manual_test`, left by `adr-2026-08-12` D6; and `cumulative`'s PASS
reset, per R4.

**One defect surfaced and filed.** `priorAttemptPointers` (`remediation-context-pointers.ts:77`) keys
#1620's same-site pointers on the whole canonical anchor including its free prose subjects. Measured
over 67 graded-FAIL laps, a whole-anchor match to a prior lap occurred in 4 laps (6%) against 20
(30%) for a prose-free key. Filed as jstoup111/ai-conductor#1693.
