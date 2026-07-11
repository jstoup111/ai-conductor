# Conflict Check: Main-Checkout Leak Triage + Write-Fence (#380)

**Date:** 2026-07-08
**New stories:** `.docs/stories/daemon-build-agents-leak-edits-into-the-main-check.md` (TR-1..TR-5)
**Scanned against:** all 86 files in `.docs/stories/` (grep-filtered to the 16 sharing
surface terms: fast-forward, dirty, sandbox, settings.json, PreToolUse, worktree isolation),
plus active specs and prior conflict reports.
**Result:** CLEAN — zero blocking, zero degrading conflicts.

## Pairs examined (verified reasoning, not assumed compatibility)

- **vs `harness-self-host-guardrails.md` TR-5/TR-6 (SandboxBuildEnv)** — verified ~95%:
  TR-6's invariant is "no sandbox symlink ever has a global-config target" and "globals
  unchanged after pass/fail". The fence script is a daemon-WRITTEN file inside the sandbox
  configDir (never a symlink) and dies with sandbox teardown; new TR-4 story restates both
  properties as acceptance criteria. No accepted story asserts the sandbox `settings.json`
  is a byte-identical copy of the operator's (its only settings.json mention, line ~342, is
  the migration-gate schema context) — merging a fence entry contradicts nothing.
- **vs `guard-bin-install-and-self-build-relink-against-wo.md` (#363)** — orthogonal
  surface (bin/install rooting), no shared entity.
- **vs `engineer-worktree-isolation.md`** — engineer authoring worktrees, not daemon build
  worktrees; no shared code path or state.
- **vs `make-daemon-build-push-pr-timing-a-configurable-st.md`** — its "non-fast-forward"
  scenario is a push rejection at step boundaries, not base-tracking FF; disjoint.
- **vs existing FF behavior (no story pins skip-on-dirty as permanent)** — the new TR-2/TR-3
  keep skip semantics for any unexplained dirt; heal only converts the fully-explained case.
  State-conflict check: "tree is dirty AND FF proceeds" occurs only after heal makes the
  tree clean — no impossible state.
- **Within the new set** — TR-2 (heal deletes strays in the main checkout, daemon process)
  vs TR-5 (fence blocks build-agent writes, build session): different actors/processes, no
  resource contention; fence never guards the daemon's own git plumbing.

## Sequencing

Phase 1 (TR-1..3) and phase 2 (TR-4..5) are independent; neither assumes the other ships
first. No circular dependency.
