# Track Decision — Trim skill frontmatter descriptions & de-accrete writing-system-tests

**Source:** `jstoup111/ai-conductor#327`
**Decision: TECHNICAL track.**

## Why technical (not product)

This is an internal cleanup of harness authoring artifacts (`skills/*/SKILL.md`).
There are no user-facing product requirements and no change to the SDLC flow, skill
behavior, phase, or enforcement. The intake explicitly frames it as "targeted cleanup —
no behavior change" and lists product non-goals. Acceptance criteria are structural
(word-count / content-parity / integrity-suite), so they live in stories, not a PRD.

Per the DECIDE rules, the technical track skips `/prd`. Tier is Small (see
`.docs/complexity/`), so `/architecture-diagram`, `/architecture-review`, and
`/conflict-check` are also skipped. The build-ready set is: **track → complexity →
stories → plan**.

## Scope (from #327)

1. Trim three routing descriptions to a single "use when X" clause, moving embedded
   procedure into the skill body:
   - `engineer` (80w → ~25w) — remove the inline DECIDE pipeline sequence.
   - `explore` (51w) — drop the trailing "Divergent half of the old brainstorm…" changelog clause.
   - `remediate` (47w) — drop the routing-target enumeration `(build/acceptance_specs/architecture_review/plan)`.
2. De-accrete `writing-system-tests` `## Process` section numbering
   (`1, 2, 2.5, 3, 3.5, 3a–3e, 4, 5a, 5b, 6, 7`) into a clean sequential scheme with no
   `.5` / `a–e` suffixes. Pure reorganization — zero content deleted.
3. State the framework-deference rule exactly once in `writing-system-tests`
   (keep the canonical statement; reduce the duplicate to a back-reference).

## Non-goals

- No cuts to `pipeline` body or `writing-system-tests` body content, convention tables,
  gate definitions, or worked examples.
- No change to skill behavior, phase, enforcement, or the SDLC flow.
- No change to frontmatter fields required by `test/test_harness_integrity.sh`
  (`name`, `description`, `enforcement`, `phase`) or the model table / pins.

## Approaches considered

- **A. Descriptions + numbering + deference, all three (chosen).** Matches the intake
  exactly; each sub-change is independent and low-risk.
- **B. Descriptions only.** Rejected — leaves the writing-system-tests accretion, which
  is the higher-maintenance-cost item and is explicitly in scope.
- **C. Also compress body examples in large skills.** Rejected — explicit non-goal; the
  fresh-context agent relies on those restatements to avoid gate-skips.
