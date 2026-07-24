**Status:** Accepted

# Stories: Provider-Aware Model and Effort Resolution

**Source:** issue #902 (technical track — no PRD)
**Design:** `adr-2026-07-23-provider-policies-with-deeper-discovery-effort` (APPROVED)
**Tier:** M

These stories extend the accepted retry-escalation, model-availability, and
generated-model-table contracts with built-in provider awareness. They do not
supersede those contracts.

---

## Story: Built-in providers receive explicit per-step defaults

**Requirement:** Technical intent #902; ADR Decisions 2–3

As a harness operator, I want each built-in provider to have an explicit
per-step model and effort policy so that selecting Codex never sends a Claude
alias and selecting Claude receives only the explicitly approved effort
changes.

### Policy Matrix

| Step | Claude model | Codex model | Base effort |
|------|--------------|-------------|-------------|
| `bootstrap` | `sonnet` | `gpt-5.6-terra` | `low` |
| `memory` | `haiku` | `gpt-5.6-luna` | `low` |
| `assess` | `sonnet` | `gpt-5.6-terra` | `high` |
| `explore` | `fable` | `gpt-5.6-sol` | `high` |
| `prd` | `fable` | `gpt-5.6-sol` | `high` |
| `complexity` | `sonnet` | `gpt-5.6-terra` | `low` |
| `stories` | `sonnet` | `gpt-5.6-terra` | `medium` |
| `conflict_check` | `sonnet` | `gpt-5.6-terra` | `medium` |
| `plan` | `sonnet` | `gpt-5.6-terra` | `high` |
| `architecture_diagram` | `sonnet` | `gpt-5.6-terra` | `medium` |
| `architecture_review` | `fable` | `gpt-5.6-sol` | `high` |
| `worktree` | `haiku` | `gpt-5.6-luna` | `low` |
| `acceptance_specs` | `sonnet` | `gpt-5.6-terra` | `medium` |
| `build` | `sonnet` | `gpt-5.6-terra` | `low` |
| `build_review` | `opus` | `gpt-5.6-sol` | `high` |
| `wiring_check` | `sonnet` | `gpt-5.6-terra` | `low` |
| `manual_test` | `sonnet` | `gpt-5.6-terra` | `medium` |
| `prd_audit` | `opus` | `gpt-5.6-sol` | `high` |
| `architecture_review_as_built` | `sonnet` | `gpt-5.6-terra` | `medium` |
| `retro` | `sonnet` | `gpt-5.6-terra` | `medium` |
| `rebase` | `fable` | `gpt-5.6-sol` | `max` |
| `finish` | `haiku` | `gpt-5.6-luna` | `low` |
| `remediate` | `fable` | `gpt-5.6-sol` | `high` |
| `attribution_verify` | `opus` | `gpt-5.6-sol` | `high` |

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given either built-in provider and no model or effort override,
  when every engine step is resolved, then its base model and effort equal the
  selected provider's row in the policy matrix.
- **HP-2:** Given a complexity tier, when tier-aware steps are resolved, then
  `stories` uses effort `low` at S, `medium` at M, and `high` at L;
  `explore` uses effort `low` at S and `high` at M/L; `plan` uses effort
  `medium` at S, `high` at M, and `xhigh` at L; and L-tier `plan` and
  `conflict_check` use the selected provider's deepest model (`fable` for
  Claude, `gpt-5.6-sol` for Codex).

#### Negative Paths

- **NP-1 (covers HP-1):** Given Codex is selected, when the complete engine
  step set is resolved, then every model is one of `gpt-5.6-luna`,
  `gpt-5.6-terra`, or `gpt-5.6-sol`; no step is missing and no `haiku`,
  `sonnet`, `opus`, or `fable` value is returned.
- **NP-2 (covers HP-2):** Given tier S or M, when `plan` and
  `conflict_check` are resolved, then neither is promoted to the selected
  provider's deepest model; and given any non-tier-aware step, changing S/M/L
  does not change its model or effort.

### Done When

- [ ] An exhaustive provider × step test equals the 24-row policy matrix and
      fails if a step is added without both built-in-provider entries.
- [ ] A provider × tier × tier-aware-step test equals the stated S/M/L model
      and effort outcomes.
- [ ] A Codex-default test proves that no resolved engine step contains a
      Claude model alias.
- [ ] Provider × tier tests prove both `explore` and `prd` start at `high`
      outside `explore.S`, and attempt 2 raises those base efforts to `xhigh`.

---

## Story: Explicit overrides remain provider-native and keep their precedence

**Requirement:** Technical intent #902; ADR Decision 4

As a harness operator, I want existing overrides to remain authoritative and
opaque so that provider-aware defaults do not reinterpret project or run-level
choices.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given conflicting model or effort values at multiple levels, when
  a step is resolved for either built-in provider, then the existing precedence
  remains CLI override → step tier → step → phase tier → phase → defaults →
  built-in tier value → built-in base value.
- **HP-2:** Given an explicit model string from either provider family, when it
  wins resolution, then that exact string is returned without alias
  translation, normalization, or provider-family validation.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a higher-precedence value is present and a
  lower-precedence built-in policy value differs, when resolution runs, then
  the lower value never replaces the higher one for either model or effort.
- **NP-2 (covers HP-2):** Given `sonnet` is explicitly configured while Codex
  is selected, or `gpt-5.6-sol` is explicitly configured while Claude is
  selected, when the step is resolved, then the explicit value is returned
  byte-for-byte rather than translated to the selected provider's table.

### Done When

- [ ] A table-driven test exercises every precedence boundary for both
      built-in providers and asserts model and effort independently.
- [ ] Cross-provider explicit model strings round-trip byte-for-byte in
      resolver tests.
- [ ] Existing retry count, review mode, hooks, disable, and escalation
      precedence tests remain green.

---

## Story: The selected provider policy reaches every execution path

**Requirement:** Technical intent #902; ADR Decision 1; architecture-review
Wiring Surface

As a harness operator, I want every execution mode to use the policy associated
with the selected provider so that Codex behavior does not depend on which
entry point dispatched a step.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given Codex is selected, when equivalent work is dispatched through
  inline execution, daemon execution, grouped-step resolution, the default
  step runner, or attribution verification, then each path resolves the same
  Codex-native model and effort for that step and tier.
- **HP-2:** Given an installed provider key without a built-in policy, when
  work starts, then the selected provider instance still executes with the
  legacy Claude model/effort policy and one compatibility warning is emitted
  for the process.

#### Negative Paths

- **NP-1 (covers HP-1):** Given Codex is selected on any listed execution path,
  when a step without explicit overrides is dispatched, then the path does not
  silently resolve through Claude defaults.
- **NP-2 (covers HP-2):** Given a process performs multiple resolutions for
  the same unknown provider key, when all resolutions complete, then execution
  does not fail or swap provider instances and the compatibility warning count
  remains exactly one; selecting known `claude` or `codex` emits no
  compatibility warning.

### Done When

- [ ] An integration matrix covers inline, daemon, grouped-step, default-runner,
      and attribution paths with a Codex-only expected model.
- [ ] A reachability check fails if a production step-resolution path can run
      without the selected built-in or compatibility policy.
- [ ] Unknown-provider tests assert Claude-compatible resolution, unchanged
      provider-instance dispatch, exactly one warning across repeated
      resolutions, and zero warnings for known providers.

---

## Story: Retry escalation climbs the selected provider's model order

**Requirement:** Technical intent #902; ADR Decisions 2–4; extension of
`retry-as-escalation`

As a harness operator, I want retry escalation to use provider-native model
rungs so that a harder Codex retry never crosses into a Claude alias and Claude
retry behavior remains unchanged.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given a Codex step with escalation enabled, when attempts advance,
  then attempt 1 uses the resolved base model/effort, attempt 2 bumps effort one
  rung in `low → medium → high → xhigh → max`, and attempt 3+ cumulatively
  bumps the base model `(attempt − 2)` rungs through
  `gpt-5.6-luna → gpt-5.6-terra → gpt-5.6-sol`, capped at Sol.
- **HP-2:** Given a Claude step with escalation enabled, when the same attempt
  sequence runs, then model escalation remains
  `haiku → sonnet → opus → fable`, effort ordering remains unchanged, and the
  existing attempt-indexed results are identical to the pre-#902 contract.
- **HP-3:** Given a retry that does not consume retry budget, when that work is
  re-run, then it uses the same provider-native model and effort rung; only an
  incremented attempt number advances escalation.

#### Negative Paths

- **NP-1 (covers HP-1):** Given a Codex base model already at
  `gpt-5.6-sol`, or an effort already at `max`, when later attempts run, then
  the value remains capped and no Claude alias or value outside the declared
  effort order is produced.
- **NP-2 (covers HP-2):** Given Claude is selected, when escalation reaches
  any rung, then no Codex model ID appears and no Claude rung changes position
  relative to the accepted pre-#902 sequence.
- **NP-3 (covers HP-3):** Given a rate-limit, stale-session, or authentication
  park-and-retry branch re-runs the current attempt, when it dispatches again,
  then neither model nor effort advances and no extra budget-consuming attempt
  is recorded.
- **NP-4:** Given escalation is disabled, when any retry attempt runs, then the
  exact resolved base model and effort remain pinned; and given an explicit
  model absent from the selected provider's escalation order, model escalation
  leaves that opaque model unchanged.

### Done When

- [ ] Provider × base-rung × attempt tests prove both cumulative model orders,
      effort bumping, and top-rung caps.
- [ ] Tests prove escalation-disabled and off-order explicit models remain
      unchanged for both providers.
- [ ] Existing non-consuming retry and retry-budget assertions pass with
      provider-native expected values.

---

## Story: Model-unavailability fallback descends the selected provider's ladder

**Requirement:** Technical intent #902; ADR Decisions 2–4; extension of
`model-availability-fallback-ladder`

As a harness operator, I want unavailable models to fall back within the
selected provider's family so that Codex can degrade safely without consuming
extra retry attempts and Claude fallback behavior remains unchanged.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given Codex is selected with no explicit fallback ladder, when
  `gpt-5.6-sol` is unavailable, then the same attempt walks
  `gpt-5.6-sol → gpt-5.6-terra → gpt-5.6-luna` until one succeeds.
- **HP-2:** Given Claude is selected with no explicit fallback ladder, when
  `fable` is unavailable, then the same attempt retains the accepted
  `fable → opus → sonnet` walk.
- **HP-3:** Given an explicit `model_fallback_ladder`, when a model is
  unavailable under either provider, then that exact configured order replaces
  the provider default.
- **HP-4:** Given an explicit base model that is absent from the active ladder,
  when that model reports `modelUnavailable`, then the same attempt starts at
  the active ladder's first live entry.

#### Negative Paths

- **NP-1 (covers HP-1):** Given each Codex rung in turn is unavailable, when
  the walk runs, then every dead rung is skipped in order; if all three are
  unavailable, the last ordinary failure is returned only after Luna and no
  Claude alias is invoked.
- **NP-2 (covers HP-2):** Given Claude is selected, when fallback occurs,
  then no Codex model is invoked and the pre-#902 Claude sequence is unchanged.
- **NP-3 (covers HP-3):** Given an explicitly configured empty ladder, when
  the requested model is unavailable, then no fallback invocation occurs and
  the failure proceeds to normal retry/HALT behavior.
- **NP-4 (covers HP-4):** Given an off-ladder explicit model succeeds, when
  the attempt runs, then exactly that model is invoked once; and given it
  fails for a reason other than `modelUnavailable` (including rate limit or
  authentication failure), the ladder does not advance or cache the model as
  unavailable.

### Done When

- [ ] Invocation-sequence tests cover success and unavailability at every
      Codex ladder position, full Codex exhaustion, and unchanged Claude
      sequences.
- [ ] Tests prove configured ladder precedence, deliberate empty-ladder
      behavior, and off-ladder explicit-model behavior for both providers.
- [ ] Tests assert that an in-attempt ladder walk does not increment the retry
      attempt and non-unavailability failures do not poison the availability
      cache.

---

## Story: Generated model documentation distinguishes provider and execution path

**Requirement:** Technical intent #902; ADR Decision 5; extension of
`generated-model-table`

As a harness maintainer, I want generated model documentation to identify both
built-in provider policies and the Claude-only interactive path so that the
document cannot imply that one provider's values apply universally.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given the generated model-selection table, when an engine-step row
  is read, then it presents the Claude and Codex model/effort values from the
  policy matrix and shows every relevant S/M/L variation with unambiguous
  provider labels.
- **HP-2:** Given a standalone interactive skill row or a `SKILL.md` model pin,
  when it is rendered or validated, then it is explicitly identified as the
  Claude interactive path and its pin is compared with the Claude policy.
- **HP-3:** Given both built-in policy tables and the committed generated
  region agree, when model-table and harness-integrity checks run, then they
  pass without requiring hand-authored duplicate policy data.

#### Negative Paths

- **NP-1 (covers HP-1):** Given one Claude value, Codex value, effort, tier
  variant, provider label, or engine step is removed or changed only in the
  committed generated region, when check mode runs, then it fails with a diff
  naming the drift.
- **NP-2 (covers HP-2):** Given a Codex policy value differs from the Claude
  pin for an interactive skill, when pin validation runs, then that Codex
  difference alone does not fail the Claude-path pin check; but an actual
  Claude-policy/pin mismatch still fails by skill name.
- **NP-3 (covers HP-3):** Given a new engine step lacks either built-in
  provider value, or generated output omits one provider's value, when
  type/integrity checks run, then they fail rather than silently emitting a
  partial row.

### Done When

- [ ] The regenerated engine table contains provider-labelled model and effort
      values for all 24 steps and their tier variations.
- [ ] Interactive-only rows are visibly labelled Claude-path, and pin tests
      prove they compare only against the Claude policy.
- [ ] Clean, provider-drift, missing-provider-entry, and Claude-pin-drift
      fixtures exercise the generator and integrity gates.
- [ ] The generated-table check and full harness-integrity suite pass with the
      committed document.
