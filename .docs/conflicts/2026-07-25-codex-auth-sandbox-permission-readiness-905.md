# Conflict Check: Codex Auth, Sandbox, and Permission Readiness (#905)

**Date:** 2026-07-25
**New stories:** `.docs/stories/codex-auth-sandbox-permission-readiness-905.md`
**Result:** PASSED AFTER RESOLUTION — zero remaining blocking conflicts and zero
accepted degrading conflicts

## Inventory and Method

The check inventoried all 233 Markdown files under `.docs/stories/`, all 37 files
under `.docs/specs/`, and all 115 prior reports under `.docs/conflicts/`. Semantic
scans identified every story and spec touching authentication, credentials, provider
routing/fallback, retries, model ladders, sandbox/permissions, Git/network dispatch,
operator parks, self-hosting, and daemon restart behavior. The intersecting artifacts
and their prior conflict resolutions were then read and compared directly.

All five conflict types were evaluated: contradiction, behavioral overlap, state
conflict, resource contention, and sequencing conflict. The verify-claims verdict is
**CLEAR**: every load-bearing reconciliation below follows accepted stories and the
operator-approved superseding #905 ADR; no unconfirmed assumption is used.

## Resolved Blocking Conflicts

### Conflict 1: Provider routing auth disposition versus shared recovery

**Stories involved:** #927 ST-927-6 “Preserve authentication and ordinary failure
recovery” vs. #905 Stories 5 and 11
**Files:** `.docs/stories/per-step-provider-routing-927.md` vs.
`.docs/stories/codex-auth-sandbox-permission-readiness-905.md`
**Type:** contradiction
**Severity:** blocking (resolved)
**Confidence:** 99% — the former clauses required different Codex terminal states;
the current clauses now require the same provider-neutral park boundary.

**Description:** The first #905 story set routed Codex auth failure directly to HALT,
while #927 routed provider authentication into existing recovery. The operator
clarified that every built-in provider must share one bounded parked lifecycle while
retaining provider/source-specific readiness, credential ownership, and remediation.

**Resolution options considered:**

1. Use one bounded lifecycle for every built-in provider, dispatching readiness only
   to the failed provider/source.
2. Keep Claude park and Codex immediate HALT.
3. Add a generalized credential broker or reloadable API-key store.

**Selection:** Option 1, approved by the operator. It preserves #927's auth-before-
fallback precedence, adds no credential sharing, and keeps startup-only API keys
honestly restart-required.

**Resolution applied:**

- Approved `adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness`,
  superseding the original #905 recovery decision.
- Amended FR-10/FR-22 and accepted #905 Stories 1–5, 9, and 11.
- Amended ST-927-6 so every built-in provider enters the common bounded park while
  only its selected source is rechecked.
- Preserved zero retry/model/provider/auth-source fallback budget and failed-group-
  member-only resume.

### Conflict 2: Unconditional Claude self-host preparation versus Codex isolation

**Stories involved:** #498 build-auth stories, #351 daemon-owned credential stories,
and the harness self-host guardrails vs. #905 Stories 9 and 10
**Files:** `.docs/stories/build-auth-token-check-and-classify.md`,
`.docs/stories/isolate-daemon-build-auth-from-operator-oauth.md`, and
`.docs/stories/harness-self-host-guardrails.md` vs.
`.docs/stories/codex-auth-sandbox-permission-readiness-905.md`
**Type:** sequencing conflict
**Severity:** blocking (resolved)
**Confidence:** 99% — unconditional Claude preparation would make a Codex self-build
depend on Claude account state before Codex readiness.

**Description:** Historical self-host stories placed Claude relink, build credential,
throwaway `CLAUDE_CONFIG_DIR`, token injection, and hook-sandbox preparation before
dispatch. Applying those requirements to Codex would violate provider isolation and
could park Codex work on unrelated Claude health.

**Resolution options considered:**

1. Resolve the build provider first; run Claude-only preparation for Claude and
   Codex-native readiness/policy for Codex, retaining common release gates.
2. Port Claude credential/config preparation into Codex.
3. Skip the complete self-host guardrail bundle for Codex.

**Selection:** Option 1, approved by the operator. “Codex skips it” therefore means
only Claude-specific preparation, never provider-neutral version, migration,
artifact, publication, or release gates.

**Resolution applied:** Provider-scope amendment notes now qualify all three
historical story files. #905 Story 10 asserts both the skipped Claude collaborators
and the retained provider-neutral gates.

## Verified Non-Conflicting Interactions

### Installation readiness (#901)

#901 explicitly limits readiness to local CLI presence and excludes authentication,
sandbox, permission, fallback, and remote-execution qualification. #905 begins at
selected-source authentication readiness immediately before unattended dispatch.
The layers are sequential and neither mutates execution-provider selection.

### Model and provider recovery (#902 and #927)

The accepted model stories already state that authentication does not advance a model
ladder or consume a retry attempt. ST-927-6 prevents provider fallback for auth. #905
adds the shared parked disposition without changing either precedence rule or cache.
No model, provider, or auth-source state crosses provider boundaries.

### Existing Claude auth park and build-auth gate (#210, #351, #498)

The old operator-credential-copy scenarios in `sandbox-auth-expiry-park.md` remain
explicitly superseded by #351. Its live auth classification and shared timeout knob
compose with #905. The #498 health check/daemon gate and #351 token/API-key checks are
now explicitly Claude-scoped; their provider-specific refresh/remediation feed the
same lifecycle rather than becoming Codex credential logic.

### Operator park markers

The operator park owns `.daemon/parked/<slug>` and blocks future feature dispatch.
The auth park is a bounded in-feature recovery state that may resume one failed
attempt after source readiness. #905 neither writes nor removes operator-owned park
markers, so the two states do not contend for a resource or create ambiguous
unpark semantics.

### Bounded permissions, Git, and network dispatch

The CI-fix story's generic `dangerouslySkipPermissions` runner option and the existing
unattended Git/network workflows require headless progress, not an effective Codex
danger-bypass command. #905 changes the Codex provider's effective policy to explicit
`workspace-write`, `on-request`, and `auto_review`; Claude's effective permission path
remains unchanged. Automatic-review denial stays a permission failure and never
falls through to auth, model, or provider recovery.

### Restart-required environment keys and daemon lifecycle

A startup-inherited API key cannot change in a running daemon. #905 represents that
source as restart-required, creates no reloadable store, and relies on normal
unfinished-feature recovery after a new process starts. Existing restart/supervision
stories neither promise hot reload of parent environment values nor change auth-park
budgets, so no lifecycle contradiction exists.

## Five-Type Re-Check

| Conflict type | Result |
|---|---|
| Contradiction | Clean — shared lifecycle and provider-specific source behavior are explicitly separated |
| Behavioral overlap | Clean — existing auth, model, permission, and readiness layers retain one owner each |
| State conflict | Clean — auth source, provider, session, model cache, and operator-park state remain isolated |
| Resource contention | Clean — no new credential store, marker owner, database, queue, or shared config writer |
| Sequencing conflict | Clean — provider/source selection precedes readiness; auth precedes fallback; self-host provider selection precedes provider-specific preparation |

## ADR and Review Disposition

- `adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness` is the
  approved, authoritative #905 ADR.
- `adr-2026-07-25-codex-unattended-readiness-and-bounded-execution` remains as
  superseded decision history.
- No degrading conflict was accepted.
- Review remains required because blocking conflicts were found and resolved and a
  superseding ADR was created.

## Verdict

**CONFLICT CHECK PASSED.** Zero blocking conflicts and zero degrading conflicts remain.
After operator review, proceed to `/plan`.
