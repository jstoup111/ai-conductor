# Coherence Mapping: Config keys that validate but have no consumer (#1025)

Technical track (no `fr` rows). Intake outcomes staged from jstoup111/ai-conductor#1025.
Every `covered` verdict was confirmed against the counterpart artifact file.

| Row class | Cited id / criterion | Counterpart id(s) | Verdict | Notes / quote | Disposition |
|---|---|---|---|---|---|
| outcome | outcome-1 | story-2, story-3, story-1 | covered | Wire-or-remove delivered: removals (Story 2), resolver deletion with surviving behavior (Story 3), wiring the already-read custom-step keys (Story 1) |
| outcome | outcome-2 | story-1 | covered | `gate`/`kickback_target` accepted by the validator; registry already reads them |
| outcome | outcome-3 | story-5 | covered | Total consumer registry + coverage test (registry shape per adr-2026-07-26 precedent) |
| story | story-1 | task-1, task-2 | covered | Validator acceptance + end-to-end registry flow |
| story | story-2 | task-3, task-4, task-5, task-6 | covered | One removal task per dead key |
| story | story-3 | task-7 | covered | Resolver deletion with behavior-preservation checks |
| story | story-4 | task-8 | covered | Project-source conductor guard |
| story | story-5 | task-9, task-10, task-11 | covered | Registry module, red-case coverage test, and the one-key-set-source widening |
| task | task-1 | story-1 | covered | |
| task | task-2 | story-1 | covered | |
| task | task-3 | story-2 | covered | |
| task | task-4 | story-2 | covered | |
| task | task-5 | story-2 | covered | |
| task | task-6 | story-2 | covered | |
| task | task-7 | story-3 | covered | Refactor-typed; cites Story 3 |
| task | task-8 | story-4 | covered | |
| task | task-9 | story-5 | covered | Infrastructure-typed; cites Story 5 |
| task | task-10 | story-5 | covered | |
| task | task-11 | story-5 | covered | Cites Story 5; makes the accepted-key universe total so S5.1 and S5.3 hold for nested blocks |
| adr | adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal | story-1, story-2, story-3, story-4, story-5 | covered | All five stories implement the ADR's four decisions; the operator waiver governs Story 2's hard-fail removals |
| criterion | Story 1 happy: Given a project config declaring a custom step with `after:`, `gate: false`, and `kickback_target: true`, when `validateConfig` runs, then the config loads without error and `buildStepRegistry` applies the gate-loop membership override and kickback flag to the registered step | task-1, task-2 | covered | assert the `buildStepRegistry` entry has `loopGate === false` and `kickbackTarget === true` | diff-local |
| criterion | Story 1 happy: Given a custom step declaring only `gate: false` (no `kickback_target`), when the config loads, then the step's kickback flag takes the registry's existing default (false) | task-2 | covered | a second custom step declaring only `gate: false` (no `kickback_target`) gets `kickbackTarget === false` | diff-local |
| criterion | Story 1 negative: Given a built-in step (e.g. `plan`) declaring `gate`, when `validateConfig` runs, then loading fails with an error naming the step and stating the key is custom-step-only | task-1 | covered | the same keys on built-in step `plan` fail naming the step and "custom steps only" | diff-local |
| criterion | Story 1 negative: Given a custom step declaring `gate: "loop"` (non-boolean), when `validateConfig` runs, then loading fails with a type error naming the key and expected boolean type | task-1 | covered | `gate: "loop"` fails naming `gate` and boolean | diff-local |
| criterion | Story 1 negative: Given a custom step declaring `kickback_target: "yes"` (non-boolean), when `validateConfig` runs, then loading fails with a type error naming the key and expected type | task-1 | covered | `kickback_target: "yes"` fails naming `kickback_target` and boolean | diff-local |
| criterion | Story 2 happy: Given a config carrying none of the removed keys, when `validateConfig` runs, then the config loads exactly as before the change | task-6 | covered | configs with `steps.<name>.by_tier` / `phases.<name>.by_tier` still validate | diff-local |
| criterion | Story 2 happy: Given a config with nested `harness_self_host.auth_park_timeout_minutes: 0`, when the config is resolved and consumed, then the existing contract is unchanged (0 still means immediate credentials-specific HALT; non-integer/negative still coerce to 60) | task-5 | covered | nested `harness_self_host.auth_park_timeout_minutes` keeps its exact contract — 0 → immediate credentials HALT, non-integer/negative → 60 | diff-local |
| criterion | Story 2 negative: Given a config carrying `complexity.default_tier`, when `validateConfig` runs, then loading fails with the ordinary unknown-key error naming the key | task-3 | covered | a config with `complexity: { default_tier: 'M' }` fails validation with an unknown-key error naming `default_tier` | diff-local |
| criterion | Story 2 negative: Given a config carrying `harness_self_host.skill_relink_preflight`, when `validateConfig` runs, then loading fails with the unknown-key error, and the skill-relink preflight still runs unconditionally on every self-host path | task-4 | covered | a config with `harness_self_host: { skill_relink_preflight: false }` fails validation with an unknown-key error naming the key | diff-local |
| criterion | Story 2 negative: Given a config carrying top-level `auth_park_timeout_minutes`, when `validateConfig` runs, then loading fails with the unknown-top-level-key error (unchanged from today), and no top-level resolver for it exists to contradict that | task-5 | covered | fails with `Unknown top-level key` | diff-local |
| criterion | Story 2 negative: Given a `defaults:` block carrying `by_tier`, when `validateConfig` runs, then loading fails with an unknown-key error for `defaults.by_tier`, while `steps.<name>.by_tier` and `phases.<name>.by_tier` continue to load and resolve | task-6 | covered | a config with `defaults: { by_tier: { S: {} } }` fails validation with an unknown-key error naming `defaults.by_tier` | diff-local |
| criterion | Story 3 happy: Given a config with `mergeable_autoresolve.enabled: true` and a `suiteCommand`, when the daemon reads autoresolve config, then enablement, suite command, and cooldown behave exactly as before | task-7 | covered | raw-block consumers in `daemon-cli.ts`, `autoresolve.ts`, `mergeable-sweep.ts` are untouched | diff-local |
| criterion | Story 3 negative: Given `mergeable_autoresolve.enabled: false` or the block absent, when a CONFLICTING PR is swept, then no autoresolve dispatch occurs, exactly as before the resolver deletion | task-7 | covered | disabled/absent block still means no autoresolve dispatch | diff-local |
| criterion | Story 4 happy: Given a user config with a valid `conductor:` block and a project config without one, when the merged config loads, then the user's conductor values are in effect | task-8 | covered | the merged/user path with a valid `conductor` block still validates | diff-local |
| criterion | Story 4 happy: Given `conduct-ts config set` writing the user-level conductor block, when it validates and writes, then that path is unchanged | task-8 | covered | including existing `spec_owner` guard tests and `validateConductorBlock` tests unmodified | diff-local |
| criterion | Story 4 negative: Given a committed project config carrying a `conductor:` block, when `validateConfig` runs on the project source (pre-merge), then loading fails with a hard error naming the offending file and stating the fix (move the block to the user config), mirroring the `spec_owner` guard | task-8 | covered | a PRESENT `conductor` key — regardless of value — is a hard rejection naming `projectConfigPath(projectRoot)` and the fix | diff-local |
| criterion | Story 4 negative: Given a user config with a `conductor:` block and a clean project config, when the merged pass validates, then the guard does not fire on the merged user values | task-8 | covered | merged/user path test passes | diff-local |
| criterion | Story 5 happy: Given the shipped registry, when the coverage test runs, then every key accepted by the validator's key sets has exactly one declaration, and every non-`none` declaration names a production consumer module that resolves | task-9, task-10, task-11 | covered | every accepted key from the exported validator sets has exactly one declaration (both-direction diff in the test) | diff-local |
| criterion | Story 5 happy: Given a key that is valid but deliberately inert (e.g. self-host-precedence-downgraded keys), when the test runs, then its `{ consumer: 'none', reason: <tracked ref or rationale> }` declaration passes as first-class | task-9 | covered | `none` requires `reason`, INERT-waiver grammar `none (inert until <ref>)` welcome | diff-local |
| criterion | Story 5 negative: Given a key added to a validator accepted set with no registry declaration, when the coverage test runs, then it fails naming the undeclared key | task-10, task-11 | covered | a key in the sets with no declaration fails naming the key | diff-local |
| criterion | Story 5 negative: Given a registry declaration naming a consumer module that does not exist, when the coverage test runs, then it fails naming the declaration and the unresolvable consumer | task-10 | covered | a declaration whose `consumer` module path does not exist on disk fails naming the declaration and path | diff-local |
| criterion | Story 5 negative: Given a registry declaration for a key the validator no longer accepts, when the coverage test runs, then it fails naming the orphaned declaration | task-10 | covered | a declaration for a key absent from the sets fails as orphaned | diff-local |
