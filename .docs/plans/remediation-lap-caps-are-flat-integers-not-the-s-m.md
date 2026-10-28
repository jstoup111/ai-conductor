# Implementation Plan: Remediation lap allowance derives from the feature's complexity tier

**Date:** 2026-10-25
**Design:** .docs/decisions/architecture-review-2026-10-25-remediation-lap-caps-are-flat-integers-not-the-s-m.md
**Stories:** .docs/stories/remediation-lap-caps-are-flat-integers-not-the-s-m.md
**Conflict check:** Clean as of 2026-10-25 (.docs/conflicts/2026-10-25-remediation-lap-caps-are-flat-integers-not-the-s-m.md)

## Summary

Make the `prd_audit` and `architecture_review_as_built` remediation lap allowance a function of
(gate, config, feature tier) with defaults S 2 / M 3 / L 4 and no-tier → M. Config takes an
integer or an S/M/L map, enforcement resolves with the tier at every check, and halts, inspect and
daemon status name the tier and allowance. The root config's TEMPORARY grants are reverted.
10 tasks.

## Technical Approach

- **Config shape (`src/conductor/src/engine/config.ts`).** `validatePrdAuditBlock` and
  `validateArchitectureReviewAsBuiltBlock` accept `max_remediation_laps` as a positive integer or a
  plain object whose keys are a subset of `VALID_COMPLEXITY_TIERS` with positive-integer values.
  Each error names the full path (`<gate>.max_remediation_laps[.<tier>]`). `resolvePrdAuditBlock` and
  `resolveArchitectureReviewAsBuiltBlock` stop writing `max_remediation_laps` when it is absent, and
  `PRD_AUDIT_DEFAULTS` / `ARCHITECTURE_REVIEW_AS_BUILT_DEFAULTS` drop that key. Every other default
  stays materialized. User and project layers already combine through `mergeConfigs` → `deepMerge`
  (plain objects merge per key, the project wins, and anything else replaces), so the map form
  merges per tier with no new merge code.
- **One resolver (`src/conductor/src/engine/remediation-caps.ts`).** A new exported
  `resolveRemediationLapAllowance(gate, config, tier)` returns `{ limit, tier, source }`:
  - `source` is `configured` for an integer, or for a map entry for the tier.
  - Otherwise it is `default` from a `REMEDIATION_LAP_TIER_DEFAULTS` table (S 2, M 3, L 4).
  - An undefined tier resolves as M, with `tier` left undefined so renderers can say "unrecorded".
  - `remediationLapCapForGate`, `kickbackBudgetFallbackLimit`, `validationJoinRemediationRoundCap`
    and `pendingRepairSettlementBudgets` gain a `tier` parameter and delegate to it. The `?? 1`
    fallbacks are removed.
  - Precedence at every use stays `effectiveLapCap ?? resolved.limit`.
- **Lazy tier at enforcement (`src/conductor/src/engine/conductor.ts`).**
  - `planRemediation`, the BUILD-dispatch settlement closure, the validation-join round cap and the
    refusal-rework admission blocker pass `state.complexity_tier` at the moment they evaluate.
  - The pre-loop `prdAuditRemediationLapCap` constant in `run()` becomes a function that resolves
    with the current state on each call. The serial impl-gap call sites keep calling it, unchanged
    otherwise (out of scope).
- **Rendering (`src/conductor/src/engine/kickback-budget-view.ts`).**
  - `kickbackBudgetView` / `renderKickbackBudgetView` accept an optional allowance descriptor
    (`tier`, resolved limit, source). For remediation gates only, they append to the existing line
    `Kickback budget (<gate>): <c>/<l> consumed; <r> remaining`:
    - ` — tier <T> allowance <l> (default|configured)`;
    - ` — tier <T> allowance <l> (raised from <resolved>)` when `effectiveLapCap` is set;
    - ` — tier unrecorded, treated as M; allowance <l> (default|configured)` when no tier is recorded.
  - The JSON view gains `tier` (`"S"|"M"|"L"|null`) and `allowanceSource`
    (`"default"|"configured"|"raised"`) for remediation gates only. `build_review` output is
    byte-unchanged.
- **Operator surfaces.** `kickback-budget-cli.ts` `defaultsFor` reads the tier from the feature
  worktree's `.pipeline/conduct-state.json` (`readState`). An unreadable state renders as unrecorded
  and is never an error. `daemon-observe-cli.ts` passes the visible entry's `tier`. Both build the
  descriptor through the same resolver the halts use, so halt, inspect and status agree.
- **Root config.**
  - Remove `max_remediation_laps` from both gates in `.ai-conductor/config.yml`.
  - Restore `prd_audit.max_appended_tasks: 8`, the #2131 value before the 2026-09-04 TEMPORARY
    grant.
  - Delete the three TEMPORARY comments.
  - Keep `max_appended_ratio: 0.8` and the empty `architecture_review_as_built` block's other
    defaults.
- **Sequencing.** Config shape → resolver → conductor wiring, serialized because the tasks share
  `conductor.ts` → view → halts / CLI / status. The root-config revert depends only on the config
  shape and the resolver.

**Local pattern basis.**
- **Path-named config errors.** Follow the existing `validatePrdAuditBlock` positive-integer branch
  and `validateByTier` in `config.ts`.
  - Keep: a typed `ConfigError` returned from validation, never a thrown error or a clamp.
  - May vary: the message text.
- **Budget rendering.** Follow `renderKickbackBudgetView` in `kickback-budget-view.ts`, which already
  takes the fallback limit from its caller.
  - Keep: one render function shared by halts, inspect and daemon status.
  - May vary: an added optional parameter.
- **Tests that read the repo's own config.** Follow the acceptance tests that resolve
  `.ai-conductor/config.yml` from the repo root (search `test/acceptance` for `.ai-conductor`).

## Prerequisites

- None. `ConductState.complexity_tier` exists. The daemon seeds it from the backlog tier, and the
  interactive complexity step records it.

## Tasks

### Task 1: Config accepts an integer or an S/M/L map and stops materializing the lap default
**Story:** Story 2 (negative paths 1–4), Story 1 Done When
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`:
   - Validation of `0`, `"3"`, `{ XL: 3 }`, `{ M: 2.5 }`, and acceptance of `5`, `{}`, `{ L: 6 }`, for both gates.
   - A config with `prd_audit: { max_appended_tasks: 5 }` and `architecture_review_as_built: { remediation: { enabled: true } }` resolves with no `max_remediation_laps` key in either block, while the other defaults are still present.
2. Verify RED.
3. Implement in `config.ts`, following the existing positive-integer branch and `validateByTier`. Return a typed `ConfigError` naming the full path, never a thrown error or a clamp. Drop `max_remediation_laps` from `PRD_AUDIT_DEFAULTS` and `ARCHITECTURE_REVIEW_AS_BUILT_DEFAULTS`. Have the two `resolve*Block` functions copy the key only when it is set. Update the `config-consumer-registry` test entries if they pin the default.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] validatePrdAuditBlock and validateArchitectureReviewAsBuiltBlock accept a positive integer, `{}`, and a map whose keys are a subset of S, M, L with positive-integer values, as asserted in config.test.ts.
- [test] loading `prd_audit.max_remediation_laps: 0` fails with a ConfigError naming `prd_audit.max_remediation_laps` and stating it must be a positive integer or a map of S, M, L to positive integers, and loading `"3"` fails naming the same path with no coercion to a number.
- [test] loading `architecture_review_as_built.max_remediation_laps: { XL: 3 }` fails naming `architecture_review_as_built.max_remediation_laps.XL` as an unknown tier, and `{ M: 2.5 }` fails naming `architecture_review_as_built.max_remediation_laps.M` as not a positive integer.
- [test] resolvePrdAuditBlock and resolveArchitectureReviewAsBuiltBlock leave `max_remediation_laps` absent when no layer sets it, while `max_appended_tasks`, `max_appended_ratio`, and `remediation.enabled` defaults are still materialized.

**Files likely touched:**
- src/conductor/src/engine/config.ts — map validation, path-named errors, no lap default
- src/conductor/test/engine/config.test.ts — validation and resolution tests
- src/conductor/test/engine/config-consumer-registry.ts — default entries for the two keys, if pinned

**Dependencies:** none

### Task 2: One tier-aware allowance resolver behind every cap read
**Story:** Story 1 (happy paths 1–2, negative paths 1–2), Story 2 (happy paths 1–4, negative paths 5–6)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-caps.test.ts`:
   - The tier-default table for both gates and an unrecorded tier.
   - The integer and map forms, `{}`, and gate independence.
   - `source` and `tier` on the result.
   - A load-path case that writes a temp user config and a temp project config and calls `loadConfig`. Cover: project blocks with other keys but no lap key (tier L → 4 for both gates); user `{ S: 1 }` + project `{ L: 5 }`; user `{ L: 5 }` + project `2`.
2. Verify RED.
3. Implement `resolveRemediationLapAllowance(gate, config, tier)` and `REMEDIATION_LAP_TIER_DEFAULTS` in `remediation-caps.ts`. Thread a `tier` parameter through `remediationLapCapForGate`, `kickbackBudgetFallbackLimit`, `validationJoinRemediationRoundCap`, and `pendingRepairSettlementBudgets`. Update existing callers to pass `undefined` until their owning tasks wire the real tier, so the build stays green. Update `test/structural/conductor-exports.json` if the export list changes.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] resolveRemediationLapAllowance(gate, config, tier) in remediation-caps.ts returns limit 2 for tier S, 3 for tier M, 4 for tier L, and 3 for an unrecorded tier when no layer sets max_remediation_laps, for both prd_audit and architecture_review_as_built.
- [test] an integer setting yields that integer for S, M, L and an unrecorded tier; a map yields its entry for a listed tier and the tier default for unlisted tiers and for `{}`; under `{ L: 6 }` a tier-L feature resolves 6, tier S 2, tier M 3, and an unrecorded tier 3; a `prd_audit` map never changes the `architecture_review_as_built` limit.
- [test] each resolved allowance carries source `configured` when its value came from config and `default` otherwise, and carries the tier used or none when unrecorded.
- [test] through loadConfig with a user and a project config, a tier-L feature whose project blocks set other keys but no max_remediation_laps resolves 4 for both gates (never 1); user `{ S: 1 }` plus project `{ L: 5 }` resolves S 1, M 3, L 5; user `{ L: 5 }` plus project `2` resolves 2 for every tier.
- remediationLapCapForGate, kickbackBudgetFallbackLimit, validationJoinRemediationRoundCap, and pendingRepairSettlementBudgets accept the feature's tier and return the resolver's limit, with no `?? 1` fallback remaining in remediation-caps.ts.

**Files likely touched:**
- src/conductor/src/engine/remediation-caps.ts — resolver, defaults table, tier parameters
- src/conductor/test/engine/remediation-caps.test.ts — resolver and load-path tests
- src/conductor/src/engine/conductor.ts — pass-through `undefined` at existing call sites
- src/conductor/src/engine/kickback-budget-cli.ts — pass-through `undefined`
- src/conductor/src/engine/daemon-observe-cli.ts — pass-through `undefined`
- src/conductor/test/structural/conductor-exports.json — export list, if changed

**Dependencies:** Task 1

### Task 3: Remediation planning and BUILD-dispatch settlement charge against the current tier's allowance
**Story:** Story 1 (happy paths 3–4, negative path 3), Story 3 (happy path 2, negative paths 2–3)
**Type:** happy-path

**Steps:**
1. Write failing conductor-level tests in `src/conductor/test/engine/conductor-kickback-transition.test.ts`, using the existing settlement fixtures (search for `BUILD dispatch halted`):
   - Unconfigured tier-L as-built with 3 laps dispatches and charges a 4th; with 4 laps it halts `kickback-cap`.
   - Unconfigured tier-S prd_audit with 2 laps halts, with the ledger still at 2.
   - A tier change from L to S between laps halts against 2.
   - A raised `effectiveLapCap`: tier-M as-built 3 → 5, and tier-L with configured `2` raised to 5 and 4 laps.
2. Verify RED.
3. Implement: in `planRemediation` and the BUILD-dispatch settlement closure (`pendingRepairSettlementBudgets` and the `fallbackLapCap` computation), pass `state.complexity_tier`, read when each budget is evaluated.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] an unconfigured tier-L feature with 3 recorded architecture_review_as_built laps reaching BUILD dispatch is charged a fourth lap and dispatches BUILD with no kickback-cap halt, and with 4 recorded laps the same dispatch halts with the kickback-cap class, asserted through the conductor run loop.
- [test] an unconfigured tier-S feature with 2 recorded prd_audit laps halts with the kickback-cap class at BUILD dispatch and its kickback ledger still records 2 prd_audit laps, so no third lap was charged.
- [test] a feature whose conduct state changes tier from L to S between laps, with 3 recorded prd_audit laps, halts with the kickback-cap class at the next BUILD dispatch against an allowance of 2.
- [test] a recorded effectiveLapCap is the limit charged at BUILD dispatch: a tier-M as-built gate raised from 3 to 5 is charged against 5, and a tier-L feature configured `architecture_review_as_built.max_remediation_laps: 2` and raised to 5 with 4 laps dispatches against 5, not 2 or 4.
- planRemediation and the BUILD-dispatch settlement in conductor.ts read state.complexity_tier when each budget is evaluated, never a tier captured earlier in the run.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — tier at planRemediation and the settlement closure
- src/conductor/test/engine/conductor-kickback-transition.test.ts — settlement tests

**Dependencies:** Task 2

### Task 4: prd_audit allowance and refusal-rework admission honor a tier recorded mid-run
**Story:** Story 3 (happy path 1, negative path 1)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/prd-audit-kickback.test.ts` for an interactive run that starts with no tier and records L at the complexity step:
   - A later prd_audit round with 3 laps dispatches against 4.
   - Refusal-rework admission (`refusalReworkAllowanceBlocker`) with 3 laps is not exhausted.
2. Verify RED.
3. Implement: replace the pre-loop `prdAuditRemediationLapCap` constant in `run()` with a resolver call made at each use, with the current `state.complexity_tier`. This covers the refusal blocker and its `fallbackLapCap`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] in an interactive run that starts with no recorded tier and records tier L at its complexity step, a later prd_audit remediation round with 3 recorded laps is charged against an allowance of 4 and dispatches BUILD.
- [test] in that run, refusal-rework admission through refusalReworkAllowanceBlocker with 3 recorded prd_audit laps returns no exhausted blocker, so an allowance computed before the tier was recorded is never used.
- run() in conductor.ts holds no pre-loop prdAuditRemediationLapCap value; every use resolves the allowance with the current state.complexity_tier.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — lazy prd_audit allowance in run()
- src/conductor/test/prd-audit-kickback.test.ts — mid-run tier tests

**Dependencies:** Task 3

### Task 5: Validation-group join round bound follows the tier allowance
**Story:** Story 3 (happy path 3)
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - In `remediation-caps.test.ts`, assert `validationJoinRemediationRoundCap` with tier L.
   - In `src/conductor/test/prd-audit-kickback.test.ts`, near "bounds validation-join remediation rounds", assert that a tier-L feature's join dispatches its fourth `/remediate` round.
2. Verify RED.
3. Implement: pass `state.complexity_tier` to `validationJoinRemediationRoundCap` at both join call sites in `conductor.ts`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] validationJoinRemediationRoundCap for an unconfigured tier-L feature with no ledger entries returns at least 4, as asserted in remediation-caps.test.ts.
- [test] the validation-group join in conductor.ts passes state.complexity_tier, so an unconfigured tier-L feature's join dispatches a fourth /remediate round rather than halting needs-human on the round bound.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — tier at both join sites
- src/conductor/test/engine/remediation-caps.test.ts — round-bound assertion
- src/conductor/test/prd-audit-kickback.test.ts — join dispatch assertion

**Dependencies:** Task 4

### Task 6: Budget view names the tier and allowance for remediation gates only
**Story:** Story 4 (negative path 5)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/kickback-budget-view.test.ts` for:
   - Each suffix form: default, configured, raised, unrecorded tier.
   - The JSON fields `tier` and `allowanceSource`.
   - The unchanged `build_review` line and JSON.
2. Verify RED.
3. Implement an optional allowance descriptor parameter on `kickbackBudgetView` / `renderKickbackBudgetView`, applied only to `prd_audit` and `architecture_review_as_built`. Keep one shared render function.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] renderKickbackBudgetView for prd_audit and architecture_review_as_built appends ` — tier <T> allowance <N> (default)` or `(configured)` after `<c>/<l> consumed; <r> remaining`, and ` — tier unrecorded, treated as M; allowance <N> (default)` when no tier is recorded, as asserted in kickback-budget-view.test.ts.
- [test] when the entry carries effectiveLapCap, the suffix reads `tier <T> allowance <effective> (raised from <resolved>)` and kickbackBudgetView reports allowanceSource `raised`.
- [test] kickbackBudgetView carries `tier` ("S", "M", "L", or null) and `allowanceSource` only for prd_audit and architecture_review_as_built, and a build_review view renders `Kickback budget (build_review): 4/6 consumed; 2 remaining` with no tier or allowance suffix and with neither JSON field.

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-view.ts — allowance descriptor and suffix
- src/conductor/test/engine/kickback-budget-view.test.ts — rendering tests

**Dependencies:** Task 2

### Task 7: Lap-cap and refusal-rework halts name the tier and allowance
**Story:** Story 4 (happy path 1, negative paths 1–2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-kickback-transition.test.ts` and `src/conductor/test/prd-audit-kickback.test.ts` asserting the halt reason text for:
   - an unconfigured tier-L as-built halt at 4/4;
   - an unrecorded-tier prd_audit halt at 3/3;
   - a tier-S refusal-rework halt.
2. Verify RED.
3. Implement: at the BUILD-dispatch settlement halt and the refusal-rework halt in `conductor.ts`, build the allowance descriptor from `resolveRemediationLapAllowance` with the current tier and pass it to `renderKickbackBudgetView`.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] an unconfigured tier-L feature halting at BUILD dispatch with 4 recorded architecture_review_as_built laps writes a halt reason containing `Kickback budget (architecture_review_as_built): 4/4 consumed; 0 remaining` followed by `tier L allowance 4 (default)`.
- [test] an unconfigured feature with no recorded tier halting at its prd_audit lap cap writes a halt reason containing `3/3 consumed` and `tier unrecorded, treated as M; allowance 3 (default)`, and the reason contains neither `tier L` nor `allowance 4`.
- [test] a refusal-rework round refused because a tier-S feature's prd_audit lap allowance is spent writes a halt reason containing `Refusal rework halted: prd_audit laps allowance exhausted.` and `tier S allowance 2 (default)`.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — descriptor at the two halt sites
- src/conductor/test/engine/conductor-kickback-transition.test.ts — settlement halt text
- src/conductor/test/prd-audit-kickback.test.ts — refusal halt text

**Dependencies:** Tasks 5, 6

### Task 8: kickback-budget inspect reads the feature's tier
**Story:** Story 4 (happy paths 2–3, negative path 4)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/kickback-budget.test.ts`, each with a temp worktree carrying `.pipeline/conduct-state.json`:
   - human and JSON output for a tier-M `{ M: 5 }` feature;
   - a raised as-built gate;
   - a missing state file and an unparseable one.
2. Verify RED.
3. Implement: in `kickback-budget-cli.ts`, have `defaultsFor` read the tier with `readState` from the feature worktree's `.pipeline/conduct-state.json`, treating an unreadable state as unrecorded. Build the allowance descriptor through `resolveRemediationLapAllowance` and pass it to the view, including child views, so they resolve the tier from the same feature state as the halt.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `ai-conductor kickback-budget inspect --feature <slug>` for a tier-M feature configured `prd_audit.max_remediation_laps: { M: 5 }` with 1 recorded lap prints a prd_audit line containing `1/5 consumed; 4 remaining` and `tier M allowance 5 (configured)`, and `--format json` carries `tier: "M"`, `limit: 5`, and `allowanceSource: "configured"`, as asserted in test/cli/kickback-budget.test.ts.
- [test] inspect for a tier-M feature whose architecture_review_as_built gate was raised from 3 to 5 prints `tier M allowance 5 (raised from 3)` and its JSON carries `allowanceSource: "raised"`.
- [test] when the feature worktree's `.pipeline/conduct-state.json` is missing or unparseable, inspect exits 0 and renders that feature's allowance as `tier unrecorded, treated as M`.
- defaultsFor in kickback-budget-cli.ts resolves remediation-gate limits with the tier read from the feature worktree's `.pipeline/conduct-state.json`, and child views use that same feature tier.

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-cli.ts — tier read and descriptor
- src/conductor/test/cli/kickback-budget.test.ts — inspect tests

**Dependencies:** Task 6

### Task 9: daemon status shows the same tier and allowance as inspect
**Story:** Story 4 (happy path 4, negative paths 3 and 5)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-observe-cli.test.ts`:
   - An unconfigured tier-S feature with 1 prd_audit lap: its status line, compared with inspect output for the same fixture.
   - A malformed remediation-gate entry.
   - A build_review entry with cap evidence at 4 of 6, checked in both status and inspect (human and JSON).
2. Verify RED.
3. Implement: in `daemon-observe-cli.ts`, pass the visible entry's `tier` to `kickbackBudgetFallbackLimit` and build the descriptor through `resolveRemediationLapAllowance` for `renderKickbackBudgetView`. Leave the unavailable-entry branch unchanged.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] `ai-conductor daemon status` for an in-progress unconfigured tier-S feature with 1 recorded prd_audit lap prints a `KICKBACK BUDGET [<slug>]:` line containing `1/2 consumed; 1 remaining` and `tier S allowance 2 (default)`, and `kickback-budget inspect` for the same feature prints the same figures and suffix, as asserted in daemon-observe-cli.test.ts.
- [test] `ai-conductor daemon status` for a feature whose remediation-gate ledger entry fails validation still prints `budget unavailable (durable entry failed validation)` for that gate in its `KICKBACK BUDGET [<slug>]:` line with no tier or allowance text, as asserted in daemon-observe-cli.test.ts.
- [test] for a feature whose build_review entry carries cap evidence and records 4 of 6, both `ai-conductor kickback-budget inspect` and `ai-conductor daemon status` print `Kickback budget (build_review): 4/6 consumed; 2 remaining` with no tier or allowance suffix, and the inspect `--format json` build_review view carries no `tier` or `allowanceSource` field.

**Files likely touched:**
- src/conductor/src/engine/daemon-observe-cli.ts — tier and descriptor
- src/conductor/test/engine/daemon-observe-cli.test.ts — status tests, including the build_review line in status and inspect

**Dependencies:** Task 8

### Task 10: Revert this repository's TEMPORARY remediation grants
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write a failing test `src/conductor/test/engine/repo-remediation-config.test.ts`. Following the acceptance tests that resolve `.ai-conductor/config.yml` from the repository root, parse the repo's committed config and validate it with `validateConfig` (no user layer). Assert:
   - no `max_remediation_laps` in either gate;
   - `max_appended_tasks` 8, `max_appended_ratio` 0.8, and `remediation.enabled` true;
   - resolved allowances L → 4 for both gates and S → 2 for as-built.
2. Verify RED.
3. Edit `.ai-conductor/config.yml`:
   - delete both `max_remediation_laps` lines and their TEMPORARY comments;
   - set `max_appended_tasks: 8` and delete its TEMPORARY comment;
   - remove the now-empty `architecture_review_as_built:` block heading if nothing remains under it;
   - leave every other setting byte-identical.
4. Verify GREEN.
5. Commit.

**Done when:**
- [test] repo-remediation-config.test.ts validates the committed `.ai-conductor/config.yml` successfully and finds no `max_remediation_laps` under `prd_audit` or `architecture_review_as_built`.
- [test] the same test resolves `prd_audit.max_appended_tasks` to 8, `prd_audit.max_appended_ratio` to 0.8, and `architecture_review_as_built.remediation.enabled` to true.
- [test] the same test resolves, through resolveRemediationLapAllowance, an allowance of 4 for a tier-L feature on both gates and 2 for a tier-S feature on architecture_review_as_built.
- `.ai-conductor/config.yml` contains no TEMPORARY comment for the two lap grants or the `max_appended_tasks` grant, and its diff touches only those lines.

**Files likely touched:**
- .ai-conductor/config.yml — revert the three grants
- src/conductor/test/engine/repo-remediation-config.test.ts — committed-config assertions

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 → Task 2 ─┬→ Task 3 → Task 4 → Task 5 ─┐
                 ├→ Task 6 ───────────────────┴→ Task 7
                 │      └→ Task 8 → Task 9
                 └→ Task 10
```

## Integration Points

- After Task 3: an unconfigured feature's BUILD-dispatch charge and `kickback-cap` halt follow its tier end to end.
- After Task 7: a real lap-cap halt reason names the tier and allowance.
- After Task 9: halt, `kickback-budget inspect`, and `daemon status` agree for one feature.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given neither the user nor the project config sets `max_remediation_laps` for either gate, and a feature recorded at tier S, when its allowance for `prd_audit` and for `architecture_review_as_built` is resolved, then each is 2. | 2 | "returns limit 2 for tier S" | diff-local |
| Story 1 happy: Given the same unconfigured repository and a feature recorded at tier M, when both allowances are resolved, then each is 3. | 2 | "3 for tier M" | diff-local |
| Story 1 happy: Given the same unconfigured repository and a feature recorded at tier L whose `architecture_review_as_built` ledger records 3 laps, when a fourth as-built remediation round reaches BUILD dispatch, then the lap is charged and BUILD dispatches without a `kickback-cap` halt. | 3 | "is charged a fourth lap and dispatches BUILD with no kickback-cap halt" | diff-local |
| Story 1 happy: Given the same unconfigured repository and a feature recorded at tier L whose `architecture_review_as_built` ledger records 4 laps, when another as-built remediation round reaches BUILD dispatch, then the feature halts with the `kickback-cap` class. | 3 | "with 4 recorded laps the same dispatch halts with the kickback-cap class" | diff-local |
| Story 1 negative: Given a project config that has a `prd_audit` block (for example only `max_appended_tasks: 5`) and an `architecture_review_as_built` block (for example only `remediation.enabled: true`) but no `max_remediation_laps` in either, and a user config that sets neither key, when the config is loaded through the normal project-plus-user load path and a tier-L feature's allowance is resolved, then each gate's allowance is 4, never 1. | 2 | "resolves 4 for both gates (never 1)" | diff-local |
| Story 1 negative: Given an unconfigured repository and a feature with no recorded complexity tier, when both allowances are resolved, then each is 3 (treated as tier M), never 4. | 2 | "3 for an unrecorded tier" | diff-local |
| Story 1 negative: Given an unconfigured repository and a feature recorded at tier S whose `prd_audit` ledger records 2 laps, when another prd_audit remediation round reaches BUILD dispatch, then the feature halts with the `kickback-cap` class and no third lap is charged. | 3 | "so no third lap was charged" | diff-local |
| Story 2 happy: Given a project config setting `prd_audit.max_remediation_laps: 5`, when the `prd_audit` allowance is resolved for features at tiers S, M, and L and for a feature with no recorded tier, then each is 5. | 2 | "an integer setting yields that integer for S, M, L and an unrecorded tier" | diff-local |
| Story 2 happy: Given a project config setting `architecture_review_as_built.max_remediation_laps: { L: 6 }`, when that gate's allowance is resolved, then a tier-L feature gets 6, a tier-S feature gets 2, a tier-M feature gets 3, and a feature with no recorded tier gets 3. | 2 | "a map yields its entry for a listed tier and the tier default for unlisted tiers" | diff-local |
| Story 2 happy: Given a user config setting `prd_audit.max_remediation_laps: { S: 1 }` and a project config setting `prd_audit.max_remediation_laps: { L: 5 }`, when the merged config resolves the `prd_audit` allowance, then tier S gets 1, tier M gets 3, and tier L gets 5. | 2 | "user `{ S: 1 }` plus project `{ L: 5 }` resolves S 1, M 3, L 5" | diff-local |
| Story 2 happy: Given a user config setting `prd_audit.max_remediation_laps: { L: 5 }` and a project config setting `prd_audit.max_remediation_laps: 2`, when the merged config resolves the `prd_audit` allowance, then every tier gets 2. | 2 | "user `{ L: 5 }` plus project `2` resolves 2 for every tier" | diff-local |
| Story 2 negative: Given a project config setting `prd_audit.max_remediation_laps: 0`, when the config is loaded, then loading fails with an error naming `prd_audit.max_remediation_laps` and stating it must be a positive integer or a map of S, M, L to positive integers. | 1 | "loading `prd_audit.max_remediation_laps: 0` fails with a ConfigError naming `prd_audit.max_remediation_laps`" | diff-local |
| Story 2 negative: Given a project config setting `architecture_review_as_built.max_remediation_laps: { XL: 3 }`, when the config is loaded, then loading fails with an error naming `architecture_review_as_built.max_remediation_laps.XL` as an unknown tier. | 1 | "fails naming `architecture_review_as_built.max_remediation_laps.XL` as an unknown tier" | diff-local |
| Story 2 negative: Given a project config setting `architecture_review_as_built.max_remediation_laps: { M: 2.5 }`, when the config is loaded, then loading fails with an error naming `architecture_review_as_built.max_remediation_laps.M` and stating it must be a positive integer. | 1 | "`{ M: 2.5 }` fails naming `architecture_review_as_built.max_remediation_laps.M` as not a positive integer" | diff-local |
| Story 2 negative: Given a project config setting `prd_audit.max_remediation_laps: "3"`, when the config is loaded, then loading fails with an error naming `prd_audit.max_remediation_laps`; the string is never coerced to a number. | 1 | "fails naming the same path with no coercion to a number" | diff-local |
| Story 2 negative: Given a project config setting `prd_audit.max_remediation_laps: {}`, when the `prd_audit` allowance is resolved, then every tier gets its default (S 2, M 3, L 4). | 2 | "the tier default for unlisted tiers and for `{}`" | diff-local |
| Story 2 negative: Given a project config setting `prd_audit.max_remediation_laps: { L: 6 }` only, when the `architecture_review_as_built` allowance is resolved for a tier-L feature, then it is 4; one gate's configuration never changes the other gate's allowance. | 2 | "a `prd_audit` map never changes the `architecture_review_as_built` limit" | diff-local |
| Story 3 happy: Given an interactive run of a feature that starts with no recorded tier and records tier L at its complexity step, with no config override, when a prd_audit remediation round later reaches BUILD dispatch with 3 laps recorded, then the lap is charged against an allowance of 4 and BUILD dispatches. | 4 | "is charged against an allowance of 4 and dispatches BUILD" | diff-local |
| Story 3 happy: Given a tier-M feature whose `architecture_review_as_built` gate was raised by `kickback-budget raise --by 2` after halting at 3/3, when the next as-built round reaches BUILD dispatch, then the lap is charged against the raised allowance of 5. | 3 | "a tier-M as-built gate raised from 3 to 5 is charged against 5" | diff-local |
| Story 3 happy: Given a tier-L feature with no config override, when the validation-group join computes its remediation round bound, then the bound is never lower than the tier-L allowance of 4. | 5 | "returns at least 4" | diff-local |
| Story 3 negative: Given an interactive run of a feature that records tier L at its complexity step, with no config override, when a prd_audit refusal-rework round is admitted with 3 laps recorded, then it is not refused as exhausted; an allowance computed before the tier was recorded is never used. | 4 | "returns no exhausted blocker" | diff-local |
| Story 3 negative: Given a feature whose recorded tier changes from L to S between laps and whose `prd_audit` ledger records 3 laps, when the next prd_audit round reaches BUILD dispatch, then it halts with the `kickback-cap` class against an allowance of 2. | 3 | "halts with the kickback-cap class at the next BUILD dispatch against an allowance of 2" | diff-local |
| Story 3 negative: Given a tier-L feature with a project config `architecture_review_as_built.max_remediation_laps: 2` and an operator raise to 5, when the next as-built round reaches BUILD dispatch with 4 laps recorded, then the raised allowance of 5 applies, not 2 and not 4. | 3 | "dispatches against 5, not 2 or 4" | diff-local |
| Story 4 happy: Given an unconfigured tier-L feature that halts at BUILD dispatch because its `architecture_review_as_built` ledger records 4 laps, when the halt reason is written, then it contains `Kickback budget (architecture_review_as_built): 4/4 consumed; 0 remaining` followed by `tier L allowance 4 (default)`. | 7 | "followed by `tier L allowance 4 (default)`" | diff-local |
| Story 4 happy: Given a tier-M feature with `prd_audit.max_remediation_laps: { M: 5 }` and 1 recorded lap, when the operator runs `ai-conductor kickback-budget inspect --feature <slug>`, then the `prd_audit` line contains `1/5 consumed; 4 remaining` and `tier M allowance 5 (configured)`, and the JSON view for that gate carries `tier: "M"`, `limit: 5`, and `allowanceSource: "configured"`. | 8 | "`1/5 consumed; 4 remaining` and `tier M allowance 5 (configured)`" | diff-local |
| Story 4 happy: Given a tier-M feature whose `architecture_review_as_built` gate was raised from 3 to 5, when the operator runs inspect, then that gate's line contains `tier M allowance 5 (raised from 3)` and the JSON view carries `allowanceSource: "raised"`. | 8 | "prints `tier M allowance 5 (raised from 3)`" | diff-local |
| Story 4 happy: Given an in-progress unconfigured tier-S feature with 1 recorded `prd_audit` lap, when the operator runs `ai-conductor daemon status` and `kickback-budget inspect`, then both show `1/2 consumed; 1 remaining` and `tier S allowance 2 (default)` for that gate. | 9 | "prints the same figures and suffix" | diff-local |
| Story 4 negative: Given an unconfigured feature with no recorded tier that halts at its `prd_audit` lap cap, when the halt reason is written, then it contains `3/3 consumed` and `tier unrecorded, treated as M; allowance 3 (default)`, and never names tier L or an allowance of 4. | 7 | "the reason contains neither `tier L` nor `allowance 4`" | diff-local |
| Story 4 negative: Given a prd_audit refusal-rework round refused because the lap allowance is spent on a tier-S feature, when the refusal halt reason is written, then it contains `tier S allowance 2 (default)`. | 7 | "and `tier S allowance 2 (default)`" | diff-local |
| Story 4 negative: Given a feature whose remediation-gate ledger entry fails validation, when the operator runs daemon status, then that gate still reads `budget unavailable (durable entry failed validation)` with no tier or allowance figure. | 9 | "still prints `budget unavailable (durable entry failed validation)`" | diff-local |
| Story 4 negative: Given a feature whose `conduct-state.json` cannot be read, when the operator runs `kickback-budget inspect`, then the command exits 0 and renders that feature's allowance as `tier unrecorded, treated as M`. | 8 | "inspect exits 0 and renders that feature's allowance as `tier unrecorded, treated as M`" | diff-local |
| Story 4 negative: Given a feature with a `build_review` budget of 4 consumed of 6, when the operator runs `kickback-budget inspect` or `daemon status`, then the `build_review` line reads `Kickback budget (build_review): 4/6 consumed; 2 remaining` with no tier or allowance suffix, and its JSON view carries no `tier` or `allowanceSource` field. | 9 | "print `Kickback budget (build_review): 4/6 consumed; 2 remaining` with no tier or allowance suffix, and the inspect `--format json` build_review view carries no `tier` or `allowanceSource` field" | diff-local |
| Story 5 happy: Given this repository's committed `.ai-conductor/config.yml`, when it is read, then neither `prd_audit` nor `architecture_review_as_built` sets `max_remediation_laps`. | 10 | "finds no `max_remediation_laps` under `prd_audit` or `architecture_review_as_built`" | diff-local |
| Story 5 happy: Given this repository's committed config and a tier-L feature built here, when its allowances are resolved, then each gate's allowance is 4. | 10 | "an allowance of 4 for a tier-L feature on both gates" | diff-local |
| Story 5 happy: Given this repository's committed config, when `prd_audit.max_appended_tasks` is resolved, then it is 8, the value configured before the 2026-09-04 TEMPORARY grant raised it to 10. | 10 | "resolves `prd_audit.max_appended_tasks` to 8" | diff-local |
| Story 5 negative: Given this repository's committed config after the reverts, when it is loaded, then loading succeeds, `prd_audit.max_appended_ratio` still resolves to 0.8, and `architecture_review_as_built.remediation.enabled` still resolves to true. | 10 | "`prd_audit.max_appended_ratio` to 0.8, and `architecture_review_as_built.remediation.enabled` to true" | diff-local |
| Story 5 negative: Given this repository's committed config and a tier-S feature built here, when its `architecture_review_as_built` allowance is resolved, then it is 2, not the former flat 3. | 10 | "2 for a tier-S feature on architecture_review_as_built" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D1 | no-change | none | This feature changes only the lap allowance; which artifact is the audit authority (stories criteria) is untouched. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D2 | no-change | none | prd_audit still runs on every feature, tier, and track; no run-rule or skip logic changes. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D3 | no-change | none | The PASS/FIXABLE/PLAN_GAP/OVER_SCOPE grade schema is untouched. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D4 | no-change | none | OVER_SCOPE scope-as-intent judgement is untouched. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D5 | task | task-2, task-3 | an unconfigured tier-S feature with 2 recorded prd_audit laps halts with the kickback-cap class at BUILD dispatch |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D6 | no-change | none | The kickback ledger growth record and its accounting are unchanged; Task 10 only reverts this repository's configured max_appended_tasks value, which the growth caps already make operator-configurable. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D7 | no-change | none | PLAN_GAP halting is untouched. |
| adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback#D8 | no-change | none | Recorded findings persistence and shipped-record copying are untouched. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D1 | no-change | none | Per-finding REMEDIABLE/DESIGN classification is untouched. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D2 | no-change | none | Fail-closed as-built report parsing is untouched. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D3 | no-change | none | The bounded route to BUILD and its admission are untouched; only the lap allowance bounding it changes (D4). |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D4 | task | task-3, task-7 | with 4 recorded laps the same dispatch halts with the kickback-cap class |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D5 | no-change | none | planRemediation and the remediation-append seam remain the only plan appender; no append path changes. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D6 | no-change | none | Per-finding classification and remediation outcome events are unchanged; halt text only gains the tier suffix (Task 7). |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D7 | no-change | none | Pending remediation finding persistence across restarts is untouched; the allowance is recomputed from durable tier state at each check. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D8 | no-change | none | The bounded route stays a fallback behind preempting routes; routing order is untouched. |
| adr-2026-08-25-as-built-remediable-findings-bounded-build-route#D9 | no-change | none | existing-task findings still append nothing and charge no growth; they charge a lap against the (now tier-derived) allowance exactly as before. |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D1 | no-change | none | Which refusals become bounded rework is untouched. |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D2 | no-change | none | Refusal evidence carried to the planner is untouched. |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D3 | no-change | none | The single /remediate planner for refusal rework is untouched. |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D4 | no-change | none | Refusal rework still uses the existing append seam and gates.prd_audit caps. |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D5 | task | task-4, task-7 | returns no exhausted blocker |
| adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework#D6 | no-change | none | The serial SHIP tail and validation-group join still consume the same CurrentPrdAuditRoute result. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
