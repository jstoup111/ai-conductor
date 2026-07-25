# Conflict Check: Codex Auth, Sandbox, and Permission Readiness (#905)

**Date:** 2026-07-25
**Result:** STALE — the authentication-recovery amendment superseded this report's
first resolution. Rerun conflict-check after the amended #905 stories are approved.

## Inventory and method

The check inventoried every file under `.docs/stories/`, every active design under
`.docs/specs/`, and all prior reports under `.docs/conflicts/`. It then compared all
ten #905 stories internally and examined every repository artifact touching provider
routing, authentication, credentials, readiness, model/provider fallback, sandbox or
permission policy, self-hosting, Git/network execution, and secret handling. All five
conflict types were evaluated: contradiction, behavioral overlap, state conflict,
resource contention, and sequencing conflict.

## Conflict 1: Provider-neutral park wording vs Codex immediate HALT

**Stories involved:** #927 ST-927-6 “Preserve authentication and ordinary failure
recovery” vs #905 Story 5 “Stop post-dispatch authentication rejection without
budget or fallback”
**Files:** `.docs/stories/per-step-provider-routing-927.md` vs
`.docs/stories/codex-auth-sandbox-permission-readiness-905.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 98% — #927 explicitly sent every provider auth failure to the
“existing authentication retry/park flow,” while #905 explicitly forbids Codex from
entering the Claude park and requires immediate HALT.

**Description:** Both clauses governed the same Codex authentication rejection and
required mutually exclusive terminal behavior. Their common invariants—auth wins
classification precedence, consumes no retry/model budget, and never advances the
provider list—were compatible; only the recovery disposition was contradictory.

**Resolution options:**

1. Scope recovery by failed provider: Claude parks; Codex HALTs immediately.
2. Send Codex through the Claude credential park, requiring a new Codex credential
   watcher and remediation lifecycle.
3. Replace both providers' recovery with one generic immediate HALT.

**Recommendation:** Option 1. It preserves #927's no-fallback intent, preserves
Claude byte-for-byte, and implements the approved #905 provider-isolation decision.

**Resolution:** Option 1 was selected by the operator-approved #905 ADR and accepted
#905 stories. ST-927-6 now says “provider's authentication disposition” and names the
Claude/Codex branches explicitly.

## Conflict 2: Unconditional Claude self-host setup vs Codex-native self-host setup

**Stories involved:** #498 build-auth stories and the original harness self-host
guardrail stories vs #905 Story 10 “Preserve provider-specific self-host safeguards
and Claude compatibility”
**Files:** `.docs/stories/build-auth-token-check-and-classify.md` and
`.docs/stories/harness-self-host-guardrails.md` vs
`.docs/stories/codex-auth-sandbox-permission-readiness-905.md`
**Type:** sequencing conflict
**Severity:** blocking
**Confidence:** 97% — the older stories placed the Claude token gate, relink, and
throwaway `CLAUDE_CONFIG_DIR` before every self-build, while #905 requires provider
selection first and zero Claude setup calls for a Codex self-build.

**Description:** If the older sequencing remained provider-neutral, a missing Claude
token could park a Codex self-build and Codex could read or mutate Claude account
state before its own readiness check. That violates #905's provider isolation and
makes Codex autonomy depend on unrelated Claude health.

**Resolution options:**

1. Resolve the preferred build provider first; retain all existing Claude setup only
   for Claude, use Codex-native readiness/policy for Codex, and retain all
   provider-neutral release gates.
2. Port the Claude token/config/hook sandbox into Codex, coupling the providers and
   adding a second Codex credential lifecycle.
3. Skip the whole self-host guardrail bundle for Codex, including provider-neutral
   version and release gates.

**Recommendation:** Option 1. It is the smallest provider-aware split, preserves
existing Claude safety, and keeps the provider-neutral self-release contract intact.

**Resolution:** Option 1 was selected by the operator-approved #905 ADR and accepted
#905 stories. Provider-scope amendment notes were added to both older story files.

## Verified clean interactions

- **#901 installation readiness:** CLI presence/readiness selection and per-dispatch
  Codex authentication readiness are separate gates; neither mutates execution
  provider selection.
- **#902 model policy and #927 provider fallback:** model unavailability may walk a
  provider-native ladder and then the configured provider list; authentication and
  permission failures do neither.
- **#904 Codex skills/repository guidance:** remains the owner of Codex skill
  discovery, `$skill`, `AGENTS.md`, and bootstrap guidance; #905 adds none of those
  surfaces.
- **Phase-scoped `.docs` guard and write fences:** lifecycle authorization remains
  distinct from Codex's filesystem sandbox. #905 neither grants permission to bypass
  a harness lifecycle guard nor ports the Claude hook sandbox.
- **Git/network workflows:** existing commit, PR, force-with-lease, and publication
  requirements describe the operation and its safety preconditions; #905 only makes
  the Codex boundary decision automatic and does not alter those workflows.
- **Internal #905 pairs:** deterministic auth selection, four-state readiness,
  confidentiality, bounded execution, provider isolation, and self-host branching
  compose without contradictory states or circular ordering.

## Active-work overlap

The Codex provider, provider installation, model policy, per-step routing, and Codex
skill-parity work visible in historical worktrees is already represented in current
`main` by merged changes. The implementation plan must still treat
`codex-provider.ts`, conductor auth joins, group result propagation, and self-host
dispatch preparation as shared high-contention surfaces and verify current signatures
before each edit.

## Re-check

After the three provider-scope amendments, every auth failure has exactly one
provider-owned disposition and every self-host dispatch has exactly one
provider-specific preparation branch. Zero blocking conflicts and zero degrading
conflicts remain.
