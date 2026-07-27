**Status:** Accepted

# Stories: Model Attribution and Provider Defaults (#931)

**Source:** issue #931 and approved technical exploration
**Track:** Technical
**Complexity:** Small

These stories amend the provider-native policy accepted for issue #902 and the
per-step provider routing accepted for issue #927. They do not add provider
selection below the existing autonomous engine-step boundary; issue #964 owns
that future outcome.

## Story: Models and effort match task shape and feature size

**Requirement:** Technical intent #931 — task-fit provider-native policy

As a harness operator, I want built-in model and effort defaults to reflect each
step's execution or judgment role so that routine work avoids unnecessary token
burn without weakening high-cascade gates.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given either built-in provider and no explicit model or effort
  override, when an affected step is resolved, then it receives the following
  provider-native policy:

  | Step | Claude model | Codex model | Effort |
  |---|---|---|---|
  | `explore` | `opus` | `gpt-5.6-sol` | `low` at S; `high` at M/L |
  | `conflict_check` | `opus` at S/M; `fable` at L | `gpt-5.6-terra` at S/M; `gpt-5.6-sol` at L | `medium` |
  | `plan` | `opus` at S/M; `fable` at L | `gpt-5.6-terra` at S/M; `gpt-5.6-sol` at L | `medium` at S; `high` at M; `xhigh` at L |
  | `acceptance_specs` | `opus` | `gpt-5.6-sol` | `medium` at S/M; `high` at L |
  | `build` | `sonnet` | `gpt-5.6-terra` | `medium` at S/M; `high` at L |
  | `build_review` | `fable` | `gpt-5.6-sol` | `high` |
  | `prd_audit` | `fable` | `gpt-5.6-sol` | `high` |
  | `architecture_review_as_built` | `fable` | `gpt-5.6-sol` | `high` |
  | `rebase` | `opus` | `gpt-5.6-terra` | `high` |
  | `finish` | `haiku` | `gpt-5.6-luna` | `medium` |
  | `remediate` | `fable` | `gpt-5.6-sol` | `medium` |

- **HP-2:** Given a built-in step not listed in HP-1, when its policy is
  resolved at S, M, and L, then its existing provider-native model, effort, and
  tier behavior remain unchanged.

- **HP-3:** Given the policy table changes, when model documentation is
  generated, then every affected autonomous row displays the exact provider,
  model, effort, size variation, and task-fit rationale from HP-1.

#### Negative Paths

- **NP-1 (covers HP-1):** Given an affected step is resolved for Claude or
  Codex, when every S/M/L combination is inspected, then no model from the
  other provider family appears and no unspecified size silently falls back to
  the superseded model or effort.

- **NP-2 (covers HP-2):** Given the policy amendment is applied, when the
  complete provider × step × tier matrix is compared, then no unlisted step
  changes and every newly introduced engine step still requires an explicit
  policy entry for both built-in providers.

- **NP-3 (covers HP-3):** Given generated documentation is stale or its
  rationale contradicts the executable policy, when the model-table drift gate
  runs, then verification fails instead of publishing mismatched guidance.

### Done When

- [ ] An exhaustive provider × affected-step × S/M/L test equals HP-1.
- [ ] A full-policy regression test proves all HP-2 rows remain byte-for-byte unchanged.
- [ ] The generated model-selection table contains the HP-1 outcomes and passes its drift and completeness checks.
- [ ] Existing explicit model/effort precedence, retry escalation, and model-unavailability fallback tests remain green.

## Story: This repository routes execution to Codex and judgment to Claude

**Requirement:** Technical intent #931 — project-local provider defaults

As an ai-conductor maintainer, I want this repository to prefer Codex for
execution-oriented engine steps and Claude for judgment-oriented engine steps
so that self-hosted runs use the approved provider split without requiring
manual selection on every feature.

### Acceptance Criteria

#### Happy Path

- **HP-1:** Given this repository's committed configuration, when a step has no
  explicit Claude preference, then Codex is attempted first and Claude remains
  the ordered fallback provider.

- **HP-2:** Given a self-hosted run reaches `explore`, `prd`,
  `architecture_review`, `conflict_check`, `coherence_check`,
  `acceptance_specs`, `build_review`, `prd_audit`,
  `architecture_review_as_built`, `rebase`, or the configured
  `maintain-documentation` step, when
  that step is dispatched, then Claude is attempted first and Codex remains
  its ordered fallback.

  Out-of-band `assess`, `remediate`, and `attribution_verify` retain the
  inherited provider because current configuration does not recognize them as
  configurable built-in steps; issue #964 owns that missing seam.

- **HP-3:** Given `manual_test` is configured as disabled for this repository,
  when provider defaults are added, then it remains disabled and the existing
  downstream skip semantics are unchanged.

#### Negative Paths

- **NP-1 (covers HP-1):** Given Codex is unavailable for a Codex-first step,
  when provider fallback runs, then Claude executes with Claude-native defaults
  and the fallback is reported visibly; no Codex model string is carried over.

- **NP-2 (covers HP-2):** Given Claude is unavailable for a Claude-first
  judgment step, when provider fallback runs, then Codex executes with
  Codex-native defaults and the fallback is reported visibly; no Claude model
  string is carried over.

- **NP-3 (covers HP-3):** Given both provider configuration and
  `manual_test.disable: true` are present, when configuration is loaded, then
  the file remains valid and `manual_test` is not dispatched.

### Done When

- [ ] Loading the committed repository configuration proves the global order is Codex then Claude and every HP-2 step prefers Claude.
- [ ] Existing provider-spy tests for both fallback directions remain green, proving native model/effort re-resolution without cross-family leakage.
- [ ] The committed repository configuration still disables `manual_test` and passes existing schema validation.
- [ ] No nested generator, evaluator, TDD phase, domain reviewer, specialist, or standalone skill gains an independent provider setting under issue #931.
