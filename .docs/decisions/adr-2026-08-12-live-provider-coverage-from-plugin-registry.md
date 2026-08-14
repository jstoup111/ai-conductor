# ADR: Live-tier provider coverage is derived from the plugin registry, not a maintained list

**Date:** 2026-08-12
**Status:** APPROVED (operator-approved 2026-08-12)
**Deciders:** James Stoup (operator), engineer session (ai-conductor#1264)
**Feature:** live-daemon-e2e-tier-covers-only-claude-no-real-ag (jstoup111/ai-conductor#1264)
**Related:** `adr-2026-08-12-per-provider-live-smoke-legs` (the per-provider leg shape this
guards); `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization` (whose
discovery-by-glob principle this extends to the provider axis)

## Context

Issue #1264's fifth desired outcome is not about Codex: *"Whatever invocation runs the live tier
covers every supported provider, so adding a provider to the harness cannot silently leave it
uncovered."* It asks for a property that survives the next provider, not a second leg.

The gap it names has already happened once. `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`
deferred the Codex leg with the matrix shape retained "precisely so the Codex leg is one entry
plus one credential var." That intent was recorded in an ADR, in a workflow matrix entry, and in
a component-responsibility table — and Codex still shipped uncovered for ten days, because
nothing failed when it was missing. Prose intent did not hold; a check would have.

This repository's stated design principle is directly on point: *"Never rely on prompt discipline
for something machinery can enforce or compute... When an agent repeatedly violates a rule, the
fix is machinery that stamps/validates/rejects at the moment of the mistake — not a stronger
prompt."*

`adr-2026-08-07` already applies exactly this reasoning one axis over. Its single entry point
discovers smoke files by glob specifically so that "a newly added smoke file is picked up with no
list to edit anywhere, satisfying the requirement that the gate not depend on a maintained
inventory." Provider coverage has the same requirement and currently has no such mechanism.

A verified asymmetry makes the check cheap: the production provider set is already enumerable in
one place. `plugin-loader.ts:153-157` registers every built-in `llm_provider` against the plugin
registry, and `provider-home.ts` independently declares the `SelfHostProviderId` union
(`'claude' | 'codex'`) with its per-provider home variable mapping.

## Options Considered

### Option A: A structural test that enumerates registered `llm_provider` ids and asserts each has a live leg
- **Pros:** Fails at the moment of the mistake — the commit that registers a third provider
  without a live leg does not pass the ordinary test suite. Costs one cheap, hermetic structural
  test with no live dispatch, no credential, and no spend. Reuses the enumeration source that
  production dispatch itself reads, so the check cannot disagree with reality.
- **Cons:** Creates a dependency from the test tier onto the plugin registry's registration
  surface, so a refactor of how providers register must keep that surface enumerable. Registering
  a provider now carries an obligation to add a leg, which is a real cost on whoever adds one.

### Option B: Document the obligation in `docs/contributing/testing.md` and the ADR
- **Pros:** Zero code. No new coupling.
- **Cons:** This is the mechanism that already failed for Codex. It has one recorded trial and a
  0% success rate. It does not satisfy the stated outcome, which asks that omission be
  impossible-to-do-silently, not merely documented as undesirable.

### Option C: Have the smoke runner discover provider legs by glob, mirroring file discovery
- **Pros:** Symmetrical with `adr-2026-08-07`'s discovery-by-glob for files; no maintained list.
- **Cons:** Discovers only what exists. A glob over `daemon-e2e-live-*.smoke.test.ts` finds the
  legs that were written; it can never report the provider for which no file was written, which
  is the entire failure being guarded against. Glob discovery answers "what is here", and this
  outcome needs "what is missing."

## Decision

**Adopt Option A.** A structural test enumerates the registered `llm_provider` plugin ids and
asserts that each one has both a live smoke leg and a corresponding capability entry. A
registered provider without a leg fails the ordinary test suite.

Option C was rejected on a specific inadequacy rather than on taste: absence cannot be discovered
by globbing for presence. The check must start from the production provider set and look for the
leg, not start from the legs and hope the set matches.

The check is deliberately **not** credential-conditional. A missing credential is a legitimate,
temporary, environment-dependent state that
`adr-2026-08-12-per-provider-live-smoke-legs` handles by keying gate enforcement to credential
presence. A missing *leg* is a permanent coverage hole in the repository itself. Conflating the
two would let "we have not added the secret yet" excuse "we never wrote the test."

The provider descriptor manifest introduced by the companion ADR is the single seam this check
compares against, so the manifest — not a doc table, not a workflow matrix, not a prose
responsibility table — is the one place a provider's live-tier facts are recorded.

## Consequences

### Positive
- The next provider added to this harness cannot reach main without a live leg or an explicit,
  reviewed decision to change this check. The outcome becomes a repository invariant instead of a
  practice.
- The guard is hermetic and free: no credential, no binary, no live dispatch, no spend. It runs
  in the ordinary suite on every PR, not only in the manually-dispatched live tier.
- The failure message can name the uncovered provider directly, so the fix is obvious without
  reading this ADR.

### Negative
- Registering a new `llm_provider` now costs a live leg, which is a real barrier to adding an
  experimental or third-party provider. If that becomes burdensome, the correct response is to
  make the check's expectation explicit per provider — never to delete the check.
- The structural test couples to how providers are registered. A future refactor that makes the
  registry non-enumerable at test time would need to preserve an enumeration seam.
- The existing hardcoded `smokeCapabilities` map in `test/structural/smoke-entry-point.test.ts`
  becomes a second, overlapping inventory. It should be reconciled with the manifest rather than
  left to drift beside it.

### Follow-up Actions
- [ ] Reconcile `test/structural/smoke-entry-point.test.ts`'s hardcoded capability map with the
      provider descriptor manifest so the two cannot disagree.
- [ ] Ensure the guard's failure message names the uncovered provider id and points at the
      manifest.
