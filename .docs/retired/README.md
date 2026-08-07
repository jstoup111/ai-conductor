# Retired plans

Plans in this directory are **not** work. They were authored, never shipped through the harness,
and their intent has since been delivered by other features — so the plan artifact outlived the
problem it described.

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

A plan whose intent is already delivered, verified by reading the code — not by assuming. Retiring
a plan whose work was never done silently drops it.

## What does not

- **Shipped through the harness.** That is `.docs/shipped/<stem>.md`, written by
  `conduct-ts shipped-record`. Backlog dedup already handles it; do not also retire it.
- **Still wanted but under-specified.** Fix the DECIDE artifact instead. A missing dependency graph
  or unapproved stories file is a defect in the spec, not a reason to retire real work.
- **Abandoned on purpose.** Retirement records "already done", not "decided against". Record a
  cancellation as an ADR so the reasoning survives.

## Retiring a plan

`git mv .docs/plans/<stem>.md .docs/retired/<stem>.md`, add a row below with the evidence that the
intent shipped, and land it on the base branch. Leave the plan's ADRs, stories, and architecture
notes where they are — only plans drive the backlog scan, and those artifacts remain the historical
record.

## Retired

| Plan | Retired | Delivered by |
|---|---|---|
| `2026-03-30-technical-assessment` | 2026-08-07 | `skills/assess/SKILL.md` and all 10 `agents/cto-*.md` specialist personas exist |
| `daemon-self-host-guardrails` | 2026-08-07 | `src/conductor/src/engine/self-host/` — 16 modules including `live-boundary.ts`, `release-gate.ts`, `version-gate.ts`, `write-fence.ts` |
| `expose-daemon-pause-resume-verbs` | 2026-08-07 | `daemon park` / `daemon unpark` shipped and documented at `docs/reference/cli.md:247` |
| `remediate-aggregate-test-suite-gate` | 2026-08-07 | `remediate` step and `full-suite-executor.ts` both shipped |
| `remediation-comment-upsert` | 2026-08-07 | `remediation-append.ts` implements the upsert semantics — one task per id, an existing id is resolved rather than re-appended |
