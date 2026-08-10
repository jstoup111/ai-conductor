# Coherence Mapping: declared pattern replication for Nth-of-a-kind BUILD work

**Date:** 2026-08-09 · **Stem:** `build-dispatches-every-plan-task-through-a-full-ge` · **Tier:** M
· **Track:** technical

Two row classes are omitted, both correctly rather than as gaps. The `fr` class: the technical
track has no PRD and therefore no enumerated `FR-N`. The `outcome` class: this spec originated in
chat, not from a GitHub intake issue, so no outcome bullets were ever staged or committed and there
is no `.docs/intake/` marker to cite. An outcome layer that does not exist is "not required," never
a gap — so the chain here runs story → task, and the desired outcomes that motivated the work are
recorded as prose below instead of as citable ids.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-1, task-2, task-3, task-4, task-9 | covered | Header grammar and its five fail-closed branches; task-9 lands the authoring contract. Every story-1 negative path maps to a task-4 assertion. |
| story | story-2 | task-10, task-11 | covered | Spec copy plus its three fail-closed shapes (empty source set, target collision, all-passing copies). Confirmed against task-11's step 1. |
| story | story-3 | task-12, task-12b | covered | Split 2026-08-09 by operator decision. task-12 now carries the happy path and the zero-LLM requirement; task-12b carries the three negative paths (undeclared target, unreadable source, copy task with no declaration) as an explicit task, matching the convention used for stories 1, 2, and 4. The earlier bundling caveat is resolved. |
| story | story-4 | task-5, task-6, task-7, task-8 | covered | Comparison, the four distinct mismatch verdicts, the blocking contrast with the advisory floor, and the wiring. The strongest-covered story in the spec. |
| story | story-5 | task-13 | covered | Delta-only execution plus the whole-task-satisfaction tie-break and both sha negatives. Single task, but its assertions are enumerated one per criterion. |
| story | story-6 | task-14, task-16, task-17 | covered | Unmodified delta cycle (task-14), the declaration-axis invariance pin (task-16), and the harness test-ownership confirmation (task-17). |
| story | story-7 | task-15 | covered | Scoped suppression with extraction authority retained. task-15 carries all five criteria in one task; unlike story-3 this was left unsplit because the criteria are variations of a single scoping rule rather than distinct failure modes. |
| task | task-1 | story-1 | covered | Parses the Pattern-source header line. |
| task | task-2 | story-1 | covered | Inline-code and Markdown-link path forms. |
| task | task-3 | story-1 | covered | Rename-map parsed as an ordered pair list, case preserved, no `+` split. |
| task | task-4 | story-1 | covered | All six fail-closed branches, including the `absent` vs `malformed` type distinction. |
| task | task-5 | story-4 | covered | The content comparison itself — the engine's first content-comparison primitive. |
| task | task-6 | story-4 | covered | Four distinct mismatch verdicts plus the fail-closed guard. |
| task | task-7 | story-4 | covered | Pins that a mismatch fails where `runPerTaskCommitFloor` warns. Directly serves architecture-review Condition 1. |
| task | task-8 | story-4 | covered | Wires the check into `runBuildReview`, and carries the conflict-check constraint that it must not run at `acceptance_specs`. |
| task | task-9 | story-1 | covered | The plan-skill authoring contract for the new grammar. |
| task | task-10 | story-2 | covered | Copy and rename at `acceptance_specs`. |
| task | task-11 | story-2 | covered | The three fail-closed spec-copy shapes. |
| task | task-12 | story-3 | covered | The declared copy task's happy path and zero-LLM requirement. |
| task | task-12b | story-3 | covered | The three copy-task failure branches, each as its own assertion. |
| task | task-13 | story-5 | covered | Delta-only execution honoring the tie-break. |
| task | task-14 | story-6 | covered | Delta tasks run the unmodified cycle. |
| task | task-15 | story-7 | covered | Suppression scoped to declared pairs. |
| task | task-16 | story-6 | covered | Pins skip and gate sets invariant to a declaration — the declaration axis, which the existing tier-axis pins do not cover. |
| task | task-17 | story-6 | covered | Confirms the harness plan-tasks-own-their-tests rule holds for the copy task and the delta tasks. Verify-only; the citation is load-bearing because story-6 is the story that rule governs. |
| task | task-18 | story-5 | covered | Retied 2026-08-09 from story-6, where the citation was decorative. task-18 now confirms story-5's own guarantee — that a satisfied-by-closed task consumed zero test-authoring dispatches — and carries the Assumption 1 measurement (architecture-review Condition 3) in the same pass. Load-bearing against story-5. |

## Consistency pass (§4d)

Every covered row was re-read for contradiction against its counterpart, and each cross-layer pair
sharing a subject was tested in both directions. **No `fail` rows.** The pairs examined:

- **"no gate weakened" ↔ task-13/task-14.** The stated outcome against "close via satisfied-by."
  Satisfying the outcome leaves task-13 intact, because satisfied-by is an existing form the spec
  explicitly does not relax. Satisfying task-13 leaves the outcome intact under the
  whole-task-satisfaction tie-break. Two "yes" — not an oscillation.
- **"mechanically verified alignment" ↔ task-8.** The stated outcome against a check wired at
  `build_review` rather than at the task itself. These do not contradict: the check's verdict is
  blocking either way, and the outcome asks for mechanical verification, not for a particular step
  to host it. Grounded in the architecture artifact's Wiring Surface row, which places it there by
  design.
- **story-6 ↔ story-5.** Same-layer, already swept by `/conflict-check`, which found and closed the
  partition gap. Not re-reported here per the boundary rule.
- **story-7 ↔ "mechanically verified alignment".** Suppressing the duplication flag against verifying alignment. No
  contradiction: suppression is scoped to declared pairs and the equivalence check is what verifies
  alignment; the duplication review was never the verifier.

## The three motivating outcomes, and where each is delivered

These are not citable ids (see the omission note above); they are recorded so the chain's intent
survives in the artifact rather than only in the session that produced it.

- **Mechanically verified alignment with the source pattern** — delivered by story-4's blocking
  equivalence check and bounded by story-3's declared `**Files:**` set.
- **No existing BUILD gate skipped or weakened** — delivered by story-6's unmodified delta cycle
  and its declaration-axis invariance pin, and by story-5's explicit "relaxes no existing check."
- **No LLM turns spent re-deriving behavior the source already covers** — delivered by story-3's
  zero-LLM copy contract and story-5's satisfied-by closure, and confirmed by task-18 against
  `.pipeline/events.jsonl`. This replaced a timing outcome; see below.

## Deliberate descoping of the timing outcome

The idea that opened this spec was framed around wasted cycles, and the desired outcome was
originally worded as "replication-shaped work completes materially faster/cheaper than today." That
wording is **deliberately not in this spec's chain**, by operator decision on 2026-08-09. It is
recorded here rather than dropped silently.

The reason is that it was unfalsifiable as authored: no story asserted a duration or cost bound, and
no task measured one, so nothing in the spec would have failed if the feature made a build slower.
The choice was between waiving an ambition and stating a guarantee. The guarantee — no LLM turns
spent re-deriving covered behavior — is what the mechanism actually provides, is checkable against
the event ledger, and is the third outcome recorded above.

What this costs: if the feature ships and the end-to-end build is not meaningfully faster, no gate
in this spec will notice. The ADR's Assumption 1 (derivation dominates RED cost, ~70% confidence)
remains the load-bearing premise behind the speed expectation, and task-18 measures it. If it is
falsified, the documented fallback is exemplar priming rather than any further weakening of the
cycle.

## Gap summary

No gap or fail rows. Both gaps found in the first pass were resolved rather than waived: the
unmeasured timing outcome by re-scoping to the guarantee the mechanism delivers, and `task-18` by
retying it from a decorative story-6 citation to story-5, whose guarantee it actually confirms. No
`.docs/coherence-waivers/` entry is required.
