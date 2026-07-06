# Implementation Plan — Trim skill descriptions & de-accrete writing-system-tests

**Source:** `jstoup111/ai-conductor#327` · **Track:** technical · **Tier:** S
**Stories:** `.docs/stories/trim-skill-frontmatter-descriptions-and-de-accrete.md`

Documentation-only change to four `SKILL.md` files. No code, schema, or behavior change.
Validate with `test/test_harness_integrity.sh` after edits.

---

## Task 1 — Trim `engineer` description (Story 1)

File: `skills/engineer/SKILL.md`, frontmatter `description:`.

- Replace the ~80-word description (which embeds the DECIDE sequence) with a single
  when-to-fire clause, e.g.:
  > "Use when capturing and routing a raw idea into a spec PR in the right repo — an
  > interactive, phone-drivable idea→spec loop that runs the full DECIDE phase and hands
  > off a spec PR. NOT for building inside one repo (that's `conduct`)."
- Confirm the removed DECIDE step sequence already exists in the skill body (the Purpose /
  "The Loop" sections already enumerate `explore → complexity → prd → … → plan`); if any
  detail was *only* in the description, move it into the body. Do not delete it outright.
- Keep all other frontmatter fields byte-identical (`name`, `enforcement`, `phase`,
  `standalone`, `requires`, `model: fable`).

## Task 2 — Trim `explore` description (Story 1)

File: `skills/explore/SKILL.md`, frontmatter `description:`.

- Remove the trailing changelog clause: "Divergent half of the old brainstorm — produces
  no committed design doc; the product-track PRD is authored by /prd."
- Keep the when-to-fire core: "Use at the start of any new feature or change. Explores
  context, asks clarifying questions one at a time, proposes 2-3 approaches with
  trade-offs, and decides the work track (product vs technical)."
- Leave other frontmatter fields unchanged.

## Task 3 — Trim `remediate` description (Story 1)

File: `skills/remediate/SKILL.md`, frontmatter `description:`.

- Remove the routing-target enumeration parenthetical
  `(build/acceptance_specs/architecture_review/plan)` from the description.
- Keep the when-to-fire core: "Use at SHIP when prd-audit, the as-built architecture
  review, or the finish verification blocks. Reasons over the blocking gaps and emits
  per-gap remediation dispositions + concrete tasks … HALTs only for
  architectural-clarity or product-scope gaps that need a human."
- Confirm the routing-target list is present in the body (it is, in the Purpose /
  routing section); leave other frontmatter fields unchanged.

## Task 4 — Re-number `writing-system-tests` `## Process` (Story 2)

File: `skills/writing-system-tests/SKILL.md`, `## Process` and its `###` children.

Apply this header mapping (order preserved; body text under each header is moved verbatim,
not reworded):

| Current header | New header |
|---|---|
| `### 1. Detect Project Type` | `### 1. Detect Project Type` |
| `### 2. Check for Missing Acceptance Specs` | `### 2. Check for Missing Acceptance Specs` |
| `### 2.5. Schema Consistency Check` | `### 3. Schema Consistency Check` |
| `### 3. Parse Acceptance Criteria` | `### 4. Parse Acceptance Criteria` |
| `### 3.5. Domain Alignment Check` | `### 5. Domain Alignment Check` |
| `### 3a. Classify Story Flows` | `### 6. Classify Story Flows` |
| `### 3b. Replacement Tasks: Drive the REAL Entry Point` | `### 7. Replacement Tasks: Drive the REAL Entry Point` |
| `### 3c. Boundary-Value Checklist for Path / Prefix Guards` | `### 8. Boundary-Value Checklist for Path / Prefix Guards` |
| `### 3d. Adversarial Derivation Coverage: Every Call Site, Real Input` | `### 9. Adversarial Derivation Coverage: Every Call Site, Real Input` |
| `### 3e. FR Coverage Mapping (Product Track)` | `### 10. FR Coverage Mapping (Product Track)` |
| `### 4. Read App Context` | `### 11. Read App Context` |
| `### 5a. Generate HTTP / Request-Level Acceptance Specs (Headless / API Projects)` | `### 12. Generate Acceptance Specs` → `#### HTTP / Request-Level (Headless / API Projects)` |
| `### 5b. Generate End-to-End / UI Specs (Full-Stack Projects)` | (under 12) `#### End-to-End / UI Specs (Full-Stack Projects)` |
| `### 6. Run and Verify RED` | `### 13. Run and Verify RED` |
| `### 7. Commit the Failing Tests` | `### 14. Commit the Failing Tests` |

Notes:
- `5a`/`5b` are two branches of the same step (pick per project shape), so they collapse
  under one numbered parent (`### 12. Generate Acceptance Specs`) as two unnumbered
  `####` sub-headings. This removes the letter suffix without deleting either branch's
  body. (Alternatively they may stay as two sequential steps `### 12` / `### 13` with the
  tail renumbered — either is acceptable provided no `.5`/letter suffix remains and no body
  content is lost.)
- The `####` sub-headers already inside step bodies (e.g. `#### Record the FR coverage
  evidence (gating)`, `#### Stubbing Rules for Pre-Implementation Specs`) are left as-is.

## Task 5 — Fix internal step cross-references (Story 2)

File: `skills/writing-system-tests/SKILL.md`.

- `grep -nE '§[0-9]|see (§|section) ?[0-9]|step [0-9]' skills/writing-system-tests/SKILL.md`
  and update any reference that names a renumbered step. Known instance: the
  "Check for Missing Acceptance Specs" body references "the acceptance test directory
  (whatever the framework uses — see §1)" — verify it still points at "Detect Project
  Type" (now still §1) and fix any that drifted.

## Task 6 — Deduplicate the framework-deference rule (Story 3)

File: `skills/writing-system-tests/SKILL.md`.

- Two standalone assertions of the same rule exist in the Overview region:
  1. the "This skill is **language- and framework-agnostic.** …defers to 'stack test
     conventions.'" paragraph, and
  2. the "**The test framework and paths are the project's, not this skill's.**" line
     above the stack-mapping table.
- Keep **one** as the canonical statement (recommend keeping #2, which introduces the
  stack-mapping table) and reduce the other to a one-line back-reference (or remove it),
  so the rule is stated exactly once as a standalone rule.
- Do NOT touch the many operational in-step phrasings ("per the project's layout", "the
  framework's request test layer", etc.) — those are working instructions, not the rule
  restatement. Do NOT touch the frontmatter `description`.

## Task 7 — Validate

- Run `test/test_harness_integrity.sh`; it must pass (frontmatter fields present; no
  duplicate section numbers; model table + pins unaffected).
- Sanity-check word counts: `engineer` description materially shorter than before
  (~25w vs ~80w); no arrow-joined step sequence in any of the three trimmed descriptions.
- `git diff` review: confirm the `writing-system-tests` diff is header-only plus the
  single deference-line change — no body prose deleted.

## Task 8 — Changelog

- Add an entry under `## [Unreleased]` in `CHANGELOG.md` (Changed):
  "Trimmed `engineer`/`explore`/`remediate` skill descriptions to when-to-fire clauses
  and de-accreted `writing-system-tests` `## Process` numbering (no behavior change)."

## Out of scope

- No edits to `pipeline` body, `writing-system-tests` body content/tables/examples, or any
  skill behavior, phase, or enforcement. No `VERSION` bump decision here — that is the
  operator's call at PR time (PATCH per the semver rules: non-behavioral cleanup).
