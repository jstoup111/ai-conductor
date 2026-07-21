---
status: APPROVED
date: 2026-07-21
---

# ADR: DECIDE-time unmerged-overlap scan is a deterministic primitive, dual-hooked and advisory

**Status:** APPROVED
**Date:** 2026-07-21
**Feature:** spec-authoring-is-blind-to-unmerged-dependent-work (#523, Scope A)
**Track:** technical

## Context

Spec authoring is blind to unmerged dependent work (#523). Two reconnaissance sweeps confirmed
the gap is greenfield:

- The build-side dependency gate (`blocker-resolver.resolve()` → `daemon-backlog`'s `waiting`
  channel) reasons only over GitHub-issue `blocked_by` links and **merged** base-branch
  artifacts (`gitTreeSource` reads `git ls-tree`/`git show` against the base branch). An
  unmerged `spec/«slug»` branch is intentionally invisible to it. *(verified — recon)*
- Nothing on the authoring side surfaces unmerged sibling `spec/*`/PR branches whose diff
  overlaps the files a new spec is designing against. There is **no existing branch-enumeration
  helper** in the engine. *(verified — recon: "you'd be adding the first branch-listing helper")*
- Two reusable primitives already exist: `rebase.ts#changedPathsBetween(git, from, to)`
  (`git diff --name-only`) and `blocker-resolver` (constructed today at `engineer-cli.ts:1023`
  as `createBlockerResolver({ run: (args) => gh(args, { cwd }) })`). *(verified — recon)*

Scope A (operator-selected) is the **DECIDE-time, read-only** half: warn the author of overlap
before the plan locks. Build-side re-validation (persisting an authoring base + a new `waiting`
reason-kind) is explicitly **out** (Scope B/C).

## Decision

**1. The scan is a deterministic `conduct-ts` primitive, not prompt discipline.**
Per this repo's Design Principle (deterministic where possible; LLM only where necessary),
branch enumeration, diffing, file-overlap intersection, and the blocker lookup are done by a
new non-interactive `conduct-ts` subcommand + engine module — not by asking an agent to
"remember to check." The DECIDE skills merely *invoke* it and render its report. The primitive
reuses `changedPathsBetween` and the existing `blocker-resolver` factory; it adds only the
branch enumerator and the intersection.

**2. Dual hook point: `/architecture-review` (early) and `/plan` (authoritative).**
- At `/architecture-review` (Medium/Large) the candidate paths come from the `## Wiring
  Surface` section — the earliest concrete file-intent — giving the author a design-time
  warning *before* they write the plan.
- At `/plan` the candidate paths come from the authoritative `**Files:**` set — the final,
  accurate check before the plan is committed and the spec lands.
- Rejected "single hook at `/plan` only": by then the design is largely fixed, so the author
  loses the chance to reconsider the *approach* — the exact cost #523 wants to avoid.
- Rejected "single hook at `/explore` only": no file list exists that early; the scan would
  have nothing to intersect.

**3. Advisory, never blocking; stateless; build side untouched.**
The scan surfaces *named* overlaps (branch + file) and open blockers and returns; it never
hard-blocks the plan and writes no durable state. A spec with no blocker links and no seam
overlap produces **no** prompt (intake's zero-ceremony negative path). Enumeration/resolver
failures degrade to an advisory-skip note — the scan can never block authoring. `daemon-backlog`
and the build path are byte-for-byte unchanged.

## Consequences

- **Positive:** eliminates the insider-diff-reading the operator does today to decide which
  issues are parallel-speccable; deterministic and token-free at the point of use; no hot-path
  or durable-state risk; reuses two proven primitives.
- **Negative / accepted residual:** point-in-time snapshot only. A spec authored clean, then
  overlapped by a *later*-merging impl, still dispatches silently — that residual is precisely
  what a future Scope B (build-side reconcile gate) would close, and is a known, accepted limit
  of Scope A, not an oversight.
- **Follow-up:** Scope B/C remain available as separable follow-up work.

## Confidence & assumptions

- Reuse of `changedPathsBetween` and the `blocker-resolver` gh-runner factory: **verified**
  (~95%) by direct recon of `rebase.ts:186` and `engineer-cli.ts:1023`.
- New subcommand home is `cli.ts`'s commander `.command(...)` table dispatched via `index.ts`
  (where engineer subcommands already live): **verified** (~90%).
- No load-bearing assumption remains unconfirmed; no HALT required.
