# Conflict Check: Operator restack --tip resolution always refused stale (#3582, folding #3557 and #3576)

**Date:** 2026-11-02
**New stories:** `.docs/stories/operator-restack-tip-resolution-always-refused-sta.md` (Stories 1-5)
**Result:** PASSED after resolution. 5 blocking contradictions with accepted stories were resolved by rewriting the superseded criteria in place, as the operator-approved ADR requires. 0 conflicts remain, and no degrading conflict was accepted.

## Inventory

- **Stories scanned for the subject** (halt records, restack resolution, leaf move): all 670 story files by keyword, then read: `stacked-repair-restack-conflict-above-the-repaired.md`, `restack-resolver-asks-for-an-operator-decision-no-.md`, `build-loop-cannot-complete-a-feature-child-by-chil.md`, `a-halt-leaves-no-committed-pushed-record-for-the-o.md`, `halt-records-committed-on-stacked-child-branches-m.md`, `a-change-to-one-stacked-child-cannot-be-carried-in.md`, `a-partial-stack-merge-or-mid-stack-push-halts-the-.md`, `a-published-stacked-child-changes-silently-when-a-.md`, `manual-reviewer-edits-cannot-be-landed-safely-in-t.md`, `a-routed-fix-cannot-be-built-charged-and-reviewed-.md`, `automatic-rebase-preserves-merges-carrying-unique-.md`, `halt-records-never-reach-origin-after-daemon-auto-.md`.
- **ADRs examined:** `adr-2026-08-23-committed-halt-record`, `adr-2026-10-07-per-child-build-region`, `adr-2026-10-10-stacked-restack-journaled-replay`, `adr-2026-10-25-operator-recorded-restack-conflict-resolution`, `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts`, `adr-2026-10-17-stacked-feature-publication-as-native-stack`, `adr-2026-10-24-operator-route-round-for-closed-stacked-children`, `adr-2026-10-12-routed-whole-feature-repair`, `adr-2026-11-01-routed-fix-refreshes-a-published-stack`, `adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts`.
- **ADRs narrowed out:** the remaining approved ADRs, which do not address stacked halt records, recorded resolutions, the restack resolver's tip or the leaf move.

## Conflict: A stale resolution was kept

**Stories involved:** Story 3 vs `stacked-repair-restack-conflict-above-the-repaired.md` Stories 3 and 5, and `restack-resolver-asks-for-an-operator-decision-no-.md` Story 1
**Type:** contradiction
**Severity:** blocking
**Description:** Those criteria kept the resolution and record on a stale halt, and kept them on any abort. Story 3 deletes the resolution and writes a fresh record.
**Resolution:** Rewritten in place, per the approved ADR decision 4. A resolution that still matches is still kept across an unrelated abort.

## Conflict: An orphan resolution halted

**Stories involved:** Story 3 vs `stacked-repair-restack-conflict-above-the-repaired.md` Story 3
**Type:** contradiction
**Severity:** blocking
**Description:** A resolution with no record halted `restack-resolution-stale`. Story 3 retires it and replays.
**Resolution:** Rewritten in place, per ADR decision 5.

## Conflict: Stacked records were committed on branches

**Stories involved:** Story 4 vs `build-loop-cannot-complete-a-feature-child-by-chil.md`
**Type:** contradiction
**Severity:** blocking
**Description:** Those criteria committed the record on the active child, and on the active leaf with a push.
**Resolution:** Rewritten in place, per ADR decision 1.

## Conflict: A stacked leaf's record was pushed

**Stories involved:** Story 4 vs `a-halt-leaves-no-committed-pushed-record-for-the-o.md`
**Type:** contradiction
**Severity:** blocking
**Description:** The criterion pushed every branch except a child branch, which includes a stacked leaf.
**Resolution:** Rewritten in place to scope the push to features outside the stacked-child lifecycle.

## Conflict: FR-9 and the settled tip disagreed

**Stories involved:** Story 1 vs `halt-records-committed-on-stacked-child-branches-m.md` Story 1
**Type:** overlap
**Severity:** blocking
**Description:** FR-9 reads the checkout's HEAD, while the returned tip came from another source, so a passed guard did not describe the moved tip.
**Resolution:** Story 1 makes HEAD the tip authority. No accepted criterion changes; FR-9's subject list still excludes halt-record commits.

## Pairs reasoned through and left unchanged

- **`halt-records-committed-on-stacked-child-branches-m.md` and `a-change-to-one-stacked-child-cannot-be-carried-in.md` halt-record replay rules:** in-flight stacks keep their committed records, so these rules still apply. Fully satisfying Story 4 leaves them true for older commits, and they don't constrain new writes.
- **`build-loop-cannot-complete-a-feature-child-by-chil.md` pre-region record:** a leaf before its first child still commits, as Story 4 states, and child 1 carries it.
- **`a-published-stacked-child-changes-silently-when-a-.md` halt-record leaf push refusal:** the guard is still correct on the publish path, and Story 4 means a stacked feature no longer reaches that push. No contradiction.
- **`manual-reviewer-edits-cannot-be-landed-safely-in-t.md` and `a-routed-fix-cannot-be-built-charged-and-reviewed-.md` exemptions:** they tolerate halt-record commits and require none, so they hold with or without the commits.
- **`a-partial-stack-merge-or-mid-stack-push-halts-the-.md` teardown:** it removes every feature conductor ref, which now includes the record ref.
- **No oscillation found.** Story 2's masking and Story 3's refusal partition one comparison exactly, by the single masked path, so satisfying either leaves the other true.
