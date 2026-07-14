# Stories: Lightweight DECIDE flow for size-S bugs (#668)

**Track:** technical · **Tier:** M · **Design:** adr-2026-07-14-s-tier-bug-decide-flow.md (APPROVED)
**Status: Accepted**

Acceptance criteria live here (technical track — no PRD). Each story is testable against the
`engineer` claim path, the `complexity` tier resolver, and the `landSTierSpec` expand+validate
primitive using a faithfully seeded intake issue payload and a temp worktree with a `.docs/` tree.

---

## S1 — `size: S` + `bug` label triggers the S-flow with an authoritative tier (happy)

**Given** an intake issue carrying both the `bug` and `size: S` labels,
**When** `engineer claim` dequeues it,
**Then** it reports `{ sTier: true, tier: 'S', class: 'bug', owner }`,
**and** the tier is resolved from the label via `resolveTierFromLabels`, **not** from the LLM
`assessTier` signal walk.

**Acceptance:**
- `resolveTierFromLabels(['bug','size: S'])` returns `'S'` and `assessTier` is not invoked on that
  path.
- A claim on the seeded issue surfaces the S-flow eligibility flag and the operator as `owner`.

## S2 — One mini-spec expands to the canonical gate-read files with stamps (happy)

**Given** a `.docs/s-tier/<slug>.md` authored from the template (header + Problem + Root-cause anchor
+ Fix sketch + RED test list + Acceptance),
**When** `landSTierSpec` runs,
**Then** it emits `.docs/intake/<slug>.md` (`Owner:`), `.docs/track/<slug>.md` (`Track: technical`),
`.docs/complexity/<slug>.md` (`Tier: S`), `.docs/stories/<slug>.md` (`Status: Accepted` + acceptance
rendered as stories), and `.docs/plans/<slug>.md` (RED-first tasks) — from that single source.

**Acceptance:**
- After expansion all five files exist; each carries its stamp verbatim.
- The stories file's acceptance items are derived from the mini-spec's Acceptance section.

## S3 — Owner stamped by construction → owner-gate builds (happy, closes #656)

**Given** an expanded S-bug spec whose `.docs/intake/<slug>.md` Owner equals the daemon owner,
**When** `decideSpecGate` evaluates it,
**Then** the decision is `{ build: true }` — never the un-owned grandfather/skip branch.

**Acceptance:**
- `readSpecOwnerStamp` returns `{ present: true, id: '<owner>' }` for the expanded marker.
- `decideSpecGate` with a matching daemon owner returns `build: true`.

## S4 — Stories stamped Accepted by construction → stories-status gate passes (happy, closes #625)

**Given** the expanded `.docs/stories/<slug>.md`,
**When** the daemon backlog vetting runs `isStoriesApproved`,
**Then** it returns true and the spec is not warn-skipped for a missing status.

**Acceptance:**
- `isStoriesApproved(expandedStories)` is true; no `Status: DRAFT` appears in the output.

## S5 — No ADR authored for an S-bug → ADR-status gate cannot trip (happy, closes #662)

**Given** an S-bug spec landed via `landSTierSpec`,
**When** the land ADR hard-gate runs,
**Then** there is no `.docs/decisions/adr-*.md` for the slug and `hasDraftAdr` is never satisfied.

**Acceptance:**
- The expander writes no ADR file; the land completes without an ADR-status throw.

## S6 — Build pipeline runs with reviews intact under Tier S (happy, no gate weakening)

**Given** a merged S-bug spec with `Tier: S`,
**When** the conductor runs the pipeline,
**Then** `architecture_diagram`, `architecture_review`, `conflict_check`, `acceptance_specs`,
`architecture_review_as_built`, and `retro` are skipped (existing behaviour),
**and** `build`, `build_review`, `wiring_check`, `manual_test`, and `finish` all run —
`build_review` and `code-review` are in **no** skip list.

**Acceptance:**
- `getSkippableSteps('S')` is unchanged by this feature and does **not** include `build_review`,
  `wiring_check`, `manual_test`, or `build`.
- No edit to `steps.ts` `skippableForTiers` or `conductor.ts:1614-1623` is required by the S-flow.

## S7 — Missing Owner is rejected at land (negative)

**Given** a mini-spec whose operator identity cannot be resolved (blank owner),
**When** `landSTierSpec` runs,
**Then** it throws, opens no PR, writes no partial artifact set, and keeps the worktree for
inspection.

**Acceptance:**
- Expansion+validation with an empty owner throws; `.docs/` is left without a half-written spec.

## S8 — Empty RED test list is rejected (negative, RED-first preserved)

**Given** a mini-spec whose RED test list names zero failing tests,
**When** `parseMiniSpec` / `landSTierSpec` validates it,
**Then** it is rejected — an S-bug with no named failing test is not landable.

**Acceptance:**
- A mini-spec with an empty RED list throws with a message naming the missing RED tests.

## S9 — A stray DRAFT ADR in an S-bug spec is rejected (negative)

**Given** an S-bug worktree that (against D5) contains a `.docs/decisions/adr-*.md` with
`Status: DRAFT`,
**When** `landSTierSpec` runs its validation,
**Then** it throws via the existing `hasDraftAdr` check — a DRAFT ADR can never slip through.

**Acceptance:**
- With a seeded DRAFT ADR present, land throws the same ADR hard-gate error as full DECIDE land.

## S10 — M/L and non-bug `size: S` ideas are untouched (negative, regression)

**Given** a `size: M` issue, or a `size: S` issue **without** the `bug` label,
**When** `engineer claim` dequeues it,
**Then** it does **not** enter the S-flow — `sTier` is false and full DECIDE is required.

**Acceptance:**
- `resolveTierFromLabels(['size: M'])` and `resolveTierFromLabels(['size: S'])` (no `bug`) both
  return null (no S-flow); the claim reports no S-tier eligibility.
