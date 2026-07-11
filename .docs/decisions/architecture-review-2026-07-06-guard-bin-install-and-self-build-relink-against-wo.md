# Architecture Review: Guard bin/install and self-build relink against worktree-rooted global installs (#363)
**Date:** 2026-07-06
**Mode:** Lightweight (tier M, technical track) — feasibility + alignment
**Input:** explore output + operator-approved Approach A; architecture docs at
`.docs/architecture/guard-bin-install-and-self-build-relink-against-wo.md` (+ sequences/)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack:** bash (guard + flag in `bin/install`) and TypeScript (`install-freshness.ts`,
  one call-site change in `conductor.ts`). No new dependencies; `git rev-parse
  --git-common-dir` is already a runtime dependency class the engine uses (execa + git).
  Verified against the actual sources (see ADR evidence). Confidence: 95% (verified).
- **Prerequisites:** none — registry readers (`registry.ts`) and `InstallStaleError` →
  HALT plumbing already exist.
- **Integration surface:** 2 modules + 1 call site. The one dangerous coupling —
  `resolveHarnessRoot` shared with `PathSelfHostDetector` — is resolved by NOT touching
  it (see ADR). Confidence in the coupling claim: verified by reading `detector.ts:42`.
- **Worktree isolation:** the feature is itself about worktree isolation; no new shared
  resources. Tests must not exercise the real installer against `~/.claude` (inject the
  runner seam, per existing `RelinkPreflightOptions.runner` pattern) and need a
  real-binary smoke for the bash guard (injected-runner argv tests alone are a known
  false-green trap in this repo).

## Alignment

- **Detection seam (adr-2026-06-30-self-host-detection-seam):** preserved — detector
  semantics unchanged; the new resolver is write-authorization only.
- **Sandbox isolation (adr-2026-06-30-sandbox-build-isolation):** strengthened — passing
  the installed root to `provisionSandbox` makes the documented settings-retarget
  behavior actually occur for worktree-run engines.
- **Fail-closed convention (self-host guardrails):** rejection → `InstallStaleError` →
  HALT matches the existing preflight failure contract; no silent fallback.
- **Fix-at-the-skill-not-engine precedent:** N/A — this is an engine/installer defect,
  fixed at the defective seams.
- **Pattern consistency:** injectable seams (`runner`, `log`, git runner) follow the
  module's existing test conventions.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Changing shared `resolveHarnessRoot` disables self-host detection for worktree engines | Technical | High (if done naively) | High | Separate `resolveInstalledHarnessRoot`; detector untouched; regression test asserting detector still classifies a worktree-run self-build as self-host |
| Relink HALTs on repos/layouts where main-root derivation fails (e.g. bare/unusual git dirs) | Technical | Low | Medium | Hard-reject only when the probe found a WORKTREE root; a plain unresolved root keeps today's log-and-skip |
| Bash guard false-positive on a legitimately `.worktrees/`-pathed main checkout | Technical | Low | Low | `--allow-worktree-root` override + message naming the resolved root |
| Sandbox `harnessRoot` change alters retarget output for existing self-builds | Integration | Medium | Medium | Story with explicit before/after assertions on retargeted settings.json content |

## ADRs Created

- `adr-2026-07-06-installed-root-resolution-for-global-writes.md` (DRAFT → pending
  operator approval)

## Conditions

1. A regression test MUST assert `PathSelfHostDetector` still returns true for a
   worktree-run self-build after the change (the High/High risk above).
2. The bash guard MUST have a real-binary smoke test (run the actual `bin/install` from a
   throwaway `.worktrees/`-pathed copy and assert refusal + zero global mutation), not
   only injected-runner tests.
3. Negative paths are the core of every story: worktree root → refuse/HALT with globals
   untouched, override flag honored, unresolved-root skip preserved.
