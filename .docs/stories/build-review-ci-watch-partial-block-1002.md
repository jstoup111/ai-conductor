**Status:** Accepted

# Technical Stories: build_review / ci_watch partial-block preservation (#1002)

Track: technical
Complexity: Small
Source issue: jstoup111/ai-conductor#1002

## Context

`validateConfig()` normalizes the `build_review` and `ci_watch` blocks by *replacing* them
wholesale with `{ enabled: true }` whenever any key other than `enabled` is present
(`src/conductor/src/engine/config.ts:845-898`). Consequences observed today:

- `build_review.perTaskFloor` is documented and consumed
  (`engine/resolved-config.ts:633` → `engine/step-runners.ts:1571`) but setting it discards the
  whole block, including the operator's `enabled` value, with a warning that names the block and
  not the key.
- `ci_watch.cooldownMinutes` is documented and consumed (`engine/ci-fix.ts:250`) but setting it
  discards the whole block **silently** — no warning of any kind — so the cooldown is permanently
  60 minutes and the operator has no diagnostic.

Both consumers already read their key with a `??` default and require no change: the defect is
entirely in normalization.

## Story 1 — A partially-specified `build_review` block keeps every valid key

As an operator tuning the build_review gate, I want setting `perTaskFloor` alongside `enabled` to
preserve both so that I do not silently lose the on/off switch I set in the same block.

### Acceptance Criteria

#### Happy Path

- **Given** `build_review: { enabled: false, perTaskFloor: false }`, **when** the config is
  validated, **then** the resolved block reports `enabled: false` and `perTaskFloor: false`, and no
  warning is emitted.
- **Given** `build_review: { perTaskFloor: false }` with `enabled` omitted, **when** the config is
  validated, **then** `perTaskFloor` is `false`, `enabled` resolves to its default `true`, and no
  warning is emitted.
- **Given** a validated config carrying `build_review.perTaskFloor: false`, **when** the per-task
  work-happened floor is consulted during a build, **then** the floor gate is off — the configured
  value reaches its consumer rather than the built-in default.

#### Negative Path

- **Given** `build_review: { enabled: 'banana', perTaskFloor: false }`, **when** the config is
  validated, **then** a warning names `build_review.enabled`, `enabled` falls back to `true`, and
  `perTaskFloor: false` is still preserved.
- **Given** `build_review: { enabled: false, perTaskFloor: 'sometimes' }`, **when** the config is
  validated, **then** a warning names `build_review.perTaskFloor`, that key falls back to its
  default, and `enabled: false` is still preserved.
- **Given** `build_review` set to a non-object (a string, number, or array), **when** the config is
  validated, **then** the existing fail-open behavior is unchanged: the block resolves to
  `{ enabled: true }` with one warning, and validation still returns ok.

### Done When

- [ ] A partially-specified `build_review` block never loses a sibling key.
- [ ] `perTaskFloor` set in config is observable at its consumer in `step-runners.ts`.
- [ ] Existing absent/null/non-object/non-boolean-`enabled` behavior is unchanged.

## Story 2 — A partially-specified `ci_watch` block keeps every valid key

As an operator tuning CI watch, I want setting `cooldownMinutes` alongside `enabled` to preserve
both so that the CI fix cooldown I configure is actually the cooldown that runs.

### Acceptance Criteria

#### Happy Path

- **Given** `ci_watch: { enabled: true, cooldownMinutes: 15 }`, **when** the config is validated,
  **then** the resolved block reports `enabled: true` and `cooldownMinutes: 15`, and no warning is
  emitted.
- **Given** `ci_watch: { cooldownMinutes: 0 }` with `enabled` omitted, **when** the config is
  validated, **then** `cooldownMinutes` is `0`, `enabled` resolves to its default `true`, and no
  warning is emitted.
- **Given** a validated config carrying `ci_watch.cooldownMinutes: 15`, **when** the CI fix path
  computes its cooldown window, **then** the window is derived from 15 minutes rather than the
  built-in 60-minute default.

#### Negative Path

- **Given** `ci_watch: { enabled: false, cooldownMinutes: 'thirty' }`, **when** the config is
  validated, **then** a warning names `ci_watch.cooldownMinutes`, that key falls back to its
  default, and `enabled: false` is still preserved.
- **Given** `ci_watch: { enabled: true, cooldownMinutes: -5 }`, **when** the config is validated,
  **then** a warning names `ci_watch.cooldownMinutes`, the negative value is not adopted, and
  `enabled: true` is preserved.
- **Given** `ci_watch` set to a non-object, or `ci_watch: { enabled: 'banana' }`, **when** the
  config is validated, **then** it fails open to enabled as it does today, validation still returns
  ok, and — unlike today — a warning is emitted rather than the discard happening silently.

### Done When

- [ ] A partially-specified `ci_watch` block never loses a sibling key.
- [ ] `cooldownMinutes` set in config is observable at its consumer in `ci-fix.ts`.
- [ ] No `ci_watch` normalization discard is silent any more.

## Story 3 — An unknown key inside either block warns by name without dropping siblings

As an operator who typos a config key, I want the warning to name the offending key and leave the
rest of the block intact so that a typo costs me one key, not the whole block.

### Acceptance Criteria

#### Happy Path

- **Given** `build_review: { enabled: false, perTaskFlooor: true }` (typo), **when** the config is
  validated, **then** exactly one warning is emitted, it names `perTaskFlooor`, the unknown key is
  dropped, and `enabled: false` survives.
- **Given** `ci_watch: { cooldownMinutes: 15, bogus: 1 }`, **when** the config is validated,
  **then** exactly one warning is emitted, it names `bogus`, and `cooldownMinutes: 15` survives.

#### Negative Path

- **Given** a block containing several unknown keys, **when** the config is validated, **then**
  every unknown key is named across the warnings and no valid sibling is dropped.
- **Given** any shape of either block — absent, null, empty object, non-object, valid, partially
  valid, or fully invalid — **when** the config is validated, **then** validation never throws and
  never returns a hard error for these two blocks, and the resolved block is always defined.

### Done When

- [ ] Unknown keys warn by name in both blocks.
- [ ] An unknown key never removes a valid sibling key.
- [ ] The totality contract (never throws, block always defined) still holds for every shape.

## Story 4 — The documented "known limitation" no longer describes reality

As a reader of the configuration reference, I want the documentation to describe the working
behavior so that I do not avoid a key that now works.

### Acceptance Criteria

#### Happy Path

- **Given** the fix has landed, **when** the configuration reference is read, **then**
  `build_review.perTaskFloor` and `ci_watch.cooldownMinutes` are documented as reaching their
  consumers rather than as unreachable, and the two "Known limitation" callouts describing the
  whole-block discard are removed or rewritten to the new per-key behavior.

#### Negative Path

- **Given** unrelated blocks that genuinely still discard on unknown keys (for example
  `kickback_escalation`), **when** the documentation is updated, **then** their existing
  descriptions are not falsely rewritten as fixed.

### Done When

- [ ] `docs/reference/configuration.md` describes per-key preservation for both blocks.
- [ ] No stale "unreachable from config" claim remains for either key.
- [ ] Blocks outside this change keep their accurate existing descriptions.
