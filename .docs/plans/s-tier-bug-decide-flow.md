# Implementation Plan: Lightweight DECIDE flow for size-S bugs (#668)

**Date:** 2026-07-14 · **Tier:** M · **Track:** technical
**Design:** .docs/decisions/adr-2026-07-14-s-tier-bug-decide-flow.md (APPROVED)
**Stories:** .docs/stories/s-tier-bug-decide-flow.md (Accepted, S1–S10)
**Conflict check:** .docs/conflicts/s-tier-bug-decide-flow.md (clean)

## Summary

Add a first-class S-tier mini-spec authoring path that stamps the owner, stories-status, and tier
fields **by construction** and reuses every existing gate reader and the whole build pipeline
unchanged. All code under `src/conductor/src/engine/`. Test-first (RED → GREEN): each task names the
story it turns green and the exact test. Run tests from `src/conductor` (`npm install` per worktree;
vitest config lives there). No change to `steps.ts` `skippableForTiers` or `conductor.ts` tier-skip
logic — S6/T11 lock that invariant.

## Merge-order notes (from conflict check)
- N1 (#646 retry-classify): orthogonal (SHIP-tail), no shared file.
- N2 (steps.ts config-disable): S-flow makes no `skippableForTiers` change; standard rebase if the
  file is shared. T11 catches drift.

## Technical approach
- **Trigger** is deterministic label reading — no new LLM step. `resolveTierFromLabels` is a pure
  function; the `engineer claim` path consumes it.
- **Expansion** is pure string templating from one parsed mini-spec to the canonical gate-read files;
  validation reuses `readSpecOwnerStamp`, `isStoriesApproved`, `parseComplexityTier`, `hasDraftAdr`.
- `landSTierSpec` is a branch of the existing land primitive selected when `.docs/s-tier/<slug>.md`
  exists; on any validation miss it throws and keeps the worktree (matches `land-spec.ts` posture).

## Tasks

### Task T1 — `resolveTierFromLabels` (label-authoritative tier)
Add `resolveTierFromLabels(labels: string[]): 'S' | null` to
`src/conductor/src/engine/complexity.ts`: returns `'S'` iff labels include **both** `bug` and
`size: S`; otherwise `null`. Does not call `assessTier`.
**Test (S1, S10):** `complexity.test.ts` — `['bug','size: S'] → 'S'`; `['size: S'] → null`;
`['size: M'] → null`; asserts `assessTier` not invoked on the `'S'` path (spy).
**Dependencies:** none.

### Task T2 — `engineer claim` S-flow eligibility
In the claim path (`engineer/` claim command), read the claimed issue's labels and, via
`resolveTierFromLabels`, emit `{ sTier, tier: 'S', class: 'bug', owner }` when eligible (`owner` from
the issue assignee / operator identity). Non-eligible claims are unchanged.
**Test (S1, S10):** claim on a seeded `bug`+`size: S` issue reports `sTier: true` + owner; a
`size: M` and a bug-less `size: S` report `sTier: false`.
**Dependencies:** T1.

### Task T3 — mini-spec template
Add `templates/s-tier-mini-spec.md.template`: header (`Owner`, `Track: technical`, `Tier: S`,
`Status: Accepted`, `Issue`) + body sections Problem · Root-cause anchor · Fix sketch ·
RED test list · Acceptance, with inline authoring guidance.
**Test:** integrity/template-shape unit — template parses cleanly through `parseMiniSpec` (T4) as the
canonical example.
**Dependencies:** none.

### Task T4 — `parseMiniSpec`
Add `parseMiniSpec(content): MiniSpec` (new module under `engine/engineer/`): extract header fields
and the five body sections into a typed struct; **reject** (throw) a missing required section or an
**empty RED test list**.
**Test (S8):** round-trips the template; a mini-spec with zero RED tests throws naming the missing
RED list; a missing Acceptance section throws.
**Dependencies:** T3.

### Task T5 — `expandMiniSpec`
Add `expandMiniSpec(spec: MiniSpec, ctx: { slug; owner }): Record<path, content>`: emit the canonical
files with stamps injected — `.docs/intake/<slug>.md` (`Owner:`), `.docs/track` (`Track: technical`),
`.docs/complexity` (`Tier: S`), `.docs/stories` (acceptance → stories + `Status: Accepted`),
`.docs/plans` (RED list → RED-first tasks).
**Test (S2):** expansion of the template yields all five paths; asserts each stamp verbatim and that
stories acceptance derives from the mini-spec Acceptance section.
**Dependencies:** T4.

### Task T6 — unconditional Owner marker on the S-flow
Ensure the S-flow writes the intake Owner marker via `writeIntakeMarker`
(`engineer/intake-marker.ts:44`) **unconditionally** (not gated on `--source-ref`), sourcing the id
from the claim's `owner`.
**Test (S3):** after the S-flow write, `readSpecOwnerStamp` returns `{ present: true, id: owner }`.
**Dependencies:** T2, T5.

### Task T7 — `landSTierSpec` orchestrator (happy path)
Add `landSTierSpec` as a branch of the land primitive (`engineer/land-spec.ts`), selected when
`.docs/s-tier/<slug>.md` exists: parse → expand → write files → run existing validators
(`readSpecOwnerStamp`, `isStoriesApproved`, `parseComplexityTier === 'S'`, no DRAFT ADR). Stages only
`.docs` (no `add -A`).
**Test (S2, S3, S4, S5):** on the template mini-spec, produces a buildable set; `isStoriesApproved`
true; `parseComplexityTier` `'S'`; no ADR file written; `decideSpecGate` with a matching owner
returns `build: true`.
**Dependencies:** T5, T6.

### Task T8 — reject missing Owner (negative)
In `landSTierSpec`, a blank/unresolvable owner throws before any file is written; worktree kept.
**Test (S7):** empty-owner land throws; `.docs/` has no partial spec set.
**Dependencies:** T7.

### Task T9 — reject stray DRAFT ADR (negative)
`landSTierSpec` runs the existing `hasDraftAdr` check over any `.docs/decisions/adr-*.md` in the
worktree and throws on DRAFT (D5 belt-and-braces).
**Test (S9):** a seeded DRAFT ADR makes land throw the same hard-gate error as full DECIDE land.
**Dependencies:** T7.

### Task T10 — build-pipeline invariant lock
Assert the S-flow adds **no** new skip: `getSkippableSteps('S')` equals the pre-existing set and
excludes `build`, `build_review`, `wiring_check`, `manual_test`, `finish`.
**Test (S6):** `steps.test.ts` — `getSkippableSteps('S')` snapshot unchanged; `build_review` /
`wiring_check` / `manual_test` not present.
**Dependencies:** none.

### Task T11 — `engineer` SKILL.md + README docs
Document the S-flow trigger (`bug`+`size: S`), the mini-spec artifact + template, the expand/stamp
land behaviour, and the explicit non-goals (M/L unchanged, no gate weakening) in
`skills/engineer/SKILL.md` and the relevant `README.md` / `src/conductor/README.md`. Add the
`[Unreleased]` CHANGELOG entry if not already present.
**Test:** `test/test_harness_integrity.sh` passes (skill/agent/template references resolve).
**Dependencies:** T1–T10.

## Task dependency graph
- T1 → T2 → T6
- T3 → T4 → T5 → {T6, T7}
- T7 → {T8, T9}
- T10 (independent)
- T11 depends on T1–T10
