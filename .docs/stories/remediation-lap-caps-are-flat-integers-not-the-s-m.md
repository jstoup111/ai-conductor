**Status:** Accepted

# Stories: Remediation lap allowance derives from the feature's complexity tier

Source: jstoup111/ai-conductor#2413. Track: technical (no PRD). Tier: M.

`prd_audit` and `architecture_review_as_built` bound remediation by laps recorded in the kickback
ledger. Today each gate's allowance is one flat integer for every feature, so Small features get
more laps than they need while Large features halt `needs-human` on ordinary convergence. These
stories make the allowance follow the feature's complexity tier (Small 2, Medium 3, Large 4), keep
operator configuration and per-feature raises in control, and make every lap-cap surface name the
tier and allowance it measured against. Pinning the allowance at the first lap and the serial
prd-audit impl-gap path are out of scope.

## Story 1: An unconfigured gate grants the tier's default allowance

**Requirement:** #2413 desired outcomes 1, 4

As an operator, I want a feature's remediation lap allowance to follow its complexity tier when I
have configured nothing, so that Large features converge without a hand-raised cap and Small
features do not spend laps they never need.

### Acceptance Criteria

#### Happy Path
- Given neither the user nor the project config sets `max_remediation_laps` for either gate, and a feature recorded at tier S, when its allowance for `prd_audit` and for `architecture_review_as_built` is resolved, then each is 2.
- Given the same unconfigured repository and a feature recorded at tier M, when both allowances are resolved, then each is 3.
- Given the same unconfigured repository and a feature recorded at tier L whose `architecture_review_as_built` ledger records 3 laps, when a fourth as-built remediation round reaches BUILD dispatch, then the lap is charged and BUILD dispatches without a `kickback-cap` halt.
- Given the same unconfigured repository and a feature recorded at tier L whose `architecture_review_as_built` ledger records 4 laps, when another as-built remediation round reaches BUILD dispatch, then the feature halts with the `kickback-cap` class.

#### Negative Paths
- Given a project config that has a `prd_audit` block (for example only `max_appended_tasks: 5`) and an `architecture_review_as_built` block (for example only `remediation.enabled: true`) but no `max_remediation_laps` in either, and a user config that sets neither key, when the config is loaded through the normal project-plus-user load path and a tier-L feature's allowance is resolved, then each gate's allowance is 4, never 1.
- Given an unconfigured repository and a feature with no recorded complexity tier, when both allowances are resolved, then each is 3 (treated as tier M), never 4.
- Given an unconfigured repository and a feature recorded at tier S whose `prd_audit` ledger records 2 laps, when another prd_audit remediation round reaches BUILD dispatch, then the feature halts with the `kickback-cap` class and no third lap is charged.

### Done When
- [ ] With no `max_remediation_laps` set at any config layer, both gates resolve S → 2, M → 3, L → 4, and no recorded tier → 3.
- [ ] A loaded config in which no layer sets `max_remediation_laps` carries no materialized value for that key under either gate.
- [ ] A test drives a lap-cap halt for an unconfigured tier-S feature after 2 laps and an unconfigured tier-L feature after 4 laps.

## Story 2: Operators override the allowance per gate, per tier or for every tier

**Requirement:** #2413 desired outcome 2

As an operator, I want to set a gate's allowance either once for every tier or separately per
tier, so that I can tune one tier without changing the others.

### Acceptance Criteria

#### Happy Path
- Given a project config setting `prd_audit.max_remediation_laps: 5`, when the `prd_audit` allowance is resolved for features at tiers S, M, and L and for a feature with no recorded tier, then each is 5.
- Given a project config setting `architecture_review_as_built.max_remediation_laps: { L: 6 }`, when that gate's allowance is resolved, then a tier-L feature gets 6, a tier-S feature gets 2, a tier-M feature gets 3, and a feature with no recorded tier gets 3.
- Given a user config setting `prd_audit.max_remediation_laps: { S: 1 }` and a project config setting `prd_audit.max_remediation_laps: { L: 5 }`, when the merged config resolves the `prd_audit` allowance, then tier S gets 1, tier M gets 3, and tier L gets 5.
- Given a user config setting `prd_audit.max_remediation_laps: { L: 5 }` and a project config setting `prd_audit.max_remediation_laps: 2`, when the merged config resolves the `prd_audit` allowance, then every tier gets 2.

#### Negative Paths
- Given a project config setting `prd_audit.max_remediation_laps: 0`, when the config is loaded, then loading fails with an error naming `prd_audit.max_remediation_laps` and stating it must be a positive integer or a map of S, M, L to positive integers.
- Given a project config setting `architecture_review_as_built.max_remediation_laps: { XL: 3 }`, when the config is loaded, then loading fails with an error naming `architecture_review_as_built.max_remediation_laps.XL` as an unknown tier.
- Given a project config setting `architecture_review_as_built.max_remediation_laps: { M: 2.5 }`, when the config is loaded, then loading fails with an error naming `architecture_review_as_built.max_remediation_laps.M` and stating it must be a positive integer.
- Given a project config setting `prd_audit.max_remediation_laps: "3"`, when the config is loaded, then loading fails with an error naming `prd_audit.max_remediation_laps`; the string is never coerced to a number.
- Given a project config setting `prd_audit.max_remediation_laps: {}`, when the `prd_audit` allowance is resolved, then every tier gets its default (S 2, M 3, L 4).
- Given a project config setting `prd_audit.max_remediation_laps: { L: 6 }` only, when the `architecture_review_as_built` allowance is resolved for a tier-L feature, then it is 4; one gate's configuration never changes the other gate's allowance.

### Done When
- [ ] Both gates accept a positive integer or a map whose keys are a subset of S, M, L with positive-integer values, and reject every other shape at config load with a path-named error.
- [ ] An integer applies to every tier, including a feature with no recorded tier; a map entry applies to its tier; a tier missing from the map keeps its default.
- [ ] Merged user and project maps combine per tier with the project winning, and an integer at either layer replaces a map at the other.

## Story 3: The allowance follows the feature's current tier, and an operator raise still wins

**Requirement:** #2413 desired outcomes 1, 2

As an operator, I want every lap-cap check to use the tier the feature has when the check runs,
and my `kickback-budget raise` to keep overriding it, so that a tier recorded mid-run is honored and
my per-feature grant is never undone by the new defaults.

### Acceptance Criteria

#### Happy Path
- Given an interactive run of a feature that starts with no recorded tier and records tier L at its complexity step, with no config override, when a prd_audit remediation round later reaches BUILD dispatch with 3 laps recorded, then the lap is charged against an allowance of 4 and BUILD dispatches.
- Given a tier-M feature whose `architecture_review_as_built` gate was raised by `kickback-budget raise --by 2` after halting at 3/3, when the next as-built round reaches BUILD dispatch, then the lap is charged against the raised allowance of 5.
- Given a tier-L feature with no config override, when the validation-group join computes its remediation round bound, then the bound is never lower than the tier-L allowance of 4.

#### Negative Paths
- Given an interactive run of a feature that records tier L at its complexity step, with no config override, when a prd_audit refusal-rework round is admitted with 3 laps recorded, then it is not refused as exhausted; an allowance computed before the tier was recorded is never used.
- Given a feature whose recorded tier changes from L to S between laps and whose `prd_audit` ledger records 3 laps, when the next prd_audit round reaches BUILD dispatch, then it halts with the `kickback-cap` class against an allowance of 2.
- Given a tier-L feature with a project config `architecture_review_as_built.max_remediation_laps: 2` and an operator raise to 5, when the next as-built round reaches BUILD dispatch with 4 laps recorded, then the raised allowance of 5 applies, not 2 and not 4.

### Done When
- [ ] Every enforcement check for both gates resolves the allowance with the feature's tier at the moment of the check, including the refusal-rework admission check.
- [ ] A recorded operator raise overrides the configured and default allowance at every enforcement check.
- [ ] A test records the tier after the run starts and proves the later check uses that tier's allowance.

## Story 4: Lap-cap halts and budget views name the tier and allowance

**Requirement:** #2413 desired outcome 3

As an operator reading a lap-cap halt or checking a feature's budget, I want to see which tier the
allowance came from and where its value came from, so that I can tell an ordinary tier limit from a
misconfiguration without opening the config or the ledger.

### Acceptance Criteria

#### Happy Path
- Given an unconfigured tier-L feature that halts at BUILD dispatch because its `architecture_review_as_built` ledger records 4 laps, when the halt reason is written, then it contains `Kickback budget (architecture_review_as_built): 4/4 consumed; 0 remaining` followed by `tier L allowance 4 (default)`.
- Given a tier-M feature with `prd_audit.max_remediation_laps: { M: 5 }` and 1 recorded lap, when the operator runs `ai-conductor kickback-budget inspect --feature <slug>`, then the `prd_audit` line contains `1/5 consumed; 4 remaining` and `tier M allowance 5 (configured)`, and the JSON view for that gate carries `tier: "M"`, `limit: 5`, and `allowanceSource: "configured"`.
- Given a tier-M feature whose `architecture_review_as_built` gate was raised from 3 to 5, when the operator runs inspect, then that gate's line contains `tier M allowance 5 (raised from 3)` and the JSON view carries `allowanceSource: "raised"`.
- Given an in-progress unconfigured tier-S feature with 1 recorded `prd_audit` lap, when the operator runs `ai-conductor daemon status` and `kickback-budget inspect`, then both show `1/2 consumed; 1 remaining` and `tier S allowance 2 (default)` for that gate.

#### Negative Paths
- Given an unconfigured feature with no recorded tier that halts at its `prd_audit` lap cap, when the halt reason is written, then it contains `3/3 consumed` and `tier unrecorded, treated as M; allowance 3 (default)`, and never names tier L or an allowance of 4.
- Given a prd_audit refusal-rework round refused because the lap allowance is spent on a tier-S feature, when the refusal halt reason is written, then it contains `tier S allowance 2 (default)`.
- Given a feature whose remediation-gate ledger entry fails validation, when the operator runs daemon status, then that gate still reads `budget unavailable (durable entry failed validation)` with no tier or allowance figure.
- Given a feature whose `conduct-state.json` cannot be read, when the operator runs `kickback-budget inspect`, then the command exits 0 and renders that feature's allowance as `tier unrecorded, treated as M`.
- Given a feature with a `build_review` budget of 4 consumed of 6, when the operator runs `kickback-budget inspect` or `daemon status`, then the `build_review` line reads `Kickback budget (build_review): 4/6 consumed; 2 remaining` with no tier or allowance suffix, and its JSON view carries no `tier` or `allowanceSource` field.

### Done When
- [ ] The tier-and-allowance suffix and JSON fields appear only for `prd_audit` and `architecture_review_as_built`; `build_review` budget output is unchanged.
- [ ] Every lap-cap halt for either gate, the refusal-rework halt, `kickback-budget inspect` (human and JSON), and `daemon status` render the tier (or `unrecorded, treated as M`), the allowance, and its source (`default`, `configured`, or `raised from <n>`).
- [ ] Halt, inspect, and daemon status show identical tier and allowance for the same feature and gate.
- [ ] The inspect JSON view for each remediation gate carries `tier` (`"S"`, `"M"`, `"L"`, or `null`) and `allowanceSource`.

## Story 5: This repository's builds use the tier defaults

**Requirement:** #2413 desired outcome 1 (impact)

As the operator of this repository's daemon, I want the TEMPORARY lap-cap overrides, and the
TEMPORARY growth grant tied to them, reverted in the root config, so that this repository's own
features get tier-derived allowances instead of the flat values granted for earlier stuck
features.

### Acceptance Criteria

#### Happy Path
- Given this repository's committed `.ai-conductor/config.yml`, when it is read, then neither `prd_audit` nor `architecture_review_as_built` sets `max_remediation_laps`.
- Given this repository's committed config and a tier-L feature built here, when its allowances are resolved, then each gate's allowance is 4.
- Given this repository's committed config, when `prd_audit.max_appended_tasks` is resolved, then it is 8, the value configured before the 2026-09-04 TEMPORARY grant raised it to 10.

#### Negative Paths
- Given this repository's committed config after the reverts, when it is loaded, then loading succeeds, `prd_audit.max_appended_ratio` still resolves to 0.8, and `architecture_review_as_built.remediation.enabled` still resolves to true.
- Given this repository's committed config and a tier-S feature built here, when its `architecture_review_as_built` allowance is resolved, then it is 2, not the former flat 3.

### Done When
- [ ] The root `.ai-conductor/config.yml` carries no `max_remediation_laps` key for either gate, sets `prd_audit.max_appended_tasks: 8`, and keeps no TEMPORARY comment for any of the three reverted grants.
- [ ] The root config loads successfully, with every other setting unchanged.
