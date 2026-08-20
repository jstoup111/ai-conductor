# Coherence: Equivalent re-worded findings escape their accepted dispositions

**Date:** 2026-08-16
**Tier:** M — technical track (no PRD, so the `fr` row class is omitted as not applicable)
**Plan stem:** `equivalent-re-worded-findings-escape-their-accepte`
**Outcome source:** `.pipeline/intake-outcomes.md` (`Source-Ref: jstoup111/ai-conductor#1611`)

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-3, story-6 | covered | "A finding whose substance was accepted stays accepted across laps regardless of how the grader re-words its concernKind or anchor labels." Story 1 removes free text from the identity so re-wording cannot move an id; Story 3 keeps the closure from auto-parking builds as it arms; Story 6 stops the vocabulary drifting back apart from its four contracts. |
| outcome | outcome-2 | story-2 | covered | "Genuinely different findings at the same paths still surface (no blanket path-level immunity)." Story 2 pins per-rubric that a shared subject reference with a different classification member stays distinct and blocking, and pins the completeness collapse case explicitly. |
| outcome | outcome-3 | story-5 | covered | "When an acceptance binds, the lap output says which accepted disposition matched." Story 5 names the matched disposition in the findings output and reports a stored disposition that cannot bind instead of dropping it silently. |
| outcome | outcome-4 | story-4 | covered | "Routing-time disposition re-resolution covers every remediate outcome, halts included." Story 4 makes every exit from the daemon build_review FAIL block consult the effective verdict, with the `/remediate` refusal HALT — the filed occurrence — pinned end to end. |
| adr | adr-2026-08-16-closed-build-review-finding-vocabularies | story-1, story-2, story-3, story-4, story-5, story-6 | covered | D1 (closed classifications, verified subjects, completeness missing-surface) to story-1 and story-2; D2 (normalize before validate, ambiguity guard) to story-1; D3 (rendered schema, listed diagnosis, rerun not lap-burn, no `other` member) to story-3; D4 (contract v2, parse both, no migration machinery) to story-5; D5 (one source, binding check) to story-6; D6 (predicate at each exit, ordering and HALT distinctness preserved) to story-4; D7 (version-invalidated reported on the spine) to story-5. |
| story | story-1 | task-1, task-2, task-3, task-4, task-5 | covered | Task 1 derives the sets from the corpus before anything depends on them; 2 is RED for stability and collision; 3-5 close the vocabulary, validate at the trust boundary, and remove prose from the identity. |
| story | story-2 | task-10 | covered | The narrowness pins — same subject with a different classification member, the completeness collapse case, and a reclassified concern. |
| story | story-3 | task-7, task-8, task-9 | covered | Task 7 shows the grader its members, Task 8 names them on rejection, Task 9 makes a surviving rejection rerun without consuming budget and forbids an `other` member. |
| story | story-4 | task-11, task-12, task-13, task-14 | covered | Task 11 derives the exit set by grep, 12 is RED for the filed refusal-HALT occurrence, 13 consults one pure predicate at each exit, 14 pins ordering, HALT distinctness, and unchanged behavior for unresolved findings. |
| story | story-5 | task-6, task-15, task-16 | covered | Task 6 advances the contract while still parsing the superseded version, 15 reports a non-binding disposition on the event spine, 16 names the matched disposition in the operator-facing output. |
| story | story-6 | task-17, task-18 | covered | Task 17 enumerates the members in the four rubric contracts, Task 18 binds them to the engine source with an integrity check and updates the affected documentation. |
| task | task-1 | story-1 | covered | `infrastructure`, `Verify-only: yes` — discharges review condition 1 and the flagged assumption before any dependent task. |
| task | task-2 | story-1 | covered | RED for identity stability across re-wording and for vocabulary collision. |
| task | task-3 | story-1 | covered | GREEN: one engine vocabulary source with guarded normalization. |
| task | task-4 | story-1 | covered | GREEN: normalize-then-validate at the trust boundary. |
| task | task-5 | story-1 | covered | GREEN: prose subjects leave the identity; completeness gains a verified surface. |
| task | task-6 | story-5 | covered | Contract v2 while still parsing v1, so a stale store never reads as malformed. |
| task | task-7 | story-3 | covered | The dispatch schema renders each rubric's members. |
| task | task-8 | story-3 | covered | The rejection diagnosis lists the allowed members. |
| task | task-9 | story-3 | covered | A surviving rejection reruns; no kickback consumed, no `other` member. |
| task | task-10 | story-2 | covered | Narrowness pins per rubric. |
| task | task-11 | story-4 | covered | `infrastructure`, `Verify-only: yes` — grep-derives the exit set so none is missed by hand. |
| task | task-12 | story-4 | covered | RED for the 2026-08-15 23:40 remediate-refusal HALT. |
| task | task-13 | story-4 | covered | GREEN: one pure predicate consulted adjacent to each exit. |
| task | task-14 | story-4 | covered | Ordering, HALT classes, and unresolved-finding behavior pinned. |
| task | task-15 | story-5 | covered | The version-invalidated disposition event and its sink declaration. |
| task | task-16 | story-5 | covered | The matched disposition named in both output formats. |
| task | task-17 | story-6 | covered | The four rubric contracts enumerate their members. |
| task | task-18 | story-6 | covered | The binding integrity check plus the affected documentation. |

## Consistency pass (§4d)

Cross-layer pairs were checked in both directions. Same-layer story-vs-story pairs are
`/conflict-check`'s sweep and are reported in
`.docs/conflicts/2026-08-16-equivalent-re-worded-findings-escape-their-accepte.md`, not here.

- **outcome-1 ↔ task-5 (prose leaves the identity)** — consistent, and the pair the feature turns on.
  Removing free text from the canonical payload is what makes "stays accepted regardless of how the
  grader re-words it" true. Nothing in Task 5 works against it.
- **outcome-1 ↔ outcome-2** — the feature's central tension, and it resolves in the design rather
  than in a trade-off. Outcome 1 wants re-wordings to bind; outcome 2 wants different concerns to
  stay distinct. Both hold only because the classification member survives in the identity while the
  prose subject leaves it. Under the rejected structural-only hypothesis they would be mutually
  exclusive; under the withdrawn LLM-matcher design they would trade off probabilistically.
- **outcome-2 ↔ task-5 (completeness missing-surface)** — consistent in both directions, and this is
  the pair that caught a hole in the first draft. Without the added reference, completeness identity
  would have reduced to rubric, version, kind, and plan task, collapsing two different missing
  deliverables into one id — outcome 2 violated by the very change meant to serve outcome 1.
- **outcome-1 ↔ task-9 (rerun, not lap-burn)** — consistent, and load-bearing rather than defensive.
  A closure that auto-parks builds does not deliver outcome 1; it trades one operator intervention
  for a worse one, which is what the auto-park precedents record.
- **outcome-4 ↔ task-13 (predicate at each exit)** — consistent in both directions. Consulting the
  store adjacent to each decision is what makes "covers every remediate outcome, halts included"
  true, and it is stronger than the top-of-block hoist the operator originally selected, because the
  `/remediate` planner runs for minutes between an early read and the exits below it.
- **outcome-4 ↔ task-14 (ordering preserved)** — consistent. Task 14 constrains Task 13 rather than
  opposing it: better input at each exit, with cap-first ordering and distinct HALT reasons intact.
- **adr D3 ↔ task-9** — mutually reinforcing. D3 declines an `other` escape member and Task 9 is the
  test that proves the decline held, including the negative that no catch-all member exists.
- **adr D4 ↔ task-6** — consistent. D4's "accept both versions" is not backward compatibility for
  matching; Task 6 asserts precisely that a superseded record still parses and still does not bind.
- **adr D5 ↔ story-6** — consistent. D5 requires one source and a binding check; story-6 makes the
  absence of either a suite failure, so the self-contradicting contract that produced this defect
  cannot return.

## Assumption surfaced (per `/verify-claims`)

**`.daemon/evals-raw` is representative of production grader output** — 80%, inferred. It carries 337
`concernKind` uses across at least five features, collected off real builds rather than fixtures, and
the filed drift is directly visible in it. But it skews recent, and tautology and rootCause each show
roughly 21 distinct values over only about 23 and 29 uses — thin evidence that a closed set covers
them.

Impact if wrong: a set too narrow sends graders down Story 3's rerun path routinely, converting a
correctness fix into a throughput problem on the daemon's critical path — the exact failure
`adr-2026-07-07-task-trailer-id-alias` and `adr-2026-07-21-no-diff-task-evidence-stamp` record. That
is a genuine design fork, so plan Task 1 discharges it before any dependent task and is instructed to
halt for the operator rather than widen a set until it no longer discriminates. How to confirm:
derive each set against the full corpus and assert coverage in a test, which is review condition 1.
