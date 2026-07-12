# ADR 004: `when:` and `parallel:` Workflow DSL

**Date:** 2026-04-19
**Status:** APPROVED

## Context

Custom steps in `.ai-conductor/config.yml` can currently be inserted with `after:` to fix sequential position, but cannot be:

- **Conditional** — "run this step only for Large features in the BUILD phase"
- **Concurrent** — "run these three steps in parallel and wait for all"

Without these primitives, harness composition is limited to "add or disable a step." Real workflow customization requires conditional and parallel control flow.

The full design space includes loops (`until:`), DAGs (arbitrary `depends_on`), and Starlark-style DSLs. These were rejected as scope creep — they introduce Turing-complete or near-Turing-complete config and explode the testing surface. Wave B targets the minimum useful primitives.

## Decision

### `when:` — conditional step skip

Custom steps may declare a `when:` expression. Grammar (5 forms only):

| Form | Example | Semantics |
|---|---|---|
| `tier == V` | `tier == L` | Current `complexity_tier` equals literal |
| `tier in [V, V]` | `tier in [M, L]` | Current tier is in the literal set |
| `phase == V` | `phase == BUILD` | Current `phase` equals literal |
| `${key} == V` | `${bootstrap_mode} == new` | State key equals literal (undefined key → false; see ADR-005) |
| `A && B` | `tier == L && phase == BUILD` | Conjunction of any two of the above |

Grammar is **hand-parsed** in `src/engine/when-expression.ts`. No expression library (jsonata, expr-eval, jexl) — those bring in 50KB+ and a much larger attack surface for a 5-form grammar.

**Validation is two-phase:**
1. **Config-load (`validateWhenSyntax`)** — tokenize + reject empty sets, unknown tier/phase literals, malformed `${}`, `when:` on harness lifecycle step names. Throws `ConfigValidationError` with location.
2. **Dispatch-time (`evaluateWhen`)** — accepts a pre-validated AST, returns boolean. No re-tokenization (parsed AST stored on `StepConfig.whenAst` after load).

A skipped step:
- Sets `conduct-state.json[step] = "skipped"`.
- Emits `when_skip { step, condition, actualTier?, actualPhase? }` event.
- Counts as "satisfied" for downstream gate checks (skip propagates cleanly).

### `parallel:` — concurrent step group

A step node is **either** a skill step (`skill: ...`) **or** a parallel group (`parallel: [...]`) — never both. This is a discriminated union enforced both at config-load and (per architecture review condition C3) in the TypeScript type:

```ts
type StepConfig =
  | { kind: 'skill'; skill: string; ... }
  | { kind: 'parallel'; parallel: StepConfig[]; ... };
```

A parallel group:

- Expands to **synthetic flat keys** in `conduct-state.json`: `<group_name>__<branch_name>: "done" | "failed" | "skipped"`. The flat key format preserves the bash-readable state contract from the 2026-04-12 conductor rewrite (state remains a flat string→string JSON object).
- Dispatches branches via `Promise.all`. Branches share the conductor's existing Claude rate-limit/cooldown semaphore (per architecture review condition C4) — concurrent invocation does not bypass throttling.
- Emits lifecycle events: `parallel_started { group, branches }`, `parallel_completed { group, duration_ms, branches }`, `parallel_failure { group, branch, error }`.
- **Gating semantics:** Downstream `after: <group>` waits until all branches show `done` or `skipped` in state. One gating-branch failure → group fails → downstream blocked. Advisory branches that fail are recorded but do not block.
- **`when:` on a parallel group:** evaluated before fan-out. If false, all synthetic branch keys set to `"skipped"`, single `when_skip` event emitted for the group, downstream sees the group as satisfied.
- **SIGINT during parallel:** per-branch state (`in_progress | done | failed`) persists atomically (per condition C5 — single-writer mutex on state file). Resume can detect partial progress.

### Synthetic key format: `<group>__<branch>`

The `__` separator avoids collision with existing step keys: harness `ALL_STEPS` are kebab-case (no underscores), and custom step names inherit the same convention via config validation.

## Out of Scope (Explicit)

- **OR conjunction (`||`)** — only `&&` is supported. OR can be expressed by duplicating the step with two `when:` variants.
- **Negation (`!`)** — express as inverted membership (`tier in [M, S]` instead of `!tier == L`).
- **Loops** (`until: <expr>`) — deferred indefinitely; use external orchestration if needed.
- **DAG dependencies** (`depends_on: [a, b, c]`) — `parallel:` is the maximum richness.
- **Function calls / arithmetic** — config DSL stays declarative.
- **Custom expression libraries** — explicitly rejected (50KB+ deps, oversized for the grammar).

## Consequences

- **Pro:** Real workflow composition: tier-gated steps, phase-gated steps, parallel design fan-out.
- **Pro:** Hand-parsed grammar fits in ~150 LOC; testable per-form; no third-party security surface.
- **Pro:** Synthetic flat keys preserve the existing state-file contract — no migration needed for existing tooling that reads `conduct-state.json`.
- **Pro:** Mutual exclusion via discriminated union catches `skill + parallel` errors at compile time.
- **Con:** Five-form grammar is extensible but each new form requires touching the parser, validator, and tests. Future grammar additions need ADR amendments.
- **Con:** `parallel:` constrained to share LLM throttling — limits theoretical concurrency for LLM-heavy branches. Acceptable trade for not blowing rate limits.
- **Migration impact:** Additive config schema. Existing `.ai-conductor/config.yml` files continue to work unchanged. New optional fields documented in CHANGELOG Migration block.

## Evidence

- 2026-04-12 conductor rewrite ADRs preserved the flat state-file format; this decision honors that constraint.
- Bash conductor cooldown machinery (preserved in TS rewrite per 2026-04-12 ADR-3) remains the single point of LLM throttling — parallel branches must route through it.
- Existing step state values (`pending | in_progress | done | failed | skipped | stale`) already include `skipped`, so downstream gate logic only needs to extend "satisfied" to include skipped (one-line change in `gates.ts`).

## Amendment

**Amended by:** adr-2026-07-10-concurrent-group-core (2026-07-10) — the `parallel:` DSL schema is unchanged, but execution moves from `runParallelGroup` (deleted; dispatched the group name instead of each branch's skill, unbounded fan-out, no rate-limit/retry wiring) to the capped, engine-integrated concurrent group core shared with the built-in SHIP validation group (adr-2026-07-10-validation-group-join).
