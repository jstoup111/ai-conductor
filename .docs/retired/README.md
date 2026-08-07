# Retired plans

Plans in this directory are **not** work. They were authored, never shipped through the harness,
and are no longer going to be — either because another feature already delivered their intent, or
because the operator decided against them. Either way the plan artifact outlived the problem it
described.

They live here rather than in `.docs/plans/` because the daemon's backlog scanner discovers work
with a non-recursive `git ls-tree <baseBranch>:.docs/plans` filtered to `*.md`
(`daemon-backlog.ts:61-77`). A plan left in `.docs/plans/` with a stale or incomplete DECIDE
artifact — a missing stories file, no dependency graph — is reported as BLOCKED on every scan
forever, because nothing will ever unblock it. Moving the file out of that tree retires it on the
base branch, so a fresh clone sees the same clean backlog with no local state to re-apply.

Nothing reads this directory. `.docs/retired/` is deliberately outside `.docs/plans/` rather than a
subdirectory of it, because `shipment-audit.ts:145` enumerates plans with a **recursive**
`ls-tree -r` and a subdirectory would keep surfacing them as audit sources.

## What belongs here

Exactly two kinds of plan, tracked in separate tables below:

- **Delivered** — the intent is already implemented, verified by reading the code, not by assuming.
  Retiring a plan whose work was never done silently drops it, so the register records the evidence
  for each.
- **Abandoned** — the operator decided the work will not be done. This is a decision, not an
  observation, so the register records who decided and when. It is deliberately not inferable from
  the code: an abandoned plan usually looks exactly like an unimplemented one.

## What does not

- **Shipped through the harness.** That is `.docs/shipped/<stem>.md`, written by
  `conduct-ts shipped-record`. Backlog dedup already handles it; do not also retire it.
- **Still wanted but under-specified.** Fix the DECIDE artifact instead. A missing dependency graph
  or unapproved stories file is a defect in the spec, not a reason to retire real work.

## Retiring a plan

`git mv .docs/plans/<stem>.md .docs/retired/<stem>.md`, add a row to the matching table below, and
land it on the base branch. Leave the plan's ADRs, stories, and architecture notes where they are —
only plans drive the backlog scan, and those artifacts remain the historical record.

## Delivered

Intent already implemented; the plan is redundant.

| Plan | Retired | Delivered by |
|---|---|---|
| `2026-03-30-technical-assessment` | 2026-08-07 | `skills/assess/SKILL.md` and all 10 `agents/cto-*.md` specialist personas exist |
| `daemon-self-host-guardrails` | 2026-08-07 | `src/conductor/src/engine/self-host/` — 16 modules including `live-boundary.ts`, `release-gate.ts`, `version-gate.ts`, `write-fence.ts` |
| `expose-daemon-pause-resume-verbs` | 2026-08-07 | `daemon park` / `daemon unpark` shipped and documented at `docs/reference/cli.md:247` |
| `remediate-aggregate-test-suite-gate` | 2026-08-07 | `remediate` step and `full-suite-executor.ts` both shipped |
| `remediation-comment-upsert` | 2026-08-07 | `remediation-append.ts` implements the upsert semantics — one task per id, an existing id is resolved rather than re-appended |

## Abandoned

Operator decided the work will not be done. These are **not** implemented — do not read a row here
as evidence that the behavior exists.

| Plan | Retired | Decided by | Note |
|---|---|---|---|
| `satisfied-by-forged-citation-validation` | 2026-08-07 | operator (James Stoup) | Stories were authored (8, never approved) but the citation-validation work was never built — `Satisfied-by` appears nowhere in `src/`, `skills/`, or `docs/` |
| `intake-issues-get-contradictory-duplicate-priority` | 2026-08-07 | operator (James Stoup) | `label-sync.ts` remains additive-only; the namespace-scoped replace this plan specified (`removeLabel` / `restRemoveLabelArgs` in the intake tree) was never built, and contradictory `priority:` / `size:` labels persist on affected issues |
