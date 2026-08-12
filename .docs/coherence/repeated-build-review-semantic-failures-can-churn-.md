# Coherence Mapping: bounded build_review convergence and removal-anchored Tautology grading

**Issue:** #1521
**Tier:** M — this step is required.
**Track:** technical. There is no PRD, so the `fr` row class is omitted entirely rather than
given placeholder verdicts. No intake outcomes were staged or committed at authoring time — there
is no `.pipeline/` staged outcomes file and no `.docs/intake/` marker — so the `outcome` row class
is likewise omitted, which §4a defines as "not required," never a gap. Outcome traceability is
recorded in prose below instead. The `adr`, `story`, and `task` row classes apply.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| adr | adr-2026-08-12-cumulative-build-review-convergence-bound | story-1, story-2, story-3, story-4, story-5 | covered | Its six decisions map one-to-one onto these stories: D1→story-1, D2→story-2, D3→story-3, D4→story-4, D5→story-5. D6 (scope limited to `build_review`) is honored throughout — no story extends the bound to another gate. |
| adr | adr-2026-08-12-removal-anchored-tautology-exemption | story-6, story-7 | covered | D1→story-6 (three removal kinds derived deterministically). D2, D3, D4→story-7 (fourth evidence block, per-test predicate, untouched new-behavior tests). D5 is the structural precedent and constrains rather than adds behavior; story-7's Done-When encodes it as the closed-list requirement. |
| story | story-1 | task-1, task-2, task-3, task-4, task-5 | covered | Field and guard (1–3), tree-proof increment (4), eight-lap regression (5). |
| story | story-2 | task-6, task-7, task-8 | covered | Reset function (6), PASS-path wiring (7), missing/unreadable-ledger tolerance (8). |
| story | story-3 | task-9, task-10, task-11, task-12 | covered | Cap and exhaustion signal (9), the halt (10), its reason and class (11), single-halt-when-both-exhaust (12). |
| story | story-4 | task-13, task-14 | covered | Config block (13), halt-only gating that leaves counter and event live (14). |
| story | story-5 | task-15, task-16, task-17 | covered | Event field (15), population at the emit site (16), readable-history regression (17). |
| story | story-6 | task-18, task-19, task-20 | covered | Files and declarations (18), removed type members (19), fail-safe guards (20). |
| story | story-7 | task-21, task-22, task-23, task-24, task-25 | covered | Input field and derivation call (21), block rendering (22), narrowed predicate (23), closed-list exceptions (24), untouched-rubric and input-isolation invariance (25). |
| task | task-1 | story-1 | covered | Declares the cumulative field and extends the type guard. |
| task | task-2 | story-1 | covered | Legacy entry without the key reads as zero — story-1's compatibility negative path. |
| task | task-3 | story-1 | covered | Malformed value rejected — story-1's malformed-field negative path. |
| task | task-4 | story-1 | covered | Increment outside the `madeProgress` branch — story-1's core happy path. |
| task | task-5 | story-1 | covered | Eight-lap regression plus the cross-gate isolation assertion. |
| task | task-6 | story-2 | covered | Per-gate reset that preserves `count`. |
| task | task-7 | story-2 | covered | Wires the reset to the `build_review` PASS path; asserts FAIL does not reset. |
| task | task-8 | story-2 | covered | Missing/unreadable-ledger tolerance — story-2's negative paths. |
| task | task-9 | story-3 | covered | Cap constant and a cumulative-exhaustion flag distinct from the existing one. |
| task | task-10 | story-3 | covered | The `needs-human` halt at six laps, none at five. |
| task | task-11 | story-3 | covered | Reason names gate, count, cap, last reason; class sidecar and `loop_halt` asserted. |
| task | task-12 | story-3 | covered | Exactly one halt when both bounds exhaust; other gates byte-for-byte unchanged. |
| task | task-13 | story-4 | covered | Config interface with absent-resolves-to-enabled semantics. |
| task | task-14 | story-4 | covered | Gates the halt only; counter and event stay live when disabled. |
| task | task-15 | story-5 | covered | Optional `cumulativeCount` on the `kickback` union member. |
| task | task-16 | story-5 | covered | Populated at the existing emit site from the bump result. |
| task | task-17 | story-5 | covered | Eight-lap readable-history regression and the omitted-field schema check. |
| task | task-18 | story-6 | covered | Deleted files and deleted exported declarations. |
| task | task-19 | story-6 | covered | Removed members of exported types — the case the incident depended on. |
| task | task-20 | story-6 | covered | Rename, comment/string, unparseable-declaration and no-subprocess guards. |
| task | task-21 | story-7 | covered | `removalContext` on the inputs, derived during assembly. |
| task | task-22 | story-7 | covered | Block rendered with populated and `(none)` forms and escaping. |
| task | task-23 | story-7 | covered | Three-condition predicate plus the explicit per-test-not-per-diff statement. |
| task | task-24 | story-7 | covered | Closed list of the two Tautology exceptions with its closing statement. |
| task | task-25 | story-7 | covered | Item-count-agnostic invariance of the other rubric items, plus input isolation and provider neutrality. |

## Outcome traceability (prose — the row class is omitted, see above)

The four desired outcomes stated in issue #1521 and restated at the top of the stories file map to
stories as follows. Each was confirmed against the stories file rather than inferred.

- **O1** — bounded, operator-visible terminal state despite tree movement → stories 1, 3, 4.
  story-1 makes the counter immune to tree change, story-3 turns it into a `needs-human` halt naming
  gate, count, cap and reason, story-4 governs the default-on switch.
- **O2** — fixture maintenance stays support work while new-behavior tests stay mutation-sensitive
  → stories 6, 7. story-6 derives the removal facts, story-7 applies the three-condition per-test
  predicate and preserves full strictness for tests claiming new behavior.
- **O3** — a remediation that actually clears the finding proceeds → stories 2, 3. story-2 resets
  the counter on PASS; story-3's negative path requires no halt at lap 5 and none at all when a
  remediation clears the finding.
- **O4** — cumulative history and terminal reason observable → stories 3, 5. story-5 puts
  `cumulativeCount` on the `kickback` event and reproduces the eight-lap history; story-3 requires
  the `loop_halt` reason to name the terminal cause.

Every outcome has at least two covering stories, and every story serves at least one outcome.

## Consistency pass (§4d)

Every covered row above was re-read for contradiction, not only coverage. Cross-layer pairs
sharing a subject were tested in both directions, since same-layer pairs belong to
`/conflict-check` and were swept there.

**O1 versus story-4 — examined closely, verdict `covered`, not `fail`.** This is the pair
most likely to be an oscillation and it deserves its reasoning on the record. O1 demands a
bounded terminal state; story-4 gives an operator a switch that removes the bound. Applied naively,
the two-direction heuristic returns two "no" answers, which is the oscillation signature. It is not
one. The heuristic detects requirements that must hold *simultaneously* and cannot; these two hold
under disjoint configuration states. The block is absent by default and absent resolves to enabled,
so the shipped default satisfies O1 unconditionally, and the only way to reach the unbounded
state is a deliberate, recorded operator override of a documented guard. A default-on guarantee plus
an explicit opt-out is a conditional, not a contradiction. Confidence 90%, basis: verified against
`adr-2026-08-12-cumulative-build-review-convergence-bound` D4 and story-4's happy path, which
asserts the absent-block-resolves-to-enabled behavior directly.

**O3 versus story-3 — no contradiction.** Fully satisfying story-3's cap halt leaves
O3 intact: laps 1 through 5 still run normally, and a remediation that clears the finding
produces a PASS, which story-2 makes reset the counter. Fully satisfying O3 leaves story-3
intact, because the cap only engages past lap 5. One "yes" in each direction.

**adr-2026-08-12-removal-anchored-tautology-exemption versus story-7 — no contradiction, and the
risk direction is guarded.** The ADR's D3 requires a per-test predicate; story-7's negative paths
require the prompt to state explicitly that a diff which deletes something does not exempt every
test it touches. The story does not weaken what the ADR decided; it encodes the ADR's own stated
guard as a testable assertion.

**No `fail` rows.** No counterpart was found that exists and opposes what it implements.

## Note on the ADR row class

Two non-deleted `.docs/decisions/adr-*.md` files are in this change set, so the class carries two
rows keyed by filename stem. `architecture-review-2026-08-12-repeated-build-review-semantic-failures-can-churn.md`
is not an `adr-*` file and correctly produces no row. The per-decision ids used inside the stories
file (CB-D1..CB-D6, RT-D1..RT-D5) are traceability aids within that artifact; the row ids here are
the filename-stem forms the land-time validator and the waiver vocabulary parse.

## Gaps

None. No row carries a `gap` or `fail` verdict, so there is no gap id for a
`.docs/coherence-waivers/` waiver to cite.
