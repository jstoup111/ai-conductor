# ADR: Main-checkout leak triage with byte-identity-gated auto-heal, plus a sandbox write-fence

**Date:** 2026-07-08
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer loop (issue jstoup111/ai-conductor#380)

## Context

Two daemon self-builds leaked edits into the harness MAIN checkout: 4 tracked files modified
(932 lines) plus a stray `daemon.test.ts.new`, every file byte-identical to the feature
branch's HEAD. The dirty tree made `maybeFastForward` (`daemon-backlog.ts:175-184`) skip
base tracking on every poll — silently stalling re-kick sweeps and new-spec discovery until
a human ran the verify-identical-then-restore recipe by hand.

Forces:
- The operator's `block-default-branch-edits.sh` PreToolUse guard IS present in the
  self-build sandbox (settings.json is copied by `sandbox-build-env.ts`; personal
  `~/.claude/hooks` paths survive the copy untouched — verified in source). It guards
  Edit/Write/MultiEdit/NotebookEdit only. The `.ts.new` + rename residue indicates the leak
  wrote through **Bash** (`… > file.new && mv`), which no PreToolUse file-tool guard sees.
- Build worktrees live **under** the main checkout (`<repo>/.worktrees/<slug>`), so any
  fence must allow the worktree subtree while blocking the rest of the checkout.
- A dirty tree can also be legitimate operator work — any automated cleanup that guesses
  wrong destroys uncommitted human changes. Trust is earned by never healing on a guess.

## Options Considered

### Option A: Prevention fence only
- **Pros:** Stops the escape at the source; no destructive automation.
- **Cons:** Bash guarding is heuristic (shell can construct paths dynamically); the silent
  FF-stall failure mode remains for anything that still slips through; observed vector is
  exactly the one a file-tool guard already missed.

### Option B: Detection + auto-heal only
- **Pros:** Deterministic, fully testable with git plumbing; directly removes the
  operational pain (silent stall + manual recovery).
- **Cons:** Accepts that leaks keep happening; each leak burns a heal cycle and log noise.

### Option C (chosen): Detect + heal first, then fence
- **Pros:** Closes the stall now with a mechanically safe recipe; adds cheap prevention on
  the existing sandbox settings-provisioning seam.
- **Cons:** Two moving parts; the fence's Bash heuristics need care to avoid false-blocking
  legitimate worktree-internal builds.

## Decision

**Phase 1 — LeakTriage + AutoHeal on the FF-skip path.** When `maybeFastForward` finds a
dirty tree, before giving up it classifies every dirty entry against candidate branch heads
(branches of in-flight daemon builds first, then local `feat/*` heads):

- A **modified tracked file** is *explained* iff its working-tree content is byte-identical
  to the same path's blob at a candidate branch head.
- An **untracked stray** is *explained* iff its content hash matches some blob in that same
  candidate branch's tree (covers `X.ts.new` holding branch `X.ts` content).
- **All-or-nothing gate:** heal runs only when a SINGLE candidate branch explains EVERY
  dirty entry (and the index has no staged changes). Then: `git restore` the modified files,
  delete the explained strays, log one loud WARN naming the culprit branch and each healed
  path, and let the same poll's fast-forward proceed.
- Anything unexplained → **no heal at all**; keep today's skip behavior but escalate the log
  from a one-line skip to a leak-suspect WARN with the per-file diff-stat, so the stall is
  never silent again.

**Phase 2 — write-fence in the self-build sandbox.** `provisionSandboxBuildEnv` merges a
daemon-owned PreToolUse hook entry into the sandbox's copied `settings.json`:
- Edit/Write/MultiEdit/NotebookEdit targeting a path under the harness main checkout but
  **outside the build worktree** → block (exit 2) with guidance to use the worktree path.
- Bash commands whose text references the main-checkout path outside the worktree → block
  with the same guidance (heuristic by design; the deterministic backstop is phase 1).
- The fence never fires on worktree-internal paths, the OS temp dir, or non-harness repos.

Scope: the fence rides the sandbox seam, so it covers **self-builds** (where both observed
leaks happened). Consumer-repo daemon builds keep the operator's global guard; extending the
fence there is a follow-up, not part of this decision.

Why C: the deterministic half (triage/heal) is what removes the operational pain and is
safe to automate because byte-identity against a known branch proves the content already
exists in git — restoring loses nothing. The fence is cheap on the existing seam and shrinks
recurrence, but is heuristic, so it is deliberately the second layer, not the load-bearing one.

## Assumption ledger (verify-claims)

- FF-skip behavior and location — **verified** (read `daemon-backlog.ts:175-184`).
- Sandbox copies operator settings.json, personal hook paths intact — **verified** (read
  `sandbox-build-env.ts` provisionSettings/retargetHarnessPaths).
- Leak vector was agent Bash write-then-rename — **inferred, ~90%** (`.ts.new` residue,
  mtimes during builds, byte-identity to branch HEADs; guard for file tools was present).
  If wrong (some other writer), phase 1 still detects/heals the symptom; phase 2 would
  under-prevent — acceptable, detection is the load-bearing layer.
- Build worktrees are subdirectories of the main checkout — **verified** (`.worktrees/`).

## Consequences

### Positive
- A leak-dirty tree self-heals within one poll; base tracking and spec discovery resume
  without human intervention; the culprit build is named in the log.
- Operator work is structurally protected: heal requires whole-tree explanation by one
  branch; any ambiguity keeps hands off.
- Self-build agents get an in-session block the moment they aim a write at the live harness.

### Negative
- Bash fence is best-effort; a determined/dynamic path construction evades it (accepted —
  phase 1 backstops).
- Triage adds git plumbing work to the dirty-FF path (bounded: only runs when dirty, only
  hashes dirty files).
- A leak byte-identical to a branch that ISN'T the culprit heals "wrong" in name only — the
  restore is still content-safe (file returns to HEAD state).

### Follow-up Actions
- [ ] Extend the fence to consumer-repo daemon builds (needs a non-sandbox injection seam).
- [ ] Root-cause how agents obtain main-checkout paths (issue direction 1) — instrument the
      fence's block log to capture the offending tool inputs for diagnosis.
