# ADR: Live provider coverage is one smoke file per provider, and gate enforcement follows the credential

**Date:** 2026-08-12
**Status:** APPROVED (operator-approved 2026-08-12)
**Deciders:** James Stoup (operator), engineer session (ai-conductor#1264)
**Feature:** live-daemon-e2e-tier-covers-only-claude-no-real-ag (jstoup111/ai-conductor#1264)
**Related:** `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization` (the APPROVED
capability model this extends); `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`
(the workflow this changes, and whose Codex-deferral clause this amends);
`adr-2026-08-02-live-tier-asserts-outcomes-not-scripts` (governs both legs' assertions);
`adr-2026-08-04-live-tier-provisions-its-own-provider-home` (the home the second leg reuses)

## Context

Codex is a first-class built-in provider, registered beside Claude at
`plugin-loader.ts:153-157`. The live daemon E2E tier — the only place a real agent drives the
real `runDaemon` claim-to-finish path — covers Claude alone, so roughly half the provider
surface reaches v1.0 with no live end-to-end signal.

`adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` deferred the Codex leg and
recorded that "the matrix shape is retained precisely so the Codex leg is one entry plus one
credential var." Verified against the tree on 2026-08-12, that assertion does not hold:

- **The matrix parameterizes nothing.** `live-daemon-e2e.yml` declares
  `matrix: provider: [claude]`, but every leg runs the identical `npm run smoke` and the
  credential-check step reads only `CLAUDE_CODE_OAUTH_TOKEN`. The matrix value is never
  consumed. Adding `codex` to the list would run the Claude leg twice.
- **The capability model has no provider dimension.** `smoke-capability.ts` resolves the
  `credentialed` capability against a hardcoded `CLAUDE_CODE_OAUTH_TOKEN` in *both*
  `resolveAdvisorySmokeCapabilities` and `resolveGateSmokeCapabilities`.
- **The live tier is hardcoded end to end.** `daemon-e2e-live.smoke.test.ts` constructs
  `new ClaudeProvider()`, probes `which claude`, passes `executable: 'claude'`,
  `providerKey: 'claude'`, and reads the Claude token directly.

The decisive constraint is `smoke-runner.ts`: it parses **one** `smokeCapability` declaration
per file, resolves **one** outcome per file, emits **one** ledger line per file, and records
failure per file. Capability resolution is file-granular. That is what makes the isolation
requirement (issue #1264's fourth desired outcome — "one provider's missing credential or
absent CLI never suppresses, fails, or masks the other's result") a **file-layout** question
rather than a workflow-configuration question.

A second constraint bounds the gate design. `release.yml:124-127` calls this tier with
`require_credentials: true`, which selects `SMOKE_MODE=gate`, where an unmet capability is a
**failure**. Codex headless API-key authentication has no CI precedent anywhere in this
repository — verified 2026-08-12: no repository variable exists, and repository secrets are
`CLAUDE_CODE_OAUTH_TOKEN`, `RELEASE_PR_APP_ID`, and `RELEASE_PR_APP_PRIVATE_KEY`. So a Codex
leg wired fail-closed on the day it merges could block every release on an auth path nobody has
ever seen succeed on a runner.

## Options Considered

### Option A: One smoke file per provider, gate enforcement keyed to credential presence
- **Pros:** Isolation is structural. Because the runner's unit of resolution, ledger line, and
  failure is the file, a missing `CODEX_API_KEY` fails or skips only the Codex file and cannot
  touch the Claude verdict — locally under a bare `npm run smoke` exactly as in CI. Each leg
  gets its own ledger line, so the tier reports per-provider outcomes without a new reporting
  channel. Extends the existing capability model along the axis its own ADR anticipated
  ("splittable by cost later") rather than working around it.
- **Cons:** Widens the closed `SMOKE_CAPABILITIES` union and changes the
  `assertGateCredentialedExecution` invariant — both read by a release-gating path. Splitting a
  671-line file risks disturbing a currently-green gate.

### Option B: One file, in-file provider loop, provider chosen by the CI matrix
- **Pros:** Smallest diff. No change to the capability union or the gate invariant. This is the
  shape the deferral ADR anticipated.
- **Cons:** Fails the isolation requirement. One file declares one capability, so in gate mode a
  missing Codex credential fails the **shared file** and masks the Claude verdict — or, if the
  capability stays Claude-only, the Codex leg is never gated at all. Isolation would exist only
  as an artifact of CI matrix configuration; a developer running `npm run smoke` locally still
  gets the two providers coupled. There is also nowhere natural to hang the coverage guard.

### Option C: Hand-written second Codex file, existing Claude file untouched
- **Pros:** Zero risk to the currently-green Claude leg. Fastest route to a Codex verdict.
- **Cons:** Duplicates roughly 200 lines of seed/provision/preflight/meter/assert logic. The two
  copies drift, and the claim that both providers drive "the same claim-to-finish path" — the
  entire point of the tier — erodes silently and invisibly.

## Decision

**Adopt Option A.**

**1. One live smoke file per provider, over one shared run body.** The seed → provision →
preflight → meter → `runDaemon` → assert sequence is extracted once and parameterized by a
provider descriptor (id, provider construction, binary name, credential environment variable,
self-host executable, `providerKey`). Each provider gets a thin file that supplies its
descriptor. Both legs therefore provably drive the same path — the property Option C forfeits —
while the runner's existing file granularity delivers isolation for free.

Option B was rejected on the isolation requirement specifically, not on diff size. Coupling two
providers inside one file makes a missing credential for either one a shared-file outcome, and
"masks the other's result" is precisely the failure the issue names.

**2. The `credentialed` capability gains a provider dimension.** The union stays closed —
`credentialed:claude` and `credentialed:codex` are enumerated members, not a free-form string —
and each resolves against that provider's own credential variable in both advisory and gate
mode. This is an extension of the model `adr-2026-08-07` carries forward, not a departure from
it: that ADR's premise is that a capability names *a fact about what a file needs*, and "needs
the Codex credential" is a different fact from "needs the Claude credential."

**3. Gate enforcement follows the credential; the coverage guard does not.** These are
deliberately separated:

- A provider leg is **gate-enforced when its credential is present** in the environment, and
  recorded as an explicit, named non-gating skip in the ledger and the workflow step summary
  when it is absent. Adding the `CODEX_API_KEY` repository secret *is* the flip from advisory to
  gating — there is no follow-up ticket to forget and no second code change to make.
- `assertGateCredentialedExecution` still requires at least one credentialed leg to have
  actually run, so the gate can never silently degrade into an empty pass.
- The coverage guard (see `adr-2026-08-12-live-provider-coverage-from-plugin-registry`) is
  **not** credential-conditional: a registered provider with no live leg at all is always a
  failure, whether or not its credential exists.

This is the operator's decision of 2026-08-12 ("advisory until proven, then flip"), implemented
as machinery rather than as a promise. It resolves the unproven-auth risk without the failure
mode of a deferred follow-up: the non-gating state is visible in every run's ledger, and it ends
the moment the credential lands.

**4. The workflow matrix becomes load-bearing.** Each leg checks only its own credential, runs
only its own provider's smoke file, and emits its own step summary and failure diagnostics —
giving the Codex leg the same daemon-log-and-pipeline-state excerpt the Claude leg prints.

**5. Nothing about assertion semantics changes.** `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`
governs both legs identically: terminal state, committed artifacts, token cap. Codex is held to
the same outcome assertions as Claude, never to a Codex-shaped script, and the token cap
(`DAEMON_E2E_LIVE_TOKEN_CAP`) applies per leg with each leg reporting its observed total.

## Consequences

### Positive
- Provider isolation is a property of the tier's structure, so it holds under a plain local
  `npm run smoke` and not only under a correctly-configured CI matrix.
- Per-provider ledger lines and step summaries ride the existing smoke ledger and GitHub step
  summary. No sidecar file, no second reporting channel.
- The shared run body makes "both providers drive the same claim-to-finish path" mechanically
  true rather than a maintenance commitment.
- The advisory-to-gating transition needs no code change, no release, and no reminder.

### Negative
- The closed capability union now grows with the provider set, so adding a third provider edits
  a typed union rather than only a data list. This is the cost of keeping the union closed; it
  is paid down by the coverage guard, which makes the omission impossible to miss.
- Splitting the 671-line live file touches code on the release-gating path. The extraction must
  be assertion-preserving; the existing ungated self-check cases in that file are the safety net
  and must keep passing unchanged.
- Until `CODEX_API_KEY` exists, the tier reports a visible non-gating Codex skip on every
  release. That is the intended, honest reading of the current state — not a silent pass.
- `CodexProvider` resolves its authentication in the constructor (`codex-provider.ts:169`), so
  the Codex leg must ensure `CODEX_API_KEY` is present in `process.env` *before* it constructs
  the provider. This is a real ordering constraint, not an incidental detail.

### Follow-up Actions
- [ ] Add the `CODEX_API_KEY` repository secret (operator-committed 2026-08-12); its presence
      flips the Codex leg to gate-enforced with no further change.
- [ ] Dispatch the Codex leg manually via `workflow_dispatch` to observe the first real run
      before a release consumes it.
- [ ] Amend `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` beside its
      "one entry plus one credential var" assertion, which this ADR falsifies.
