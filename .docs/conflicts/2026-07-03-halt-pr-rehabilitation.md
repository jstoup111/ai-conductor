# Conflict Check: finish-time halt-PR rehabilitation (#271)

**Date:** 2026-07-03
**New stories:** `.docs/stories/finish-should-rewrite-stale-needs-remediation-titl.md`
**Scanned against:** all `.docs/stories/*.md` (36 files), focus surfaces:
daemon-pr-labels, remediation-comment-upsert, intake-issue-pr-link-autoclose,
make-daemon-build-push-pr-timing-a-configurable-st,
content-aware-shipped-work-dedup, finish-force-with-lease-after-sanctioned-rebase.

## Result: PASSED after 1 resolution (0 blocking remaining)

## Conflict 1 (RESOLVED): draft status as halt signal vs `early-draft` PR timing

**Stories involved:** Story 3/4 (rehabilitation detection) vs
"Daemon early-draft — build-start push and lazy draft PR"
**Files:** `finish-should-rewrite-stale-needs-remediation-titl.md` vs
`make-daemon-build-push-pr-timing-a-configurable-st.md` (unshipped spec, #199)
**Type:** behavioral overlap
**Severity:** degrading

**Description:** `pr_timing: early-draft` opens legitimate draft PRs at build
start (clean title, no label). Treating draft status as a standalone halt-PR
signal would misclassify every early-draft build PR as a halt PR at finish.

**Resolution (operator-selected Option 1, least disruptive):** halt-PR
detection = `needs-remediation:` title prefix OR `needs-remediation` label
only. Draft status alone is never a halt signal; `isDraft` is read only to
decide whether a ready-flip is still needed after a halt signal is
established. ADR `adr-2026-07-03-halt-pr-rehabilitation-at-finish` Decision
intro + Decision 4 amended in place (ADR was authored this session, pre-land;
no supersession needed); Stories 3 and 4 amended.

## Non-conflicts (checked, compatible)

- **daemon-pr-labels FR-12** (`mergeable` suppressed while `needs-remediation`
  present): reinforcing — label clearing at finish un-starves FR-10 for reused
  halt PRs. No semantic contention on the label.
- **remediation-comment-upsert**: birth-side marked comment; Story 1 preserves
  the comment thread verbatim. The rewrite touches title/body only.
- **intake-issue-pr-link-autoclose**: same `injectIssueRef` primitive, already
  idempotent; "Closes present exactly once" holds whether injected by the
  existing post-run call or the rehabilitation step.
- **content-aware-shipped-work-dedup**: shipped-record write happens on the
  branch pre-push; rehabilitation edits PR metadata post-record. No ordering
  contention.
- **finish-force-with-lease-after-sanctioned-rebase**: push semantics only;
  rehabilitation performs no pushes.
- **Issue #274 (birth-side verify-after-write)**: adjacent, disjoint side of
  the lifecycle (birth vs finish); both converge on PR-state consistency.

## Sequencing note

This feature does not depend on #199; if #199 ships first or later, Option 1
detection is correct in both worlds.
