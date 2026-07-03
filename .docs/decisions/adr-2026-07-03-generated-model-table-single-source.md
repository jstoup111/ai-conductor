# ADR: Generated HARNESS.md model table — typed engine metadata as single source

**Status:** APPROVED
**Date:** 2026-07-03
**Context:** intake jstoup111/ai-conductor#187 (Fable rollout program #186–#194)

## Context

Model/effort policy lives in three hand-synced places: `DEFAULT_STEP_MODELS` /
`DEFAULT_STEP_EFFORT` / `DEFAULT_STEP_TIER_OVERRIDES` in
`src/conductor/src/engine/resolved-config.ts` (autonomous path), `model:` pins in SKILL.md
frontmatter (interactive path), and the human-readable Model Selection table in HARNESS.md.
The standing rule "when you change one, change all three" is a drift hazard that the fourth
model tier (Fable, #186–#194) multiplies. Today the drift is real: the `complexity` engine step
has no table row, and `architecture_review_as_built` exists only as prose inside another row.

## Decision

1. **Typed metadata in the engine is the single source of truth.** A new module
   `src/conductor/src/engine/model-table-metadata.ts` exports:
   - `STEP_RATIONALE: Record<StepName, string>` — the table's "Why" text per engine step.
     Typed against `StepName`, so adding a step without rationale fails `tsc`, not a human review.
   - `EXTRA_MODEL_TABLE_ROWS: readonly ModelTableRow[]` — rows with no engine step (agent
     personas: domain-reviewer, evaluator, cto-*; interactive-only skills: engineer, debugging,
     code-review, tdd phases, conduct, pr, …), each carrying its own model + rationale.
   - `SKILL_STEP_MAP: Record<string, StepName>` — kebab-case skill dir → snake_case step for the
     pin check (e.g. `architecture-review` → `architecture_review`).
   - `PIN_EXEMPT_SKILLS: readonly string[]` — skills whose `model:` pin is intentionally not
     tied to an engine step default; every exemption carries an inline rationale comment.
   The rationale text currently in `//` comments inside `resolved-config.ts` moves into
   `STEP_RATIONALE` (comments are not machine-readable; typed exports are).

2. **The generator runs from TypeScript source via a locally-pinned `tsx` — never a dist
   build.** `bin/generate-model-table` (bash wrapper) execs
   `src/conductor/node_modules/.bin/tsx src/conductor/src/tools/generate-model-table.ts`.
   It MUST NOT invoke `npm run build`/`tsup`: rebuilding the shared `dist/` can ENOENT-crash
   running daemons in other repos (known shared-dist rebuild hazard, issue #215). `tsx` is added
   to `src/conductor` devDependencies; `npx -y` (network fetch) is forbidden.

3. **HARNESS.md carries a generated region.** The Model Selection table sits between
   `<!-- BEGIN GENERATED: model-selection-table -->` / `<!-- END GENERATED: model-selection-table -->`
   markers. Write mode rewrites only that region; `--check` mode diffs the region against
   generated output and exits non-zero with a unified diff on drift. **Missing or malformed
   markers are a hard error** (never silently append or regenerate the whole file). Surrounding
   prose (two-enforcement-paths explanation, the #186 interim-fallback note) stays hand-authored
   outside the region; the "change all three by hand" instruction is replaced by "edit the engine
   metadata and run `bin/generate-model-table`".

4. **Integrity suite extends check 5 with content checks at one bash/TS seam.**
   - 5a (drift): run `bin/generate-model-table --check`; fail on non-zero.
   - 5b (pins): the generator emits `{skill → expected model}` JSON (`--pins` mode); bash
     compares each `skills/*/SKILL.md` `model:` pin against it; disagreement fails unless the
     skill is in `PIN_EXEMPT_SKILLS`.
   - **Degradation:** when `src/conductor/node_modules` is absent, both checks WARN and skip
     (exit 0 for the section) — consumer checkouts without `npm install` must never see a false
     integrity failure. The existing presence-only check 5 remains and still runs everywhere.

5. **Table shape:** every engine step gets its own generated row (Model, Effort, Why), with
   tier-override suffixes rendered from `DEFAULT_STEP_TIER_OVERRIDES` (e.g. `sonnet (S/M),
   fable (L)`); `complexity` and `architecture_review_as_built` become explicit rows. Extra
   (non-engine) rows render after engine rows from `EXTRA_MODEL_TABLE_ROWS`.

## Consequences

- Every future model-policy change (including the Fable rollout ladder #186) is a single-file
  edit + one regeneration command; CI catches forgotten regeneration and pin drift.
- The integrity suite gains a conditional node dependency confined to one seam
  (`bin/generate-model-table`); bash never parses TypeScript.
- `resolved-config.ts` resolution precedence and runtime behavior are untouched; the new module
  is data-only.
- SKILL.md pins remain hand-authored (Claude Code reads frontmatter from files, not the engine),
  but can no longer silently disagree with the engine.
- Renaming an engine step now also requires updating `SKILL_STEP_MAP` — enforced by the
  `Record<StepName, …>` typing and the pin check itself.

## Alternatives considered

- **Bash/awk parsing of `resolved-config.ts`** — no new dependency, but comments-as-data is the
  untyped coupling this ADR removes; silently breaks on TS refactor.
- **Shared YAML/JSON policy file consumed by engine + generator** — inverts the dependency,
  weakens compile-time typing or adds a build step; larger blast radius for equal payoff.
- **Running the generator from built `dist/`** — rejected outright: requires a rebuild, which is
  the shared-dist daemon-crash hazard.
