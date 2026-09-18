# Conflict Check: build_review testQuality evidence travels by reference with a projection-size guard (#2582)

**Date:** 2026-09-18
**Stories checked:** `.docs/stories/build-review-testquality-rubric-prompt-embeds-full.md` (Stories 1-6) against every file in `.docs/stories/` and the selected ADR corpus.
**ADR corpus:** `conflict_check.adr_corpus: repo_wide` — 590 ADR/review files examined by a full first-pass term sweep; 22 read in full; 6 retained as overlapping the stories' subject (`adr-2026-08-13-engine-managed-build-review-rubric-branches`, `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`, `adr-2026-09-06-engine-owned-test-quality-scope`, `adr-2026-09-10-portable-build-review-policy`, `adr-2026-08-16-closed-build-review-finding-vocabularies`, `adr-2026-08-21-engine-identity-in-build-review-cache-key`). Narrowed out: 584 files whose subject does not touch the rubric projection, evidence pinning, the mechanical-fault lane, reduced coverage, the cache key, or the event spine. Supersession parsing: none of the six is fully superseded; `adr-2026-08-13` is partially amended (retained).
**Result:** 2 blocking conflicts found, both rooted in the same approved design amendment; 0 degrading.

## Conflict: A below-cap oversize publishes an aggregate, but an earlier story says every below-cap all-infrastructure lap publishes none

**Stories involved:** Story 5 (A deterministic oversize is charged once and routed to a human, never retried) vs one-rubric-s-rejected-contract-discards-the-whole- Story 2 (A mechanical-fault lap leaves no aggregate but loses no verdict)
**Files:** [.docs/stories/build-review-testquality-rubric-prompt-embeds-full.md] vs [.docs/stories/one-rubric-s-rejected-contract-discards-the-whole-.md]
**Type:** contradiction
**Severity:** blocking
**Story opposing sentence (existing, verbatim):** "Given a lap where every rubric is an infrastructure failure, when the lap join completes below cap, then no aggregate is written and the step result names the first failing rubric and its closed reason"
**Story opposing sentence (new, verbatim):** "Given a lap whose testQuality branch settled `projection-oversized`, when the step joins results, then it writes the aggregate carrying that infrastructure result, does not increment the mechanical-fault counter, and returns a `needs-human` halt whose text names the rubric, the measured bytes, and the bound."

**Description:** With testQuality as the only dispatched rubric, an oversize lap is "a lap where every rubric is an infrastructure failure" below cap. The existing criterion requires no aggregate; Story 5 requires one. Direction check: satisfying Story 5 breaks the existing criterion for the oversize class; satisfying the existing criterion for every class makes Story 5 unimplementable. One direction only, so a contradiction, not an oscillation. Root cause: design — the existing criterion encodes `adr-2026-08-18` D3 before its approved amendment D3.1 (2026-09-18), which carves deterministic faults out of the publish-nothing-and-re-run rule.

**Resolution Options:**
1. Narrow the existing criterion to retriable faults: "Given a lap where every rubric is a retriable infrastructure failure (any closed reason other than `projection-oversized`), when the lap join completes below cap, then no aggregate is written …". Story 5 unchanged.
2. Drop the aggregate write from Story 5 and halt from the branch artifact alone — rejected: the operator's reduced-coverage record and the effective-verdict rendering both read the aggregate (adr-2026-08-18 D6/D9); a halt with no aggregate is the undiagnosable state #2582 reports.
3. Make the oversize consume the whole allowance in one lap so the existing at-cap criterion applies — rejected: it charges three faults for one deterministic cause and misreports the allowance in the halt text.

**Recommendation:** Option 1. It is the literal consequence of the approved D3.1 and changes nothing for transient faults.

## Conflict: A deterministic fault must not re-run, but an earlier story says every below-allowance mechanical fault re-runs the review

**Stories involved:** Story 5 (A deterministic oversize is charged once and routed to a human, never retried) vs review-infrastructure-failures-are-operator-unreco Story 4 (A mechanical lap re-runs the review instead of sending the build back for rework)
**Files:** [.docs/stories/build-review-testquality-rubric-prompt-embeds-full.md] vs [.docs/stories/review-infrastructure-failures-are-operator-unreco.md]
**Type:** contradiction
**Severity:** blocking
**Story opposing sentence (existing, verbatim):** "Given a lap that ends in a mechanical fault with mechanical allowance remaining, when the lap completes, then no review outcome is published for that lap and the review runs again."
**Story opposing sentence (new, verbatim):** "Given a `projection-oversized` lap, when the conductor evaluates whether to re-dispatch build_review, then no second lap is dispatched for the same snapshot, proven by a lap counter that stays at one."

**Description:** `projection-oversized` is a mechanical fault with allowance remaining (Story 5 never consumes any), so the existing criterion requires a re-run that Story 5 forbids. Same root as the first conflict: the existing criterion predates `adr-2026-08-18` D3.1. Direction check: one direction only; contradiction.

**Resolution Options:**
1. Narrow the existing criterion to retriable faults: "Given a lap that ends in a retriable mechanical fault (any closed reason other than `projection-oversized`) with mechanical allowance remaining …". Story 5 unchanged.
2. Re-run once and halt on the second identical oversize — rejected: it spends a lap to learn what the frozen inputs already prove, which is the waste #2582 names.

**Recommendation:** Option 1, same rationale.

## Examined pairs found compatible

- Story 5 vs a-halted-feature-only-re-runs-when-a-human-clears- Story 3: the oversize halt carries class `needs-human` (adr-2026-08-18 D5), so the base-advance sweep retains it; had it been class `mechanical`, that story's last criterion would have auto-re-kicked it forever. Both hold in both directions.
- Story 3 vs testquality-admits-724-test-titles-for-eight-chang Story 7 ("frozen scope and binding evidence remain unchanged" after worktree mutation): Story 3 was tightened in place to read at the pinned refs (`git show «mergeBase»:«path»` / `git show «headSha»:«path»`), never the working tree, and to verify against `contentHash`. Both hold in both directions.
- Stories 1-2 vs testquality-admits-724 Stories 3 and 5 ("shared evidence is available once by pinned reference", "the existing reviewer reads its pinned evidence"): by-reference evidence is what those criteria describe. Compatible.
- Story 4 vs clean-rubric-judgements-rejected-as-invalid-provid Story 1 Done-When ("No member is added to the closed infrastructure-failure reason vocabulary"): that check bounds that feature's own diff, not the vocabulary permanently; `adr-2026-08-18` D2 permits closed extension and D2.1 makes it. Not a conflict.
- Story 4 vs projects-cannot-add-portable-non-competing-build-r Story 6 (package over-limit "reports the breached limit … without truncating"): same shape, different subject. Compatible.
- Story 6 vs one-rubric-s-rejected-contract-discards-the-whole- Story 1 (stale-aggregate event declared in `EVENT_SINKS`): Story 6 adds optional fields to an existing event; the exhaustiveness check accepts additive fields. Compatible.
- Stories 1-3 vs `adr-2026-08-13` §2 original sentence "The skill receives the projection, not a path through which it can read additional source-snapshot fields.": resolved by the approved amendment D2.1 on the spec branch (commit `772c6a4c1`) before these stories were written; not recorded as a conflict.

## Resolution record

Both blocking conflicts resolve by Option 1: narrow the two pre-existing criteria to retriable faults, replaced in place in their story files with no amendment record. Those files carry foreign stems, and the engineer land gate rejects story edits whose stem is not this spec's, so the two replacements ship as a companion PR based on `main` rather than on this spec branch. Until that companion merges the contradiction remains in the accepted corpus; the plan for this spec records the dependency.
