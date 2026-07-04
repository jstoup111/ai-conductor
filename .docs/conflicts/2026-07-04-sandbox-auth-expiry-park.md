# Conflict Check: sandbox-auth-expiry-park
**Date:** 2026-07-04
**New stories:** .docs/stories/sandbox-auth-expiry-park.md (TR-1…TR-5)
**Result:** PASSED — zero blocking, zero degrading conflicts

## Surfaces scanned

All `.docs/stories/*.md` (30+ files keyword-hit on halt/retry/sandbox/credential;
the four with genuine surface overlap examined pairwise), plus the governing ADRs.

## Findings

1. **model-availability-fallback-ladder (shipped, #186/PR #276)** — shares the
   signature-classification site (`claude-provider.ts`) and the no-budget-burn
   conductor paths. **No conflict:** TR-1 adds a new, disjoint signature and pins
   ordering (auth checked first; a matched auth failure never reaches
   model-unavailable handling, never marks a ladder model dead). The ladder
   stories' assertions ("ordinary failure → no modelUnavailable flag") remain
   true — an auth failure was never classified as modelUnavailable before and
   still isn't.
2. **harness-self-host-guardrails / adr-2026-06-30-sandbox-build-isolation
   (TR-6)** — sandbox provisioning invariants. **No conflict:** TR-3's refresh is
   a re-copy through the existing copy helper; no symlink to global config is
   introduced. Provision-failure semantics (no build launch, partial sandbox
   removed) are untouched.
3. **Issue #188 retry-as-escalation (OPEN, unbuilt)** — will reshape the same
   retry ladder. **Noted overlap, pre-resolved:** adr-2026-07-04-auth-failure-
   park-and-poll pins "auth classification precedes any retry/escalation decision
   and never triggers effort/model escalation" as a binding constraint on #188's
   future spec. Sequencing is safe whichever lands first: this feature does not
   modify the retry ladder's escalation shape, and #188 must honor the APPROVED
   ADR's ordering clause.
4. **Rate-limit / stale-session no-burn semantics** — TR-1/TR-3 mirror the
   existing `attempt--` contract without modifying those branches; a
   rate-limit-matching output with no auth signature keeps its existing path
   (explicit TR-1 negative scenario). No resource contention: `authFailure` is a
   new flag, `auth_park_timeout_minutes` a new config key, neither reuses an
   existing field with different semantics.
5. **REKICK / HALT.cleared remediation** — TR-4 asserts the standard remediation
   flow works unchanged on an auth-timeout HALT; no story alters the HALT
   marker protocol itself.

## Accepted degrading conflicts

None.
