# Architecture: Lightweight DECIDE flow for size-S bugs (#668)

**Track:** technical · **Tier:** M · **Design:** adr-2026-07-14-s-tier-bug-decide-flow.md (APPROVED)

## Context (current state)

Two authoring paths exist today:

- **Full DECIDE** (`/engineer`): explore → complexity → [prd] → architecture-diagram →
  architecture-review → stories → conflict-check → plan, then `land` + `handoff`. `land`
  (`land-spec.ts`) writes the intake Owner marker only on the `--source-ref` path, asserts stories
  `Status: Accepted`, and hard-gates DRAFT ADRs.
- **Ad-hoc hotfix** (tonight's #634/#644/#548): a direct worktree + RED test + PR, bypassing DECIDE
  entirely — so no `.docs/` artifacts and no gate stamps exist, forcing post-hoc hand-stamping and
  the #656 / #662 / #625 gate failures.

The build pipeline already right-sizes Small: `steps.ts` marks `architecture_diagram`,
`architecture_review`, `conflict_check`, `acceptance_specs`, `architecture_review_as_built`, and
`retro` with `skippableForTiers: ['S']`, and `conductor.ts:1614-1623` skips them at build time. The
ceremony being paid for an S-bug is therefore purely **authoring-side**, not verification.

## Decision (as C4-ish component view)

Add a third, first-class path — the **S-tier mini-spec** — that sits beside full DECIDE and reuses
every downstream gate and the whole build pipeline unchanged.

```
[ intake issue: bug + size:S ]
            │  (labels read deterministically — no LLM complexity re-derivation)
            ▼
   engineer claim  ──▶  { sTier:true, tier:'S', class:'bug', owner }
            │
            ▼
   ONE mini-spec artifact  (.docs/s-tier/<slug>.md)
      header: Owner / Track: technical / Tier: S / Status: Accepted / Issue
      body:   Problem · Root-cause anchor(file:line) · Fix sketch · RED test list · Acceptance
            │
            ▼
   landSTierSpec  (deterministic)
      ├─ parseMiniSpec()            structured sections; empty RED list → REJECT
      ├─ expandMiniSpec()           emits canonical gate-read files with stamps injected:
      │     .docs/intake/<slug>.md      Owner: <op>            (writeIntakeMarker, unconditional)
      │     .docs/track/<slug>.md       Track: technical
      │     .docs/complexity/<slug>.md  Tier: S
      │     .docs/stories/<slug>.md     Status: Accepted  (+ acceptance rendered as stories)
      │     .docs/plans/<slug>.md       RED-first tasks (named failing tests)
      └─ validate (REUSED predicates): readSpecOwnerStamp · isStoriesApproved ·
            parseComplexityTier==S · no DRAFT ADR (hasDraftAdr). Any miss → REJECT (no PR).
            │
            ▼
   daemon build pipeline  (UNCHANGED):  Tier S skips heavy DECIDE-audit steps;
      build → build_review → wiring_check → manual_test → finish  all run;
      build_review + TDD domain review + code-review NOT skipped → no gate weakening.
```

## Why this shape

- **Deterministic-first (CLAUDE.md).** The gate-satisfying fields (Owner, `Status: Accepted`,
  `Tier: S`) are *stamped by machinery* at expand time, not left to prompt discipline — the classes
  #656/#662/#625 die at the point of authoring, not by a stronger prompt.
- **Zero new gate readers.** The expander targets the files the *existing* gates already read, so the
  owner-gate, stories-status gate and ADR-status gate need no change and cannot regress.
- **No verification collapse.** Only DECIDE-audit ceremony (architecture/conflict/acceptance-specs/
  retro) is skipped — exactly what `skippableForTiers: ['S']` already skips. Adversarial code review
  (build_review, domain review, code-review) is untouched.
