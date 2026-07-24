# ADR: Built-in provider policies with deeper discovery effort

**Date:** 2026-07-23
**Status:** APPROVED
**Supersedes:** adr-2026-07-23-built-in-provider-model-policies
**Deciders:** James Stoup (operator, approved 2026-07-23), architecture-review amendment for issue #902

## Context

The superseded ADR established the internal built-in provider-policy registry,
the independent Claude and Codex model tables, provider-native escalation and
fallback ladders, explicit-override precedence, and the unknown-provider
compatibility path.

During conflict review, the per-step effort table received a fresh fit check.
The prior draft preserved `medium` for `explore` and `prd` because those were
the current Claude values, then mirrored them into Codex. The operator rejected
that inherited setting: both steps make high-cascade decisions, and their
default effort should reflect that role instead of treating historical
compatibility as the deciding factor.

The existing S-tier `explore` override has a separate purpose: keeping small
work cheap while retaining the normal retry ladder. The operator confirmed
that this override remains `low`.

## Options Considered

### Option A: Preserve `medium` for both providers

- **Pros:** Exact Claude compatibility; lowest default token use.
- **Cons:** Repeats the historical value without a fresh task-fit decision;
  underweights two high-cascade DECIDE steps.

### Option B: Use `high` for both providers, retaining `explore.S: low`

- **Pros:** Matches the consequence of discovery and requirements decisions;
  keeps Claude and Codex operator expectations aligned; preserves a meaningful
  attempt-2 escalation from `high` to `xhigh`; retains the explicit S-tier cost
  policy.
- **Cons:** Deliberately increases base effort and expected cost for Claude
  `explore`/`prd` and Codex `explore`/`prd`.

### Option C: Restore `xhigh`

- **Pros:** Maximum default depth short of `max`.
- **Cons:** Leaves only `max` as the effort retry rung and makes every normal
  discovery/requirements run pay near-top effort.

### Option D: Diverge Claude and Codex efforts

- **Pros:** Allows provider-specific tuning immediately.
- **Cons:** There is no observed evidence yet that these two steps need
  different effort intent across providers; divergence would add policy
  complexity without a confirmed benefit.

## Decision

Choose **Option B**.

All structural and model-selection decisions from
`adr-2026-07-23-built-in-provider-model-policies` remain in force:

- The internal policy registry covers the built-in `claude` and `codex` keys.
- `LLMProvider` remains unchanged; the selected registry key and policy are
  threaded separately.
- Claude and Codex retain independent explicit per-step model tables.
- Claude escalation remains `haiku → sonnet → opus → fable`; Codex escalation
  remains `gpt-5.6-luna → gpt-5.6-terra → gpt-5.6-sol`.
- Claude fallback remains `fable → opus → sonnet`; Codex fallback remains
  `gpt-5.6-sol → gpt-5.6-terra → gpt-5.6-luna`.
- Explicit model, effort, and fallback-ladder overrides retain their existing
  precedence and opaque provider-native values.
- Unknown installed provider-policy keys retain the warned Claude compatibility
  policy.
- Generated engine documentation remains provider-labelled, while standalone
  skill pins remain the Claude interactive path.

The per-step effort policy is amended as follows:

| Step and tier | Claude effort | Codex effort |
|---------------|---------------|--------------|
| `explore`, S | `low` | `low` |
| `explore`, M/L or no tier | `high` | `high` |
| `prd`, every tier | `high` | `high` |

Every other per-step and tier-specific effort remains equal to the prior
policy. With escalation enabled, attempt 2 raises these `high` base efforts to
`xhigh`; later model escalation remains provider-native and attempt-indexed.

## Consequences

### Positive

- Discovery and PRD authoring receive effort proportional to their downstream
  decision impact.
- Claude and Codex share a clear initial effort intent for the same tasks.
- Retry attempt 2 still has a meaningful effort rung (`high → xhigh`).
- Small exploration retains its independently approved low-cost profile.

### Negative

- Claude compatibility is intentionally not byte-identical for two base effort
  values.
- Normal M/L exploration and all PRD runs consume more reasoning effort by
  default.
- Compatibility tests and generated documentation must encode the two explicit
  effort exceptions rather than asserting that every Claude value is unchanged.

### Follow-up Actions

- [ ] Encode `explore: high` and `prd: high` in both built-in policies.
- [ ] Preserve the `explore.S: low` tier override in both policies.
- [ ] Assert attempt 2 escalates these steps to `xhigh`.
- [ ] Update provider-labelled generated documentation and compatibility tests.
