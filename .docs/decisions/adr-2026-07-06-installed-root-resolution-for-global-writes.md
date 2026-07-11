# ADR: Installed-root resolution for operator-global writes (worktree-install guard)

Status: APPROVED
Date: 2026-07-06
Refs: issue #363, adr-2026-06-30-self-host-detection-seam, adr-2026-06-30-sandbox-build-isolation

## Context

Incident #363: a self-build engine running from a worktree's `src/conductor/dist*` resolved
the **worktree** as the harness root (`resolveHarnessRoot()` probes `join(__dirname, '../../../')`
— a worktree is a full checkout with `bin/install`), and the relink preflight then ran
`bin/install --update` rooted there. All operator globals (`~/.local/bin` bins, 26
`~/.claude/skills/*` symlinks, every hook command in `~/.claude/settings.json`) were repointed
at the worktree; ship-time worktree removal left them dangling and killed the daemon's own
self-restart. A second, independent trigger exists: nothing stops a build agent running
`bin/install` for real inside a self-build (the Phase-6 sandbox isolates `CLAUDE_CONFIG_DIR`
only).

**Constraint discovered during review (verified, 95%+, read directly):**
`resolveHarnessRoot` is shared by `PathSelfHostDetector` (`self-host/detector.ts:42`) — the
activation seam for the entire guardrail bundle. During the incident, detection returned true
*because* both sides resolved to the worktree. Making `resolveHarnessRoot` itself
registry-first/worktree-rejecting would flip detection to **false** for worktree-run engines
and silently disable the sandbox and every self-host gate — a strictly worse failure mode.
The detector's semantics must not change.

## Decision

1. **New, separate resolver `resolveInstalledHarnessRoot()`** (in `install-freshness.ts`) used
   ONLY where the resolved root authorizes **writes to operator globals**. The detector keeps
   the existing `resolveHarnessRoot` unchanged (TR-3 identity seam untouched).

   Resolution ladder:
   a. Module-relative probe (existing `resolveHarnessRoot` logic).
   b. If the probed root is a **linked worktree** — its path contains `/.worktrees/`, or
      `git rev-parse --git-common-dir` run there resolves outside the probed root — derive the
      **main checkout** from the git common dir (the worktree's `.git` file points into
      `<main>/.git/worktrees/<name>`; this is authoritative, no registry guessing needed).
   c. Assert `bin/install` exists at the derived root.
   d. **Hard-reject:** if the final root still sits under `/.worktrees/` or cannot be derived,
      return a rejection (callers fail loudly — never fall back to the worktree).
   e. Advisory cross-check: warn (log only) when the resolved root differs from the
      registry-recorded path in `~/.ai-conductor/registry.json` (reuse `registry.ts` readers).
      The registry is advisory rather than primary because nothing in a registry entry marks
      "the harness" — path derivation via git is unambiguous.

2. **Callers of the new resolver:**
   - `relinkSkillsForSelfBuild` — on rejection, throw `InstallStaleError` (→ `.pipeline/HALT`,
     build never dispatches). Never run `bin/install --update` at a worktree root.
   - `runSelfBuildDispatch`'s sandbox provisioning (`conductor.ts:754`) — pass the installed
     root as `harnessRoot` so the sandbox's settings.json retargeting (main → worktree) actually
     fires; today a worktree-resolved root makes the retarget a no-op and the build runs against
     the operator's live hook paths (the exact verification gap the sandbox exists to close).
     Fallback for a non-self-host or unresolvable case stays `projectRoot` (unchanged behavior).

3. **`bin/install` self-root refusal (caller-independent backstop):** when the physically
   resolved `HARNESS_DIR` (`pwd -P` / realpath) contains `/.worktrees/`, all **global-mutating**
   modes (default install, `--update`) refuse with a non-zero exit and a message naming the root
   and the fix, unless `--allow-worktree-root` is explicitly passed. Read-only (`--check`, help)
   and `--uninstall` are unaffected. This kills the class regardless of caller — including a
   build agent inside a self-build running the installer directly.

## Consequences

- A worktree-run engine HALTs its self-build at the relink preflight instead of bricking the
  operator environment; the HALT message names the resolved root.
- Sandbox settings retargeting becomes correct for worktree-run engines (main-checkout hook
  paths rewritten to the worktree).
- Worktrees created by other means (not under `.worktrees/`) are still caught by the
  git-common-dir derivation in the resolver; the bash guard's path test is a backstop keyed to
  the harness's own worktree convention.
- Self-host detection behavior is byte-for-byte unchanged.
- Out of scope (deliberately, own spec): extending sandbox denial/detection to operator-global
  paths (`~/.local/bin`, `~/.claude`) per the isolated-EKS principle, and ship-time scanning
  for global symlinks into a worktree being removed.

## Evidence

- `install-freshness.ts:31-39` — `__dirname`-relative probing (read 2026-07-06).
- `self-host/detector.ts:17,42` — detector defaults to the same resolver (read 2026-07-06).
- `conductor.ts` `runSelfBuildDispatch` — relink call + `resolveHarnessRoot() ?? projectRoot`
  passed to `provisionSandbox` (read 2026-07-06).
- `sandbox-build-env.ts:16,187,227,239` — settings retarget replaces `<harnessRoot>/` prefixes
  with `<worktreeRoot>/` (read 2026-07-06).
- `bin/install:10` — `HARNESS_DIR="$(cd "$(dirname "$0")/.." && pwd)"`, no guard (read
  2026-07-06).
- `registry.ts:62,89,106` — reusable registry readers (read 2026-07-06).
- Incident timeline: issue #363 body (daemon.log-sourced, 2026-07-06).
