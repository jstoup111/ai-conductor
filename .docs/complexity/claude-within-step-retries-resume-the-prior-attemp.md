# Complexity: Claude declares no resume (#1071)

Tier: M

## Rationale

Sizing assumes **#1069 (issue #903) merges first** — it supplies the `supportsSessionResume`
capability, the `runProviderInvocation` gate, and the `session_policy` diagnostic that this
feature consumes. Without that dependency the tier would rise, because the capability itself
would have to be built here.

**Signals present**

- **A state-machine contract change.** `ProviderSessionScope` is a small state machine
  (`create` → `markCreated` → `prepare` returns `resume`). Moving id minting from per-scope to
  per-invocation changes every consumer of `created`, including the fallback-candidate and
  concurrent-group branch paths.
- **Three dispatch paths, only one of which #1069 covers.** The provider-aware path is gated;
  `group-core.ts:464-469` and `step-runners.ts:529-530` are not, because they never enter
  `provider-execution.ts`. Each needs its own change and its own test.
- **A behavior-preserving companion that cannot be deferred.** Flipping the declaration without
  per-invocation minting trades conversational contamination for a `--session-id` collision on
  every retry, so the two ship together.
- **A genuinely new capability.** `runInteractive` carries no context outside the resumed
  conversation; cold-starting it requires threading failure context from two call sites.
- **Cross-feature test choreography.** #1069 amends the Codex half of several suites and
  deliberately preserves the Claude half; this feature inverts that surviving half, so the same
  files are edited in sequence by two features.
- **Contract documentation across six artifacts**, including an ADR clause that #1069 already
  re-qualified once and this feature resolves to unconditional.

**Signals absent**

- No new data model, persistence, or schema migration.
- No new third-party integration, auth surface, or CLI command.
- No new external contract — `bin/conduct-ts` flags and `settings.json` are untouched.
- No new abstraction is introduced: the capability seam already exists after #1069, and this
  feature consumes rather than extends it.

**Not Small** — it is not a single-seam edit. It spans a state-machine contract, two provider
adapters, two ungated dispatch paths, an operator-facing recovery path, and a dozen pinned
assertions, with a hard ordering dependency on another feature.

**Not Large** — the change is confined to one subsystem with a well-understood seam, adds no
integration or persistence surface, requires no architectural decomposition, and the bulk of the
conceptual work (deciding that resume becomes a declared capability) was done by #1069.

Architecture-diagram, lightweight architecture-review, conflict-check and coherence-check all
run at this tier.
