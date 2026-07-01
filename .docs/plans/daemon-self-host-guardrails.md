# Implementation Plan: Harness Daemon Self-Host Guardrails

**Date:** 2026-06-30
**Tier:** L (full ceremony)
**Track:** Technical
**Design:** `.docs/specs/2026-06-30-harness-self-host-guardrails.md`
**Stories:** `.docs/stories/harness-self-host-guardrails.md` (TR-1..TR-13)
**ADRs:** adr-2026-06-30-{self-host-detection-seam, sandbox-build-isolation, halt-based-release-gates}

**Conventions:** every task is test-first (RED → GREEN → refactor) per `/tdd`; tasks are 2–5 min.
All new code lives in `src/conductor/src/engine/`. Tests use the project's vitest setup
(`rtk proxy npx vitest run` per [[reference_rtk_swallows_vitest]]). Injected-runner tests are
paired with a real-binary smoke where an external binary is invoked
([[feedback_injected_runner_needs_real_binary_smoke]]).

---

## Phase 0 — Config foundation (TR-11)

- [ ] 0.1 RED: test `validateConfig()` accepts a well-formed `harness_self_host` block
      (`activation: auto|force_on|force_off`, per-gate booleans).
- [ ] 0.2 RED: test `validateConfig()` rejects an invalid `activation` value with a keyed error
      naming allowed values.
- [ ] 0.3 GREEN: add `HarnessSelfHostConfig` type to `types/config.ts`; add `harness_self_host?`
      to `HarnessConfig`; add key to `knownTopLevelKeys`.
- [ ] 0.4 GREEN: implement validation in `validateConfig()` (enum + boolean checks, keyed errors).
- [ ] 0.5 RED→GREEN: absent block → defaults resolve to `activation:auto`, all gates ON
      (a resolver helper `resolveSelfHostConfig(config)`); partial block → omitted gates default ON.
- [ ] 0.6 Refactor + confirm existing config tests still pass.

## Phase 1 — SelfHostDetector seam (TR-1, TR-2, TR-3)

- [ ] 1.1 RED: test a `SelfHostDetector` interface with a default impl: equal realpaths → true.
- [ ] 1.2 RED: different realpaths → false; `resolveHarnessRoot()` null → false (+ single debug line).
- [ ] 1.3 RED: trailing-slash / symlinked-segment equality → true (normalize via realpath).
- [ ] 1.4 RED: same basename different path → false (identity by path, not name).
- [ ] 1.5 GREEN: implement `self-host-detector.ts` — interface + `PathSelfHostDetector` using
      `resolveHarnessRoot()`; normalized-realpath compare; positive-only activation.
- [ ] 1.6 RED→GREEN: config override — `force_on` → true for any repo; `force_off` → false for
      harness; `auto`/absent → path detection (consume `resolveSelfHostConfig`).
- [ ] 1.7 RED: guardrail activation depends on the *interface*; a stub detector (true/false) drives
      activation with no change to guardrail code; no injected detector → default concrete impl.
- [ ] 1.8 GREEN: wire the detector injection seam at `daemon.ts` discovery/dispatch (beside
      owner-gating; owner-gate eligibility first, then self-host classification — per conflict-check).

## Phase 2 — SkillRelinkPreflight (TR-4)

- [ ] 2.1 RED: for a self-build, preflight relinks via the existing `InstallRunner`; new-skill
      scenario → relink invoked → dispatch proceeds (injected runner).
- [ ] 2.2 RED: `bin/install` non-zero exit → `InstallStaleError`; build NOT dispatched.
- [ ] 2.3 RED: non-harness build → preflight identical to today (regression guard).
- [ ] 2.4 RED: missing/non-executable `bin/install` → clear keyed error (not opaque spawn error);
      null harness root → no relink attempt, reports unresolved root.
- [ ] 2.5 GREEN: extend `ensureInstallFresh` (`install-freshness.ts`) with a self-build relink path
      gated by the detector; reuse `InstallRunner`/`InstallStaleError`.
- [ ] 2.6 SMOKE: real-binary smoke — actual `bin/install` relink runs and links a probe skill
      (guards against argv-only false pass).

## Phase 3 — SandboxBuildEnv (TR-5, TR-6) — safety-critical

- [ ] 3.1 RED: provisioning creates a throwaway config dir whose `skills/`+`hooks/` link into the
      worktree; build launched with `CLAUDE_CONFIG_DIR` set to it.
- [ ] 3.2 RED (edit-sensitive): an edited-skill worktree causes the build to resolve the EDITED
      skill, not the global one.
- [ ] 3.3 RED: after pass AND after fail, global `~/.claude/skills`+`hooks` are diff-clean
      (hash/inode-stable).
- [ ] 3.4 RED: forced mid-build crash/kill → teardown still runs (try/finally); no orphaned dir.
- [ ] 3.5 RED: mkdir/symlink failure (EACCES/disk) → no build launch; partial sandbox removed;
      keyed error naming the failed path.
- [ ] 3.6 RED: pre-existing `CLAUDE_CONFIG_DIR` in daemon env → sandbox value for child only; daemon
      env restored after (no bleed).
- [ ] 3.7 RED: invariant test — no sandbox symlink resolves to a global-config target.
- [ ] 3.8 GREEN: implement `sandbox-build-env.ts` (provision/teardown + no-leak invariant); integrate
      at the build step (`DefaultStepRunner`, `steps.ts`) for self-builds only.
- [ ] 3.9 RED→GREEN: single-daemon lock (ADR-010) prevents a second concurrent self-build sharing
      the sandbox.
- [ ] 3.10 Refactor; document the no-global-target invariant in code + design doc.

## Phase 4 — VersionApprovalGate (TR-7)

- [ ] 4.1 RED: marker present + VERSION matches → gate passes; PR opened with approved VERSION.
- [ ] 4.2 RED: no marker in `auto` mode → `writeHalt()` with a distinct gate reason; PR NOT opened.
- [ ] 4.3 RED: marker VERSION ≠ repo VERSION after bump → HALT naming the mismatch.
- [ ] 4.4 RED: non-harness finish → gate not applied.
- [ ] 4.5 GREEN: implement `version-approval-gate.ts`; hook into finish handling (`conductor.ts`
      finish, before PR open) gated by the detector; reuse `writeHalt`.
- [ ] 4.6 Define the approval-marker location/format (e.g. `.pipeline/version-approval`) + document.

## Phase 5 — ReleaseArtifactGate (TR-8, TR-9, TR-10)

- [ ] 5.1 RED: integrity exit 0 → pass; non-zero → HALT naming the failing gate; PR NOT opened.
- [ ] 5.2 RED: missing/non-executable integrity script → fail-closed HALT (not a silent pass);
      script hang → timeout treated as failure (HALT).
- [ ] 5.3 RED: `[Unreleased]` populated → pass; empty/missing/whitespace-only → HALT.
- [ ] 5.4 RED: breaking surface + runnable ```bash migration block → pass; breaking + no block → HALT;
      non-breaking → migration not required; uncertain → fail-closed (require block).
- [ ] 5.5 GREEN: implement `release-artifact-gate.ts` — run `test_harness_integrity.sh` (bounded
      timeout), parse `CHANGELOG [Unreleased]`, detect breaking surfaces
      (settings.json schema / hook wiring / skill symlink targets / `bin/conduct` CLI) + require
      `## Migration`. All fail-closed. Hook into finish after the version gate.
- [ ] 5.6 Refactor; ensure each gate emits a distinct HALT reason.

## Phase 6 — Wiring, non-autonomy, regression (TR-12, TR-13)

- [ ] 6.1 RED (structural): no `gh pr merge` / merge-API call is reachable from the self-build finish
      path (ADR-005 non-autonomy-by-construction).
- [ ] 6.2 RED: self-build finish always terminates at a HALT for manual re-install/verify/merge;
      any gate failure → HALT, PR/merge unreachable.
- [ ] 6.3 RED: representative non-harness build exercises the unchanged normal path (no relink/
      sandbox/gates); only added hot-path cost is one detector boolean.
- [ ] 6.4 GREEN: final integration wiring; confirm the guardrail bundle activates as one unit behind
      the detector.
- [ ] 6.5 Run full daemon/finish suite — assert zero regression on existing tests.

## Phase 7 — Docs (required same-PR; CLAUDE.md "Docs track features")

- [ ] 7.1 `CHANGELOG.md` `## [Unreleased]` — Added: harness self-host guardrails (this is itself
      gated by TR-9, so it must be real).
- [ ] 7.2 `## Migration` block IF any breaking surface changed (config schema is additive/optional →
      likely non-breaking; confirm during build).
- [ ] 7.3 `README.md` + `src/conductor/README.md` — document the `harness_self_host` config block and
      the self-host build behavior (sandbox + HALT gates).
- [ ] 7.4 Note the new gates in the relevant architecture/skill docs; update the architecture diagram
      change log if components shifted during implementation.
- [ ] 7.5 VERSION bump decision presented to operator (MINOR — new gates/hooks) per CLAUDE.md;
      do not edit VERSION until approved.

---

## Sequencing notes
- Phase 0 → 1 are foundational (config + detector) and unblock everything.
- Phases 2–5 are independent per-component and can be built in any order after Phase 1.
- Phase 6 must be last (integration + regression). Phase 7 docs land in the same PR.
- Isolation (Phase 3) is the highest-risk work — budget the most review there; adversarial tests on
  pass/fail/crash branches are mandatory ([[feedback_negative_path_specs]]).
