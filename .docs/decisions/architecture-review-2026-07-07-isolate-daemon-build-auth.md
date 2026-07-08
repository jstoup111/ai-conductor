# Architecture Review: Isolate Daemon Build Auth from Operator OAuth
**Date:** 2026-07-07
**Mode:** Lightweight (Tier M) — pre-stories, technical track
**Input reviewed:** explore decision (.memory/decisions/2026-07-07-isolate-daemon-build-auth.md), to-be diagrams (.docs/architecture/2026-07-07-isolate-daemon-build-auth-from-operator-oauth.md), governing ADRs, self-host source
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** no new packages or services. The mechanism is env-var injection into the
  existing sandbox `childEnv()` plus removal of one copy call — verified compatible
  with `sandbox-build-env.ts` as written (`copyIfPresent` already models the
  env-key-auth, no-credentials-file sandbox).
- **CLI capability:** `claude setup-token` verified present (CLI 2.1.202);
  `CLAUDE_CODE_OAUTH_TOKEN` verified present in the installed binary (65 refs).
  End-to-end headless auth is the one load-bearing residual — gated by Condition 1.
- **Prerequisites:** one-time operator mint of the daemon token; config block
  addition in `resolveSelfHostConfig` (additive, safe-by-default).
- **Integration surface:** `engine/self-host/` (sandbox-build-env,
  operator-credentials) + the conductor auth-failure branch + pre-flight. Two
  modules, one subsystem — within Tier M bounds.
- **Data/schema:** none. No worktree-isolation impact (token file is host-global,
  read-only to builds).

## Alignment

- **adr-2026-06-30-sandbox-build-isolation:** TR-5 (fail-closed provisioning) and
  TR-6 (no symlink to global config) are strengthened, not weakened — the sandbox
  stops reading global credential state altogether. The ADR's credential-copy clause
  is formally amended by the new ADR (append-only; original stays APPROVED for its
  skills/hooks/settings/trust machinery).
- **adr-2026-07-04-auth-failure-park-and-poll:** §5 explicitly reserved this seam
  ("a platform-provided identity source can replace the file-based implementation
  without touching classification or park logic"). The new design lands inside that
  carve-out: classification and park logic survive; only the watched source changes.
- **PR #175 (design for isolated EKS):** the BuildAuthProvider seam is the swappable
  identity boundary that direction calls for.
- **Pattern consistency:** config resolution follows the existing safe-by-default
  `resolveSelfHostConfig` pattern; the provider seam mirrors existing injectable
  seams (SandboxFs, globalConfigDir).
- **State management:** auth mode is an explicit enum-like mode, not boolean flags;
  invalid mode strings must be rejected at config validation (fail-closed, matching
  `CANONICAL_BREAKING_SURFACES` precedent of never silently accepting unknowns).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Env-var auth doesn't work headless on subscription | Technical | Low | High | Condition 1: real-binary smoke before copy path is deleted; in-approach fallback = daemon-owned config dir |
| Update HALTs every self-host daemon until token minted | Integration | Certain | Medium | CHANGELOG Migration block with exact `claude setup-token` steps; HALT names the fix |
| Token file leaks (plaintext long-lived credential) | Security | Low | High | 0600 perms, path outside any repo, never committed/logged; HALT messages name the path but never the value |
| Park/pre-flight misclassifies token-mode state (no expiresAt JSON) | Technical | Medium | Medium | Presence/mtime classification + signature backstop; negative-path specs per adr-2026-07-04 |
| Conductor auth-branch edits collide with PR #392 (rate-limit episode) | Integration | Low | Low | Different branches of the retry loop; conflict-check step assesses formally |

## ADRs Created

- `adr-2026-07-07-daemon-owned-build-credential.md` — DRAFT → pending operator
  approval (presented in-session). Amends the credential-copy clause of
  adr-2026-06-30-sandbox-build-isolation and retargets adr-2026-07-04's park source.

## Conditions

1. **Real-binary smoke gate:** a test invoking the actual installed `claude` binary
   with a fresh CLAUDE_CONFIG_DIR and `CLAUDE_CODE_OAUTH_TOKEN` must pass before the
   operator-credential copy path is deleted (feedback_injected_runner_needs_real_binary_smoke).
2. **No silent fallback:** missing daemon token in `daemon-token` mode must HALT with
   the mint instructions — never fall back to copying operator OAuth or to API-key
   billing.
3. **Migration block:** the PR must carry a CHANGELOG `## Migration` section with the
   one-time `claude setup-token` onboarding (operational breaking change for
   self-host daemons).
4. **Negative-path specs** at every new classification/parse site (adr-2026-07-04
   consequence carries forward): successful runs mentioning "Not logged in" must not
   park; empty/whitespace token file = missing; park must leave retry budget intact.
