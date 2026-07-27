# ADR: Custom steps may declare fresh completion artifacts

**Date:** 2026-07-25
**Status:** APPROVED
**Deciders:** Project operator and maintain-documentation architecture review

## Context

Repository configuration can insert a custom step and dispatch its skill, but a custom step with
no built-in artifact glob or predicate is complete as soon as its runner returns successfully.
That behavior cannot enforce a judgment gate: a skill may report a blocking result while the
conductor continues to the next step.

The documentation workflow needs one repository-local gate after `rebase`. The generic engine
change must remain inert for every project and step that does not opt in. A prior run's marker must
not satisfy a new attempt.

## Options Considered

### Option A: Rely on the skill's exit behavior

- **Pros:** No engine change.
- **Cons:** Model behavior remains the completion authority; a returned session can false-pass.

### Option B: Add a built-in documentation predicate

- **Pros:** Direct mechanical enforcement.
- **Cons:** Makes a repository-specific workflow first-class globally and couples the engine to one
  skill name.

### Option C: Add an opt-in custom-step completion artifact

- **Pros:** Reuses the existing completion gate; supports other repository-local custom gates;
  remains inert when absent.
- **Cons:** Adds one configuration key and exact-file freshness semantics.

## Decision

Choose Option C.

1. A custom step may set `completion_artifact` to one exact repository-relative file under
   `.pipeline/`. Built-in steps reject the key. Absolute paths, traversal, glob syntax, empty
   values, and `.pipeline/` without a filename are invalid.
2. A configured completion artifact makes that custom step completion-checked. No configured
   artifact preserves current custom-step behavior.
3. Completion requires the exact file to exist and have an mtime at or after the current attempt
   start. A non-dispatch check falls back to the conductor session start. No available freshness
   floor fails closed for the configured gate.
4. The skill owns marker creation. A blocking result omits the marker. The engine does not infer a
   pass from a review report or process exit alone.
5. Built-in completion predicates and artifact globs remain unchanged.

## Consequences

### Positive

- Repository-local judgment steps can block downstream execution mechanically.
- Stale markers cannot approve a later attempt.
- Consumer projects receive no new step or dependency unless they configure the key.

### Negative

- Marker freshness depends on filesystem mtime precision; the existing one-second tolerance is
  retained where required for filesystem compatibility.
- The engine verifies only marker presence and freshness, not the semantic quality of the review.

### Follow-up Actions

- [ ] Add the typed configuration field and fail-closed validation.
- [ ] Make completion-check detection config-aware.
- [ ] Add exact-file, freshness, compatibility, and gate-loop tests.
- [ ] Configure this repository's `maintain-documentation` custom step.
