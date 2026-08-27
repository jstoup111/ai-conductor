**Status:** Accepted

# Stories: Config keys that validate but have no consumer (#1025)

Technical track — acceptance derives from
`adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` (APPROVED).

## Story 1: Custom steps can declare gate and kickback_target

As a harness operator, I want a custom step's `gate` and `kickback_target` keys to load so that the documented pipeline-extension path works.

### Acceptance Criteria

#### Happy Path
- Given a project config declaring a custom step with `after:`, `gate: false`, and `kickback_target: true`, when `validateConfig` runs, then the config loads without error and `buildStepRegistry` applies the gate-loop membership override and kickback flag to the registered step
- Given a custom step declaring only `gate: false` (no `kickback_target`), when the config loads, then the step's kickback flag takes the registry's existing default (false)

#### Negative Paths
- Given a built-in step (e.g. `plan`) declaring `gate`, when `validateConfig` runs, then loading fails with an error naming the step and stating the key is custom-step-only
- Given a custom step declaring `gate: "loop"` (non-boolean), when `validateConfig` runs, then loading fails with a type error naming the key and expected boolean type
- Given a custom step declaring `kickback_target: "yes"` (non-boolean), when `validateConfig` runs, then loading fails with a type error naming the key and expected type

### Done When
- [ ] `knownStepKeys` accepts `gate` and `kickback_target`; a config-flow test loads a custom step with both keys and asserts the built registry entry carries them
- [ ] Built-in-step rejection, non-boolean `gate` rejection, and non-boolean `kickback_target` rejection each covered by a failing-load test asserting the exact error message shape

## Story 2: Removed dead keys fail config load loudly

As a harness operator, I want the removed keys rejected at load so that a config value that does nothing can no longer sit silently.

### Acceptance Criteria

#### Happy Path
- Given a config carrying none of the removed keys, when `validateConfig` runs, then the config loads exactly as before the change
- Given a config with nested `harness_self_host.auth_park_timeout_minutes: 0`, when the config is resolved and consumed, then the existing contract is unchanged (0 still means immediate credentials-specific HALT; non-integer/negative still coerce to 60)

#### Negative Paths
- Given a config carrying `complexity.default_tier`, when `validateConfig` runs, then loading fails with the ordinary unknown-key error naming the key
- Given a config carrying `harness_self_host.skill_relink_preflight`, when `validateConfig` runs, then loading fails with the unknown-key error, and the skill-relink preflight still runs unconditionally on every self-host path
- Given a config carrying top-level `auth_park_timeout_minutes`, when `validateConfig` runs, then loading fails with the unknown-top-level-key error (unchanged from today), and no top-level resolver for it exists to contradict that
- Given a `defaults:` block carrying `by_tier`, when `validateConfig` runs, then loading fails with an unknown-key error for `defaults.by_tier`, while `steps.<name>.by_tier` and `phases.<name>.by_tier` continue to load and resolve

### Done When
- [ ] Each removed key has a failing-load test asserting its unknown-key error, and `complexity.default_tier`, `skill_relink_preflight`, and top-level `auth_park_timeout_minutes` are gone from `HarnessConfig` types and resolvers
- [ ] Existing nested auth-park-timeout resolution tests and step/phase `by_tier` resolution tests still pass unmodified
- [ ] The repo's own `.ai-conductor/config.yml` and both templates validate cleanly after the removals

## Story 3: mergeable_autoresolve behavior survives resolver deletion

As a daemon operator, I want autoresolve behavior unchanged after the dead resolver helper is deleted so that only dead weight leaves.

### Acceptance Criteria

#### Happy Path
- Given a config with `mergeable_autoresolve.enabled: true` and a `suiteCommand`, when the daemon reads autoresolve config, then enablement, suite command, and cooldown behave exactly as before

#### Negative Paths
- Given `mergeable_autoresolve.enabled: false` or the block absent, when a CONFLICTING PR is swept, then no autoresolve dispatch occurs, exactly as before the resolver deletion

### Done When
- [ ] `resolveMergeableAutoresolve` and its result type no longer exist; existing autoresolve consumer tests (`autoresolve-loop`, `ci-fix`, config tests) pass unmodified
- [ ] The disabled/absent-block no-dispatch path is covered by an existing or new test that passes

## Story 4: Project configs cannot override the user-level conductor block

As a harness operator, I want a committed project config's `conductor:` block rejected so that a project cannot rewrite my user-level update-check state.

### Acceptance Criteria

#### Happy Path
- Given a user config with a valid `conductor:` block and a project config without one, when the merged config loads, then the user's conductor values are in effect
- Given `conduct-ts config set` writing the user-level conductor block, when it validates and writes, then that path is unchanged

#### Negative Paths
- Given a committed project config carrying a `conductor:` block, when `validateConfig` runs on the project source (pre-merge), then loading fails with a hard error naming the offending file and stating the fix (move the block to the user config), mirroring the `spec_owner` guard
- Given a user config with a `conductor:` block and a clean project config, when the merged pass validates, then the guard does not fire on the merged user values

### Done When
- [ ] A project-source validation test asserts the hard error, its file naming, and its fix text; a merged-pass test asserts no false fire
- [ ] The guard sits at the same pre-merge project-source seam as the `spec_owner` guard

## Story 5: A total consumer registry makes every documented key declare its consumer

As a harness maintainer, I want every accepted config key mapped to a consumer declaration so that a new decorative key fails a test the moment it is added.

### Acceptance Criteria

#### Happy Path
- Given the shipped registry, when the coverage test runs, then every key accepted by the validator's key sets has exactly one declaration, and every non-`none` declaration names a production consumer module that resolves
- Given a key that is valid but deliberately inert (e.g. self-host-precedence-downgraded keys), when the test runs, then its `{ consumer: 'none', reason: <tracked ref or rationale> }` declaration passes as first-class

#### Negative Paths
- Given a key added to a validator accepted set with no registry declaration, when the coverage test runs, then it fails naming the undeclared key
- Given a registry declaration naming a consumer module that does not exist, when the coverage test runs, then it fails naming the declaration and the unresolvable consumer
- Given a registry declaration for a key the validator no longer accepts, when the coverage test runs, then it fails naming the orphaned declaration

### Done When
- [ ] A registry module exports a total `Record` over the validator-accepted key universe, derived from (not hand-copied beside) the validator's own key sets
- [ ] The coverage test fails on: undeclared key, unresolvable consumer, orphaned declaration — each proven by a red-case test
- [ ] Every `none` declaration carries a non-empty reason
