# Architecture Review: Kernel-enforced live-checkout containment for self-host dispatches

**Date:** 2026-08-17
**Mode:** Lightweight (Medium tier — Sections 2 and 4 only)
**Track:** technical (no PRD; review input is the explore output + technical intent)
**Source:** intake jstoup111/ai-conductor#1301
**Stories reviewed:** none yet — this review runs before `/stories`, per
adr-2026-06-29-architecture-before-stories-convergent-kickback
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment | Flag |
|---|---|---|
| **Stack compatibility** | Node/TypeScript plus one OS binary, `bwrap`. Not an npm dependency — it is a distro package that may be absent. Verified present and functional on the operator's machine; the design must not assume it elsewhere. | Handled by capability probe + fallback |
| **Prerequisites** | `bwrap` installed and able to enforce `--ro-bind`. Verified here even though unprivileged user namespaces are denied (`unshare -Urm` fails; setuid `bwrap` succeeds). No migration, no account, no network. | Probe is a prerequisite check, not an assumption |
| **Integration surface** | 3 modules changed or added: new `self-host/live-containment.ts`; `conductor.ts` `prepareCandidateSelfHost` (2 branches, one common return shape); `self-host/live-boundary.ts` (`verifyLiveBoundary` signature + one branch). Plus `resolved-config.ts` for the escape hatch. Does not cross a domain boundary — all inside self-host provisioning. | Below the 3-boundary threshold |
| **Data implications** | No schema change, no new persisted artifact. `ContainmentVerdict` is passed in-process from provisioning to the guard through the closure that already carries `verify()`. No sidecar file, no new ledger — the event-spine skill's schema-not-file test is satisfied because nothing needs to outlive the dispatch. | None |
| **Performance risk** | One extra `bwrap` process per dispatch for the probe (milliseconds), plus a `node_modules` discovery walk over the live checkout at provision time. The walk must be depth-bounded and must not descend into `node_modules` itself, or it degenerates on a large tree. Dispatch runtime is otherwise unaffected — `bwrap` is a thin exec wrapper, not an interpreter. | Bound the discovery walk — see Risks |
| **Worktree isolation** | The bind set is derived per-dispatch from `(liveCheckout, worktreeRoot)`, and mount namespaces are per-process. Two concurrent dispatches on different worktrees get independent namespaces with no shared state. No fixed port, no lockfile, no global mount. | None |

**Verified claims underpinning this section** (per `/verify-claims`):

- `bwrap` present at `/usr/bin/bwrap` and enforces `--ro-bind` without privileged userns —
  **100%, verified** by direct execution: a `>>` append into a `--ro-bind` path failed with
  `Read-only file system`, exit 1, while `unshare -Urm true` failed with
  `Operation not permitted`.
- Bind order is load-bearing (a later `--bind` overlays an earlier `--ro-bind`) — **100%,
  verified**: the first probe run accidentally re-bound `/tmp` read-write *after* the
  read-only bind of a directory beneath it, and the write succeeded. Correcting the order
  produced the `EROFS` above. This is the single most likely implementation error.
- `prepareCandidateSelfHost` returns `{ executable, env, args, teardown }` from both the
  Codex and Claude branches — **100%, verified** by reading `conductor.ts:3157-3190`.
- The Codex branch provisions no write fence — **100%, verified**: `provisionWriteFence` is
  called only from `sandbox-build-env.ts`, which only the Claude branch reaches.
- `classifyLiveCheckoutDiff` cannot explain a git-ignored path — **100%, verified**:
  `.claude/` is in this repo's `.git/info/exclude` (`git check-ignore -v`), and the function
  only promotes `M `/` M`/`MM`/`D `/` D` porcelain statuses, which an ignored path never
  receives.
- The `harness_self_host` config block exists and follows a `key ?? default` shape suitable
  for an opt-out — **100%, verified** by reading `resolved-config.ts:592-665`.
- The write fence's policy is already "block every write under the harness root outside the
  worktree" — **100%, verified** by reading `write-fence.ts:253-266`.

**Assumptions surfaced.**

- *The dispatch has no legitimate live-checkout write outside the carve-out* — **inferred,
  ~90%**, and load-bearing. Two independent bases: the carve-out is exactly the set the
  guard already excludes as harness self-bookkeeping, and the write fence's existing policy
  already asserts the dispatch should have zero such writes. **This assumption does not need
  operator pre-approval because the design makes being wrong non-silent and non-destructive**:
  the probe detects a wrong bind set before the dispatch runs, and a carve-out gap discovered
  at runtime surfaces as an in-session `EROFS` tool error attributable to a named path, not
  as data loss or a false halt. Condition C2 below makes that recovery explicit.
- No other assumption remains unconfirmed and load-bearing. The design fork that would have
  changed the outcome — containment versus a fence-witness ledger versus documentation — was
  put to the operator on 2026-08-17 and decided explicitly before this review was written.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Bind-set ordering error silently disables containment.** A `--bind` that overlays the `--ro-bind` leaves the live checkout writable while the verdict claims `contained` — the guard would then amnesty a *real* leak. This is a detection regression, the one outcome the issue forbids. | **High** | The probe must assert *both* directions: live root not writable **and** worktree writable. A one-sided probe passes trivially when `bwrap` fails open. Condition C1. |
| **Carve-out gap breaks every self-host build with `EROFS`.** A path the dispatch legitimately writes but the carve-out omits fails at the syscall, mid-step. | **High** | Probe proves the bind set before the dispatch spends a turn; the carve-out is imported from `LIVE_CHECKOUT_VOLATILE` rather than restated, so it cannot drift from the guard's own list; config opt-out gives the operator an immediate lever. Condition C2. |
| **`bwrap` absent on another machine.** Daemon runs on any machine the operator uses. | Medium | Probe returns `unavailable`; dispatch runs exactly as it does today. This is a no-op fallback, not a degradation — it is the current behavior. |
| **Containment is claimed but the child escaped it.** `bwrap` exits non-zero for reasons unrelated to binds (kernel config, seccomp, missing setuid). | Medium | Verdict is derived only from a *successful* two-sided probe. Any probe failure — non-zero, timeout, unparseable — yields `unavailable`, never `contained`. Fail-closed on the verdict itself. |
| **`node_modules` discovery walk is unbounded.** A deep live checkout makes provisioning slow. | Low | Walk must skip `.git`, `.worktrees`, and must not descend into a `node_modules` once matched. Depth cap. |
| **Concurrent self-host work touches the same lane.** Other in-flight features edit self-host provisioning. | Medium | Deferred to `/conflict-check`, which is mandatory at this tier. |
| **The guard's live-checkout branch becomes untested in the contained path.** With containment on, the halt path stops exercising in normal operation and can rot. | Low | Regression coverage is required in both directions by outcome 6; tests drive the verdict directly rather than depending on ambient `bwrap`. Condition C3. |

## Conditions of approval

- **C1 — The probe is two-sided.** `probeContainment` asserts the live checkout root is not
  writable *and* the worktree root is writable, using the same bind set the dispatch will
  receive. A verdict of `contained` may be produced only when both assertions hold. A
  one-sided probe is not acceptable: it cannot distinguish enforced containment from `bwrap`
  failing open.
- **C2 — Carve-out is imported, never restated.** The read-write re-bind list derives from
  `LIVE_CHECKOUT_VOLATILE` in `live-boundary.ts`. A future edit to that list must
  automatically move the containment boundary with it. The recovery path for a carve-out gap
  (`EROFS` naming the path → add it to the shared list, or disable containment via config)
  must be documented in the stalled-or-stuck runbook.
- **C3 — Both regression directions are covered without depending on ambient `bwrap`.** The
  guard's behavior under each verdict (`contained` → no halt on live-checkout drift;
  `unavailable` → today's git classification and halt) is unit-tested by supplying the
  verdict directly. Containment enforcement itself is tested separately and skipped when
  `bwrap` is unavailable, so CI on a machine without it does not fail — but must not silently
  report a pass for the enforcement behavior.
- **C4 — The escape hatch is a real config key, not an env var.** Add
  `harness_self_host.live_containment` (default `true`) to `ResolvedSelfHostConfig`
  following the existing `sandbox_build_env` shape, and document it in
  `docs/reference/configuration.md`.
- **C5 — `CLAUDE.md`'s Daemon Operations Safety section is updated in the same PR.** Its
  "Unsafe while a build runs" list is the reader-facing statement of the behavior this change
  removes; leaving it stale would leave the operator following a rule that no longer applies.

## Alignment

The change is consistent with the repository's Design Principle: it replaces a judgement the
machinery cannot make (who wrote this file?) with a structural fact it can (the writer could
not have been the dispatch). It adds no parallel telemetry channel — the verdict is an
in-process value, not a sidecar file — so the event-spine constraint is satisfied.

It does not reverse `adr-2026-07-08-main-checkout-leak-triage-and-write-fence`. That ADR
decided the fence's *heuristic Bash enforcement* is not load-bearing; this work does not make
it load-bearing, it enforces the fence's existing policy at the syscall instead. The fence
remains in place for its in-session operator feedback (a blocked tool call explains itself,
where an `EROFS` does not).
