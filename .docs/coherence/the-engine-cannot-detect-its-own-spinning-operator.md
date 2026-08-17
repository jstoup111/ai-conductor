# Coherence: The engine cannot detect its own spinning

**Date:** 2026-08-17
**Tier:** M — technical track (no PRD, so the `fr` row class is omitted as not applicable)
**Plan stem:** `the-engine-cannot-detect-its-own-spinning-operator`
**Outcome source:** `.pipeline/intake-outcomes.md` (`Source-Ref: jstoup111/ai-conductor#1652`)

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2, story-3, story-6 | covered (scoped) | "The engine detects, during a build, that review/suite rounds are repeating rather than converging — at minimum: (a) the same test file or finding site failing N times across rounds, (b) finding substance recurring across laps under drifted keys, (c) kickback rate over a window — and halts needs-human with a rendered diagnosis instead of running to a cap." Sub-clause (a) is delivered in full: story-1 counts unresolved sites in durable state, story-2 fixes the key and blocks the cache-re-stamp miscount, story-3 halts needs-human before the cumulative cap is spent, story-6 makes the signal readable off the spine. Sub-clauses (b) and (c) are deliberately NOT delivered and are excluded in the stories' partial-delivery note, the ADR's Alternatives, and conflict-check Conflicts 1 and 4. (b) is jstoup111/ai-conductor#1611's territory — spec landed, unimplemented — and duplicating its identity contract here would fork a decision that ADR is mid-flight on. (c) is forbidden: `adr-2026-07-10-intra-step-build-progress-events` confines the engine's only wall-clock threshold to observability, a rate trigger is not reproducible run-to-run, and `cumulative` already answers the volume question from the state file. The scoping is stated rather than silently absorbed. |
| outcome | outcome-2 | story-4 | covered | "The halt names what repeated, so the operator rules on substance immediately rather than reconstructing it from logs." Story 4 renders site, repeat count, raising rubrics, and budget state into the new halt AND into the existing cumulative-cap halt, so the diagnosis ships on the path that fired in the filed incident even where the new bound never fires. Its negative paths forbid the body asserting any conclusion the tally did not establish. |
| outcome | outcome-3 | story-2, story-5 | covered | "A genuinely converging build (new sites each lap, findings resolving) is never interrupted by the detector." Story 2 keeps cache re-stamps and resolved findings from advancing the tally, so a converging build does not accumulate a false count; story-5's config gate, default-on with fail-closed validation, is the operator's escape when the threshold proves too tight — the mitigation the architecture review names as load-bearing given the threshold's 55% confidence. |
| adr | adr-2026-08-17-build-review-site-repetition-short-circuit | story-1, story-2, story-3, story-4, story-5, story-6 | covered | D1 (bounded per-site tally on the ledger entry, legacy tolerance, PASS reset) to story-1; D2 (typed anchor subject as the key, not `evidenceLocations`, not the whole anchor) and D3 (tick on consumption from the current lap's join, never a lap scan) to story-2; D4 (threshold 3, needs-human) and D6 (ordering after the fresh-base disposition and after the cap) to story-3; D7 (both convergence halts render what repeated) to story-4; D5 (config gate, default on, fail-closed, written exit condition) to story-5; D8 (`repeatedSites` on the existing `kickback` event, no new variant) to story-6; D9 (build_review only, and the operator override that carries D1–D6) scopes all six. |
| story | story-1 | task-2, task-3, task-7 | covered | Task 2 is RED for tally advance, field isolation, and PASS reset; task 3 adds `siteRepeats` and the bump; task 7 covers accepted findings, legacy entries, and bounded eviction. |
| story | story-2 | task-4, task-5, task-6 | covered | Task 4 is RED for the four rubric arms and prose-insensitivity; task 5 implements the pure derivation; task 6 pins that cache re-stamps never tick and that no module derives counts by enumerating lap directories. |
| story | story-3 | task-8, task-9, task-10, task-11, task-12 | covered | Task 8 is RED for the predicate; task 9 derives the FAIL block's exit set by grep at the tree, discharging review condition C1; task 10 implements the predicate; task 11 wires the exit after the cap and reuses the exact halt sequence; task 12 pins cap-precedence, the discarded stale-base lap, the all-accepted lap, and the re-kick-sweep classification. |
| story | story-4 | task-13, task-14 | covered | Task 13 is RED for both halt bodies and the empty-tally degradation; task 14 implements the bounded, evidence-only renderer discharging review condition C5. |
| story | story-5 | task-1, task-15, task-17 | covered | Task 1 records the threshold's basis and exit condition before anything depends on the number; task 15 adds the gate with fail-closed validation and proves `enabled: false` byte-identical; task 17 documents the key and its exit condition. |
| story | story-6 | task-16 | covered | Task 16 adds the additive optional field to the existing `kickback` member, an explicit persisting sink entry per review condition C3, and a reconstruction test — with no new event variant. |
| task | task-1 | story-5 | covered | `infrastructure`, `Verify-only: yes` — censuses lap provenance, records the 55% threshold basis and the ADR's exit condition before any dependent task. |
| task | task-2 | story-1 | covered | RED for tally advance, `count`/`cumulative` isolation, and PASS reset. |
| task | task-3 | story-1 | covered | GREEN: `siteRepeats` on the gate entry and its bump. |
| task | task-4 | story-2 | covered | RED for the four rubric anchor arms and prose-insensitivity. |
| task | task-5 | story-2 | covered | GREEN: pure, exhaustive `siteOf` with no I/O. |
| task | task-6 | story-2 | covered | Cache re-stamps never tick; a structural test forbids lap-directory counting. |
| task | task-7 | story-1 | covered | Accepted findings do not tick; legacy entries load clean (C4); the tally is bounded and evicts. |
| task | task-8 | story-3 | covered | RED for the short-circuit predicate at and below threshold. |
| task | task-9 | story-3 | covered | `infrastructure`, `Verify-only: yes` — the exit set is grep-derived from the tree, not from this plan (C1). |
| task | task-10 | story-3 | covered | GREEN: the predicate, pure and config-aware. |
| task | task-11 | story-3 | covered | The exit is wired after the fresh-base disposition, D2 escalation, budget consumption, and the cap; the halt reuses marker → PR surfacing → central emit (C2). |
| task | task-12 | story-3 | covered | Ordering negatives: cap precedence, discarded stale-base lap, all-accepted lap, re-kick-sweep classification. |
| task | task-13 | story-4 | covered | RED for both halt bodies and the empty-tally degradation. |
| task | task-14 | story-4 | covered | GREEN: bounded, evidence-only renderer on both halt paths (C5). |
| task | task-15 | story-5 | covered | Config gate: absent means on, `enabled: false` byte-identical, invalid threshold fails closed naming the key. |
| task | task-16 | story-6 | covered | `repeatedSites` on the existing `kickback` event, explicit persisting sink entry, reconstruction test (C3). |
| task | task-17 | story-5 | covered | Configuration reference, gates explanation, and stalled-or-stuck runbook updated in the same PR (C6). |

## Scoping statement

outcome-1 is the only row carrying a scoped verdict, and the scoping is deliberate rather than a
shortfall discovered late. The intake enumerated three signals "at minimum"; two of them were
removed during DECIDE by decisions that predate this feature, not by effort limits.

Sub-clause (c) — a kickback rate over a wall-clock window — is **forbidden**, not deferred. It is
recorded as Conflict 1 in the conflict check and as a rejected alternative in the ADR.

Sub-clause (b) — finding substance recurring under drifted keys — is owned by
jstoup111/ai-conductor#1611, whose spec is landed and unimplemented. Implementing it here would fork
the identity contract that ADR is mid-flight on, which is the failure
`adr-2026-08-13-stable-build-review-finding-dispositions` exists to prevent. It is left where it
belongs.

## Assumptions surfaced

**The threshold of 3 separates spin from convergence** — 55%, inferred. This is the weakest
load-bearing claim in the feature and it is stated as such in the ADR, the architecture review's R1,
the stories' closing note, and the plan's risks.

The basis for the low confidence is a measurement, not caution. Of the two features with persisted
`build_review` laps on disk, one carries **two** fresh rubric judgements and the other **zero** —
every other `lap-*` directory is a cache re-stamp under `adr-2026-08-13` D7. The corpus that would
calibrate a repetition threshold does not exist, and the first round of measurement in this DECIDE
produced a signal and a counter-signal that were both artifacts of counting those re-stamps.

Impact if wrong: too tight and the bound halts converging features, which `adr-2026-08-12` names as
"the expensive failure direction" and which directly contradicts outcome-3; too loose and no site
reaches 3 before the cumulative cap fires at 6, leaving only the diagnosis half shipped.

How to confirm: plan task 1 records the basis before anything depends on the number, story-5's gate
makes the value changeable without a release, and story-6's persisted `repeatedSites` telemetry is
what makes the ADR's written exit condition — re-derive from ten features that reached three or more
consumed `build_review` kickbacks — actually reachable. The operator was shown this evidence and
directed that the short-circuit ship regardless; that direction is recorded in the ADR's D9 and in
the track marker, so the accepted cost is attributable rather than implicit.

**A coarser-than-identity key is licensed on the halting side** — 85%, inferred. `adr-2026-08-16`
rejected path-level collapse for identity, where it grants blanket immunity. Here collapse causes a
conservative human-required halt instead. Impact if wrong: false halts on features that legitimately
revisit one file. How to confirm: the same telemetry, plus the stories' standing prohibition on this
key touching identity, dispositions, or any immunity decision.
