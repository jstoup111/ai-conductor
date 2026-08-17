# Architecture Review: Site-repetition short-circuit for build_review

**Date:** 2026-08-17
**Status:** APPROVED WITH CONDITIONS
**Feature:** jstoup111/ai-conductor#1652
**Reviews:** `adr-2026-08-17-build-review-site-repetition-short-circuit.md`
**Sweep:** repo-wide, all 481 files in `.docs/decisions/` read (4 partitions; one partition
re-run after an API failure). Base `f5a2b29c8`.

## Verdict

The design is architecturally sound **as revised**. Two of its three original elements were
withdrawn during review on evidence, and the survivor is placed correctly against a dense set of
approved constraints. Approval is conditional on the six conditions in §4, all mechanical.

The dominant risk is **not** architectural. It is that D4's threshold is a 55%-confidence judgement
that no available data can calibrate, on a bound whose wrong direction halts converging features.
D5's flag and exit condition are the mitigation and are treated as load-bearing, not optional.

## 1. What the sweep changed

The sweep reversed the design twice. Both reversals are recorded because each was a correct-looking
design that an approved decision or a measurement falsified.

**Reversal 1 — the rate window (forbidden).** The intake proposed a kickback rate over a wall-clock
window. `adr-2026-08-12` had already rejected deriving a control decision by parsing persisted
history ("state belongs in the state file; the event is the observation of it"), and
`adr-2026-07-10-intra-step-build-progress-events` confines the engine's only wall-clock threshold to
observability events. A rate trigger is also not reproducible run-to-run. Withdrawn; `cumulative`
already answers the volume question from the state file.

**Reversal 2 — the counting unit (falsified).** The intake's central hypothesis was that the
persisted lap directories already carry every signal. A census over both features with laps on disk
showed 36 of 44 rubric artifacts on the incident feature, and 20 of 20 on the other, were
`provenance.kind = 'cache-hit'` — `adr-2026-08-13` D7 re-stamps a prior verdict into the current
lap's artifact. The apparent 8-of-11 signal was one judgement counted eight times, and so was the
apparent false-positive that briefly argued against building anything. The corpus of genuine
judgements is **two**.

This is the sharpest finding of the review: **a design measured against `lap-*` directory counts
measures the rubric cache.** The revised design ticks on consumed kickbacks instead, which is one
real backward move per tick and immune to the artifact.

## 2. Constraint conformance

| Constraint | Source | Verdict |
|---|---|---|
| No second bound may silently re-derive the cumulative one | `adr-2026-08-12` | **Pass** — composes explicitly; that ADR named rubric-item identity as "the strongest candidate for a future refinement" that "composes with this bound rather than replacing it" |
| Bound key may not be grader prose | `adr-2026-07-26` D3 | **Pass** — typed anchor subjects only; whole-anchor equality measured at zero repeats on disk, confirming D3 empirically |
| `evidenceLocations` is presentation, not identity | `adr-2026-08-13-stable-…-dispositions`, `adr-2026-08-16` | **Pass after revision** — an earlier draft keyed on it; withdrawn |
| Control state belongs in the state file | `adr-2026-08-12` rejected alt. | **Pass** — tally on `KickbackGateEntry`, not a scan |
| No on-disk verdict is sufficient authority alone | `adr-2026-08-03-build-repair-member-reuse-validity` | **Pass** — unresolved-ness re-derived from the current lap's join |
| A `build_review` artifact does not attest the current tree | `architecture-review-2026-07-08` | **Pass** — no prior-lap artifact is read |
| Fresh-base disposition precedes any kickback spend | `adr-2026-07-23` | **Pass** — new exit placed after it (D6) |
| Cap-first ordering | `adr-2026-07-27`, `adr-2026-08-16` D6 | **Pass** — threshold 3 < cap 5, and the cap wins on a tie |
| Exit set grep-derived; predicate consulted at each exit | `adr-2026-08-16` D6 | **Condition C1** |
| Distinct reason and explicit class per HALT | `adr-2026-06-30`, `adr-2026-08-16` D6 | **Pass** |
| Only `needs-human` survives the re-kick sweep | `daemon-rekick.ts:173-193`, `adr-2026-07-28` | **Pass** — chosen, with the reasoning stated |
| New HALT reuses marker → PR surfacing → `loop_halt` | `architecture-review-2026-07-04` cond. 2 | **Condition C2** |
| `writeHaltMarker`'s result must be consumed | `adr-2026-08-11-halt-events-ride-the-persisted-spine` | **Condition C2** |
| No per-emit-site halt payload variant | `adr-2026-08-11` | **Pass** — additive field on `kickback`, central `emitLoopHalt` |
| Durable counter legal only if the occurrence is emitted | event-spine exception C, `adr-2026-08-12` D5 | **Pass** — D8 |
| New event field needs an explicit sink decision | `adr-2026-07-26-event-sink-registry-exhaustiveness` | **Condition C3** |
| New bound must be config-gated, default-inert when off | `adr-2026-08-12` D4, `adr-2026-07-03-pr-timing-config-key` | **Pass** — D5, fail-closed validation |
| A staged flag needs a written exit condition | `adr-2026-08-09-repo-wide-adr-sweep-staged-…` | **Pass** — D5 |
| Legacy ledger entries must read clean | `adr-2026-08-12` D1 | **Condition C4** |
| No LLM in the bound's decision path | `adr-2026-08-12` consequences | **Pass** — pure predicate, no dispatch |
| `.pipeline` reads must not throw at a routing boundary | `adr-2026-07-11` | **Pass** — in-memory state, no scan |
| Halt reason may assert only what evidence established | `adr-2026-08-05-worktree-classification-…` | **Condition C5** |

## 3. Risks

**R1 — Threshold miscalibration (High impact, High likelihood).** D4 is 55% confidence, weaker than
the 70% `adr-2026-08-12` recorded for its own cap, and the census shows why: two fresh judgements is
the entire corpus. Too tight halts converging features — "the expensive failure direction" in that
ADR's words. Mitigated by D5's flag, fail-closed validation, and a written exit condition that
re-derives the value from ten features' telemetry. **This mitigation must actually be exercised;**
a flag left dormant converts a 55% guess into permanent behaviour.

**R2 — Site collapse (Medium impact, Medium likelihood).** D2's key is coarser than finding
identity, so two materially different findings at one site read as one repeat. `adr-2026-08-16`
rejected path collapse for identity on a High-impact risk. The design's answer — that collapse on
the halting side produces a conservative human ruling rather than silent over-acceptance — is
accepted as sound, and is exactly the behaviour the operator asked for. It is nonetheless the most
likely source of a false halt, and it is the first thing to inspect if R1's signal appears.

**R3 — The bound may be inert (Medium impact, Low likelihood).** If most spins distribute across
sites rather than concentrating, no site reaches 3 before the cap fires at 6 and only D7's diagnosis
ships. This is not a failure — D7 alone delivers issue outcomes 2 and 3 — but the telemetry in D8
must be able to distinguish "never fired" from "fired correctly", which the exit condition depends
on.

**R4 — Unbounded tally growth (Low impact, Low likelihood).** D1 caps and evicts. Eviction biased
toward keeping high counts fails open (a lost tally means no halt), which is the correct direction.

## 4. Conditions

- **C1.** The FAIL block's exit set is **derived by grep at implementation time**, not from this
  document's or the ADR's enumeration, and the effective-verdict predicate is consulted **at** each
  exit rather than hoisted once — `adr-2026-08-16` D6, verbatim. The plan states seven exits on that
  ADR's authority; the implementation confirms the count against the tree it edits.
- **C2.** The new halt reuses the **exact** sequence beside it — `writeHaltMarker` with its result
  consumed and its failure logged, then `surfaceRemediationPr`, then `emitLoopHalt` — matching the
  cumulative-cap halt at `conductor.ts:7607-7617`. No bare marker write.
- **C3.** `repeatedSites` is added to `EVENT_SINKS` with an explicit render/persist/audit decision;
  it must persist, since D5's exit condition reads it back.
- **C4.** A regression test pins that a ledger entry written before this change (no `siteRepeats`)
  loads clean and yields an empty tally, mirroring `test/engine/kickback-ledger.test.ts`'s existing
  legacy-`cumulative` coverage.
- **C5.** A regression test pins that **repeated cache-hit laps do not advance the tally** — the
  falsification from §1 encoded as a test, so no future refactor reintroduces artifact counting.
  A second test pins that the halt body states only the observed repeat counts and never asserts
  that the run is spinning or cannot converge.
- **C6.** `docs/explanation/gates.md`, `docs/reference/configuration.md`, and
  `docs/runbooks/stalled-or-stuck-feature.md` are updated in the same PR. The runbook's recorded
  "Known limitation — `--report` renders neither halt nor kickback tables" is adjacent to this work
  and should be noted, not fixed here.

## 5. Out of scope, confirmed against the sweep

`test_suite` per-round history (the data does not exist); substance equivalence across re-worded
findings (#1611, spec landed, unimplemented); cross-rubric arbitration (#1630); infrastructure
budget lanes (#1629); `prd_audit` and `manual_test`, left by `adr-2026-08-12` D6 to whichever issue
produces their evidence.

**One defect surfaced and deliberately not fixed here.** `priorAttemptPointers`
(`remediation-context-pointers.ts:52`) keys #1620's same-site prior-attempt pointers on the whole
canonical anchor, including its free prose subjects. Whole-anchor equality repeated **zero** times
across every lap on disk, so those advisory pointers appear never to fire in production. That is a
defect in shipped behaviour, unrelated to this bound's correctness, and belongs in its own intake
issue rather than widening this change.
