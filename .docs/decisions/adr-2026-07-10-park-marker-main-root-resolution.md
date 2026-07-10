# ADR: Park markers anchor to the MAIN repository root, resolved inside park-marker.ts

**Date:** 2026-07-10
**Status:** APPROVED
**Feature:** auto-park-markers-written-to-the-worktree-s-daemon (fix #486)
**Related:** .docs/architecture/2026-07-10-park-marker-main-root-resolution.md,
adr-2026-06-28-daemon-halt-reconciliation (park/halt marker single-source pattern),
.memory/decisions/2026-07-10-park-marker-main-root-resolution.md

## Context

`.daemon/parked/<slug>` is the daemon's only per-feature stop signal. Today its path is
anchored to whatever root the caller happens to hold:

- The conductor's auto-park (`conductor.ts:1855` → `checkAndAutoPark(this.projectRoot, …)`)
  runs with `projectRoot` = the FEATURE WORKTREE in daemon runs, so the marker lands at
  `.worktrees/<slug>/.daemon/parked/<slug>` (verified: two live features stranded this way).
- The rekick sweep's gate (`daemon-cli.ts:1051` → `isOperatorParked(projectRoot, …)`) reads
  the MAIN checkout's `.daemon/parked/`. It never sees the worktree marker; the check is
  fail-open (ENOENT → not parked), so a capped feature re-dispatches on every sweep —
  a token-burning loop on work that cannot converge.
- `conduct-ts daemon park/unpark` (`daemon-park-cli.ts:69`) resolves `process.cwd()`; run
  from inside a worktree it parks invisibly (and `validateSlug` passes there, so no warning).
- A second, latent instance of the same shape: unpark's auto-park counter reset
  (`resetNoEvidenceAttempts(cwd)`) targets `<cwd>/.pipeline/task-evidence.json`, but the
  counter that drove the park lives in the FEATURE WORKTREE's `.pipeline/` — so even a
  visible unpark would re-park on the next dispatch.

Per the deterministic-first principle, the fix must make divergence impossible at the
machinery layer, not ask call sites to remember to resolve the right root.

## Decision

1. **`resolveMainRepoRoot(startDir)` in park-marker.ts.** Runs
   `git rev-parse --git-common-dir` with cwd `startDir`; the common `.git` dir's parent is
   the main repository root (relative output joined against `startDir` first — same
   handling as `memory-store.ts:stableIdentity`, which is verified against linked
   worktrees). On ANY git failure (not a repo, git absent, unborn HEAD) it returns
   `startDir` unchanged — non-git tmp-dir tests and non-repo consumers keep today's
   byte-for-byte behavior. Results are memoized per `startDir` for the process lifetime
   (markers are checked per-slug in sweeps and dashboards; one subprocess per unique root,
   not per check).
2. **Every park-marker primitive resolves through it** — `writeOperatorPark`,
   `writeAutoPark`, `isOperatorParked`, `removeOperatorPark`, `listOperatorParkedSlugs`,
   `getProvenanceType`. Callers keep passing whatever root they hold; writer, gate,
   dashboard, and CLI converge on `<main>/.daemon/parked/<slug>` mechanically. No call-site
   changes are required for correctness (call sites are unchanged by design — the seam is
   the primitive).
3. **Park CLI validates and reports against the resolved root.** `validateSlug` checks
   `.docs/plans/<slug>.md` / `.worktrees/<slug>` under the RESOLVED main root; `daemon park`
   echoes the absolute marker path it wrote, so a misdirected park is visible instead of
   silent.
4. **Unpark resets the counter where it lives.** For an auto-parked slug, unpark resets
   `.worktrees/<slug>/.pipeline/task-evidence.json` under the resolved main root when that
   worktree exists (fall back to the resolved root's own `.pipeline/` when it does not —
   the pre-#486 location), so the freed feature does not instantly re-park.
5. **One-time sweep reconciliation of stranded markers.** At daemon rekick-sweep start, a
   `reconcileStrandedParkMarkers(mainRoot)` primitive scans
   `.worktrees/*/.daemon/parked/<slug>` and moves each marker to
   `<main>/.daemon/parked/<slug>` (preserving body, hence provenance). If the main marker
   already exists, the main copy wins (matching the `wx` first-writer-wins semantics) and
   the worktree copy is deleted. Idempotent; a per-marker failure is logged and skipped,
   never fatal to the sweep.

## Consequences

- The fail-open re-dispatch loop closes: auto-parks placed from inside a worktree are
  visible to the gate on the next sweep; the two currently-stranded features park
  immediately after the reconciliation runs.
- `isOperatorParked`'s fail-toward-parked read semantics are unchanged; only the path
  anchor moves. Resolution failure degrades to today's behavior (given root), never to a
  new failure mode.
- Park-marker primitives gain a git dependency (one memoized subprocess per unique root).
  Tests that use non-git tmp dirs are unaffected via the fallback.
- Marker layout and body format are unchanged — no migration block needed for consumers;
  the reconciliation sweep is the migration, executed mechanically by the daemon itself.
- The same anchor applies to interactive (non-daemon) runs from a worktree: a park placed
  anywhere in the repo acts repo-wide, which is the operator's evident intent.
