# Architecture Review: Sandbox auth-expiry park-and-poll
**Date:** 2026-07-04
**Mode:** Lightweight (Tier M, technical track, pre-stories)
**Input reviewed:** explore output + approved approach C (issue jstoup111/ai-conductor#210); diagrams `.docs/architecture/sandbox-auth-expiry-park.md`, `.docs/architecture/sequences/sandbox-auth-expiry-park.md`
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** all changes are internal to `src/conductor` (TypeScript);
  no new packages, services, or infrastructure. Credential parsing is a JSON read of
  a file the sandbox provisioner already copies.
- **Prerequisites:** none. The insertion points all exist today:
  - signature regexes in `src/conductor/src/execution/claude-provider.ts`
    (`MODEL_UNAVAILABLE_RE`, `RATE_LIMIT_RE`, `STALE_SESSION_RE`);
  - no-budget-burn retry paths in the conductor per-step loop
    (rateLimited / sessionExpired decrement `attempt--`);
  - `writeHaltMarker` in `src/conductor/src/engine/halt-marker.ts`;
  - `provisionSandboxBuildEnv` / `copyIfPresent` in
    `src/conductor/src/engine/self-host/sandbox-build-env.ts`.
- **Integration surface:** four modules (provider, step-runners, conductor,
  sandbox-build-env) + HALT wording — all within the engine boundary; no external APIs.
- **Data implications:** none (no schema, no persisted state beyond the existing
  HALT marker; the park loop is in-memory within a feature run).
- **Performance:** the park loop sleeps between polls; polling is a stat + small
  JSON read. Parking blocks only the current feature run — identical blocking
  contract to the existing rate-limit wait.
- **Worktree isolation:** no new shared resources; the credentials file is already
  a shared operator-level input. Two parked daemons polling the same file is
  read-only and safe.

## Alignment

- **`adr-2026-06-30-sandbox-build-isolation` (APPROVED, TR-6):** honored. The
  credentials refresh is a **re-copy** into the sandbox config dir — never a
  symlink to global config. The pre-flight reads the *operator* file (source of
  truth), not the sandbox copy.
- **`adr-2026-07-03-reactive-model-fallback-ladder` (APPROVED):** followed as
  precedent — reactive output-signature classification plus a no-budget-burn
  handling path. Ordering constraint: auth-failure classification happens
  **before** model-unavailability handling; an auth failure must never mark a
  model dead in the ladder (every model would "fail" identically).
- **Future `#188` retry-as-escalation:** auth failures are classified before any
  retry/escalation decision, so escalation (effort/model bumps) never fires on an
  auth failure. Captured as an explicit constraint in the ADR so #188's spec
  composes cleanly.
- **Pattern consistency:** extends the existing signature-flag pattern
  (`rateLimited`/`sessionExpired`/`modelUnavailable` → new `authFailure`) rather
  than introducing a new mechanism. The park-until-file-change shape mirrors the
  daemon's existing HALT/REKICK "re-check a filesystem condition per tick" pattern.
- **Identity seam (EKS constraint):** credentials location and expiry reading go
  through the existing `globalConfigDir` resolution (`$CLAUDE_CONFIG_DIR` or
  `~/.claude`) behind a small reader function, so a platform-provided identity
  source can replace the file-based reader without touching classification or
  park logic. No new hardwired `~/.claude` paths.
- **State management:** the park outcome is explicit (resume | timeout-HALT); no
  boolean-flag state machines. The HALT reason is structured to name the
  credentials file path and the observed `expiresAt`.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| False-positive auth classification (build output merely *mentions* "Not logged in") parks a healthy build | Technical | Low | Medium | Anchor the signature to the CLI's actual error shape + non-zero exit; classification only on failed invocations; negative-path acceptance specs at the classification site |
| Operator never refreshes credentials → park forever | Technical | Medium | Medium | Generous configurable timeout (default 60 min) → HALT naming creds file + expiry; existing HALT.cleared/REKICK remediation applies |
| Stale sandbox copy after source refresh (sandbox reused across attempts) | Data | High | High | Mandatory re-copy into the sandbox on resume — resume without refresh is forbidden by acceptance spec |
| Malformed/missing credentials file or missing `claudeAiOauth` (env-key auth path) misread as expired | Integration | Low | Medium | Pre-flight fails open to today's behavior (dispatch normally) — only a well-formed, actually-expired token parks; signature catch still backstops real auth failures |
| Model ladder marks models dead on auth failure (interaction bug) | Technical | Medium | High | Classification ordering: auth check precedes model-unavailable handling; spec asserts ladder state untouched after an auth park |

## ADRs Created

- `adr-2026-07-04-auth-failure-park-and-poll.md` — auth failures are
  park-and-poll (not retryable, not escalatable); credentials seam; timeout→HALT
  contract. (Presented for approval; must be APPROVED before stories.)

## Conditions

None — APPROVED. The single new ADR requires operator approval before `/stories`
(engineer-flow gate: `land` rejects DRAFT ADRs).
