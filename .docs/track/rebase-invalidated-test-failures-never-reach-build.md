# Track: rebase-invalidated-test-failures-never-reach-build

Track: technical

Scope boundary: Approach A (balanced) — replace the transient `kickback.from === 'rebase'`
probe with durable base-advance attribution sourced from the existing event spine
(`rebase_changed` / `rebase_gate_invalidated` in `.pipeline/events.jsonl`); make repair
recording gate-agnostic rather than `test_suite`-only; allow multiple repair records per
base advance; and record grading provenance so an operator can tell whether a build_review
finding was graded with or without repair context.

EXCLUDED: reworking the per-gate kickback counter / convergence bound (the counter that
resets on tree movement). Operator explicitly scoped this out; it remains a separate concern.
EXCLUDED: giving the grader the raw base-advance delta (Approach C) — rejected as replacing
a deterministic record with LLM judgment.

> **Amended 2026-08-13 by #1535 (architecture-review, operator-confirmed):** the scope boundary
> additionally includes inverting the markdown default in `isCodeOrTestPath`
> (`src/conductor/src/engine/rebase.ts:377-388`) so that only `.docs/`, `docs/`, `README*`, and
> `CHANGELOG.md` are documentation and all other markdown — `agents/*.md`, `skills/**/SKILL.md`,
> `tech-context/`, root `HARNESS.md`/`AGENT_INSTRUCTIONS.md` — is runtime source. Reason: the
> incident's own invalidated path was `agents/planner.md`, which the current predicate excludes,
> so the base-advance attribution join could not see the failure it exists to explain and #1535
> would not actually be fixed. The durable base-advance record additionally carries the
> **unfiltered** delta as defence in depth, so attribution survives a future classifier error.
> This is a consumer-visible engine behavior change and is governed by its own ADR.
> The original scope boundary above is preserved unchanged.

Rationale: internal engine attribution machinery consumed by the daemon and the build_review
grader; no product-facing requirements, so acceptance criteria live directly in stories.
