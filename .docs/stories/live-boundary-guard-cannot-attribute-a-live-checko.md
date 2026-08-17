**Status:** Accepted

# Stories: Kernel-enforced live-checkout containment for self-host dispatches

**Source:** intake jstoup111/ai-conductor#1301
**Track:** technical (no PRD) — `.docs/track/live-boundary-guard-cannot-attribute-a-live-checko.md`
**Decision record:** `.docs/decisions/adr-2026-08-17-structural-live-checkout-containment.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-08-17-live-checkout-containment-1301.md`

---

## Story 1: The dispatch's write carve-out is derived from the guard's own exclusion list

**Requirement:** Technical intent — ADR decision 1, condition C2

As the engineer maintaining this guard, I want the containment boundary to be computed from
`LIVE_CHECKOUT_VOLATILE` rather than restated alongside it, so that a future edit to the
guard's exclusion list moves the containment boundary with it instead of silently opening a
gap that fails every self-host build.

### Acceptance Criteria

#### Happy Path
- Given a live checkout root and a build worktree root beneath it, when `deriveBindSet` is
  called, then it returns bind arguments beginning with a full host bind, followed by a
  read-only bind of the live checkout root, followed by a read-write bind for each path in
  `LIVE_CHECKOUT_VOLATILE` that exists on disk.
- Given the same inputs, when `deriveBindSet` is called, then the read-write binds appear
  strictly **after** the read-only bind of the live checkout in the returned argument order,
  because bwrap applies binds in sequence and a read-write bind emitted first would be
  overlaid and lost.
- Given a live checkout containing `node_modules` directories at more than one depth, when
  `deriveBindSet` is called, then each discovered `node_modules` tree receives a read-write
  bind.
- Given `LIVE_CHECKOUT_VOLATILE` gains a new entry, when `deriveBindSet` is called, then that
  entry receives a read-write bind with no edit to `live-containment.ts` — the list is
  imported, not copied.

#### Negative Paths
- Given a `LIVE_CHECKOUT_VOLATILE` entry that does not exist on disk in this checkout, when
  `deriveBindSet` is called, then no bind is emitted for it, because bwrap fails when asked to
  bind a nonexistent source.
- Given a live checkout whose tree contains a `node_modules` directory, when discovery walks
  it, then the walk does not descend into that `node_modules` and does not descend into `.git`
  or `.worktrees`, so provisioning cost stays bounded on a large checkout.

### Done When
- [ ] `deriveBindSet` is a pure function in `src/conductor/src/engine/self-host/live-containment.ts`
      taking `(liveCheckout, worktreeRoot)` and returning `readonly string[]`.
- [ ] It imports `LIVE_CHECKOUT_VOLATILE` from `live-boundary.ts`; a grep confirms the path
      list is not duplicated anywhere in `live-containment.ts`.
- [ ] Vitest cases cover bind ordering, existing-path filtering, multi-depth `node_modules`
      discovery, and walk pruning, using a real `mkdtemp` fixture tree.

---

## Story 2: Containment is proven by a two-sided probe before the dispatch runs

**Requirement:** Technical intent — ADR decision 2, condition C1

As the operator relying on this guard to catch a real sandbox escape, I want a `contained`
verdict to be issued only after the exact bind set has been proven to enforce read-only in one
direction and read-write in the other, so that `bwrap` failing open can never be mistaken for
containment and used to amnesty a genuine leak.

### Acceptance Criteria

#### Happy Path
- Given `bwrap` is available and the derived bind set is correct, when `probeContainment`
  runs, then it executes `bwrap` with that same bind set, observes that the live checkout root
  is not writable **and** that the worktree root is writable, and returns
  `{ contained: true, evidence }` where `evidence` names both assertions.

#### Negative Paths
- Given `bwrap` is absent from `PATH`, when `probeContainment` runs, then it returns
  `{ contained: false, reason }` and `reason` names `bwrap` as not found.
- Given `bwrap` runs but the live checkout root is writable inside the namespace (an ordering
  or bind-set error), when `probeContainment` runs, then it returns `{ contained: false, reason }`
  naming the writable path — a one-sided pass is never promoted to `contained`.
- Given `bwrap` runs but the worktree root is **not** writable inside the namespace, when
  `probeContainment` runs, then it returns `{ contained: false, reason }` naming the worktree
  path, because a dispatch that cannot write its own worktree would fail anyway and must not
  be launched contained.
- Given `bwrap` exits non-zero, times out, or produces output the probe cannot parse, when
  `probeContainment` runs, then it returns `{ contained: false, reason }` carrying the
  observed failure — every non-success collapses to `contained: false`, never to `contained: true`.

### Done When
- [ ] `probeContainment` returns a `ContainmentVerdict` discriminated union with exactly the
      two shapes above; no code path constructs `contained: true` without both assertions
      holding.
- [ ] Vitest cases cover the two-sided pass, the writable-live-root failure, the
      unwritable-worktree failure, and the `bwrap`-absent failure. Tests that require real
      `bwrap` enforcement are skipped when `bwrap` is unavailable, and the skip is reported
      rather than counted as a pass.

---

## Story 3: Both providers' dispatches are wrapped at the same seam

**Requirement:** Technical intent — ADR decision 3

As the operator running self-host builds on either provider, I want containment applied to the
Claude and Codex dispatches identically, so that Codex builds — which have no write fence at
all today — stop halting on my edits for the same reason Claude builds do.

### Acceptance Criteria

#### Happy Path
- Given a Claude self-host candidate and a `contained` verdict, when
  `prepareCandidateSelfHost` returns, then `executable` is `bwrap`, `args` begins with the
  derived bind set and is followed by the original executable and its original arguments, and
  `env` is byte-for-byte the environment the unwrapped branch would have returned — so the
  throwaway `CLAUDE_CONFIG_DIR` and the daemon build token are unaffected.
- Given a Codex self-host candidate and a `contained` verdict, when
  `prepareCandidateSelfHost` returns, then the same wrapping is applied to the Codex
  executable and its provider-home arguments, and `CODEX_HOME` still points at the throwaway
  home.
- Given either provider, when the returned command is wrapped, then the `teardown` callback is
  the same one the unwrapped branch would have returned, so live-boundary verification and
  sandbox/provider-home teardown still run.

#### Negative Paths
- Given a verdict of `contained: false` for any reason, when `prepareCandidateSelfHost`
  returns, then the command is returned unwrapped and identical to today's, for both
  providers.
- Given `harness_self_host.live_containment` resolves to `false`, when the dispatch is
  prepared, then no probe is run and the command is returned unwrapped, so the operator's
  opt-out costs nothing at provision time.

### Done When
- [ ] Wrapping happens once, on the common `{ executable, env, args, teardown }` return shape,
      not separately inside each provider branch.
- [ ] Vitest cases assert the wrapped shape for both providers, environment preservation, and
      the unwrapped fallback under each `contained: false` reason.

---

## Story 4: An operator edit during a contained dispatch does not halt the build

**Requirement:** Technical intent — ADR decision 4; issue outcomes 1, 2, 6

As the operator watching a self-host build from the root checkout, I want a change I make
there during a contained dispatch to be recognized as provably not the dispatch's, so that
granting a permission or editing a file does not discard a step that has already been paid
for.

### Acceptance Criteria

#### Happy Path
- Given a dispatch ran with a `contained` verdict, when `verifyLiveBoundary` finds the
  live-checkout surface differs at a git-**ignored** path such as
  `.claude/settings.local.json`, then it returns `{ ok: true }` and no halt is recorded — this
  is the 2026-08-04 incident, and it must not halt.
- Given the same contained dispatch, when the live-checkout surface differs at an **untracked**
  path, then it also returns `{ ok: true }`, because containment attributes the write away
  from the dispatch regardless of what git can say about the path.
- Given a contained dispatch and live-checkout drift, when the outcome is recorded, then the
  logged evidence states that the dispatch ran contained and that the drift is attributed to a
  concurrent operator session.

#### Negative Paths
- Given a dispatch ran with a `contained` verdict, when the **provider state** surface
  (`~/.claude` or `$CODEX_HOME`) differs, then `verifyLiveBoundary` still returns
  `{ ok: false }` with today's reason — containment covers the live checkout only and says
  nothing about a provider home outside it.

### Done When
- [ ] `verifyLiveBoundary` accepts the `ContainmentVerdict` and applies the amnesty branch
      only to the surface labelled `live checkout`.
- [ ] `fingerprintLiveBoundary`, `LIVE_CHECKOUT_VOLATILE`, `diffManifests`, `describeDiff`,
      and `classifyLiveCheckoutDiff` are unchanged; a diff review confirms no exclusion entry
      was added.
- [ ] Vitest cases cover the git-ignored path, the untracked path, and the provider-state
      surface under a `contained` verdict.

---

## Story 5: Unproven containment still halts, and the reason names why

**Requirement:** Technical intent — ADR decisions 4 and 5; issue outcomes 3, 4, 6

As the operator diagnosing a halt, I want a live-checkout halt to state whether containment
was in force and, if not, exactly why, so that I can tell a genuine sandbox escape from my own
edit without reading source — and so that the guard never becomes weaker than it is today.

### Acceptance Criteria

#### Happy Path
- Given a dispatch ran with a verdict of `contained: false`, when `verifyLiveBoundary` finds
  the live-checkout surface differs at a path git cannot explain, then it returns
  `{ ok: false }` with today's `describeDiff` content **plus** the containment reason, and the
  reason names which of `bwrap not found`, `probe found <path> writable`, `probe failed`, or
  `disabled by configuration` applied.
- Given a dispatch ran with a verdict of `contained: false`, when the only differing paths are
  tracked `M`/`D` working-tree changes, then it returns `{ ok: true }` — the existing git
  classification amnesty from PR #1127 is preserved unchanged.

#### Negative Paths
- Given containment was unavailable and a dispatch wrote into the live checkout at an
  untracked path, when `verifyLiveBoundary` runs, then it returns `{ ok: false }` naming that
  path — the leak-detection regression case, byte-for-byte today's behavior.
- Given containment was in force and a dispatch attempts to write a live-checkout path outside
  the carve-out, when the write executes, then it fails with `EROFS` inside the session and
  the failure surfaces as a step error naming the path, rather than as a post-hoc halt that
  discards the step.

### Done When
- [ ] Every `contained: false` reason string is reachable from a test and appears in the halt
      reason.
- [ ] A vitest case asserts that under `contained: false` the halt reason is a strict
      superset of today's — no diagnostic information was lost.
- [ ] A test using a real `mkdtemp` live checkout demonstrates the `EROFS` write failure under
      a real bind set, skipped when `bwrap` is unavailable.

---

## Story 6: The operator can turn containment off, and the docs match the new behavior

**Requirement:** Technical intent — ADR decision 6; conditions C4, C5

As the operator, I want a documented config key that restores the previous behavior and
documentation that reflects what is now actually safe during a build, so that a bad bind set
on some machine is a one-line fix rather than a rollback, and so that I am not still following
a rule the code no longer enforces.

### Acceptance Criteria

#### Happy Path
- Given no configuration is present, when self-host config resolves, then
  `liveContainment` is `true`, following the `sandbox_build_env` default-on shape.
- Given `harness_self_host.live_containment: false` in project or user config, when self-host
  config resolves, then `liveContainment` is `false` and dispatches run exactly as they do
  today.

#### Negative Paths
- Given a non-boolean value for `harness_self_host.live_containment`, when config resolves,
  then it falls back to the `true` default rather than throwing or silently disabling
  containment.

### Done When
- [ ] `liveContainment` is a required field on `ResolvedSelfHostConfig` with no optional
      marker, matching the module's existing fully-resolved contract.
- [ ] `docs/reference/configuration.md` documents the key, its type, default, and effect.
- [ ] `docs/guides/running-the-daemon.md` describes containment and the fallback.
- [ ] `docs/runbooks/stalled-or-stuck-feature.md#live-boundary-violation-self-host-only`
      documents both the reduced halt frequency and the carve-out-gap recovery (`EROFS` names
      the path → add it to `LIVE_CHECKOUT_VOLATILE`, or set the key to `false`).
- [ ] `CLAUDE.md`'s Daemon Operations Safety section is updated: its "Unsafe while a build
      runs" list is the reader-facing statement of the behavior this change removes.
