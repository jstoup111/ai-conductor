# Coherence Mapping: Non-blocking plan-scope containment recorder

**Date:** 2026-08-09
**Plan stem:** `out-of-plan-production-edits-reach-build-review-in`
**Tier:** M
**Track:** Technical — the `fr` row class is omitted (no PRD; acceptance criteria live in the
stories, which cite ADR sub-decisions in place of `FR-N`).
**Source-Ref:** `jstoup111/ai-conductor#1390` — the `outcome` row class is required.

Outcome ids are the five bullets of intake #1390's **Desired outcome** list, in order.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-3 | fail | CONTRADICTS: the bullet requires a commit outside its task's declared scope "does not land — the commit is refused at the moment it is written". Counterpart story-3 asserts the opposite ("The containment check never blocks a commit" / "the commit **lands**"). Coverage exists, consistency does not. Deliberate operator departure recorded in adr-2026-08-09-non-blocking-plan-scope-containment, the stories scope note, and the architecture doc. Waived at .docs/coherence-waivers/out-of-plan-production-edits-reach-build-review-in.md. Gap id: outcome-1 |
| outcome | outcome-2 | story-3 | covered | "The refusal names the offending path(s) and the task whose scope they escaped." story-3 requires stderr to name the task id, each offending path, and the exact Scope line. The naming requirement survives the departure intact; only the refusal it was attached to is withdrawn. Confirmed against the stories file |
| outcome | outcome-3 | story-2, story-3 | covered | "A build that legitimately needs an out-of-plan path has an in-band route that succeeds without operator intervention, and the resulting diff passes build_review scope." story-2 guarantees every out-of-floor path carries a rationale (trailer verbatim, else derived), so the route needs no operator and cannot produce the unexplained widening that caused the four kickbacks. story-3's advisory hands the agent the exact trailer to author. Confirmed against both stories |
| outcome | outcome-4 | story-4, story-5 | covered | "A containment check that cannot reach a verdict does not silently permit the commit — the ambiguity is visible in the build record." Satisfied as written: the commit is permitted, but not silently. story-4 splits exit 3 from the not-applicable cases and records a ConductorEvent; story-5 puts it on a single-writer sibling ledger read back into .pipeline/containment-floor.json. Confirmed against both stories and task-12 |
| outcome | outcome-5 | story-1, story-3 | covered | "A commit fully inside its task's declared scope is unaffected — no new friction on the common path." story-1 widens the floor so adjacent files stop registering; story-3's in-floor criterion requires exit 0 with no stderr. No blocking surface is added anywhere. Confirmed against both stories |
| story | story-1 | task-1, task-2, task-3, task-4 | covered | Three floor additions each with their own RED test, plus task-4 pinning the discrimination boundary so widening cannot swallow an unrelated path. Confirmed against the plan's Story lines |
| story | story-2 | task-5, task-6, task-13 | covered | task-5 authored-trailer path, task-6 derived fallback with never-empty and bounding negatives, task-13 renders the derived distinction into the grader prompt. Confirmed against the plan |
| story | story-3 | task-8, task-9, task-15 | covered | task-8 reworded advisory and no exit 2, task-9 the real-commit integration proof against the regenerated hook, task-15 removes the stale enforcement-flip comments that would license the behavior back. Confirmed against the plan |
| story | story-4 | task-7, task-10 | covered | task-7 splits the exit codes per condition; task-10 adds the ConductorEvent variant carrying classification, task id, and ts. Confirmed against the plan |
| story | story-5 | task-11, task-12 | covered | task-11 the best-effort JSON.stringify-encoded appender that cannot throw into the hook; task-12 the tolerant read into the build record. Confirmed against the plan |
| story | story-6 | task-14 | covered | Single task, appropriate: the consumer default is asserted unchanged and this repository's config.yml opts in. Confirmed against the plan |
| task | task-1 | story-1 | covered | happy-path — test siblings |
| task | task-2 | story-1 | covered | happy-path — same-directory neighbors |
| task | task-3 | story-1 | covered | happy-path — docs/generated allowlist |
| task | task-4 | story-1 | covered | negative-path — discrimination boundary; also relocates the #1074 fixture per conflict-report CF-1 |
| task | task-5 | story-2 | covered | happy-path — authored trailer recorded verbatim |
| task | task-6 | story-2 | covered | negative-path — derived fallback, never empty, bounded |
| task | task-7 | story-4 | covered | happy-path — exit-code split |
| task | task-8 | story-3 | covered | happy-path — advisory, never a refusal |
| task | task-9 | story-3 | covered | integration — real git commit against the regenerated hook |
| task | task-10 | story-4 | covered | infrastructure — the ConductorEvent variant. Supporting purpose: story-4 cannot record anything without a union member to record |
| task | task-11 | story-5 | covered | happy-path — the appender |
| task | task-12 | story-5 | covered | integration — tolerant read into .pipeline/containment-floor.json |
| task | task-13 | story-2 | covered | happy-path — derived rendered in the grader prompt |
| task | task-14 | story-6 | covered | negative-path — default resolution and this repository's opt-in |
| task | task-15 | story-3 | covered | refactor — supporting purpose: the stale "flip this single value" comments contradict an APPROVED ADR, and conflict-report CF-2 identified comment drift as the vector that would reintroduce the refusal story-3 forbids |

## Consistency pass (§4d)

Every covered row was re-read for contradiction and for cross-layer oscillation. Same-layer
story-vs-story conflicts are `/conflict-check`'s sweep and are recorded in
`.docs/conflicts/2026-08-09-out-of-plan-production-edits-reach-build-review-in.md`; they are not
re-reported here.

**One contradiction found: outcome-1 against story-3.** Both directions fail — satisfy story-3
fully and outcome-1 cannot hold; satisfy outcome-1 fully and story-3 cannot hold. Recorded as
`fail` above and waived, because the resolution is an approved change to what is being asked for
rather than a defect in how it is built.

**Cross-layer pairs checked and clean:**

- **outcome-3 against task-6.** The outcome requires the in-band route to succeed "without operator
  intervention". task-6's derived-rationale fallback is what makes this hold — with a trailer-only
  design, a build that forgot the trailer would need a human. Mutually reinforcing, not opposed.
- **outcome-4 against task-11.** The outcome requires ambiguity be visible; task-11 makes the
  ledger write best-effort and swallow failures, which can lose a record. Checked in both
  directions and judged consistent: the alternative — throwing into the hook — would fail a commit,
  contradicting outcome-5 and adr-2026-08-09-non-blocking-plan-scope-containment D3. The residual
  loss is bounded to telemetry and recorded as an accepted consequence in
  adr-2026-08-09-hook-owned-containment-event-ledger E3. Not a contradiction; a stated trade.
- **outcome-5 against task-2.** The outcome requires no new friction on the common path; task-2's
  same-directory rule removes friction rather than adding it. Its known cost is reduced containment
  strength in flat directories (risk R3), which weakens outcome-1 — already waived — and does not
  touch outcome-5.
- **story-6 against story-1.** story-6 gates recording on `scopeContainmentEnforced`; story-1
  requires the widened floor to apply unconditionally. Checked for oscillation: satisfying either
  leaves the other intact, because the flag gates recording and advisory output, never the floor
  predicate. story-6's third happy-path criterion and story-1's fourth Done-When item both pin this
  explicitly, so the boundary is asserted rather than assumed.

## Assumptions surfaced

None outstanding. The two load-bearing integration questions — whether
`feat/daemon-pipeline-commits-files-outside-the-active-plan-bef` carried live contention, and
whether `.pipeline/pipeline-events.jsonl` was available to build on — were resolved against
evidence during architecture review (PR #1349 merged; PR #1395 open in needs-remediation) rather
than assumed, and are recorded in that review's Risk Register as R1 and R2.
