**Status:** Accepted

# Stories: Support Astra in the daemon

**Source:** Approved PRD `2026-09-10-support-astra-in-the-daemon.md`
**Architecture:** `architecture-review-2026-09-10-support-astra-in-the-daemon.md`
**Tier:** M

These scenarios specialize existing provider selection, fallback, retry, and pricing behavior for opt-in Astra. They do not replace the existing provider contracts or their default-model assignments.

## Story 1: Select Astra for configured Codex work

**Requirement:** FR-1

As an operator, I want configured Codex work to use Astra so that I can choose it for selected work.

### Acceptance Criteria

#### Happy Path

- Given Codex is the selected provider and Astra wins an existing configuration precedence path, when the daemon dispatches that work, then the provider receives exactly `gpt-6-astra` and the resolved effort. This applies to defaults, phase, phase-tier, step, step-tier, and independently configurable auxiliary model selections.
- Given Astra is selected and succeeds, when the dispatch completes, then the execution result identifies Astra as the actual model without an additional model-availability probe.

#### Negative Paths

- Given Astra appears at a lower-precedence configuration level and a different model wins at a higher level, when work is dispatched, then the higher-precedence model runs and Astra does not override it.
- Given the provider reports an ordinary execution error for Astra, when the result is handled, then the dispatch remains a failure attributed to Astra and does not become a model-unavailability substitution.

### Done When

- [ ] Configuration-path evidence records expected and actual provider model and effort for each distinct supported selection path, including auxiliary policies.
- [ ] A production dispatch entry-point proof captures Astra's exact outbound model and returned model identity with a fake provider boundary.

## Story 2: Preserve defaults and explicit selection during retries

**Requirement:** FR-2

As an operator, I want introducing Astra support to preserve the model choices of existing configurations.

### Acceptance Criteria

#### Happy Path

- Given no explicit Astra selection, when existing Claude and Codex steps are resolved at each complexity tier, then model and effort choices match the pre-feature policies.
- Given Astra is explicitly selected and ordinary retries are enabled, when later attempts are resolved, then the model remains Astra and effort follows the existing bounded retry policy.

#### Negative Paths

- Given Sol is selected by an unchanged default and retries occur, when automatic model escalation runs, then it does not introduce Astra; unchanged default fallback behavior likewise never selects Astra without explicit configuration.
- Given Astra is selected with escalation disabled or effort already at its maximum, when work retries, then disabled escalation preserves both settings and maximum effort is not exceeded.

### Done When

- [ ] Regression evidence compares default resolution across both providers and all supported tiers with the unchanged policy expectations.
- [ ] Retry evidence captures Astra retention, effort bounds, disabled escalation, and absence of implicit Astra promotion from Sol.

## Story 3: Recover from Astra unavailability using declared fallback

**Requirement:** FR-3, FR-4

As an operator, I want unavailable Astra work to follow my existing fallback choices and expose the model that actually ran.

### Acceptance Criteria

#### Happy Path

- Given Astra is selected outside the default Codex fallback ladder, when Astra reports model unavailability and Sol succeeds, then the invocation sequence is Astra followed by Sol within the same attempt, and the result identifies Sol with the existing downgrade diagnostic.
- Given an explicitly configured model fallback sequence, when Astra and an intermediate candidate are unavailable, then the daemon tries the next declared live candidate in order, without substituting an undeclared model.
- Given all Codex model candidates are unavailable and Claude is an explicitly declared provider fallback, when provider fallback occurs, then Claude receives its own resolved native settings and the result identifies the actual provider and model.

#### Negative Paths

- Given an explicitly empty model fallback ladder and no alternate provider, when Astra reports model unavailability, then only Astra is invoked and the existing failure reaches ordinary retry handling.
- Given Astra and every declared fallback model are unavailable and no alternate provider remains, when the ladder is exhausted, then the final failure is returned without an infinite walk or a fabricated success.
- Given an Astra attempt reports an authentication failure, rate limit, or expired session, when recovery is selected, then that recovery category retains its existing handling and does not mark Astra unavailable or trigger a model downgrade, including conflicting model-unavailable metadata.

### Done When

- [ ] Provider-boundary evidence records exact invocation sequences, attempt counts, actual model identities, and downgrade reasons for default, explicit, empty, and exhausted fallback cases.
- [ ] Provider-switch evidence proves Astra's model and effort do not leak into a Claude fallback candidate, and recovery-category evidence proves non-availability failures do not poison model availability.

## Story 4: Maintain Astra pricing automatically

**Requirement:** FR-5

As an operator, I want ordinary pricing maintenance to include Astra so that selecting it does not require a separate manual price enrollment.

### Acceptance Criteria

#### Happy Path

- Given the configured upstream pricing source publishes valid Astra rates, when ordinary pricing refresh runs without extra model arguments, then its maintained output includes Astra alongside existing priced models.
- Given Astra pricing changes at the source, when a later ordinary refresh runs, then the maintained Astra rate reflects the new published value and remains present on subsequent refreshes.

#### Negative Paths

- Given the upstream payload lacks Astra or carries malformed Astra rates but includes other valid model rates, when refresh runs, then it reports missing Astra pricing, produces no fabricated Astra price, and retains the existing valid-model refresh behavior.
- Given fetching the upstream source fails, the payload cannot be parsed, or no requested model has usable pricing, when refresh runs, then it reports failure and leaves the previous maintained card byte-for-byte unchanged.

### Done When

- [ ] CLI-entry-point evidence with a fake pricing source proves automatic Astra inclusion, repeated refresh retention, and changed-rate propagation without extra enrollment arguments.
- [ ] Failure evidence captures missing-rate diagnostics and preservation of the prior card on whole-refresh failure.

## Story 5: Account for Astra usage using existing pricing semantics

**Requirement:** FR-5

As an operator, I want Astra execution costs and missing-price states reflected in the same accounting as other Codex work.

### Acceptance Criteria

#### Happy Path

- Given Astra returns fresh input, cached input, cache-write, and output usage with usable maintained rates, when the dispatch is accounted for, then cost equals the sum of each usage category multiplied by its applicable rate, reasoning output is not charged a second time, and existing reporting attributes the usage and cost to Astra.
- Given a dispatch already supplies valid provider-reported cost, when maintained pricing is also available, then the provider-reported amount retains precedence.

#### Negative Paths

- Given Astra returns tokens but no usable maintained rate, when accounting runs, then tokens remain visible and the dispatch is cost-unmetered, without inventing a zero-dollar measured cost; absent usage retains the existing unmetered state.
- Given Astra falls back to Sol, when the successful dispatch is priced, then Sol's applicable rates and actual model identity are used rather than Astra's rates or requested-model identity.

### Done When

- [ ] Numerical pricing evidence uses distinct injected token-category rates to demonstrate correct category accounting, provider-cost precedence, and no reasoning-token double charge.
- [ ] A provider dispatch proof captures existing reported model, usage, cost-source, and metering classification for Astra success, missing pricing, missing usage, and successful fallback.

## Negative-Category Assessment

Invalid selection precedence and malformed pricing are covered above. Authentication, rate limits, expired sessions, upstream network failure, partial pricing failure, and unavailable dependencies use their existing distinct outcomes. Data integrity is covered by price calculation, provider-cost precedence, actual-model attribution, and unchanged prior state on failed refresh. There is no new concurrent writer, deletion, entity relationship, authorization surface, exception hierarchy, resource-allocation mechanism, or persistent idempotency key; those categories introduce no feature-specific scenario.

## Verify-Claims

The approved PRD and architecture review are the behavioral authority. Configuration precedence, off-order retry retention, reactive fallback, pricing-source selection, and missing-rate behavior were verified in the current production source. These stories introduce no new load-bearing assumption. Verdict: CLEAR.
