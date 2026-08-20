# ADR: Contain the self-host dispatch instead of attributing live-checkout drift

**Date:** 2026-08-17
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer loop (issue jstoup111/ai-conductor#1301)

## Context

`verifyLiveBoundary` fingerprints the live root checkout before a self-host dispatch and
re-verifies it afterwards. It reasons from a manifest diff alone, and a diff cannot say who
wrote a path, so it fails closed on every change it cannot explain.

Git-aware classification (PR #1127) closed part of this: a tracked `M`/`D` working-tree
change is now recognized as operator work and does not halt. The residual gap is git-**ignored**
paths. This repository lists `.claude/` in `.git/info/exclude`, so
`git status --porcelain` never reports `.claude/settings.local.json` and it always classifies
`unexplained`.

That is exactly what happened on 2026-08-04: `mechanically-verify-llm-rebase-conflict-resolution`
halted immediately after a passing `build_review` — 18 turns, 2m19s, $2.29, all discarded —
because an interactive operator session granted a Bash permission and Claude Code rewrote the
root checkout's untracked `.claude/settings.local.json`.

Forces:

- **Excluding the path is not available.** `settings.local.json` is the most sensitive file
  this surface protects. `live-boundary.ts:85-95` already reasons this out and deliberately
  keeps it fingerprinted. Widening the exclusion list blinds the guard to the exact leak it
  exists to catch, and #1301 rules it out explicitly.
- **The write fence cannot serve as evidence.**
  `adr-2026-07-08-main-checkout-leak-triage-and-write-fence` decided that the fence's Bash
  guarding is heuristic and that the fence is deliberately the second layer, not the
  load-bearing one. Amnestying a path on the grounds that "the fence would have denied it"
  contradicts that decision. The fence is also Claude-only — the Codex branch of
  `prepareCandidateSelfHost` provisions no fence at all.
- **No portable after-the-fact writer attribution exists.** The filesystem records no writer.
  `fanotify` with pid reporting needs `CAP_SYS_ADMIN`. `inotify` reports events without a pid.
- **The two natural operator behaviors are currently mutually exclusive**: watching or
  steering a build from the root checkout, and letting that build finish.
- **`bwrap` is present and enforcing on the operator's machine** — verified: a `--ro-bind`
  path rejected a write with `Read-only file system` even though unprivileged user namespaces
  are denied here.

## Options Considered

### Option A: Fence-witness ledger
The fence hook records every write target it evaluates to a dispatch-scoped ledger; the guard
amnesties a path only when the ledger proves the fence ran and did not see that path.

- **Pros:** Smallest lift; no new external dependency; positively attributes real leaks and
  makes their halt reason name the tool and timestamp.
- **Cons:** Claude-only, so Codex dispatches keep halting on operator edits. Makes the
  heuristic fence load-bearing, requiring `adr-2026-07-08` to be superseded. A Bash-constructed
  write that evades the fence would be silently amnestied instead of halting — a real
  reduction in detection power, which #1301 forbids. Does not cover the incident file at all:
  a permission grant is not a tool call the fence sees.

### Option B: Downgrade fence-denied paths to warning-with-evidence
The issue's own hypothesis 3.

- **Pros:** Cheapest possible change.
- **Cons:** Same ADR conflict as A, with none of A's compensating evidence. Rests entirely on
  the fence being correct, which the fence's own ADR says it is not.

### Option C: Document the de-facto rule
State that operators must not work in the root checkout during a self-host build; improve the
halt reason only.

- **Pros:** Zero risk.
- **Cons:** Meets none of desired outcomes 1, 2, or 6. Makes the cost explicit instead of
  removing it, and permanently forecloses steering a build from the root checkout.

### Option D (chosen): Kernel-enforced containment
Run the dispatch child under a mount namespace in which the live checkout is bind-mounted
read-only, with the volatile subtrees re-bound read-write.

- **Pros:** Attribution becomes structural rather than inferred — the dispatch physically
  cannot write the live checkout, so any drift there is provably not the dispatch. Applies to
  both providers at one seam, closing Codex, which has no protection today. Requires no ADR
  reversal: it enforces the fence's *existing* policy at the syscall rather than promoting the
  fence's heuristic to load-bearing. Turns a class of leaks from a post-hoc halt that discards
  a whole step into an immediate in-session failure.
- **Cons:** Adds an OS binary to the dispatch path. A wrong bind set fails every self-host
  build with `EROFS`. Bind ordering is subtle — a later read-write bind silently overlays an
  earlier read-only one.

## Decision

**Contain the dispatch; keep the guard as the fail-closed backstop.**

1. **A new `self-host/live-containment.ts`** derives the bind set, probes it, and wraps the
   command. The read-write carve-out is `LIVE_CHECKOUT_VOLATILE` — imported from
   `live-boundary.ts`, never restated — plus `node_modules` trees discovered under the live
   checkout. Bind order is: full host `--dev-bind / /`, then `--ro-bind` the live checkout,
   then a read-write `--bind` per carve-out path.

2. **Containment is proven, never assumed.** `probeContainment` runs `bwrap` once with the
   *same* bind set and asserts **both** that the live checkout root is not writable and that
   the worktree root is writable. Only a two-sided pass yields
   `{ contained: true, evidence }`. Every other outcome — `bwrap` absent, probe non-zero,
   probe timeout, unparseable result, containment disabled by config — yields
   `{ contained: false, reason }`. A one-sided probe cannot distinguish enforcement from
   `bwrap` failing open and is therefore not acceptable.

3. **One wrap seam, provider-neutral.** `prepareCandidateSelfHost` already returns
   `{ executable, env, args, teardown }` from both its Codex and Claude branches. Both run
   that result through `wrapForContainment` when the verdict is `contained`, and return it
   untouched otherwise. `env` passes through, so throwaway `CLAUDE_CONFIG_DIR` / `CODEX_HOME`
   isolation is unaffected.

4. **`verifyLiveBoundary` consumes the verdict, and nothing else changes.** When the
   live-checkout surface differs and the verdict is `contained`, the drift is attributable to
   something other than the dispatch and does not halt. When the verdict is not `contained`,
   behavior is byte-for-byte today's: git classification, then halt. The provider-state
   surface is untouched — containment says nothing about `~/.claude`, which lives outside the
   live checkout. `fingerprintLiveBoundary`, `LIVE_CHECKOUT_VOLATILE`, `diffManifests`,
   `describeDiff`, and `classifyLiveCheckoutDiff` are unchanged, and **no exclusion is added**.

5. **Every reason names its evidence.** A halt says why containment was not in force
   (`bwrap not found`, `probe found <path> writable`, `probe failed — <stderr>`,
   `disabled by configuration`). A non-halt logs that the dispatch ran contained. An operator
   can tell a real leak from their own edit without reading source.

6. **An operator lever exists.** `harness_self_host.live_containment` (default `true`)
   follows the existing `sandbox_build_env` shape. Turning it off restores today's behavior
   exactly.

Why D: the guard's problem is not that it lacks a cleverer heuristic — it is that the
information it needs does not exist in a diff. Containment does not try to recover that
information; it removes the need for it. Options A and B both attempt to synthesize
attribution from a mechanism their own ADR says is unreliable, and both trade away detection
power to do it. D preserves detection power fully and, where containment cannot be proven,
degrades to precisely the behavior that exists today.

## Assumption ledger (verify-claims)

- `bwrap` enforces `--ro-bind` without privileged userns on the operator's machine —
  **verified** (direct execution; `Read-only file system`, exit 1, while `unshare -Urm` is
  denied).
- Bind order is load-bearing; a later `--bind` overlays an earlier `--ro-bind` — **verified**
  (observed directly: an incorrectly-ordered probe let the write through).
- `.claude/` is git-ignored in this repo, so classification can never explain
  `settings.local.json` — **verified** (`git check-ignore -v`).
- The Codex self-host branch provisions no write fence — **verified** (`provisionWriteFence`
  is reached only via `sandbox-build-env.ts`).
- The dispatch has no legitimate live-checkout write outside the carve-out — **inferred,
  ~90%**. Bases: the carve-out is exactly the guard's own exclusion list, and the write
  fence's policy already asserts zero such writes. If wrong, a legitimate write fails
  `EROFS` naming the path; the probe catches a bad bind set before the dispatch runs, and the
  config lever restores the old behavior immediately. Not destructive and not silent, so it
  does not hard-block.
- `bwrap` is not guaranteed present on every machine running this daemon — **verified as a
  risk** (distro package, not an npm dependency). Handled by the probe and the no-op fallback.

## Consequences

### Positive

- An operator can edit, grant permissions in, or run tools against the root checkout during a
  self-host build without discarding the build's work.
- Codex dispatches gain live-checkout protection for the first time.
- A genuine leak fails at the moment of the write, in-session and attributable, instead of
  halting the loop after a whole step has been paid for.
- The guard keeps its full detection power: no path is excluded, and unproven containment
  falls back to today's fail-closed behavior.

### Negative

- The self-host dispatch path now depends on an OS binary that may be absent, adding a
  capability probe and a documented fallback to a path that previously had neither.
- A carve-out gap manifests as an `EROFS` mid-step rather than a clean gate failure. The
  runbook has to teach that recovery.
- The guard's live-checkout halt branch will rarely execute in normal operation once
  containment is on, so its coverage depends entirely on tests that drive the verdict directly.
- `bwrap` behavior varies across kernels and distros; the probe bounds this but does not
  eliminate it.

### Follow-up Actions

- [ ] Update `CLAUDE.md`'s Daemon Operations Safety section: the "Unsafe while a build runs"
      list describes the behavior this change removes.
- [ ] Add the carve-out-gap recovery to
      `docs/runbooks/stalled-or-stuck-feature.md#live-boundary-violation-self-host-only`.
- [ ] Document `harness_self_host.live_containment` in `docs/reference/configuration.md`.
- [ ] Consider whether the write fence's in-session block message should remain now that the
      syscall enforces the same policy — it still gives better operator feedback than `EROFS`,
      so removal is not proposed here.
