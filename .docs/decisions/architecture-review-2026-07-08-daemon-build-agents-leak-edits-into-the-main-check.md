# Architecture Review: Main-Checkout Leak Triage + Write-Fence (#380)
**Date:** 2026-07-08
**Stories reviewed:** none yet (pre-stories full pass, technical track — input is explore
output + issue #380; lightweight mode, tier M)
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** pure git plumbing (`status --porcelain`, blob hashing,
  `restore`) + one bash hook + a JSON merge in `sandbox-build-env.ts`. No new packages,
  services, or infra.
- **Prerequisites:** none — both seams exist (`maybeFastForward` dirty branch at
  `daemon-backlog.ts:175-184`; `provisionSettings` in `sandbox-build-env.ts`).
- **Integration surface:** two modules (daemon-backlog, sandbox-build-env) + a new hook
  script. No cross-repo or external-API surface. Candidate-branch enumeration uses the
  daemon's own in-flight worktree state plus local `feat/*` refs.
- **Data implications:** none (no schema, no persistent state; log-only output).
- **Performance risk:** triage runs only on the dirty-FF path and hashes only dirty files;
  bounded by dirty-entry count × candidate branches. Negligible against a poll interval.
- **Worktree isolation:** the fence must special-case that build worktrees live UNDER the
  main checkout (`<repo>/.worktrees/<slug>`) — allow-inside-worktree takes precedence over
  block-under-checkout. Two concurrent worktrees share nothing new (no ports/DBs/files).

## Alignment

- **Domain boundaries:** LeakTriage/AutoHeal sit wholly inside the daemon's backlog module,
  the fence wholly inside self-host sandbox provisioning — matching where their inputs
  live. No new coupling between the two phases (they share no code, only the ADR).
- **Pattern consistency:** mirrors existing guarded patterns — the fence extends the same
  PreToolUse-guard idiom as `block-default-branch-edits.sh`; heal mirrors the established
  operator recipe (verify-identical-then-restore). Fail-closed defaults match TR-5/TR-6
  precedent in `sandbox-build-env.ts`.
- **State management:** no new persistent state; heal decision is a pure function of
  (dirty entries, candidate heads) — all-or-nothing, no partial states representable.
- **Diagram accuracy:** feature diagram written and approved
  (`.docs/architecture/daemon-build-agents-leak-edits-into-the-main-check.md`).
- **Security boundaries:** the fence is a trust-boundary control (same class as #363, one
  layer up). Heal never executes content from the dirty files; it only compares hashes and
  restores tracked state. The hook script must be daemon-owned (written into the sandbox,
  not sourced from the worktree under test) so an in-build edit can't disarm it — noted as
  a story-level acceptance criterion.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Auto-heal deletes genuine operator work | Data | Low | High | All-or-nothing byte-identity gate vs one candidate branch; staged changes abort; unexplained entry ⇒ no heal |
| Bash fence false-blocks legitimate build commands | Technical | Medium | Medium | Allow-inside-worktree precedence; heuristic scoped to main-checkout path references; phase 1 backstops under-blocking |
| Fence hook sourced from the worktree could be self-disarmed by the build | Security | Low | Medium | Hook content written by the daemon into the sandbox config dir, never symlinked from the worktree |
| Wrong culprit branch named (content identical on two branches) | Technical | Low | Low | Restore is content-safe regardless; log lists all matching candidates |

## ADRs Created

- `adr-2026-07-08-main-checkout-leak-triage-and-write-fence.md` — APPROVED by the operator
  2026-07-08 (interactive engineer session).

## Conditions

None.
