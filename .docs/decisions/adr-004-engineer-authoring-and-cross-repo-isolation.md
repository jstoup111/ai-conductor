# ADR 004: Engineer authoring model + cross-repo isolation

**Date:** 2026-06-25
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** Phase 9.3 — supervisor/engineer (capstone)
**Decision surfaces:** DS-1 (run DECIDE against another repo), DS-5 (cross-repo path safety, FR-11)

## Context

The engineer must author a spec (brainstorm→stories→plan) **in a different project's repo** than the
one it runs from, on a `spec/<feature>` branch, then open a PR — without ever leaking writes into a
sibling repo or its own repo (FR-6, FR-11). This is the exact failure mode that produced a critical
bug in 3/3 prior Phase 9 features (a call site falling back to cwd / the wrong target). Cross-repo
safety must be **structural**, not vigilance-based.

Forces:
- The DECIDE skills are Markdown skills executed by Claude; they act on a working directory.
- The registry (ADR-003) already stores a **canonicalized absolute path** per project (`realpath`
  dedup), so a trustworthy target path exists.
- Any in-process default that silently resolves to cwd is a latent cross-repo leak.

## Options Considered

### Option A: cwd-isolated subprocess — spawn DECIDE with the target repo as cwd
The engineer resolves the target repo's canonical path from the registry and spawns the
authoring/DECIDE run as a subprocess whose working directory **is** that repo; idea + selected
lessons are passed via args/a handoff file.
- **Pros:** isolation is enforced by the OS process boundary — there is no in-process global state
  to bleed; if the path is wrong the subprocess fails in *that* dir, never the engineer's; reuses the
  CLI surface as-is; matches ADR-003's "thin entry points over one lib" shape.
- **Cons:** idea/lessons cross a process boundary (args or a temp handoff file); a Claude-skill
  invocation must be driven across the subprocess.

### Option B: in-process — pass the target repo path into each DECIDE step
DECIDE runs in the engineer process; every skill/step threads an explicit repo argument.
- **Pros:** simpler data passing (lessons stay in memory).
- **Cons:** every step must thread + honor the repo arg; **one missed default → writes to the
  engineer's own cwd** — precisely the recurring Phase-9 bug, re-introduced by construction.

## Decision

**Adopt Option A — cwd-isolated subprocess authoring.** The engineer resolves the target's
**canonical path from the registry** (reusing ADR-003's `realpath` records) and runs DECIDE in a
subprocess rooted at that path. Cross-repo confinement (FR-11) is then a property of the process
boundary, not of every call site remembering to pass a path.

**Mechanism (locked):**
- **Target resolution:** look up the `ProjectRecord` by the confirmed project; use its canonical
  `path`. If the path is **missing/stale on disk**, the engineer **errors before any write** — there is
  **no cwd fallback** (the explicit anti-pattern from FR-11's negative path).
- **Isolation:** authoring runs with the target repo as the subprocess cwd; the engineer never `cd`s its
  own process. A test asserts that authoring for project A leaves sibling repo B **and the engineer's
  own repo** byte-unchanged.
- **Branch safety:** branch `spec/<slug>` off the target's default branch (derive via
  `git symbolic-ref refs/remotes/origin/HEAD`, never hardcode `main`); a dirty target tree is **not**
  clobbered (branch from clean ref or error); an existing `spec/<slug>` is suffixed, never
  force-overwritten.
- **No build:** the subprocess runs DECIDE only (brainstorm→stories→plan) — no pipeline/tdd/build
  step is invoked (see ADR-005 for the structural guarantee).

## Consequences

### Positive
- FR-11 cross-repo safety holds by construction; the recurring Phase-9 cwd-leak bug is designed out.
- Reuses ADR-003 canonical paths and the existing CLI; no new isolation machinery.

### Negative
- Idea + selected lessons must be marshaled across a process boundary (args/handoff file).
- Subprocess orchestration of a Claude-driven DECIDE run is more moving parts than an in-process call.

### Follow-up Actions
- [ ] Target-resolution helper: registry canonical path → repo; stale/missing → error, no cwd fallback.
- [ ] Subprocess authoring runner (cwd = target repo); idea+lessons handoff.
- [ ] Default-branch discovery (no hardcoded `main`); dirty-tree + existing-branch guards.
- [ ] Tests: author A → assert B and engineer repo untouched; stale path → pre-write error.
