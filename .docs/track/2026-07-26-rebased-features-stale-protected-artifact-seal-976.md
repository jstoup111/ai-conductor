# Track: rebased features halt on a stale protected-artifact seal (#976)

Track: technical

Engine-internal correctness fix to the protected-artifact safety boundary
(`src/conductor/src/engine/protected-artifact-seal.ts` and its conductor call site). The seal is
generated, gitignored pipeline state — there is no user-facing product surface, no new capability,
and no operator-visible configuration. Acceptance criteria live directly in the stories.

The change is nonetheless safety-relevant: it introduces the first legitimate way for an existing
seal to be replaced, so it carries an ADR and an architecture review despite being technical-track.
