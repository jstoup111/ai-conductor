# Track: Task dependency gate is a presence check; unorderable plans pass it

Track: technical

Scope boundary: New plans only (operator-confirmed 2026-11-05). Approach A: a strict dependency
check — every authored task declares exactly one parseable `**Dependencies:**` line, every cited id
resolves, and the declared graph is acyclic (rejections name the cycle's task ids, or the citing task
and the missing id) — enforced at `land` and at the conduct `plan` gate only when the plan file is
new in the feature's own diff. Engine-appended remediation tasks are exempt, as in `plan-slices.ts`.
A `## Task Dependency Graph` section alone no longer satisfies those strict points. Excluded:
tightening daemon backlog eligibility or BUILD-entry checks for plans already on the default branch
or in flight (they keep today's presence check; a scan of 240 merged plans found 130 that the strict
parser rejects and none with a cycle); widening the dependency grammar (ranges, annotated `none`);
engine-side task scheduling.

Internal gate in the harness's own spec pipeline; no user-facing product behavior, so no PRD.
