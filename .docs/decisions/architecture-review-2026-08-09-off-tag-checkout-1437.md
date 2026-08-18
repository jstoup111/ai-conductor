# Architecture Review: Off-tag checkout reports up to date forever (#1437)

**Date:** 2026-08-09
**Mode:** DECIDE-phase, lightweight (Medium tier — Sections 2 and 4 only)
**Track:** technical
**Design reviewed:** `.docs/architecture/off-tag-checkout-reports-up-to-date-forever-tagged.md`
**Stories reviewed:** none yet — this review runs **before** `/stories`, per
adr-2026-06-29-architecture-before-stories-convergent-kickback. Input is the technical intent
plus the explore output.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
| --- | --- |
| Stack compatibility | **Pass.** Pure bash plus `git` porcelain already used throughout `bin/update`. No new dependency, no new runtime, no PyYAML reliance introduced. |
| Prerequisites | **None.** No migration, no config key, no external setup. Deliberately so — see Alignment. |
| Integration surface | **3 files plus a mirror.** `bin/lib/harness-common.sh` (new resolver), `bin/update`, `bin/conduct` (duplicate), `bin/install`. Under the 3-boundary flag threshold once the duplicate is counted as a mirror rather than an independent surface. |
| Data implications | **None.** No schema, no new key, no backfill. The persisted record keeps its existing shape and is written exactly as today. |
| Performance risk | **Negligible.** Two added `git` invocations (`tag --merged`, `rev-list --count`) against an existing `git fetch --tags` that already dominates by orders of magnitude. Both are local. |
| Worktree isolation | **Not applicable.** No ports, services, databases, or shared mutable state. The resolver is a pure read of the checkout it is pointed at via `-C "$HARNESS_DIR"`. |

### Claims verified for this review

Confidence is stated per the `verify-claims` protocol. Everything load-bearing below was
executed or read directly; nothing rests on an unconfirmed assumption.

| Claim | Basis | Confidence |
| --- | --- | --- |
| The defect reproduces with zero output and exit 0 | **verified** — executed against a scratch repo 2 commits past `v0.100.0` | 100% |
| `git tag --merged HEAD -l 'v*.*.*' --sort=-v:refname` yields the highest reachable tag | **verified** — executed on the live checkout, returned `v0.100.0` from 22 reachable tags | 100% |
| `git describe --tags --long` emits `«tag»-N-g«sha»` including `N=0` at an exact tag | **verified** — executed across exact, post-release, and annotated-tag cases | 100% |
| A checkout with no reachable tag makes the resolver return empty / git exit non-zero | **verified** — executed on an orphan branch, `describe` exited 128 | 100% |
| `--auto` output reaches the operator's terminal | **verified** — `auto-update-check.ts:21-22` spawns with `stdout: 'inherit'` | 100% |
| `bin/conduct:345-374` duplicates `check_harness_update_tagged` | **verified** — read both | 100% |
| `bin/install:883-902` seeds identity from the `VERSION` file when off-tag | **verified** — read | 100% |
| `make_repo` tags the first commit, so `i17-unknown-identity` has a reachable ancestor tag | **verified** — read `test/test_bin_update.sh:80-123` | 100% |
| `check_harness_update_main` returns bare when heads match | **verified** — read `bin/update:193` | 100% |
| #1400's seed writes legacy values over the block and renames the legacy file | **verified** — read `.docs/plans/update-check-config-single-source-of-truth.md` | 95% (plan is landed but unmerged; implementation could still shift) |

**No unconfirmed load-bearing assumption remains.** The one item below 100% (#1400's final
implementation shape) is not load-bearing: this design's correctness is independent of where
the record lives or what it holds, which is the entire point of the companion ADR.

## Alignment

**Repository Design Principle — "deterministic where possible; LLM only where necessary."**
Strong alignment. The fix replaces an unfalsifiable recorded value with a computation over
observable checkout state. Nothing here depends on prompt discipline, agent behavior, or an
operator remembering to re-run the installer. The identity is recomputed at the moment of every
decision, which is the pattern the principle asks for.

**Event spine.** Not applicable and correctly avoided. `bin/update` is a standalone bash script
outside `ConductorEventEmitter`'s reach; the design adds no sidecar file, no ad-hoc log, and no
second telemetry path. Output goes to the operator's terminal through the existing inherited
stdio. No new channel is introduced, so the event-spine skill's decision procedure returns "no
new mechanism."

**No new config key — deliberate.** The design's refusal to add a key (rejecting Option C) is
the correct call given #1400/#1412 are actively rewriting that schema surface. The two changes
touch overlapping files and will need textual conflict resolution by whoever merges second, but
neither depends on the other's semantics. This is the right kind of coupling: mechanical, not
architectural.

**Single-resolver placement.** Putting `resolve_harness_identity` in
`bin/lib/harness-common.sh` rather than inlining it twice is correct and load-bearing for a
second reason beyond DRY: `bin/conduct`'s copy is scheduled for deletion by #226, and a shared
resolver makes that deletion a removal of a call site rather than a removal of logic that must
be re-verified.

**Pattern consistency.** The resolver matches the existing helper conventions in
`harness-common.sh` (small bash function, `git -C "$HARNESS_DIR"`, defaults on failure, no
global mutation). No new pattern is introduced, so no ADR is required on that axis.

**State management.** The design's principal contribution is making an implicit state explicit.
Today the code has two implicit states (on-a-tag, not-on-a-tag) and conflates a third
(past-a-tag) into the second. The new resolver names three exhaustive, mutually exclusive
states — release, post-release, undeterminable — with no catch-all. This satisfies the
"invalid states unrepresentable" and "exhaustive matching" checks: there is no combination of
baseline and distance that falls outside the three.

**Security boundaries.** No new input surface. `git tag --merged` output is matched against a
`v*.*.*` glob and a semver regex before use; the distance is a `rev-list --count` integer. No
value derived from remote data reaches a shell command unquoted. The existing `checkout
tags/«latest»` path is unchanged and still gated on explicit consent.

**Documentation upkeep (repository rule).** This changes user-visible CLI output on both
channels, so `docs/reference/cli.md` must be updated in the same PR. `docs/reference/configuration.md`
needs a note that `currentVersion` is no longer consulted for update decisions — it remains
written, but its meaning narrows from authority to cache. Both are conditions below.

## Wiring Surface

Design-time commitment for each new or materially changed production surface.

| Surface | Where it is called from in production |
| --- | --- |
| `resolve_harness_identity` (new bash function, `bin/lib/harness-common.sh`) | Sourced by `bin/update:32` and by `bin/conduct`'s equivalent source line; called from `check_harness_update_tagged` in **both** files, from `check_harness_update_main` for its identity line, and from `bin/install`'s `detect_current_version`. |
| Identity line, tagged channel | Emitted by `check_harness_update_tagged` (`bin/update:126`), reached via `dispatch_update_channel:236` from both `check_harness_update` (no-args) and `check_harness_update_auto` (`--auto`), the latter spawned by `spawnAutoUpdateCheck` in `src/conductor/src/engine/auto-update-check.ts` at every conduct-ts startup. |
| Identity line, main channel | Emitted by `check_harness_update_main` (`bin/update:184`), same two entry points via `dispatch_update_channel`. |
| Corrected `detect_current_version` | Called by `configure_conductor` (`bin/install:908`), which runs on every `bin/install` and every `bin/install` update-mode run. |

Every surface is reached from an existing production entry point. No new entry point, hook,
scheduled job, or CLI subcommand is introduced, so there is no unwired-rung risk to carry into
the as-built sweep.

> **Amended 2026-08-17 by #1437:** the table above names the shared resolver and both of
> `bin/update`'s channels, but never names the **root chain of the `bin/conduct` mirror**, and the
> omission was read as an unreachability defect (`build_review:wiring`, "the changed `bin/conduct`
> update implementation is not reachable from any configured production entry point"). The
> assertion stands, and the missing row is added here rather than restated: **`bin/conduct` is
> itself a root production entry point, not a leaf reached from the TypeScript conductor.** The
> mirror therefore **stays inside the changed production scope**; no work is owed to route a
> TypeScript caller to it, and it must not be moved out of scope.
>
> | Surface | Root-to-caller chain (verified 2026-08-17, current source) |
> | --- | --- |
> | Tagged decision + identity line, `bin/conduct` mirror | **Root:** `bin/install:1274-1290` symlinks `${LOCAL_BIN}/conduct` → `${HARNESS_DIR}/bin/conduct` on every install and every `bin/install --update` run, so `conduct` is an operator-invocable CLI on PATH. **Caller:** `bin/conduct:2760` (`check_harness_update \|\| true`, unconditional at script top level on every `conduct` invocation) and `bin/conduct:2720` (`conduct --update`). **Dispatch:** `check_harness_update` (`bin/conduct:336-358`) selects `check_harness_update_tagged` at `:356`. **Export:** `check_harness_update_tagged` (`bin/conduct:193-274`) calls `resolve_harness_identity` at `:204-205`, sourced from `bin/lib/harness-common.sh` at `bin/conduct:20`. |
>
> **Why no TypeScript caller exists, and why that is correct.** `conduct` (bash) and `conduct-ts`
> (TypeScript) are two independently installed CLIs — `bin/install:1274-1290` and `:1303-1320`
> symlink them side by side. The only edge between them runs the opposite way: `bin/conduct:2745-2753`
> prints a heads-up that `conduct-ts` is available. Requiring `src/conductor/src/index.ts`,
> `daemon-cli.ts`, `intake-loop-cli.ts`, or `engineer-cli.ts` to reach `bin/conduct:193-274` would
> invert the deployment boundary, not repair a gap.
>
> **The finding is the retired-rubric failure mode, not a design defect.** `wiring.entry_points`
> no longer exists anywhere in `src/conductor/src` (grep, 2026-08-17); the fixed entry-point list
> survives only in test fixtures. [ADR: The build_review wiring rubric is
> retired](adr-2026-08-14-retire-build-review-wiring-rubric.md) (APPROVED) names this exact
> failure: the rubric "cannot distinguish 'never wired' from 'wired somewhere the entry-point list
> does not enumerate'". `bin/conduct` is the second case. An engine still emitting a `wiring`
> rubric verdict contradicts that APPROVED ADR — an operator-facing machinery gap, recorded here
> and out of this feature's scope.
>
> **Consequence for the as-built sweep (§12).** The `bin/conduct` mirror's production caller is
> `bin/conduct:2760`, cited from the root chain above. It is a genuine root-to-caller-to-export
> chain, not a same-file composition exception: the root is the installed `conduct` executable and
> the caller is script top-level, both outside `check_harness_update_tagged`'s own definition.

**Overlap scan.** `bin/update`, `bin/conduct`, `bin/lib/harness-common.sh`, and `bin/install`
are all touched by the landed-but-unmerged #1400 plan
(`.docs/plans/update-check-config-single-source-of-truth.md`). This is advisory and does not
affect the verdict, but `/plan` must not assume these files are uncontended — see Condition 5.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| Textual merge conflict with #1400 in all four touched files | Integration | High | Medium | Neither change depends on the other's semantics. Whoever merges second resolves textually. Condition 5 requires `/plan` to state this explicitly rather than discover it. |
| `bin/conduct` mirror is updated inconsistently or forgotten | Technical | Medium | High | The duplicate is the historical failure mode this file already warns about. Condition 2 requires a task whose scope is the mirror, and an assertion that both copies resolve identity identically. |
| Always-printed line adds noise to every daemon-loop startup log | Knowledge | High | Low | Operator explicitly chose always-print over the quieter variant after being shown this exact cost. Accepted, not mitigated. |
| Rewriting `#1005` assertions is read later as an unexplained regression | Knowledge | Medium | Medium | `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag` records the reasoning and the falsifying `make_repo` evidence; Condition 4 requires the test file to cite it inline. |
| A shallow clone now reports `unverifiable` where it previously produced a record-derived offer | Technical | Low | Low | Correct per the companion ADR, and the new tagless fixture covers it. Visible behavior change, documented in `docs/reference/cli.md`. |
| Release-gate classification flags a breaking surface for a non-breaking change | Technical | Medium | Low | The change alters `bin/conduct` content but no consumer-visible CLI grammar, hook wiring, symlink target, or schema. Condition 6 pre-decides the waiver-vs-migration question. |

No High-impact risk is left unmitigated. One (the `bin/conduct` mirror) is High-impact and is
addressed by a dedicated condition rather than by prose.

## ADRs Created

| ADR | Status | Covers |
| --- | --- | --- |
| `adr-2026-08-09-checkout-is-sole-version-identity-authority` | APPROVED | Identity is derived from the checkout every run; the record loses read-authority. Records rejected Options A and C, and replaces `git describe` with `git tag --merged` + `rev-list --count`. |
| `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag` | APPROVED | The `unverifiable` trigger moves from "no recorded identity" to "no reachable release tag"; enumerates the exact `#1005` assertion rewrites. |

Both fall under the **Cross-Cutting Concerns** decision category (error handling and reporting
strategy for a user-facing diagnostic path), which is an ADR trigger even in lightweight mode.

## Conditions

Verdict is APPROVED **with** the following. Each is checkable at code review and blocking at
`/finish`.

1. **The resolver is the only place identity is computed.** No caller may re-derive identity
   inline. `bin/update`, `bin/conduct`, and `bin/install` all call
   `resolve_harness_identity`; a second implementation of the rule anywhere fails this
   condition.
2. **The `bin/conduct` mirror is a first-class task, not a footnote.** `/plan` must carry a
   task whose scope is updating `bin/conduct:345-374`, with a test or check asserting both
   copies produce identical identity output for the same checkout. Leaving the duplicate stale
   reproduces the bug on the `bin/conduct` entry point.

   > **Amended 2026-08-17 by #1437:** the phrase "the `bin/conduct` entry point" is now
   > load-bearing and is made explicit — `bin/conduct` is a root production entry point in its own
   > right (`bin/install:1274-1290` → `${LOCAL_BIN}/conduct`; dispatch at `bin/conduct:2760` and
   > `:2720`), so the mirror remains in the changed production scope and this condition remains
   > binding. Two clarifications the original wording left implicit:
   >
   > - **The condition covers the whole tagged decision, not just the identity block.** Parity
   >   must hold across the undeterminable, cache-persistence, post-release, up-to-date,
   >   update-offer, and no-TTY/prompt branches — the mirror reproduces the bug on any branch that
   >   drifts, not only on the identity line.
   > - **Its guard must be falsifiable against the pre-diff implementation.** A parity or
   >   delegation check that also passes against the `git describe` baseline proves nothing; the
   >   guard must fail on the merge-base form of both callers.
   >
   > Owning surfaces for the BUILD kickback: `bin/update` and `bin/conduct` (implementation);
   > `test/test_harness_integrity.sh` check 24 (`:1459-1499`, static parity + delegation guard),
   > `test/test_bin_update.sh` (behavioral fixtures), and
   > `src/conductor/test/acceptance/off-tag-checkout-reports-up-to-date-forever-tagged.acceptance.test.ts`
   > (cross-caller parity). No production-reachability change is owed by any of them.
3. **`bin/install` no longer guesses.** `detect_current_version` must not fall back to the
   `VERSION` file for tagged-channel identity. If it retains a `main@«sha»` result for the main
   channel, that path must be explicit and distinguishable from a release identity.
4. **The rewritten `#1005` assertions cite the ADR inline**, and a new fixture covers the
   genuine tagless/no-reachable-tag case. Rewriting the assertions without adding that
   coverage fails this condition — it would remove the only test of "declines to guess".
5. **`/plan` states the #1400 overlap explicitly.** All four touched files are contended by
   `.docs/plans/update-check-config-single-source-of-truth.md`. The plan must name this and
   state that resolution is textual, so the build does not treat a conflict as a design problem.
6. **Release metadata is decided before the PR opens.** This is a reader-visible implementation
   change, so `Release-Disposition: note` with `Release-Category: Fixed` and
   `Release-Semver: patch`. The diff touches `bin/conduct`, which the path-based classifier
   flags as the `bin/conduct CLI` surface, but no consumer-visible CLI grammar, hook wiring,
   symlink target, or schema changes — so a `.docs/release-waivers/` waiver naming
   `bin/conduct CLI` verbatim is the correct instrument, **not** an invented migration block.
7. **Both channels print the identity line.** Operator-confirmed after this review surfaced
   that the original design covered only the tagged channel while the operator's own install
   runs on `main`. `check_harness_update_main` must emit its identity (`main@«sha»`, branch,
   behind-count) on every check including when up to date.

## Blocking Issues

None. No condition above is severe enough to withhold approval, and no unconfirmed
load-bearing assumption remains.
