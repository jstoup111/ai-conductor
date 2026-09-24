# ADR: Daemon-owned build credential behind a BuildAuthProvider seam

**Date:** 2026-07-07
**Status:** APPROVED
**Feature:** isolate-daemon-build-auth-from-operator-oauth (jstoup111/ai-conductor#351)
**Amends:** adr-2026-06-30-sandbox-build-isolation (credential-copy clause only),
adr-2026-07-04-auth-failure-park-and-poll (park watches the daemon credential source)
**Related:** adr-2026-06-30-self-host-detection-seam, PR #175 (swappable identity seams)

## Context

The self-host sandbox copies the operator's `~/.claude/.credentials.json` into the
throwaway `CLAUDE_CONFIG_DIR` (adr-2026-06-30, TR-6 copy-not-symlink), and
`refreshSandboxCredentials` re-copies it after an auth park. Claude subscription OAuth
uses a **single-use refresh token that rotates on every refresh**, so the byte-copy
forks one OAuth grant into two live sessions: whichever side refreshes first rotates
the shared refresh token and strands the other. Observed effects (#351): the operator
is repeatedly logged out of their own interactive sessions while the daemon runs, and
builds HALT with "Operator credentials expired and refresh timed out after 60 minutes"
(3 episodes on 2026-07-05). #210 fixed the *failure handling* side (park-and-poll);
the *cause* — shared credential material — remained.

## Decision

1. **BuildAuthProvider seam.** Introduce a small provider interface in
   `engine/self-host/` that resolves the build credential for a self-host sandbox.
   Modes, selected via the `harness_self_host` config block (additive fields,
   safe-by-default resolution like every other field in `resolveSelfHostConfig`):
   - **`daemon-token` (default):** a long-lived token minted once by the operator via
     `claude setup-token`, stored daemon-side (e.g. `~/.ai-conductor/build-auth`,
     mode 0600), injected into the sandbox child env as `CLAUDE_CODE_OAUTH_TOKEN`.
   - **`api-key`:** `ANTHROPIC_API_KEY` pass-through (pay-per-token billing; explicit
     opt-in, never a silent default).
   The seam is the swap point for platform-provided identity in the isolated-remote
   (EKS) deployment — satisfying adr-2026-07-04 §5's forward carve-out.
2. **Sever the copy.** Sandbox provisioning **stops reading the operator's
   `.credentials.json` entirely** (the `copyIfPresent` of `CREDENTIALS_FILE` is
   removed, not conditioned). `refreshSandboxCredentials` is retired. The existing
   provisioning already tolerates a credentials-file-less sandbox (env-key path), so
   TR-5/TR-6 are preserved: fewer global reads, same fail-closed provisioning, no new
   symlinks.
3. **No silent fallback.** In `daemon-token` mode with a missing/empty token source,
   the pre-flight HALTs with a credentials-specific reason naming the one-time setup
   step (`claude setup-token`) and the expected token path. Falling back to copying
   operator OAuth would silently reintroduce the bug; falling back to API key would
   silently change billing. Fail closed, name the fix.
4. **Park demotes to fallback on the daemon credential.** The park-and-poll machinery
   (adr-2026-07-04) is retargeted: pre-flight and the `authFailure` branch watch the
   **daemon token source** (presence + mtime; a long-lived token carries no
   `expiresAt` JSON, so freshness classification degrades to presence/change
   detection, with the signature catch as backstop — same fail-open posture for
   unknown states). HALT messages name the daemon token and its remediation, never
   the operator's OAuth file.
5. **Real-binary smoke is a hard gate.** The claim "`CLAUDE_CODE_OAUTH_TOKEN` in the
   child env authenticates a headless `claude -p` from a fresh CLAUDE_CONFIG_DIR" must
   be proven against the actual installed CLI in the test suite (per
   feedback_injected_runner_needs_real_binary_smoke) before the copy path is deleted.

> **Amended 2026-09-24 by #2737:** The Consequences scope note deferred extending daemon-token
> auth beyond self-host builds as "a future decision". This amendment makes that decision for one
> consumer only — the contained Claude `build_review` reviewer (adr-2026-09-10-portable-build-review-policy
> D5), whose scratch HOME and CLAUDE_CONFIG_DIR hide the operator login that ordinary non-self-host
> steps read in place, so on non-self-host projects it was never authenticated. Every daemon already
> holds a daemon build token in the default mode: `resolveSelfHostConfig` resolves an absent
> `build_auth` block to `daemon-token`, and the daemon-level gate of
> adr-2026-07-22-daemon-level-missing-credential-gate parks dispatch until that token is readable, for
> every project. Decisions 1–5 are unchanged, including Decision 2: no operator credential file is
> read for, copied into, or mounted into a sandbox or review scratch.
>
> 6. **Contained-reviewer credential follows the resolved build-auth mode.** The engine resolves the
>    contained Claude reviewer's credential from the same resolved `build_auth` mode the daemon gate
>    uses, on self-host and non-self-host projects alike. In `daemon-token` mode (including an absent
>    block) the reviewer receives the daemon build token as `CLAUDE_CODE_OAUTH_TOKEN`. In `api-key`
>    mode it relies on the ambient `ANTHROPIC_API_KEY` the review allowlist already admits. The
>    operator's stored Claude login is never read for a reviewer, and a missing credential never falls
>    back to another source. Codex reviewers keep their existing seeded-login path; non-contained steps
>    are untouched.
> 7. **Exactly one value crosses the boundary.** The resolved credential enters the contained reviewer
>    solely through the provider env overlay, where the engine-owned value overrides any inherited one.
>    No credential file, refresh token, or host config directory is copied or mounted into review
>    scratch. The daemon token is a separately minted, non-rotating grant, so the reviewer cannot
>    disturb the operator's interactive login. This is the deliberate re-supply
>    adr-2026-08-04-live-tier-provisions-its-own-provider-home distinguishes from ambient inheritance;
>    the review allowlist, mount set, and two-sided probes are unchanged.
> 8. **Nothing usable refuses before any attempt.** When the resolved mode's credential is missing,
>    empty, or unreadable at member preparation — an interactive run without a minted token, or a
>    token removed after the daemon gate passed — the member is refused before the first provider
>    attempt with the closed cause of adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane D2.3.
>    The refusal names the mode, the credential path or variable and its state, and the shared
>    remediation message of adr-2026-07-22-daemon-level-missing-credential-gate Decision 3, never a
>    credential value. Decision 5's real-binary smoke already proves the daemon token authenticates a
>    headless `claude -p` from a fresh CLAUDE_CONFIG_DIR; no new credential source is introduced.
>
> Rescinded before merge: an earlier draft of this amendment also read the access token of the
> operator's stored login (with a host-side CLI refresh near expiry) when no daemon token was
> configured. It was dropped once the daemon gate above showed every daemon run already holds a
> daemon token; reading operator OAuth would have re-coupled the grants Decision 2 separated, and it
> rested on an unverified claim that a login access token authenticates via the env variable.

## Evidence (verify-claims ledger)

- `claude setup-token` exists and is subscription-scoped — **verified**: CLI 2.1.202
  `--help` ("Set up a long-lived authentication token (requires Claude subscription)").
- `CLAUDE_CODE_OAUTH_TOKEN` is supported by the installed CLI — **verified**: 65
  occurrences in the 2.1.202 ELF binary. End-to-end headless behavior: **inferred
  ~95%**, gated by the real-binary smoke (Decision 5).
- Sandbox tolerates a missing credentials file — **verified**: `copyIfPresent` +
  explicit env-key comment in `sandbox-build-env.ts:180`.
- Refresh-token rotation is the logout mechanism — **inferred ~85%** from the
  mutual-invalidation symptom pattern and repeated `.credentials.json` rewrites.
  The decision does not depend on the exact rotation semantics: separating the
  grants removes the coupling under any single-use-refresh scheme.
- A separately-minted token does not share rotation state with the interactive
  session — **inferred ~90%** (multi-device sessions on one account coexist;
  setup-token exists precisely for non-interactive use).

## Consequences

- **Positive:** operator sessions and daemon builds can no longer invalidate each
  other; the 60-minute auth-park HALT class disappears from normal operation; multiple
  daemons can share one non-rotating token without racing; billing stays on the
  subscription.
- **Positive:** identity seam is in place for EKS/platform identity (PR #175 direction).
- **Negative:** one-time operator onboarding step (`claude setup-token`) per host; a
  self-host daemon updated past this change HALTs at first build until the token is
  minted (mitigated by a CHANGELOG Migration block with the exact command).
- **Negative:** token lifecycle (revocation/expiry ~long-lived) is now a daemon
  operational concern; mitigated by presence-check pre-flight + park + specific HALT.
- **Scope note:** non-self-host consumer builds (which read `~/.claude` in place,
  shared not copied) keep today's behavior; the seam makes extending daemon-token
  auth to all daemon builds a future decision, not an accident of this one.

## Alternatives rejected

- **`ANTHROPIC_API_KEY` as default:** moves all autonomous build usage to
  pay-per-token API billing. Retained as an explicit opt-in mode on the seam.
- **Read-only snapshot + refresh coordination:** the sandboxed CLI refreshes
  internally whenever its access token expires mid-build; rotation of the shared
  grant cannot be prevented from outside. Mitigation, not isolation.
- **Second full OAuth login in a daemon-owned config dir:** achieves the same grant
  separation but requires an interactive login the daemon cannot perform and
  duplicates rotating-credential lifecycle management; setup-token is the
  purpose-built non-interactive equivalent. Kept as the in-approach fallback if the
  env-var smoke fails.
