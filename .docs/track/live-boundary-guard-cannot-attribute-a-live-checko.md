# Track: Live-boundary guard cannot attribute a live-checkout change, so operator edits halt concurrent builds

Track: technical

Internal harness tooling — self-host dispatch provisioning, the write containment applied
to that dispatch, and the live-boundary guard that verifies the live checkout afterwards.
No user-facing product capability, so no PRD; acceptance criteria live directly in the
stories.

## Problem statement (from jstoup111/ai-conductor#1301)

A self-host build halts when an interactive operator session changes a file in the live
root checkout while the build is in flight. The guard reasons from a manifest diff alone,
which cannot say **who** wrote a path, so it fails closed on every unattributable change.

The 2026-08-04 incident: `mechanically-verify-llm-rebase-conflict-resolution` halted
immediately after a passing `build_review` (18 turns, 2m19s, $2.29, all discarded) because
an operator permission grant rewrote the root checkout's `.claude/settings.local.json`.

## Desired outcomes

1. A live-checkout change made by an operator/interactive session is distinguished from one
   made by a self-host dispatch, rather than both presenting as an unattributable diff.
2. A change positively attributable to something other than the running dispatch does not
   halt the build; detection of a genuine self-host leak is not weakened.
3. Where attribution is impossible, the guard still halts — fail-closed is preserved.
4. The halt reason names the attribution evidence, so an operator can tell a real leak from
   their own edit without reading source.
5. `settings.local.json` and other config-like paths remain fingerprinted; this is not
   resolved by widening the exclusion list.
6. Regression coverage both ways: a dispatch that writes the live checkout is still stopped;
   an operator edit during a dispatch does not halt the build.

## Discovery findings

**The residual gap is git-ignored paths.** `classifyLiveCheckoutDiff`
(`src/conductor/src/engine/self-host/live-boundary.ts:292-313`) already amnesties tracked
`M`/`D` working-tree changes — that shipped as
`.docs/plans/live-boundary-halts-self-host-builds-when-the-oper.md` (PR #1127). The incident
file is git-**ignored**: `.claude/` is listed in this repo's `.git/info/exclude`, so
`git status --porcelain` never reports it and every such path classifies `unexplained` →
halt. Verified by `git check-ignore -v .claude/settings.local.json`.

**The write fence cannot serve as attribution evidence.**
`adr-2026-07-08-main-checkout-leak-triage-and-write-fence.md` decides explicitly that the
fence's Bash guarding is heuristic ("a determined/dynamic path construction evades it") and
that the fence is deliberately the *second* layer, not the load-bearing one. Amnestying a
path because "the fence would have denied it" — issue hypothesis 3 — would make the fence
load-bearing against that approved decision. It is also Claude-only: the Codex branch of
`prepareCandidateSelfHost` (`conductor.ts:3157-3174`) provisions a throwaway provider home
and no fence at all.

**Kernel-enforced containment is available on this machine.** `bwrap` is installed at
`/usr/bin/bwrap` and enforces `--ro-bind` even though unprivileged user namespaces are
denied here (`unshare -Urm` fails with `Operation not permitted`, but setuid `bwrap`
succeeds). Verified directly: a `--dev-bind / /` plus `--ro-bind <dir> <dir>` wrapper made a
`>>` append fail with `Read-only file system`, exit 1.

**The wrap seam is a single point.** `prepareCandidateSelfHost` returns
`{ executable, env, args, teardown }` for both the Codex branch (`conductor.ts:3157-3174`)
and the Claude branch (`conductor.ts:3175-3190`). Containment can be applied by rewriting
`executable`/`args` in one place, provider-neutrally.

**The read-write carve-out already exists.** The subtrees a dispatch legitimately writes
inside the live checkout are exactly `LIVE_CHECKOUT_VOLATILE` (`.git`, `.daemon`,
`.worktrees`, `.pipeline`, `.claude/worktrees`, `src/conductor/dist-versions`) plus
`node_modules` trees — the same list the guard already excludes from fingerprinting.

## Chosen direction

Contain the dispatch instead of attributing its writes after the fact: run the self-host
dispatch child under a mount namespace in which the live checkout is bind-mounted
read-only, with the volatile subtrees re-bound read-write. A live-checkout change is then
provably not the dispatch, because the dispatch physically could not write there.

`verifyLiveBoundary` is retained unchanged as the fail-closed backstop: it still guards the
provider-state surface, and it still halts on live-checkout drift whenever containment was
not proven for that dispatch.

**Rejected alternatives.** A fence-witness ledger (smaller, but Claude-only and requires
superseding `adr-2026-07-08`); downgrading fence-denied paths to warnings (same ADR
conflict); documenting a "do not work in the root checkout" rule (does not meet outcomes
1, 2, or 6).

Direction confirmed with the operator on 2026-08-17 after being presented against those
three alternatives.

## Assumption ledger (verify-claims)

- `bwrap` enforces `--ro-bind` on this machine without privileged userns — **verified**
  (direct execution, `Read-only file system`, exit 1).
- The incident file is git-ignored, so git classification can never explain it —
  **verified** (`git check-ignore -v`).
- The Codex self-host branch provisions no write fence — **verified** (read
  `conductor.ts:3157-3174`; `provisionWriteFence` is called only from
  `sandbox-build-env.ts`).
- The dispatch's legitimate live-checkout writes are confined to `LIVE_CHECKOUT_VOLATILE`
  plus `node_modules` — **inferred, ~90%**. Two independent bases. First, those are exactly
  the paths the guard already excludes because the harness writes them mid-run. Second, the
  write fence's *policy* is already "block every write under the harness root that is
  outside the build worktree" (`write-fence.ts:253-266`), so the harness has already
  decided the dispatch has zero legitimate live-checkout writes outside the worktree.
  Containment is therefore not a new policy — it is the fence's existing policy made
  non-bypassable, which is why it does not make the heuristic fence load-bearing. Impact if
  wrong: a legitimate write fails with `EROFS` and the step errors. Mitigated by the
  containment probe (a wrong bind set is detected *before* the dispatch runs) and the
  availability fallback (unprovable containment falls back to today's uncontained behavior
  rather than breaking the build). Flagged for architecture-review.
- `bwrap` is not guaranteed present on every machine that runs this daemon —
  **verified as a risk** (it is a distro package, not a Node dependency). Handled by an
  explicit capability probe plus fallback to today's behavior.
