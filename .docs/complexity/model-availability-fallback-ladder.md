# Complexity: Model availability probe + fallback ladder

Tier: M

## Rationale

- **Single subsystem, sensitive seam.** All changes live in `src/conductor/src`
  (execution/ + engine/), but they modify the invocation retry/HALT path — the
  daemon's most failure-sensitive code. A wrong design silently degrades gates
  or masks real failures.
- **New failure-class threading.** A third detected failure class
  (`modelUnavailable`, alongside `rateLimited`/`sessionExpired`) must thread
  provider → step-runners → conductor retry logic coherently.
- **Config schema addition.** New `.ai-conductor/config.yml` key for the ladder
  (default `fable → opus → sonnet`) with validation and docs.
- **Mandated negative paths.** Issue #186 requires tests for an unavailable
  model at every ladder position and a fully empty ladder.
- **Not Large:** no new services, no cross-repo or cross-cutting architecture,
  no data model, story count well under 15.

Medium ⇒ architecture-diagram + lightweight architecture-review + conflict-check
all run; PRD skipped (technical track).
