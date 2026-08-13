# Conflict Check: Rebase-invalidated test failures never reach build_review as repair context

**Date:** 2026-08-13
**Feature:** intake jstoup111/ai-conductor#1535
**Stories checked:** `.docs/stories/rebase-invalidated-test-failures-never-reach-build.md`
(Stories 1–8), pairwise in both directions, plus every other file in `.docs/stories/`.
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml:81-82`)
**Result:** 0 blocking · 3 degrading (1 resolved by amendment, 1 accepted, 1 needs an operator
decision)

---

## ADR corpus: examined and narrowed out

270 ADRs in `.docs/decisions/`. Narrowed by subject overlap with these stories — base-advance
handling, gate invalidation, `build_review` inputs and rubric exceptions, event-spine persistence,
path classification, and repair/attribution ledgers.

**Examined (12, all APPROVED):**

| ADR filename stem | Why it overlaps |
|---|---|
| `adr-2026-07-20-post-rebase-delta-aware-invalidation` | Owns `changedCodePaths` and the per-gate invalidation rule |
| `adr-2026-07-23-build-review-fresh-base-disposition` | Owns base freshness and FAIL disposition; introduced the rebase-repair exception |
| `adr-2026-08-12-removal-anchored-tautology-exemption` | Sibling evidence block; names `repairContext` in its precedent table |
| `adr-2026-08-12-cumulative-build-review-convergence-bound` | The in-flight bound on the same gate |
| `adr-2026-07-07-build-review-judgement-gate` | The rubric being fed |
| `adr-2026-08-11-wiring-judged-in-build-review` | Rubric item count |
| `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` | Event-spine precedent for this class of decision |
| `adr-2026-07-07-audit-trail-event-sink` | Sink policy and the `.pipeline/events.jsonl` writer |
| `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify` | Post-rebase gate handling |
| `adr-2026-07-12-rebase-evidence-stamp-translation` | Rebase-time side effects |
| `adr-2026-08-12-fail-closed-intake-ledger-durability` | Precedent for corrupt/legacy ledger reads (Story 8) |
| `adr-2026-08-09-recorded-red-exception-for-remediation` | Governing principle: an exception is valid only when recorded, attributable, observable |

**Narrowed out as fully superseded (2):** `adr-013-daemon-main-advance-rekick` (`Status:`
SUPERSEDED), `adr-001-rebase-insertion-mechanism` (superseded by
`adr-2026-07-26-rebase-tail-current-branch-before-publication`). Neither carries a partial or
ambiguous supersession, so both are excluded per the `repo_wide` rule.

**Narrowed out as non-overlapping:** the remaining 256, covering provider selection and auth,
memory subsystem, release and changelog mechanics, intake and engineer-loop routing, cost and
timing rollups, and dashboard/UI concerns. None addresses base-advance handling, the
`build_review` input set, path classification, or the repair ledger.

---

## Conflict 1: An accepted ADR's context assertion is falsified by the classifier inversion

**Stories involved:** Story 3 (Harness source in markdown is classified as source) vs
`adr-2026-07-20-post-rebase-delta-aware-invalidation`
**Files:** `.docs/stories/rebase-invalidated-test-failures-never-reach-build.md` vs
`.docs/decisions/adr-2026-07-20-post-rebase-delta-aware-invalidation.md`
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** `adr-2026-07-20-post-rebase-delta-aware-invalidation`
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "Because the feature's own commits appear in *both* trees,
this tree-to-tree diff already captures **main-side changes + conflict resolutions**, and
`isCodeOrTestPath` (`rebase.ts:164`) already excludes `.docs/`, `CHANGELOG.md`, and markdown."
**Story opposing sentence (verbatim):** "Given a changed path under `agents/` ending in `.md`, when
it is classified, then it is treated as code/test."

**Description:**
The ADR asserts that `isCodeOrTestPath` excludes markdown. Story 3 requires that most markdown be
included. Both cannot describe the same predicate.

The assertion sits in the ADR's `## Context` section (lines 18–33), under the heading "Verified
mechanism (how the judged tail re-runs today)" — it is a **description of then-current behavior**,
not a decision clause. The ADR's `## Decision` (lines 76–110) contains no rule about markdown or
about which paths count as code/test; it governs how a *classified* delta maps to per-gate
preserve-or-rerun.

**This is therefore an accepted-artifact amendment, not a design conflict.** Confidence 95%,
basis: verified by reading both sections in full.

Moreover the ADR's binding invariant runs the *same* direction as Story 3:

> "each gate's declared surface MUST be a conservative **superset** of every code/test input whose
> change could flip that gate's verdict. Under-declaration is a correctness bug (a stale verdict
> confirmed against a changed tree); when in doubt, widen the surface toward re-run."

Excluding `agents/*.md` and `skills/**/SKILL.md` while 47 test files read them is precisely the
under-declaration that invariant names as a correctness bug. Story 3 widens toward re-run, as the
invariant instructs.

**Resolution Options:**
1. Amend the ADR's context assertion additively, leaving the original text in place.
2. Supersede `adr-2026-07-20` with a new ADR restating its decision plus the new classification.
3. Narrow Story 3 to preserve the ADR's description.

**Recommendation:** Option 1. The falsified text is descriptive context, not a decision, and the
ADR's own binding invariant endorses the change. Superseding a decision that is not changing would
misrepresent the record; narrowing Story 3 would reinstate the correctness bug.

**RESOLVED:** Option 1 applied — amendment note added beside the original assertion in
`adr-2026-07-20-post-rebase-delta-aware-invalidation.md`. Original text preserved.

---

## Conflict 2: A documentation-only base advance remains unattributable

**Stories involved:** Story 3 (negative path: docs-only advance stays a no-op) vs Story 4 /
Story 1 (a base-advance-caused failure is attributed)
**Files:** both in `.docs/stories/rebase-invalidated-test-failures-never-reach-build.md`
**Type:** state-conflict
**Severity:** degrading
**Story ID:** Story 3 vs Story 4

**Description:**
Story 3's negative path requires that a base advance touching only excluded documentation paths
stays a no-op:

> "Given a base advance whose only changed paths are under `.docs/` and `docs/`, when the rebase
> outcome is classified, then it remains a no-op and invalidates no gate."

The base-advance record is emitted only on a file-changing outcome (`rebase.ts:1296`, reached from
the `changed` case). So on a documentation-only advance **no record exists**, and Story 4's join
has nothing to match — even though the rebase really happened and the files really are gone from
the working tree.

This is not hypothetical. `docs/_config.yml` and `docs/index.md` are asserted on by
`test/check_docs_navigation.sh`, and `docs/_config.yml` is one of the three tracked non-markdown
files excluded *only* by the `docs/` directory rule — so it stays excluded under both the old and
the new classifier. A base advance deleting it breaks that check on any branch, the build must
repair it, and the repair is graded with no attribution available. That is the same failure shape
as intake #1535, one class narrower.

**Both directions tested.** Fully satisfying Story 3 (docs-only stays a no-op) leaves Story 4
unable to attribute that case. Fully satisfying Story 4 for that case requires a record on an
outcome Story 3 defines as a no-op. Two "no" answers — this is an **oscillation in the small**,
bounded to documentation-only advances. It does not oscillate the build loop, because the
unattributed case simply grades as it does today; it is a permanent narrow gap rather than a
non-terminating cycle.

**Resolution Options:**
1. Accept the gap. Record it explicitly as out of scope: documentation-only base advances remain
   unattributable, and the affected repair is graded as it is today.
2. Separate the two concerns: emit the base-advance record whenever the base actually advanced
   (including a documentation-only advance) while leaving *gate invalidation* driven by the
   filtered delta exactly as Story 3 requires. Story 3's no-op assertion is about invalidation, so
   it survives unchanged; only the record's emission condition widens.
3. Remove `docs/` from the exclusion list so documentation changes invalidate gates.

**Recommendation:** Option 2. It closes the gap without weakening any exclusion and without
changing which gates invalidate — the record becomes "the base moved, here is everything it
touched", which is what Story 2 already asks it to be, and gate invalidation stays exactly as
`adr-2026-07-20` specifies. Option 3 is the regression this spec's ADR explicitly rejected.
Option 1 leaves a known reachable gap in a spec whose entire purpose is closing this failure mode.

**RESOLVED:** Option 2 applied, operator-confirmed 2026-08-13.

Corrections made while resolving, both from verification rather than assumption:
`test/test_docs_navigation.sh` is not purely fixture-driven — lines 179-249 assert against the real
`$REPO_ROOT/docs/` tree, so a main-side docs move genuinely can break it on a branch. And this
repository's gating `maintain-documentation` custom step makes `docs/` changes routine on main
rather than rare, so the exposure is larger than first estimated, not smaller.

Applied: `adr-2026-08-13-durable-base-advance-attribution` D1 gains an explicit emission condition;
Story 1 gains a happy-path criterion and a Done-When for the documentation-only case; Story 3's
no-op assertion is retained verbatim and annotated to record that invalidation and recording are
separate conditions. Gate invalidation is unchanged in every case, so `adr-2026-07-20` needs no
further amendment.

---

## Conflict 3: Two unshipped specs edit the same grader-input render site

**Stories involved:** Story 7 (Repair records are evidence, not an exemption) vs the in-flight
spec `repeated-build-review-semantic-failures-can-churn-`
**Files:** `.docs/stories/rebase-invalidated-test-failures-never-reach-build.md` vs
`.docs/plans/repeated-build-review-semantic-failures-can-churn-.md`
**Type:** resource-contention
**Severity:** degrading
**Story ID:** Story 7

**Description:**
Both specs are unshipped and both add an evidence block to `BuildReviewInputs` and its prompt
renderer. That spec adds `removalContext` as a fourth block beside `repairContext`,
`acceptedWidenings`, and `gateInstructions`; this spec changes what feeds `repairContext` and adds
grading provenance. The files collide; the semantics do not — one narrows the Tautology rubric with
removal evidence, the other repairs the attribution channel behind an existing block.

**Already mitigated in the story text.** Story 7's negative path and Done-When forbid any assertion
that depends on the total number of evidence blocks:

> "Given repair records exist and other engine-computed evidence blocks are also present, when the
> inputs are assembled, then each block renders independently and no assertion depends on how many
> evidence blocks exist in total."

That neighbour's own plan imposes the mirror-image constraint on itself ("no task may assert how
many rubric items exist"), so both sides are already written to land in either order.

**No oscillation.** Fully satisfying this spec (a recognized repair lets `build_review` PASS)
leaves the neighbour's cumulative bound intact — a PASS clears the cumulative counter, so the bound
simply never fires. Fully satisfying the neighbour (halt after five cumulative laps) leaves this
spec intact — fewer laps are needed, so the bound is less likely to engage. Each makes the other
*less* likely to trigger. Complementary, tested in both directions.

**Resolution Options:**
1. Accept; rely on the block-count-agnostic constraints both specs already carry.
2. Sequence explicitly, blocking one spec on the other's merge.
3. Merge the two specs.

**Recommendation:** Option 1. The constraint is already written into both artifacts, and the merge
order genuinely does not matter.

**ACCEPTED** — degrading, mitigated, no change required.

---

## Examined and found clean

| Pair | Both directions tested | Finding |
|---|---|---|
| Story 1 ↔ Story 5 | Yes | Story 1 makes records durable; Story 5 makes them plural. A durable record set and a multi-record set are the same object. No contention. |
| Story 2 ↔ Story 3 | Yes | Story 2 carries the unfiltered delta; Story 3 changes the filtered one. Explicitly disjoint — Story 2 requires the filtered set stay byte-identical. Belt and braces, by operator decision. |
| Story 4 ↔ Story 7 | Yes | Story 4 creates records only on real overlap; Story 7 keeps records non-exempting. Both restrict; neither relaxes. Mutually reinforcing for O4. |
| Story 5 ↔ Story 8 | Yes | Story 5 writes the new ledger shape; Story 8 reads the old one as empty. Story 8's "no fabricated record" criterion prevents Story 5's plurality from inventing history on upgrade. |
| Story 6 ↔ Story 1 | Yes | Provenance rides the same spine the records ride. Story 6's write-failure negative path keeps grading independent of it. |
| Stories 1–8 ↔ `adr-2026-07-23-build-review-fresh-base-disposition` | Yes | That ADR owns base *freshness* and FAIL *disposition*; this spec owns the attribution *carrier*. Disjoint concerns on the same gate; its regrade counter is untouched. |
| Story 7 ↔ `adr-2026-08-12-removal-anchored-tautology-exemption` | Yes | Its D5 table lists `repairContext`'s evidence source as "engine-recorded aggregate failures". This spec broadens that source to any gate. Descriptive refinement of a table, not a decision reversal — its D1–D4 are untouched. Noted, no amendment required. |
| Stories 1, 6 ↔ `adr-2026-07-07-audit-trail-event-sink` | Yes | That ADR deliberately keeps `.pipeline/audit-trail/events.jsonl` separate from `.pipeline/events.jsonl`. This spec writes only to the latter and adds no third sink. Consistent with its stated separation. |
| Story 8 ↔ `adr-2026-08-12-fail-closed-intake-ledger-durability` | Yes | That ADR requires a corrupt *intake* ledger to fail closed rather than read as empty. Story 8 requires a legacy *repair* ledger to read as empty. Different stores, and the asymmetry is principled: an unparseable intake ledger risks losing queued work, whereas an absent repair record only forgoes an exception and grades as today. No contradiction. |
| Story 1 ↔ Story 4 | Yes | Added 2026-08-13 on operator challenge. They share the event log. Satisfying Story 1 fully (every advance recorded, including documentation-only) leaves Story 4 intact — extra recorded advances enlarge the join's candidate set but every match still requires path overlap, so they cannot manufacture an attribution. Satisfying Story 4 fully leaves Story 1 intact — it governs recording, not matching. Noted: the C2 resolution does widen the candidate set, and 129 test files reference `.docs/` paths, so a failure naming a `.docs/` path can now legitimately join a documentation-only advance. Correct behavior, but it makes task-12's overlap precision load-bearing in a way it was not before C2. |
| Story 5 ↔ Story 7 | Yes | Added 2026-08-13 on operator challenge. They share the grader's evidence block. Satisfying Story 5 fully (several records accrue per advance) leaves Story 7 implementable, but a larger block gives the grader more entries a hunk might loosely match — the per-diff-versus-per-test failure shape `adr-2026-08-12-removal-anchored-tautology-exemption` D3 warns about. One "no" at most, so pressure rather than oscillation, and Story 7's "a deletion not covered by a repair record is still gradeable" criterion is the guard. Satisfying Story 7 fully leaves Story 5 unaffected. |
| All stories ↔ existing `.docs/stories/*.md` | Yes | No other stories file addresses base-advance attribution, the repair ledger, or path classification. `.docs/stories/repeated-build-review-semantic-failures-can-churn-.md` is the nearest neighbour and is covered as Conflict 3. |

---

## Conflict 4: The plan's own task set could oscillate between the lock and the classifier

**Stories involved:** Story 2 (gate invalidation unchanged) vs Story 3 (classifier inverted)
**Files:** `.docs/plans/rebase-invalidated-test-failures-never-reach-build.md`
**Type:** oscillating
**Severity:** blocking (resolved before any BUILD entry)
**Story ID:** Story 2 vs Story 3

**Description:**
Found 2026-08-13 on operator challenge, by running the both-directions heuristic over the *plan's
task set* rather than only over the stories. The stories themselves do not conflict — Story 2's
"gate invalidation byte-identical" is scoped to the delta-field split, and Story 3's reclassification
is a different cause. The plan lost that distinction.

Task 3 as originally written locked "for a delta mixing source, test and **excluded** paths,
`classifyGateInvalidation` returns exactly the gate set it returns before this change." Under the
pre-Task-9 classifier the excluded set includes `agents/*.md`. Task 9 moves exactly those paths to
source, so a Task 3 fixture built on one would see the gate set change.

Task 3 depended on Task 2 and Task 9 on nothing, so they sat on independent chains and could land in
either order or concurrently. Both directions: implementing Task 3 first with a markdown fixture is
broken by Task 9; implementing Task 9 first makes Task 3 unwritable as worded. The natural repair —
relaxing Task 3's assertion — silently discards the guarantee Story 2 exists to provide, and nothing
downstream would notice, because the lock would still be green.

**Resolution Options:**
1. Order Task 3 after Task 9 and pin its fixture to paths stable across both classifiers.
2. Merge Tasks 3 and 9 so one task owns both the change and its lock.
3. Drop Task 3's lock and rely on the wider suite.

**Recommendation:** Option 1. It removes the interaction without enlarging either task, and keeps
the lock isolated to its one intended variable.

**RESOLVED:** Option 1 applied. Task 3 now depends on Task 2 and Task 9, its step 1 names the
forbidden fixture paths explicitly, and the dependency graph carries the anti-oscillation edge with
its rationale. Tasks 5 and 10 were already immune — both use `.docs/`/`docs/`, excluded under either
classifier.

**Method note.** This was missed on the first pass because the oscillation sweep ran over stories
and over cross-layer outcome/story/ADR pairs, but not over task-versus-task pairs within the plan.
Two tasks that each invalidate the other's fixture is the same failure shape at a layer the sweep
did not cover.

---

## Recurring patterns

Reviewed prior reports in `.docs/conflicts/`. The pattern this feature repeats is the one recorded
for `harden-intake-ledger-durability`: a durable fact stored on a carrier that a routine operation
rewrites. There, a corrupt ledger read as empty and the next write persisted the wipe; here, a
gate-verdict rewrite erases the base-advance attribution. Both resolve by making the durable fact's
carrier match the fact's lifetime. Worth noting as a design smell to check for early rather than as
an unresolved conflict.
