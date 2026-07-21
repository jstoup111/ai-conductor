# Changelog

All notable changes to this harness are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release cadence: tags `vX.Y.Z` are cut automatically by CI on merge to `main`
(see `.github/workflows/release.yml`). Every PR must add an entry under
`## [Unreleased]`.

## [Unreleased]

### Fixed

- Architecture doc for intake-only-enforcement (#695): converted the ASCII-only
  diagram to a proper ```mermaid flowchart (the only recent non-Small arch doc
  without a mermaid fence; enforcement gap captured as #729).

- Owner-gate: added the missing `Owner:` marker to `.docs/intake/intake-only-enforcement.md`
  (spec #719 merged un-owned, so the daemon skipped it forever), and a new integrity check
  fails the suite when any intake doc lacks an `Owner:` marker — un-owned specs can no
  longer merge silently.

- ci-fix resolver no longer invokes the nonexistent `claude --fix-session` flag;
  dispatches a real fix via StepRunner, classifies spawn errors, and validates
  invocation at daemon startup

### Changed

- Operator config: `harness_self_host.version_freeze` advanced 0.99.19 → 0.99.20
  to match main's VERSION after #707/#709 — restores the standing no-bump
  approval so rebased features do not HALT at the self-host version gate.

- `architecture-review` skill: tightened the ADR-naming rule with explicit
  WRONG/RIGHT examples and the heading convention (`# ADR:`, no number), after a
  spec authored `adr-0001-…`/`adr-0002-…` in violation of the existing date-based
  convention. A deterministic gate to reject number-named ADRs is captured in
  intake #705.

### Fixed

- conduct-ts autoheal: path-corroboration now credits a `Task:`-trailered
  commit whose files land in the same immediate directory as a plan-declared
  path (bounded `trailer-dirname` corroboration), eliminating a
  `no_task_progress` 0/N stall class where valid subsystem-local work was
  rejected. Judge lane unchanged; #445 inheritance guard preserved by the
  immediate-parent-dir bound. (#707)

### Added

- README: "How the Pieces Fit Together" section with a mermaid component diagram
  of the engineer / daemon / operator roles and how a feature flows from intake
  issue to merged implementation PR.

- Issue #695 — spec (DECIDE artifacts only) for **intake-only criteria
  enforcement**: priority + size + dependency-linking are stamped at every intake
  capture surface (a required-fields intake form + an isolated `intake-label-sync`
  Action, a `bin/intake-file` filing helper, and a one-shot `bin/intake-backfill`)
  so every issue is born complete, and the ~100-issue unsized backlog is completed
  in one default-and-report pass. Per the operator directive "No failures — enforce
  requirements at intake ONLY", the spec adds **zero** downstream failure modes: the
  claim path (`dependency-claim.ts`/`ClaimOutcome`), daemon dispatch/build, pipeline
  gates, and CI stay byte-identical and add no criteria check (a negative-path story
  asserts this). Supersedes PR #696 (which enforced at claim time via a
  `needs-criteria` deferral). Artifacts under
  `.docs/{plans,stories,complexity,conflicts,architecture,decisions,intake}/intake-only-enforcement*`;
  ADR `.docs/decisions/adr-2026-07-21-intake-only-enforcement.md`. Spec-only — no
  implementation, no VERSION bump, no migration.
- Issue #188 — retry-as-escalation ladder: a step's retry now escalates instead
  of repeating an identical attempt. A new pure `escalateAttempt` (with
  `EFFORT_ORDER`, `MODEL_TIER_ORDER`, `bumpEffort`, `bumpModel` in
  `engine/escalation.ts`) transforms the resolved base `(model, effort)` by the
  1-based attempt: attempt 2 bumps effort one level, attempt 3+ bumps the model
  one tier (both capped at the top rung). The bumped model still routes through
  the #186 availability ladder (`ModelAvailability.effectiveModel`), so a dead
  escalated tier is substituted with a live one. A new per-step
  `escalate?: boolean` config knob (default true; also valid at `phases`/
  `defaults`) opts out to pin the base config across retries. The `step_retry`
  event gains optional `escalatedModel`/`escalatedEffort` (the upcoming
  attempt's rung) and `aggregateRetryHotspots` surfaces the terminal rung for
  retro Part C (`.docs/plans/retry-as-escalation.md`).
- Plan tasks can now be marked `**Verify-only:** yes` (documented in the
  `/plan` and `/tdd` skill contracts) for prove-closed work that legitimately
  produces no commit; the generated commit-msg hook accepts an
  `Evidence: skipped <reason>` trailer as an alternative to `Task:` on an
  otherwise-empty commit (a non-empty reason is required; a bare empty commit
  or an unresolvable `satisfied-by` sha are still rejected); and an exhausted
  auto-park reason now names the specific unresolved verify-only task ids
  instead of only a generic "no task progress" message (#677).
- Spec for issue #677 — verify-only (prove-closed) plan tasks get a
  deterministic `**Verify-only:** yes` plan marker, class-scoped dispatch of
  the judged attribution lane for marked residue tasks (dark-cutover-safe),
  `Evidence: skipped <reason>` parity in the generated commit-msg hook, and
  park reasons that name stranded verify-only task ids — so an
  evaluator-APPROVED build no longer auto-parks solely because one task
  legitimately produced no commit
  (`.docs/plans/verify-only-prove-closed-task-evidence.md`; partial #678 —
  removes the completed-build re-dispatch trigger for this class, general
  outcomes deferred to #678/PR #679).
- Committed shipped-records for two manually-shipped features —
  `2026-07-20-engine-gc-self-eviction-guard` (#673, PR #703) and
  `build-stall-remediation-skips-no-task-progress` (#701, PR #701) — so
  `daemon-backlog.ts` dedups them instead of re-dispatching work that already
  shipped (#438 stopgap). Plus a **Daemon Operations Safety** section in
  `CLAUDE.md`: never bulk-delete worktrees/branches, park before touching a
  feature's git state, a worktree checkout is disposable but the branch is the
  source of truth, and a manual PR is not a harness finish (run
  `conduct-ts shipped-record`).
- Spec for issue #569 — build-stall auto-remediation now also fires for
  `no_task_progress` (zero-work) stalls, not only `halt_marker` stalls: a
  synthesized remediation prompt (from the completion-gate reason, the stall
  transition, and the `zero_work_product` no-evidence tag) is routed through the
  same `/remediate` dispatch, bounded by the shared `MAX_KICKBACKS_PER_GATE`
  budget, with the durable no-evidence counter still owning the terminal
  HALT/park decision; also a distinct terminal HALT reason for a stalled build
  instead of the misleading generic "retries exhausted"
  (`.docs/plans/build-stall-remediation-skips-no-task-progress.md`).
- Spec for issue #671 — build dispatches must not run attribution-blind: a
  deterministic pre-dispatch invariant on the attribution machinery, a loud
  unattributed-dispatch signal when `Task: none` sub-dispatches accumulate,
  and attribution-aware dispatch-count telemetry
  (`.docs/plans/build-dispatch-can-start-with-current-task-none-so.md`).
- Spec for issue #667 — operator `unpark` grants a fresh no-evidence budget
  (resets `noEvidenceAttempts`/`noEvidenceReasons` regardless of park
  provenance) and the auto-park halt message distinguishes an inherited
  budget from fresh failures
  (`.docs/plans/noevidenceattempts-persists-across-unpark-so-re-di.md`).

### Changed

- Issue #188 — deep-step retry budgets reduced from 5 to 3 for `explore`, `prd`,
  `plan`, and `build` (`DEFAULT_STEP_RETRIES`). Because a retry now escalates
  (effort, then model tier) rather than repeating an identical attempt, five
  identical retries were wasteful; 3 is the floor that still reaches the
  attempt-3 model-bump rung. `architecture_review` is out of scope and stays 5.

## Migration

Retry-as-escalation (#188) is **on by default** — existing pipelines begin
escalating `(model, effort)` on retry and deep-step retry budgets drop 5 → 3.
This is a behavior change, not a schema break: `escalate` is a new **optional**
`HarnessConfig` field (in `.ai-conductor/config.yml`, not `settings.json`), fully
back-compatible, so no `bin/migrate` step is required. To preserve the exact
pre-#188 identical-retry behavior for a step, pin it off:

```yaml
# .ai-conductor/config.yml
steps:
  build:
    escalate: false   # every retry reuses the base (model, effort)
```

`escalate: false` is also accepted at `phases.<PHASE>` and `defaults` to opt a
whole phase or the entire pipeline out. Restoring the old budgets is independent:
set `steps.<step>.max_retries: 5` where desired.

### Fixed

- Verify-only (prove-closed) tasks no longer strand the build gate (#677): a
  gate-miss residue containing only `**Verify-only:** yes`-marked task ids now
  arms the judged-attribution lane class-scoped — even when the global
  `attribution_judge_cutover` flag is dark — so an evaluator-APPROVED,
  legitimately-commit-less task is resolved in-loop instead of burning the
  `noEvidenceAttempts` counter and auto-parking the build. Mixed residue (some
  marked, some not) still arms only the marked subset under a dark cutover; an
  armed cutover keeps today's full-residue dispatch unchanged; residue with no
  marked ids is byte-identical to today (lane not dispatched).
- The attribution judge lane now dispatches on inherited build-gate residue on
  resumed/stalled runs — dropped the attempt-scoped `!isZeroWork` guard that
  previously suppressed dispatch whenever `headShaBeforeBuild === headShaAfterBuild`
  (i.e. no new commits landed this attempt), which meant residue carried over from
  a prior attempt was silently never judged. The two other no-op paths are
  preserved: the lane still no-ops when the cutover flag is disabled/absent, and
  when the residue set is empty. The separate kickback/no-evidence zero-work retry
  path is unrelated code and is unchanged (#570).
- `no_task_progress` (zero-work) build stalls now route through the same `/remediate`
  auto-remediation dispatch as `halt_marker` stalls (a synthesized prompt built from the run's
  own context), bounded by the shared remediation budget, with the durable no-evidence counter
  still owning the terminal HALT/park decision. Exhausted `no_task_progress` builds now halt
  with a distinct, specific reason instead of the generic "retries exhausted" message (#569).
- Build dispatches can no longer run attribution-blind — a pre-dispatch invariant
  now fails loudly (skips/fails the dispatch, writing `.pipeline/HALT` after 2
  attempts) when attribution machinery is broken (missing `task-status.json`,
  uninstalled session hooks, unwritable stamp path), and a loud
  `unattributed_dispatch` event surfaces unattributed-dispatch streaks at the
  build seam via `readDispatchAttribution`/`detectUnattributedDispatch`, instead
  of silently deferring to the evidence gate. `Task: none` is now treated as an
  error signal to watch for, not silently tolerated (#671).
- `conduct daemon unpark` now resets the no-evidence budget
  (`noEvidenceAttempts`/`noEvidenceReasons`) for both operator- and auto-parked features
  instead of only auto-parked ones, so an operator-unparked feature also gets a fresh
  budget rather than carrying over stale counts into re-dispatch. The auto-park halt
  message now distinguishes a budget inherited from a prior park/unpark cycle from
  fresh no-evidence failures accumulated since the last unpark, so operators can tell
  whether a halt reflects new misses or leftover count (#667).
- `bin/install` no longer redirects `rtk init`'s stderr to `/dev/null`, which
  silently swallowed rtk's interactive prompt and made the installer appear to
  hang with no visible output. The prompt (and any error) now reaches the
  terminal so the user can respond.
- Stamped the missing `Owner:` intake marker for the
  `finish-staleness-grep-never-matches-rebase-finish` spec
  (`.docs/intake/finish-staleness-grep-never-matches-rebase-finish.md`,
  Source-Ref jstoup111/ai-conductor#587), ungating it from the owner gate's
  `unowned-post-cutover` hold.
- `conduct daemon park`/`unpark` no longer fail with a misleading "not found" error when invoked from a subdirectory or a linked worktree: both subcommands now resolve the main repo root (`resolveMainRepoRoot`) before locating the park marker, so the marker path is computed relative to the actual main repo regardless of the operator's current working directory. Running either subcommand outside any git repo now reports a clear outside-repo error instead of a confusing not-found message.
- Fresh build dispatch no longer false-halts with "Attribution machinery broken:
  .pipeline/task-status.json is missing" — the pre-dispatch attribution-machinery
  guard now seeds `task-status.json` from the committed plan
  (`seedAndCheckAttributionMachinery`) before evaluating, instead of tripping on a
  fresh/legitimate dispatch where the plan exists and machinery is otherwise intact
  (#692).

### Added
- Parallel SHIP validation phase (#469): in auto-mode runs (inline or daemon) the three
  SHIP validators (`manual_test`, `prd_audit`, `architecture_review_as_built`) fan out as
  a built-in concurrent validation group (`VALIDATION_GROUP`/`STEP_GROUPS`,
  `engine/group-core.ts`) instead of the serial walk — per-branch fresh sessions,
  single-writer join that recomputes every member's objective gate verdict from on-disk
  evidence, branch-attributed `parallel_started`/`group_member_step`/`parallel_completed`
  events, SIGINT-safe mid-group persistence (a resumed run re-dispatches only unfinished
  members), and join classification with full serial parity (#367 manual-test kickback,
  one `/remediate` per round over the union of gap members' evidence, shared
  `MAX_KICKBACKS_PER_GATE` budget, D2/#647 kickback-to-build no-op HALT, loud non-green
  HALT naming each failing member). Interactive runs keep the serial walk and
  checkpoints. See `src/conductor/README.md` → "Parallel validation phase".
- New `validation_concurrency` config key (`.ai-conductor/config.yml`) bounding the
  validation-group fan-out. Default 2; zero/negative/non-numeric fall back to the
  default; effective width additionally capped at the number of dispatchable members
  (width 1 degrades to exact serial semantics). Additive and optional — absent config
  keeps the default.

### Changed
- The config-DSL `parallel:` step executor now runs through the same shared GroupCore as
  the built-in validation group (`runParallelGroupViaCore`): each branch dispatches its
  OWN step/skill name on its own fresh session (previously branches could dispatch under
  the group's name), with a single-writer join for state keys.

### Removed
- Internal `runParallelGroup` helper (replaced by `runParallelGroupViaCore` over the
  shared GroupCore). Engine-internal only — no consumer-visible CLI/hook/schema change,
  no migration block required.

### Added
- Implemented #646's rerun-vs-route retry classifier (queued entry below): `classifyRetryDecision`
  (`src/conductor/src/engine/artifacts.ts`) is a pure helper that, on a completion-gate miss for a
  SHIP-tail verdict step (`architecture_review_as_built`, `build_review`, `prd_audit`), decides
  `rerun` vs. `route` from a `routeClass` facet (`'named-route' | 'absent'`) now carried on
  `CompletionResult` for the as-built/build_review predicates, plus a byte-identical-reason +
  unchanged-HEAD/artifact-mtime "identical-repeat" signal. The conductor retry loop
  (`src/conductor/src/engine/conductor.ts`) calls the classifier in daemon mode, emits a
  `retry_decision` event per attempt, and — for an identical-repeat route — prepends an
  "unchanged input" note to the routed HALT reason instead of the generic "retries exhausted"
  text. A new `retry_routing:` config block (`types/config.ts` / `engine/config.ts`,
  `RETRY_ROUTING_DEFAULTS = { enabled: true }`) is the kill-switch: `enabled: false` reverts
  exactly to the pre-#646 behaviour (only `prd_audit`'s original try-1 short-circuit runs; the
  other two verdict steps burn their full retry budget before routing at `step_failed`). Routing
  reuses the existing `planRemediation`/kickback path unchanged, so `MAX_KICKBACKS_PER_GATE` and
  the #644 DECIDE-target HALT are unaffected; non-daemon (interactive) retry behavior is
  untouched (the classifier seam is daemon-gated). Documented next to `build_progress_halt` in
  `README.md` and `src/conductor/README.md`.
- Per-step config-disable opt-in for gating steps: `StepDefinition.configDisableAllowed`
  lets a specific gating built-in accept `steps.<name>.disable: true` in a project's
  `.ai-conductor/config.yml`; `validateConfig()` still rejects disabling every other
  gating step and all structural steps (fail-closed default unchanged). `manual_test`
  is the only step that opts in. This repo's self-host config now sets
  `steps.manual_test.disable: true` — harness features are engine/CLI changes covered
  by vitest + the integrity suite, so a dispatched manual-test session adds cost
  without signal. A disabled step is marked `skipped`, which satisfies downstream
  prerequisites (prd_audit, rebase) and the SHIP-tail selector, so the pipeline chain
  is unaffected.
- Spec landed for #646 (`.docs/{track,complexity,intake,stories,plans}/retry-classify-rerun-vs-route.md`
  + `.docs/decisions/adr-2026-07-13-retry-classify-rerun-vs-route.md`): a deterministic rerun-vs-route
  classifier will decide, BEFORE burning a retry, whether a SHIP-tail verdict step's completion-gate
  miss (`architecture_review_as_built`, `prd_audit`, `build_review`) is route-class — a fresh adverse
  verdict that names a route (route on try 1), or a byte-identical failure on unchanged inputs (HEAD sha
  + verdict-artifact mtimes unchanged; route on try 2) — and engage the existing `planRemediation`/
  kickback path immediately instead of exhausting the per-step retry budget. Missing/stale/changed-input
  failures still rerun. A per-retry `retry_decision` audit event records rerun-vs-route + signal for
  success-% comparison; routed halts name the unchanged input rather than "retries exhausted". New
  optional `retry_routing:` config block (`enabled`, default true); `enabled: false` is an exact revert
  to the pre-#646 behaviour (prd_audit's existing try-1 short-circuit preserved; as-built/build_review
  burn retries then route at step_failed as before). Composes with #644 (DECIDE-target routes still
  HALT), #648 (kickback re-entry escalation engages sooner through the same path), #649/#652 (fresh-
  verdict floor feeds the route-vs-rerun signal), and leaves #280's build budgets untouched (the `build`
  step is out of scope). Implementation tracked separately; this entry documents the queued fix.
- Progress-aware build halt (#280): the build retry loop no longer halts/parks a step at a
  fixed attempt budget while it's still resolving additional tasks each attempt — a
  within-dispatch progress-bypass gate re-dispatches on positive resolved-task delta, bounded
  by a new `build_progress_halt.attempt_ceiling` backstop with a distinct "progressing but hit
  ceiling" park reason. Parked/halted builds that made progress on their last dispatch are now
  also re-kick-eligible on the daemon's idle tick even without a base-sha advance, bounded per
  spec by `build_progress_halt.dispatch_ceiling`. New optional `build_progress_halt:` config
  block (`enabled`, `attempt_ceiling`, `dispatch_ceiling`); `enabled: false` is an exact revert
  to the previous fixed-budget halt. The true zero-progress park path is unchanged. See
  `README.md` and `src/conductor/README.md` for config details.
- New `wiring_check` gate (gating, always-on, all complexity tiers) sits between
  `build_review` and `manual_test` in the SHIP-phase gate loop, verifying that new
  production surface declared via a plan task's `**Wired-into:** ` line is actually
  reachable — catching orphaned code that compiles and passes tests but is never called.
  Two verification layers: a universal diff/reference-scan Layer 1 (declared-call-site
  verification, an orphan backstop, and contradiction checks for `none`/`inert`
  declarations), and an opt-in TypeScript import-graph reachability Layer 2 (rooted at
  configured `wiring.entry_points`). Plans predating the `Wired-into:` convention (zero
  such lines) get advisory-only findings; contract-bearing plans are fully blocking.
  `inert` waivers resolve on-disk (path form, no network) or via `gh issue view` (issue
  form, fail-closed on error). Evidence is written to `.pipeline/wiring-evidence.json`
  with HEAD-sha freshness invalidation, and `wiring_check` joins the post-rebase
  invalidation set alongside `build`/`build_review`/`manual_test`. This repo's own
  `.ai-conductor/config.yml` now sets `wiring.entry_points: [src/conductor/src/index.ts]`
  to enable Layer 2 on self-host builds. See `src/conductor/README.md` → "Wiring
  reachability gate" and `skills/plan/SKILL.md` §5c for the full grammar.
- Armed `attribution_judge_cutover` (2026-07-11T18:30Z) + explicit `attribution_audit_sample_pct: 10` in the committed project config — the #520 semantic attribution judgment gate and its spot-audit measurement are live for all subsequent builds.
- Spec landed for #524 (`.docs/{track,complexity,stories,conflicts,plans}/engineer-cli-subcommand-help-executes-the-command.md`): `engineer <subcommand> --help`/`-h` will short-circuit to usage text with zero side effects instead of executing the subcommand, unrecognized flags on a subcommand will be rejected (exit 1, no state change) instead of silently ignored, and `conduct-ts --help` will document every engineer subcommand/flag and name both loops (build/ship daemon vs. engineer/brain). Implementation tracked separately; this entry documents the queued fix.
- New optional `kickback_escalation:` config block (`enabled`, default `true`) — a master
  on/off switch for the #647 kickback→build no-op escalation (D2, "zero net progress and
  unchanged gate verdict"). `enabled: false` reverts D2 to the prior re-kick-until-
  `MAX_KICKBACKS_PER_GATE` behavior. The D1 route-into-no-op guard in `planRemediation` is
  fail-closed correctness and stays active regardless of this flag. See `README.md` and
  `src/conductor/README.md` for config details.

### Changed

- `/explore` (DECIDE) approach proposals now require an **Est. effort** line (very rough
  implementation time, e.g. "~1-2h", "~half day", S/M/L) and an **Impact** line (one line on
  value added / what it unblocks) on every proposed approach — required line-items on the
  option template so the operator can weigh cost vs. value when picking; no new gate or
  artifact.
- `/intake` now requires the same cost/value pair on every filed issue, split as: sizing
  as exactly one `size: S` / `size: M` / `size: L` label (S ≈ ~1-2h, M ≈ ~half day to a
  day, L ≈ multi-day; labels created in the repo), applied via REST
  (`gh api -X POST repos/{owner}/{repo}/issues/<n>/labels`) because `gh issue edit
  --add-label` is broken on classic-Projects repos; and **Impact** promoted from
  optional to a required one-line-minimum section in the issue body (the
  `.github/ISSUE_TEMPLATE/intake.yml` web form now marks Impact required to match).

### Fixed

- SHIP-tail verdict checks (`build_review`, `prd_audit`, `architecture_review_as_built`) now
  require the verdict artifact to be fresh relative to the **per-attempt** judging session
  (`attemptStartedAt`), not just the conductor-run start (`sessionStartedAt`)
  (`.docs/decisions/adr-2026-07-13-session-fresh-verdict-artifacts.md`). Previously a
  judging session that failed to rewrite its verdict file on a re-dispatched attempt could
  silently reuse a prior attempt's verdict forever (incident
  2026-07-12-wiring-reachability-gate); the new `verdictFreshnessFloor` makes that loud
  instead, scoring "no fresh verdict" when the artifact's mtime predates this attempt's
  start. Falls back to the pre-existing session-level freshness check when no per-attempt
  floor is available (legacy state, or both timestamps absent) — fail-open on presence
  preserved. The per-attempt comparison applies a small filesystem-timestamp tolerance
  (`VERDICT_FRESHNESS_FS_TOLERANCE_MS`) so a verdict written *during* the current dispatch
  is never scored a false "no fresh verdict" when the coarse filesystem clock records an
  mtime a few ms behind the captured floor; a genuinely stale prior-attempt verdict is
  separated by a full re-dispatch and stays loud.
- Kickback→build no longer loops silently when the target task's evidence is already
  stamped (#647, `.docs/decisions/adr-2026-07-13-kickback-build-no-op-escalation.md`).
  `planRemediation` now recomputes build completion after append+re-seed and HALTs with the
  gap ledger when there is no dispatchable build work (D1), instead of unconditionally
  routing back to BUILD. And a kickback→build re-entry that ends with zero net progress (no
  HEAD movement, no resolved-task increase) AND an unchanged gate verdict now HALTs on the
  first such cycle with a reason naming the unchanged input, instead of silently re-kicking
  toward `MAX_KICKBACKS_PER_GATE` (D2). The kickback audit trail now distinguishes a
  genuine self-heal (`kickback_outcome: 'did-work'`) from a kickback resolved without a
  build ever running (`'derived-already-complete'`) (D3).
- Owner: markers added to the four 2026-07-13 spec-wave intake docs (session-fresh-verdict-artifacts, park-all-dispatch-paths, kickback-to-build no-op, retry-classify) so the daemon owner-gate can dispatch their builds (#649/#651/#647/#646).
- Spec landed for #651 (`.docs/{track,complexity,intake,stories,plans}/park-all-dispatch-paths.md`
  + `.docs/decisions/adr-2026-07-13-park-all-dispatch-paths.md`): the daemon pool's fresh-dispatch path
  will consult the operator-park predicate **immediately before dispatch** (a new `guardedDispatch`
  wrapper around `deps.runFeature`), not only at `pickEligible` selection time — closing the
  selection→dispatch race where a slug parked during the `rebuildAndMaybeRestartForStaleEngine` await was
  started anyway (2026-07-13 20:43Z incident). A park-skipped dispatch will log one line naming the marker
  path; a grep-derived regression test will enumerate every build-start call site so a future entry point
  cannot silently skip the check. Store location (main-repo `.daemon/parked/`) is unchanged — the fix is
  consumer-side, distinct from #534/#486's marker-store cwd work. No kill-switch (park is a safety
  invariant). Implementation tracked separately; this entry documents the queued fix.
- Spec landed for #649 (`.docs/{track,complexity,intake,stories,plans}/session-fresh-verdict-artifacts.md`
  + `.docs/decisions/adr-2026-07-13-session-fresh-verdict-artifacts.md`): the three SHIP-tail verdict
  completion checks (`architecture_review_as_built`, `prd_audit`, `build_review`) will require their
  session-produced verdict artifact to be fresh relative to the **per-attempt judging session** rather
  than the conductor-run start. Today the freshness guard uses `sessionStartedAt`, stamped once per
  `run()` and shared by every in-loop retry, so a verdict written by an early retry stays "fresh"
  forever and a review session that fails to rewrite its verdict re-scores the stale verdict against
  code that no longer exists (incident `2026-07-12-wiring-reachability-gate`, 2026-07-13: an
  as-built BLOCKED verdict from 19:56Z looped three retries after the code was fixed at 20:22Z). The
  fix threads an `attemptStartedAt` floor captured before each review dispatch onto `CompletionContext`
  and scores a loud, distinct "no fresh verdict" (never reusing a prior session's verdict) when the
  artifact predates it; a `verdict_freshness` audit event records fresh-vs-stale-reused per evaluation.
  Falls back to the current `sessionStartedAt` floor when no per-attempt floor is present (legacy/
  resume). `manual_test` (already covered by the #367 whitewash guard), `acceptance_specs` RED
  evidence, and `retro` are enumerated and deferred; orthogonal to the unmerged #642 (touches the
  verdict predicates + retry-loop seam, not `autoheal.ts`/`deriveCompletion`). Implementation tracked
  separately; this entry documents the queued fix.
- Spec landed for #647 (`.docs/{track,complexity,intake,stories,plans}/kickback-to-build-no-op-when-target-evidence-stamped.md`
  + `.docs/decisions/adr-2026-07-13-kickback-build-no-op-escalation.md`): a remediation kickback→build
  that cannot produce real rework will fail loud and fast instead of looping silently. When
  `planRemediation` resolves a build route but build completion recomputed from disk is already
  satisfied (empty tasks, or an idempotent upsert onto an already-complete `rem-*` task), the engine
  will HALT with the gap ledger rather than route into a 23s no-op; and when a build entered via a
  kickback ends with zero net progress (unchanged head sha AND unchanged `lastResolvedCount`) while the
  reviewer verdict is unchanged, the engine will HALT with both artifacts instead of re-kicking —
  capping the legitimate reviewer-wrong case on the first cycle. An optional `kickback_escalation.enabled`
  toggle (default true) reverts the escalation. Fixes the identical-BLOCKED no-op loop observed on
  `adr-2026-07-12-wiring-check-gate→build` (2026-07-13). Non-goal: literal per-task stamp invalidation
  (kickbacks carry FR/ADR ids, not plan-task ids; completion is trailer-authoritative). Implementation
  tracked separately; this entry documents the queued fix.
- Daemon no longer autonomously rewinds to DECIDE-phase steps on remediation routing (#644):
  `planRemediation()` in `src/conductor/src/engine/conductor.ts` now guards the single
  `earliestRemediationTarget` choke point — in daemon mode, a remediation target whose step
  phase is `DECIDE` (e.g. `architecture_review`, `plan`, derived from the step definitions,
  not a hardcoded list) converts the route into a `halt` with a gap ledger naming the DECIDE
  target, writing `LOOP_HALT` for the operator instead of `navigateBack`-rewinding the whole
  DECIDE tail unattended. BUILD-phase targets (`build`, `acceptance_specs`) still route, the
  deterministic `classifyPrdAuditGaps` fallback is untouched, and interactive mode is
  unchanged. Pure engine logic — no migration needed.
- Evidence-gate path corroboration now checks the SET of `Task: <id>`-trailered commits
  per task instead of only the newest one (#548): a follow-up commit (e.g. a test-fix)
  reusing a task's trailer no longer shadows an earlier feature commit that overlaps the
  plan's declared paths — a task is corroborated if ANY reachable trailered commit
  overlaps. Stale/unreachable candidate SHAs (including a dangling `Evidence:
  satisfied-by` pointer) are skipped as candidates rather than terminally rejecting the
  task when another satisfying candidate exists. (`src/conductor/src/engine/autoheal.ts`,
  `deriveCompletionInternal`)
- finish GATE 0 no longer instructs a false-positive rebase check (#634): the skill
  prose implied that output from `git rev-parse --git-path rebase-merge` indicates a
  rebase in progress, but `--git-path` prints the path unconditionally — finish
  sessions bailed at GATE 0 on clean trees, never wrote `.pipeline/finish-choice`,
  and burned finish retries into a halt. GATE 0 now mandates directory-existence
  checks (`test -d "$(git rev-parse --git-path rebase-merge)"`), with an explicit
  warning that `rev-parse` output alone is not evidence. The `/rebase` skill's
  detection was updated to the same `test -d` form (its old `ls .git/rebase-merge/`
  probe always failed in linked worktrees, where `.git` is a file). Engine
  TypeScript (`rebaseStateActive`, git hook assets) already checked existence
  correctly and is unchanged.
  the bare `### T<N>` header shorthand (ai-conductor#636, the #417 id-grammar
  drift class resurfacing via #615). #615 widened the header regex to accept
  `### T<N> — Title` but normalized the id to a *bare* number (`T3` → `3`),
  while the pre-existing machinery — `.pipeline/task-status.json` rows, commit
  `Task: T<N>` trailers, and `.pipeline/task-evidence.json` stamps — used the
  T-prefixed grammar. The build-completion gate then UPSERTed a second, all-
  pending set of bare-id rows next to the orphaned T-rows (e.g. 18 rows for a
  9-task plan), making completion unsatisfiable and orphaning all real
  progress. Fixes: (1) `parsePlanTasks`/`parsePlanTaskPaths` now emit the id
  **as written** including the `T` prefix, so it matches the rows/trailers/
  stamps verbatim; (2) a new `canonicalTaskId` fold (`T<N>` ↔ `<N>`) is applied
  at every comparison seam — trailer→task matching (`taskTrailerMatches`),
  evidence-stamp lookup/reconcile (`reconcileStatusFromStamps`), subject
  matching, and the seed upsert key — so a commit trailer in *either* grammar
  resolves the same task; (3) `seedTaskStatus` keys rows by the canonical id
  and merges duplicate `T<N>`/`<N>` rows (keeping the more-advanced row),
  deterministically repairing any task-status.json that #615 already split.
  Files: `src/engine/autoheal.ts`, `src/engine/task-seed.ts`.
- Path corroboration in the build-completion gate no longer rejects valid task
  evidence when a plan task declares its file paths only *inline in prose*
  rather than in a `**Files:**` line or a dedicated `- \`path\`` bullet. The
  legacy per-task backtick scan (`parsePlanTaskPaths` in
  `src/engine/autoheal.ts`) previously harvested *every* backtick token in a
  section that had no `**Files:**` line — including incidental references like a
  runtime artifact the task guards (`task-status.json`) or a line-annotated
  citation (`bin/install:494–506`) — and made them the task's *required*
  corroboration paths. A real single-file commit whose trailer named the task
  then "had no overlap with plan paths" and was rejected, zeroing the attempt's
  progress and cascading into `no_task_progress` stall halts (ai-conductor#548;
  overnight 2026-07-13: #280 plan T11 / commit `b4ce60a`, and
  `2026-07-12-rtk-hook-preservation` T1/T3/T5). The scan is now restricted to
  dedicated file-list bullet items; a backtick token embedded in a prose
  sentence is treated as an incidental reference, not a declaration. With no
  declared path, corroboration **abstains** and the engine-stamped `Task:`
  trailer stands on its own (abstain-or-loud, #519/#530) — while a genuinely
  *declared* path (a `**Files:**` line or a `- \`path\`` bullet) that is disjoint
  from the commit still rejects, and segment-anchored suffix matching (#424/#425)
  is unchanged.
- Spec landed for #625 (`.docs/{track,complexity,stories,conflicts,plans,intake}/rekick-resume-republish-stale-worktree-engine.md` + `.docs/architecture/2026-07-13-rekick-resume-republish-review.md`): on a self-host re-kick resume, after `resumeRebaseFirst`'s rebase replays commits touching `src/conductor`, the worktree engine will be republished (reusing the existing content-addressed `npm run build` → `publish-engine.mjs`) BEFORE `conductor.run()` runs the gate — closing the worktree-engine variant of the stale-engine class (sibling of #598) where setup builds the `dist` from pre-rebase source and the rebase then delivers the fix into source only, so the gate mis-parses the plan (`▶ build 0/0`) and halts on the already-fixed defect. A failed republish will fail closed (HALT, worktree kept), never gate on the stale `dist`. Implementation tracked separately; this entry documents the queued fix.
- Updated `resolved-config.test.ts` expectations for `explore`/`prd` reasoning effort (`xhigh` → `medium`), which had drifted from #607's re-scope of those defaults on cost-per-outcome grounds — restores CI green on `main` (2 failing tests fixed). No production defaults changed.
- Daemon's halt-PR reconciliation sweep (`runDaemonMode` in `src/daemon-cli.ts`)
  now owns a single `PrSweepOutcome` cache for the lifetime of each daemon run
  and passes it into every startup + idle-poll `reconcileHaltPrs` call, instead
  of calling with no cache. `reconcileHaltPrs` already gated its per-PR and
  summary log lines on cache state deltas; without the cache wired in,
  production sweeps recomputed a fresh cache every tick and re-logged the full
  baseline every time. Idle steady-state ticks are now silent for unchanged
  conforming PRs, reducing daemon log volume (#521).
- Daemon build-completion gate no longer false-parks a fully-completed build as
  "empty/missing plan" when the plan's task headings use the bare `### T<N> —
  Title` shorthand (no "Task" word, ids starting at `T0`) — the form used by
  the real `2026-07-12-rtk-hook-preservation` plan that fired this live: the
  presence-check gate (`checkStepCompletion` in `src/engine/artifacts.ts`) and
  `parsePlanTaskPaths`/`parsePlanTasks` (`src/engine/autoheal.ts`) now accept a
  `T<digits>` header as an alias for `Task <id>`, alongside the existing
  colon/em-dash/en-dash forms, so `T<N>` plans parse their task ids, evidence
  is stamped, and the build passes the gate instead of auto-parking
  (ai-conductor#578).
- Corrected a Fable-pricing doc error and re-reviewed model selection on the
  right economics. Fable 5 is the **premium** tier ($10/$50 per 1M — ~2x Opus
  4.8's $5/$25, 3-5x Sonnet), not "cheaper generation" as the `explore`, `prd`,
  and `engineer` rationales claimed. Rewrote those rationales (source of truth:
  `model-table-metadata.ts`) to justify each pick on cost-per-outcome (price ×
  tokens-at-effort) rather than a false per-token price advantage, and dropped
  two front-of-funnel Fable steps off max depth so they stop paying the premium
  at high token counts: `explore` effort `xhigh`→`medium` (divergent discovery,
  localized mistake cost, 5-retry budget — conservative setting per operator
  decision, vs the more aggressive low-effort thesis) and `prd` effort
  `xhigh`→`medium`
  (its own rationale prioritises speed over depth). Both keep Fable but embody
  the operator directive that a premium model at low effort can beat a cheaper
  model at high effort on cost *and* outcome. `engineer` stays on Fable
  (operator-driven interactive quality) with its inverted "without the cost of
  opus" rationale corrected to name the choice as capability/preference, not
  cost. Opus-tier assignments (`build_review`, `prd_audit`, `attribution_verify`,
  code-review, cto-security/architecture) are reaffirmed: Opus is now the
  value-premium tier at half Fable's price, and these are deep adversarial full-
  artifact roles that genuinely need sustained high reasoning. Fable's other
  capability-justified steps (`rebase`, `remediate`, `architecture_review`,
  `conflict_check` L, `plan` L, `debugging`) are unchanged. No model *tier*
  moved, so SKILL.md `model:` pins are untouched; regenerated the HARNESS.md
  table via `bin/generate-model-table`. No config-schema, hook, symlink, or
  `bin/conduct` CLI change — no migration block required.
- Fixed a regression of the above #578 fix (#620): the widened task-header
  id grammar (`Task\s+[A-Za-z0-9._-]+` / `T\d[A-Za-z0-9._-]*`) matched any
  word as an id, so structural headings like `## Task Graph` and `## Task
  Dependency Graph` — present in many committed plans — parsed as a
  phantom task (e.g. id `Graph`) that can never be completed, making a
  fully-completed build's completion gate permanently unsatisfiable
  (`N/N+1 tasks pending`). Tightened the presence-check gate
  (`src/engine/artifacts.ts`) and `parsePlanTaskPaths`
  (`src/engine/autoheal.ts`): a pure-alpha id now requires an explicit
  colon/em-dash/en-dash separator immediately after it; only an id
  containing a digit (`Task 2`, `Task t1`, `T0`) may stand bare at
  end-of-line. `parsePlanTasks` already required a separator and was
  unaffected. All legitimate shapes keep parsing: `### Task 3 — Title`,
  `### T0 — Title`, `### Task rem-adr-001: x`, `### Task A8: x`, and
  title-less bare headers (`### Task 2`, `### Task t1`, `### T3`);
  prose/structural headings (`## Task Graph`, `## Task Dependency Graph`,
  `## Task Breakdown`, `## Tasks`, `### Testing`, `### Team sync`) never
  parse as tasks.

### Changed

- Bumped the default model for the `build` (pipeline) engine step from `haiku`
  to `sonnet`. The build step launches the implementation session that authors
  code through the TDD RED/DOMAIN/GREEN cycle — it is the real coding lane, not
  a thin dispatcher, and Haiku stalled on real coding tasks (e.g. a multi-file
  in-cycle rescue-wiring test). Genuinely mechanical steps stay on Haiku for
  cost (`memory`, `worktree`, `finish`, `conduct`). Regenerated the HARNESS.md
  model-selection table to match (`bin/generate-model-table`). No config-schema,
  hook, symlink, or `bin/conduct` CLI change, so no migration block is required.

### Added

- Semantic attribution verification lane at the build evidence gate
  (`conduct-ts` only, opt-in via `attribution_judge_cutover`): an engine-embedded
  opus/high judge validates unresolved task residue by analyzing candidate
  commit diffs and scoped test evidence, with the ENGINE (not the judge)
  mechanically verifying every citation before stamping — no-whitewash by
  construction. Configured via two new inert-when-absent config keys,
  `attribution_judge_cutover` (ISO-8601 cutover instant) and
  `attribution_audit_sample_pct` (0-100 spot-audit sampling, default 10).
  See `src/conductor/README.md` → "Semantic attribution verification lane".
- `conduct-ts evidence judge <slug> [--dry-run]` CLI: manually resolve a
  feature slug to its worktree and run the judge lane by hand, outside the
  daemon's automatic dispatch. Refuses to run while a build step is active;
  `--dry-run` reports would-be stamps without writing the evidence sidecar.
  Fully resolving all residue drops a stale `.pipeline/HALT` marker and
  writes `.pipeline/REKICK`, so a manually-judged feature is picked back up
  by the daemon on the next poll.
- Accuracy ledger (`.daemon/attribution-accuracy.jsonl`): append-only,
  concurrent-safe JSONL record of spot-audit outcomes (agreement between the
  judge's live verdict and the sampled re-audit), for measuring judge
  accuracy over time without feeding back into gate decisions.

### Changed

- HARNESS.md Communication Protocol (BUILD Phase, orchestrator rules): strengthened
  the non-narration discipline with two explicit rules — keep the work area concise
  (emit only status lines and errors, no running commentary), and do not explain what
  is happening unless it is visible to the operator or actually useful to them (no
  play-by-play of internal steps).
- Armed `attribution_enforcement_cutover` (2026-07-11T08:30Z) in the committed
  project config: daemon builds now enforce inline-work attribution
  fail-closed (#505 machinery live, not just loaded). Canary evidence: with
  hooks stamping but enforcement unarmed, 4 of 5 canary commits auto-carried
  trailers and the one inline refactor escaped — the class this arming ends.


### Fixed

- **Spec: mechanical `Evidence: satisfied-by <sha>` citations validated for
  provenance, not just object existence (#533).** The build evidence gate's
  mechanical lane (`deriveCompletionInternal` in
  `src/conductor/src/engine/autoheal.ts`) previously stamped a task complete
  whenever the cited sha merely existed in the git object database
  (`git rev-parse --verify`), so an empty commit citing a dangling pre-rebase
  object — not an ancestor of HEAD, with an unrelated diff — could forge
  completion (observed on the #520 build, task 24). This lands the DECIDE-phase
  spec (`.docs/{track,complexity,stories,conflicts,plans}/satisfied-by-forged-citation-validation.md`)
  to extend the judged lane's already-approved citation-validation rule
  (reachability → ancestry → non-empty → declared-Files overlap) to the
  mechanical `satisfied-by` form. Deterministic, git-derived; no operator-marker
  escape hatch introduced. Implementation follows in a separate build PR.
- **`getEvidenceRange` logged a spurious `anchor  is unreachable` warning for
  absent/whitespace-only evidence anchors (#510).** The gate/engine no-anchor
  form of `deriveCompletion(root, planPath)` — used by `conductor.ts`,
  `artifacts.ts`, and `evidence-cli.ts` — previously routed the empty anchor
  through the same reachability probe as a real, unreachable anchor,
  producing a misleading "unreachable" warning on every ordinary gate
  evaluation. An absent anchor now skips the reachability probe entirely and
  emits a distinct `console.info` "no recorded anchor" line instead; fallback
  merge-base-ladder results are unchanged. Verified end-to-end against the
  production `deriveCompletion` entry point (not just the `getEvidenceRange`
  unit seam).

- **Finish/pr skills' staleness-proof fallback never matched git's actual reflog wording
  (#587).** `skills/finish/SKILL.md` and `skills/pr/SKILL.md` both ran `git reflog | grep
  "rebase: finish"` as the fallback proof that a force-with-lease push after the daemon's
  finish-time rebase is safe, but git writes `rebase (finish): returning to
  refs/heads/<branch>` (parenthesized, no colon after "rebase") — the literal never matched.
  On any branch where the merge-base ancestry fast path also failed (e.g. a twice-rebased
  branch), both staleness proofs failed even though the remote was provably just the
  pre-rebase snapshot, so finish halted believing foreign commits existed. Corrected both
  skills' fallback to `grep -E "rebase \(finish\)"`, matching git's real wording, with a
  regression test (`src/conductor/test/finish-staleness-grep.test.ts`) that pins the
  corrected pattern against a real `git rebase` reflog capture.

- **Tmux daemon-session leak guard: permanent-baseline blindspot (~400-session
  incident).** `reapLeakedDaemonSessions` only ever inspected `cc-daemon-*`
  sessions absent from the suite-start baseline — correct for distinguishing
  "new this run" from the operator's real daemon, but `vitest`'s
  `globalTeardown` only fires on a normal process exit (never on SIGKILL, an
  external `timeout`-style SIGTERM, or a crashed/OOM-killed worker). Any test
  session leaked by an interrupted run survived into the *next* run's
  baseline snapshot, at which point it was permanently invisible to the
  diff-based reaper — repeat across enough interrupted runs and leaked
  sessions accumulate without bound (this is how ~400 stale sessions piled up
  and wedged a live production daemon). Added `sweepStaleDaemonSessions`
  (`src/conductor/test/tmux-leak-guard.ts`): an unconditional pre-run sweep,
  run before the baseline is taken, that kills any `cc-daemon-*` session whose
  pane cwd is tmpdir-rooted regardless of baseline membership — tmpdir-rooted
  cwd alone is sufficient proof of "test leak" since a real per-repo daemon's
  cwd is always a real checkout, never `os.tmpdir()`, so `cc-daemon-<repo>-*`
  and other real sessions (`engineer-*`, `halt-monitor`) are never touched.
  Also adds a best-effort SIGINT/SIGTERM reap-on-interrupt handler in
  `test/global-setup.ts` (can't catch SIGKILL; the next run's pre-run sweep
  is the backstop for that). The existing post-run diff-based reap and its
  fail-loud teardown assertion are unchanged.
- **Attribution abstain-or-loud hardening (#519, #501).** Pre-dispatch bookkeeping
  failures now abstain loudly (with stderr diagnostics named to stderr) instead of
  silently leaving a stale `current-task` that misattributes every later commit.
  Three improvements: (1) pre-dispatch script abandons its four silent `process.exit(0)`
  paths (status file unreadable, parse failure, wrong shape, temp-write failure) in favor
  of best-effort cleanup + diagnostic + exit 0; (2) `prepare-commit-msg` no longer falls
  back to scanning `task-status.json` for a unique `in_progress` row (uses single source
  of truth `.pipeline/current-task` or abstains); (3) `commit-msg` validates `Task:`
  trailers against real seeded task ids from the array rows instead of array indices,
  tolerating numeric-string id mismatch (#501).
- Rekick resume no longer dispatches steps past an unsatisfied on-disk gate
  verdict — the resume entry clamps backward to the earliest unsatisfied
  loop-region gate (#532).
- `session-hooks-provisioning` integration test parses hook command strings
  as `path [argv…]` instead of stat-ing the whole string — the mutation
  gate's surface flag (`mutation-gate.sh write|bash`) broke the raw-path
  assumption and failed CI on every run since the #509 merge.
- **Evidence stamp sync** (#526): `.pipeline/task-status.json` rows are now reconciled from `.pipeline/task-evidence.json` stamps. A stamped but `in_progress` row advances to `completed` immediately on stamp write or derived-completion pass. Orphan stamps (no matching row) emit a warning and never invent rows.
- Daemon build-completion gate no longer false-parks a fully-completed build as 'empty/missing plan' when the plan's task headings use the `### Task N — Title` em-dash form: `parsePlanTaskPaths` now accepts an em-dash/en-dash title separator as a task-id terminator (previously only a colon or end-of-line), so em-dash plans parse their task ids, evidence is stamped, and the build passes the gate (ai-conductor#578).


### Changed

- Skill checklist accuracy sweep: verification checklists across six skills
  now enforce what the engine's gates actually check. `pipeline` gains line-1
  dispatch-marker and never-hand-write-completed items; `tdd` corrects the
  stale full-suite-per-commit item to the scoped-verify reality and adds
  trailer verification; `finish` gains finish-record (choice + PR URL),
  halt-PR rehabilitation (title/label/draft), and push-evidence items;
  `manual-test` gains the `.pipeline/manual-test-results.md` recording
  contract; `engineer` gains the push-spec-branch-before-handoff guard;
  `writing-system-tests` gains a previously-missing Verify section covering
  the executed-RED evidence contract.


### Changed

- `/architecture-review --as-built` now performs a **production reachability
  sweep**: every primitive the feature's diff introduces (exports, hook
  scripts, config keys, ADR-promised events/log lines) must cite one
  production caller (`file:line`) from a real entry point. No caller ⇒
  BLOCKED as an "unreachable rung" (green-but-unwired guard, #462 stopgap);
  the skill text itself is deterministic/self-contained (no issue-number
  references) and the verification checklist enforces the sweep per run;
  statically-reachable-but-unobserved behavior is recorded as `UNEXERCISED`
  with its observation signature for the close-on-observation flow (#492).
  Skill-level enforcement now; engine machinery remains #462's follow-up.


### Added

- **Semantic attribution verification lane at the build evidence gate (#520).** The
  build gate now runs an engine-embedded judge lane to validate provenance proxies
  when the deterministic evidence (commit trailers, path corroboration) leaves tasks
  unresolved. The lane is controlled by project config `attribution_judge_cutover`
  (absent/future = off, default; past ISO-8601 instant = on) and operates on three
  principles: (1) **trigger** — runs when unresolved tasks remain AND enforcement is
  active AND the residue state is new (memoized by HEAD sha + residue ids; unchanged
  residue never re-dispatches); (2) **judge dispatch** — fresh UUID session, opus/high,
  input-starved (residue task definitions + candidate commits + scoped tests; no maker
  transcript or prior verdicts); (3) **validation** — the engine mechanically validates
  every cited SHA (reachable from HEAD, not empty, not bookkeeping) and overlaps with
  task-declared paths before stamping. Verdicts are written as `semantic-verified`
  evidence stamps (adr-2026-07-11-attribution-verdict-interface), optionally sampled
  via `attribution_audit_sample_pct` (0-100, default 10) for separate spot-audit
  measurement (adr-2026-07-11-attribution-spot-audit-measurement). Unsatisfied
  verdicts feed into `pendingRetryHints` (the next build try names exactly the missing
  tasks). See `adr-2026-07-11-semantic-attribution-verification-lane.md`, README.md,
  and `src/conductor/README.md`.

- **Attribution enforcement gate surfaces (commit-msg + mutation gate) for inline
  build-work attribution (#505).** Two engine-owned hook surfaces, gated behind
  project config `attribution_enforcement_cutover` (absent/future = off, default;
  past ISO-8601 instant = on; read once at engine start, so a config edit requires
  a restart to take effect): the **commit-msg gate** rejects a build-step commit
  lacking a `Task:` trailer while `.pipeline/build-step-active` is present, and the
  **session mutation gate** (`PreToolUse`, matcher `Edit|Write|NotebookEdit|Bash`)
  blocks a direct file mutation or `git commit` invocation made outside a stamped
  subagent dispatch while a build step is active. Both gates share three
  abstention/exemption surfaces — merge commits, amend of a pre-enforcement commit,
  and an empty commit carrying a resolvable `Evidence: satisfied-by <sha>` trailer —
  and fail open on an unparseable hook payload. Documented in the main README and
  `src/conductor/README.md` (§ Attribution enforcement) and `skills/pipeline/SKILL.md`
  (§ Attribution enforcement (engine gate surfaces)) as engine machinery, not a new
  orchestrator rule. See `adr-2026-07-10-inline-work-attribution-enforcement.md`.

- **New `/intake` skill — assisted authoring of intake issues (#490 companion).**
  Guides filing GitHub intake issues in the WHAT/OUTCOMES shape the intake
  convention requires: gather verbatim evidence first (exact commands + output,
  log excerpts with sources, `file:line`/SHA/PR references, repro steps,
  frequency data) while context is warm, state Impact honestly, write Desired
  outcomes as observable acceptance signals (litmus: verifiable without knowing
  the implementation), and quarantine every HOW into an explicitly-labeled
  Hypotheses section. Includes a pre-file GATE checklist (verbatim artifact
  present, outcomes observable, no HOW leakage, claims calibrated per
  verify-claims), symptom-not-solution title guidance, and filing mechanics
  (`gh issue create --assignee @me` so the engineer's intake poll captures the
  issue; exact `priority: <band>` label vocabulary with the REST fallback for
  label edits). Registered in the HARNESS.md model-selection table
  (`inherits caller` — authoring runs in whatever session observed the problem).
  Cross-linked from the intake-convention rule in HARNESS.md (agents filing via
  `gh issue create` are pointed at `/intake`) and from `/engineer`'s capture
  step (queue consumption vs. filing on the operator's behalf).

- **Engine-invoked task start/done stamping at subagent dispatch (#477).** The
  conductor now installs a Claude-session `PreToolUse`/`PostToolUse` hook pair
  (`pre-dispatch.sh`, `post-dispatch.sh`) into every feature worktree's
  `.pipeline/session-hooks/`, wired via that worktree's untracked
  `.claude/settings.local.json` with matcher `Task|Agent`. The `PreToolUse`
  hook parses **line 1 only** of the dispatched subagent prompt against the
  exact grammar `Task: <id>` | `Task: none`: a valid id flips that task's row
  to `in_progress` in `.pipeline/task-status.json` and writes
  `.pipeline/current-task` (atomic temp-file + rename); an existing stamp for
  a different id is removed (overlap guard); `Task: none` is a no-op
  pass-through. Unparseable payloads are **fail-open** (exit 0, no state
  change — abstain per #452); a parsed-but-invalid marker (unknown id,
  missing/malformed line-1 marker, e.g. `Task:7`, `task: 7`, or two ids on
  one line) is **fail-closed** (exit 2, blocks dispatch, stderr names the
  problem). The `PostToolUse` hook removes a matching stamp on subagent
  return and never writes `completed` — completion still flows through the
  evidence gate (#456/#463). This replaces prompt-discipline stamping with
  engine-mechanical stamping at the moment a subagent is actually dispatched,
  independent of whether the dispatching agent remembers to run
  `conduct-ts task start|done`. Hook scripts are embedded engine assets
  (`src/conductor/src/engine/session-hook-assets.ts`, mirroring
  `git-hook-assets.ts`), provisioned by `prepareWorktree`
  (`worktree-prepare.ts`) alongside the existing git-hook wiring; the
  provisioning merge preserves any unrelated `settings.local.json` keys and
  backs up a corrupt file rather than discarding it. All dispatch templates
  (`pipeline`, `code-review`, `simplify`, micro-retro, memory-checkpoint) now
  carry the line-1 `Task: <id>` / `Task: none` contract explicitly. See
  `README.md` and `src/conductor/README.md`.
- **Intake convention: issues state WHAT and desired outcomes; DECIDE owns HOW.** New intake issue form (`.github/ISSUE_TEMPLATE/intake.yml`) replaces open-ended problem statements with a structured shape: `Observed` (evidence), `Impact` (stakeholders/frequency), `Desired outcome` (observable behavior post-fix), and optional `Hypotheses` (filer's guesses about solutions). HARNESS.md now specifies the intake convention as a load-bearing rule (§Intake Artifacts Separate WHAT from HOW): intake issues capture *problem + desired state*, never solution design; the `engineer`/`explore` skills own the DECIDE phase (alternative approaches, track decision, architecture). On intake capture, `engineer` reframes embedded solution content as a hypothesis candidate (explicitly marked "not the chosen approach"), passed to `/explore` for divergence analysis. `explore`'s **Embedded Design Divergence Rule** (SKILL.md) ensures hypotheses enter as candidates (not privileged), at least one genuine alternative is generated, but the hypothesis can still win on merits. New test: `test_harness_integrity.sh` now validates issue-template YAML well-formedness and enforces the `blank_issues_enabled` guard. Updates: `README.md` documents the intake shape and routing flow; `skills/engineer/SKILL.md` documents hypothesis reframing (§Hypothesis reframing for embedded solution content); `skills/explore/SKILL.md` documents the divergence rule (§Embedded Design Divergence Rule). Refs issue #490.
- Intra-step build progress and stall events on the conductor event bus
  (`conduct-ts` only): `build_progress` (change-driven heartbeat: resolved/total
  tasks, current task, commit count, no-evidence attempts), `build_no_progress`
  (quiet-episode warning after `quiet_minutes` with no task-status change), and
  `build_stall` (terminal no-progress signal). Emitted by a new
  `BuildProgressWatcher` polling `.pipeline/task-status.json`/git `HEAD` during
  the `build` step, with a leak-safe start/stop lifecycle. Rendered by
  daemon.log, the TTY dashboard, the OTel exporter (as span events), and
  persisted to `.pipeline/events.jsonl`. Configurable via an optional
  `build_progress:` block (`poll_seconds`, `quiet_minutes`,
  `heartbeat_minutes`, `enabled`; all default-populated, `enabled: false` as a
  full escape hatch). See `README.md` and `src/conductor/README.md`.
- `priority: critical` backlog band, above `high`: reserved for fixes to
  things that completely break or cause very severe degradation. The daemon
  dispatches critical-labeled work first among issue-linked items (unlinked
  `no-issue` items still lead, unchanged). Parser accepts the exact label
  `priority: critical`; band ladder is now no-issue → critical → high →
  medium → low → unlabeled. READMEs document the new vocabulary.
- `daemon park` now echoes the absolute marker path to stdout on successful
  park, aiding operator scripting and audit trails (#486).
- `reconcileStrandedParkMarkers()` function heals pre-#486 park markers left
  in worktrees by moving them to the main repository root, enabling seamless
  transition when the fix is deployed (#486).

### Added

- **Finish-step order-gated in-step presentation repair (#499, ADR D1).** The finish gate's
  presentation branch now relocates its repair operations (`rehabilitateHaltPr`) from the
  daemon post-run tail into the step itself, invoked by the engine exactly once per
  completion evaluation, **order-gated**: non-presentation conditions (valid `finish-choice`,
  recorded `pr_url`, push evidence) are verified first; only when all hold does the engine
  run the repair before evaluating presentation conditions (title, draft status). Consequences:
  a finishing attempt that fails on recording or push evidence never clears the
  `needs-remediation` label/body/draft state (redispatch and reconciliation signals stay
  live); first-try ship is preserved; the daemon-cli post-run tail is removed (single
  invocation site). See `adr-2026-07-11-finish-step-engine-completion-machinery.md`.
- **Finish-gate `isDraft` ship-readiness check (#439).** The finish predicate now reads
  `gh pr view` with `isDraft` and fails ship-readiness while the recorded PR is draft —
  a guard against #439's false-draft-ship class. The check is **fail-open on gh errors**
  (presentation is not worth blocking a ship); draft removal is handled by the D1 repair
  and the D2 retitle-floor (via `ensureShipReady` in the order-gated repair).
- **Deterministic retitle-floor for stale needs-remediation titles (ADR D2).** When the
  finish gate's repair evaluates the recorded PR's title and finds it still starts with
  `needs-remediation:`, the engine rewrites it to a functional floor: `feat: <feature_desc>`
  (fallback: branch name). The skill's `/pr` prose rewrite runs earlier and is the quality
  path; the floor only fires when the agent dropped the rewrite (prefix-gated), with any
  later `/pr` pass able to improve it. Engine-authored prose stays rejected.
- **Surgical finish-record retry (ADR D4).** When a completion miss is recording-only
  (`finish-choice` absent/stale or `pr_url` missing) AND every other gate condition already
  holds, the engine's retry dispatches a narrow prompt naming exactly the one
  `conduct-ts finish-record` command with the computed absolute `--pipeline-dir`, not the
  full ~10-minute finish skill re-walk. Retry budget still applies; refusal semantics of
  adr-2026-07-07 remain intact.
- **Injectable `GhRunner` seam in finish gate (#368).** The finish predicate's presentation
  branch now takes an injected `GhRunner` (ctx-provided, defaulting to production at
  composition root) replacing the hardcoded `makeProductionGh()`, making the branch
  unit-testable with the established `fakeGh` pattern and closing the #368 test gap. Wired
  via `Conductor.completionCtx()` → `CompletionContext.gh`.

### Changed

- **`finish/SKILL.md` and `pr/SKILL.md` now document engine behavior, not agent
  instructions (#499, ADR D5).** Presentation items (undraft, unlabel, `Closes` injection,
  draft flip) are rewritten as documentation of what the engine does (D1 in-step repair,
  D2 retitle-floor, `ensureShipReady`), resolving the prior `finish/SKILL.md:373` vs
  `pr/SKILL.md:220-223` contradiction in the engine's favor. The prose title/body rewrite
  instruction remains an agent instruction (with the D2 floor as backstop). The
  `finish-record` exit contract stays an agent instruction (adr-2026-07-07).
- **Daemon-cli post-run tail rehabilitation removed (#499).** `daemon-cli.ts:784-800`'s
  post-`conductor.run()` call to `rehabilitateHaltPr` is removed (D1 moves the call
  in-step). Single invocation site for repair ensures no dual-path drift; the tail now
  only handles the done-outcome validation logic.

### Fixed

- **#368 Injectable GhRunner seam for finish-gate presentation tests.** The finish gate's
  hardcoded `makeProductionGh()` is replaced with an injectable `GhRunner`, enabling
  zero-real-gh unit tests of the title and draft checks (the prior test gap on the
  `readStaleHaltTitle` and `isDraft` paths).
- **#439 Fail ship-readiness check while recorded PR is draft.** The finish gate now reads
  `isDraft` from `gh pr view` and rejects ship-readiness if the recorded PR is still
  draft; combined with the D1 repair's `ensureShipReady` call, this prevents false-draft
  ships.

### Migration

**Attribution judgment and audit config keys (schema change for new judge lane).**

The semantic attribution verification lane requires two new optional config keys
in `.ai-conductor/config.yml`:

```yaml
# Semantic attribution judgment gate cutover: ISO-8601 instant
# Absent or future → judge lane disabled (default, inert behavior)
# Past instant → judge lane enabled for residue evaluation
# Requires daemon/conductor restart to take effect
attribution_judge_cutover: "2026-07-11T08:30:00Z"

# Spot-audit sampling percentage: integer [0, 100]
# Default: 10 (when absent, audit sampled at 10%)
# Only used when attribution_judge_cutover is active
# Clamped to [0, 100] with a startup warning if out of range
attribution_audit_sample_pct: 10
```

**Consumer action:** neither key is required. If you do not configure them,
the judge lane remains inactive and all builds proceed with deterministic
evidence only (current behavior). To enable semantic verification:

```bash migration
# Edit your project config to add the cutover instant:
cd .ai-conductor
# Add attribution_judge_cutover and optionally attribution_audit_sample_pct
# to config.yml, then restart the daemon or conductor:
conduct-ts daemon restart
```

Both keys follow the safe-by-default principle: absent = inert, no retroactive
behavior change.

**Session-hook wiring for #477 (hook wiring is a canonical breaking surface).**

Feature worktrees provisioned by an older engine build have the old hook wiring
(git-hook attribution only, no `PreToolUse`/`PostToolUse` session hooks). That
stale wiring does not break anything — the worktree keeps building normally —
but subagent dispatch inside it will not get engine-mechanical task start/done
stamping until the worktree is re-provisioned by a build using this version.

No manual consumer action is required beyond re-running `bin/install` (which
refreshes the engine build the daemon dispatches from). To pick up the new
session hooks immediately in any worktree already in flight, prune stale
worktrees so the next provisioning pass re-installs the hooks fresh:

```bash migration
# Optional: force old worktrees to re-provision the new session hooks now,
# instead of waiting for their natural lifecycle to recycle them.
cd src/conductor && npm run build   # or: bin/install, to refresh the engine build
git worktree list | awk '/\.worktrees\// {print $1}' | while read -r wt; do
  git worktree remove --force "$wt" 2>/dev/null || true
done
git worktree prune
# The daemon re-provisions worktrees on its next dispatch, installing the new
# .pipeline/session-hooks/{pre,post}-dispatch.sh and wiring
# .claude/settings.local.json automatically. No further action needed.
```

**New `/intake` skill (skill symlink targets is a canonical breaking surface).**

`skills/intake/` is a new skill directory; installed harness consumers need
their skill symlinks refreshed or `/intake` resolves as an unknown command:

```bash migration
# Link the new intake skill into ~/.claude/skills.
./bin/install
```

### Changed

- `conduct-ts engineer claim` now serves pending ideas by priority band
  (critical first) before capturedAt FIFO, reading labels at claim time and
  failing open to FIFO on gh outages (#461).

### Fixed

- tmux-leak-guard fails closed — a failed suite-start snapshot disables
  reaping and every kill requires a tmpdir-rooted pane cwd (#437).

- `bin/install` never hard-fails on missing dependencies. Every optional phase
  (permissions/hooks configuration, dependency bootstrap, conductor config,
  viewer/renderer selection) is now failure-isolated — a missing python3, npm,
  brew, curl, or viewer tool degrades to a warning instead of aborting the
  whole install under `set -e`. python3-dependent phases preflight and skip
  with an actionable message; `configure_conductor` no longer reports a false
  "Created/Refreshed" when python3 is absent; core symlink steps warn-and-
  continue per item. Verified: full install exits 0 with warnings only on a
  PATH containing nothing but coreutils. The two intentional fatal guards
  (missing skills directory, worktree-root refusal #363) are unchanged.
- `bin/install` now offers to install `uv` (Serena's installer) when it's
  missing, via a platform-agnostic ladder: brew when present, else the
  official installer (`astral.sh/uv/install.sh` → `~/.local/bin`) via curl or
  wget, picking up `~/.local/bin` on PATH for the same run. Interactive-only
  (non-tty runs keep the previous skip-with-warning), and every rung is
  best-effort — a failed uv install degrades to the manual-install warning.
- Evidence-range no-anchor derivation now anchors at branch base, not repo
  genesis: `getEvidenceRange` walks a 4-rung ladder (reachable explicit
  anchor → `merge-base --fork-point origin/<default> HEAD` → plain
  `merge-base origin/<default> HEAD` → fail-closed zero commits + anomaly)
  instead of falling back to `root-commit..HEAD` or a hardcoded `origin/main`
- Park markers now anchor to the main repository root instead of relative to
  worktree cwd, fixing #486 regression where auto-park markers written from
  build agents in worktrees were invisible to the daemon's sweep gate.
  `daemon park` and `daemon unpark` from any directory (including worktree cwd)
  now correctly resolve to the main root, and worktree-written auto-park
  markers are automatically reconciled at sweep start.
- `daemon unpark` now resets the no-evidence counter in the feature's worktree
  (if present) when unparking an auto-parked feature, enabling normal re-kick
  flow on resume (#486).
  (#456).
- Build gate now accepts evidence stamps only; first-seed grandfather
  stamping retired. `engine/artifacts.ts`'s H6/H7/H8 completion check no
  longer consults the legacy `migrationGrandfather` field — a task counts as
  done only when it has a real `evidenceStamps` entry re-derived from git on
  every gate pass. `task-seed.ts` no longer writes new grandfather entries
  (#463).

### Added

- **Deterministic task attribution automation via `conduct-ts task` CLI and worktree-scoped git hooks.** The
  pipeline now automates task progress tracking via CLI subcommands owned by the conductor engine, not prompt
  discipline. Two new subcommands: `conduct-ts task start <id>` (flip status to in_progress before dispatching
  a subagent), `conduct-ts task done <id>` (mark task completed after subagent commit lands). Both are
  idempotent and fail-open (never block the build on status-file corruption). Wired into the pipeline
  orchestration step 0 (DISPATCH phase).
- **Engine-provisioned worktree-scoped git hooks for task attribution.** When the daemon provisions a feature
  worktree, the conductor writes two deterministic attribution hooks (`prepare-commit-msg`, `commit-msg`) to
  `.pipeline/git-hooks/` and wires them via `git config --worktree core.hooksPath` scoped to that worktree
  only. The `prepare-commit-msg` hook auto-injects the `Task: <id>` trailer from `.pipeline/current-task`
  into every commit (amends malformed trailers). The `commit-msg` hook validates the trailer format. Both
  hooks are fail-open (provisioning skips gracefully on errors, build never halts). Host checkout and
  other worktrees are unaffected; if the repository has its own hooks, both run (engine's hooks first,
  exit codes propagate for chaining). Hook scripts are embedded as engine assets, written fresh to each
  worktree, and kept in sync with the engine version. The completion gate derives task completion from
  git trailers, proving code commits are load-bearing (no stray empty-commit trailers).
- Documentation added to README.md and src/conductor/README.md explaining task CLI and hook wiring
  behavior (fail-open design, chaining with repo hooks, worktree-scoped wiring).

### Changed

- **Pipeline SKILL step 0 (DISPATCH) now uses `conduct-ts task start|done` for task progress tracking.**
  The orchestrator no longer hand-edits `.pipeline/task-status.json` or relies on the subagent to inject
  the task trailer via prompt discipline. The conductor runs `conduct-ts task start <id>` before dispatching
  the subagent and `conduct-ts task done <id>` after the commit lands, ensuring deterministic and
  repeatable task attribution independent of subagent behavior. See skills/pipeline/SKILL.md §Per-Task
  Execution, steps 0 and 6.

### Fixed

- Mid-run merged-PR guard (#358): when the daemon's kickback rewind discovers the feature's
  recorded PR has been merged out-of-band (operator manual merge during a retry cycle), the daemon
  stops the run at the earliest checkpoint (kickback re-entry, rebase entry, or rekick play-forward)
  and records a synthetic verified ship, avoiding a wasted rebuild/audit cycle and spurious
  rebase conflicts. Guard invoked at three sites: kickback routes, rebase entry, and rekick
  play-forward.
- Tests no longer park child processes on undrained stdio pipes.
  `daemon-stale-respawn-e2e` spawned real daemons with `stdio: ['ignore',
  'pipe', 'pipe']` and never read either stream, so a chatty daemon wedged
  mid-write once the 64KB pipe buffer filled while `isProcessAlive` checks
  still passed — the four spawn sites now use `'ignore'`.
  `memory-store-concurrency` drained stderr but not stdout of its vite-node
  children; stdout is now explicitly discarded with `resume()`.
- Stories and plan gate predicates now scope to the FEATURE's own docs
  (`resolveFeatureStoriesPath`, mirroring #407's plan resolver) instead of
  validating the entire `.docs/stories`/`.docs/plans` corpus (#441). Legacy
  landed artifacts (49 story blocks predating the gate-audit-2026-06-23
  structural convention) made any kickback-selected stories gate permanently
  unsatisfiable, and cross-file numeric story-ID collisions let unrelated
  plans falsely satisfy coverage. Unresolvable scoping now fails explicitly
  and never falls back to a corpus-wide scan.
- Stale-engine initialization residuals from auto-restart work (#369):
  orphaned `initStaleEngineState` call site in `daemon-cli.ts` (#307),
  stale verdict log missing engine identities (#320, #321), and suppression
  records incorrectly storing boot identity instead of durable identity (#478).
  All three are now wired correctly: `initStaleEngineState` called once at
  daemon startup with its result used by the stale-engine checker,
  identities consistently captured and logged, and suppression records identity
  properly to allow cache invalidation on identity changes.

### Added

- `ci_watch` config block (default `enabled: true`): the daemon now watches each shipped PR's
  CI check rollup and drives bounded auto-remediation of red ships — up to 2 automatic fix
  attempts per PR (isolated worktree, RETRY hint from failing checks + log excerpts, guarded by
  the same acceptance guards/suite gate/lease-push discipline as `mergeable_autoresolve`), a
  non-sticky `ci-failed` label while checks are red, and escalation to a sticky
  `needs-remediation` label + PR comment + HALT-grade `ci_failed` event once attempts are
  exhausted. Documented in README.md and `src/conductor/README.md` (Task 25).
- Structural fixture-portability guard extended with `unref` and
  `tmp-outside-target-dir` matchers (with falsifiability fixtures) and armed
  over the full `src/conductor` tree; the legitimate `.unref()` call in
  `daemon-log.ts` is annotated with a `// portability-ok:` reason (Task 29).
- **Setup-failure triage — two-stage deterministic recovery (#446).** The daemon now runs a
  bounded two-stage recovery when `bin/setup` fails, eliminating the wedge pattern where a dead
  agent corrupts the worktree and leaves no mechanism to dispatch a fix-session.
  - **Stage 1: Deterministic quarantine + retry** — when setup exits nonzero, if the working tree
    has uncommitted changes, the engine preserves them to a quarantine branch
    (`wip/setup-quarantine-<slug>`) via `git add -A + commit`, then `reset --hard HEAD` to return
    to clean HEAD, and re-runs `bin/setup` exactly once (full prepare flow). All dirty state is
    committed and preserved before any reset, so a resuming agent can recover WIP deliberately via
    `git show wip/setup-quarantine-<slug>`. If setup succeeds at clean HEAD, the feature proceeds;
    if it still fails, advance to stage 2.
  - **Stage 2: Bounded fix-session** — if setup still fails at clean HEAD, dispatch exactly ONE
    fix-session with a fresh LLM session. Prompt carries the setup stderr tail (last 50 lines) and
    an explicit success contract: `bin/setup` exits 0 AND the working tree is clean (fix committed).
    The engine verifies the contract mechanically by re-running the full prepare flow — never trusts
    the agent's claim. Success ⇒ proceed to build. Failure ⇒ diagnostic HALT naming the setup error
    tail, the quarantine ref (where dirty state was preserved), and the contract verification outcome.
  - **Surfacing:** daemon log records each stage with the quarantine ref and setup stderr tail.
    `.pipeline/QUARANTINE` sentinel surfaces the ref + preserved paths to the resuming build agent.
    HALT evidence includes the error, quarantine ref, and contract outcome.
  - **Constraints:** exactly one retry (stage 1), exactly one fix-session (stage 2), all uncommitted
    state preserved before any reset (no data loss), daemon-only (no change to interactive `/conduct`
    or manual repair), zero cost to happy path (setup exit 0 ⇒ no triage).
  - **Modules:** `engine/setup-triage.ts` (triage core, dependency-injected), `worktree-prepare.ts`
    (SetupFailureError classification), `daemon-runner.ts` (wiring at prepare seam),
    `step-runners.ts` (fix-session dispatch + contract verification).
  - See `src/conductor/README.md` → "Setup-failure triage" and
    `.docs/decisions/adr-2026-07-09-setup-failure-triage.md` (APPROVED).
- CLAUDE.md "Design Principles" section codifying deterministic-first design:
  machinery (engine code, git hooks, gates) wherever possible, LLM agents only
  for steps that genuinely need judgement; repeated agent rule violations get
  fixed with enforcement at the point of violation, not stronger prompts
  (precedents: #426, #433, the H6/H7 evidence gate).

### Fixed

- Gate-writeback skip notices now log once per (slug, reason) per daemon run
  with benign will-retry wording (#379).
- Build evidence gate's path corroboration now sources each task's expected
  paths from its `**Files:**` line (#424) instead of scanning the whole task
  section for backtick tokens. Plain-text and backticked paths (`;`/`,`
  separated), template-form bullets under `**Files likely touched:**`, the
  `same` / `same as Task N` inheritance shorthand, and `none` (trailer-alone)
  all resolve correctly; stray backtick tokens in Steps prose (module-import
  strings, runtime artifact names) no longer become required corroboration
  paths that false-halt builds with correct commits. Tasks without a Files
  line keep the legacy whole-section scan (remediation-append blocks are
  unaffected).
- Build evidence gate's path corroboration no longer rejects real evidence when
  plans declare "Files likely touched" as basenames or partial paths (#425):
  commit files now match plan paths exactly OR by `/`-segment-anchored suffix
  (`push-evidence.ts` matches `src/conductor/src/engine/push-evidence.ts`;
  `trail.ts` never matches `audit-trail.ts`). One helper backs all three
  overlap sites. The plan skill now also instructs repo-relative paths.

### Fixed

- Derive diagnostics no longer flood the daemon pane (#405): the autoheal
  path-corroboration near-miss and pinned-stamp demotion-prevention notices
  now warn once per (task, commit) per daemon run instead of on every
  build-gate re-derivation, and the daemon tees engine `console.warn`/
  `console.error` lines into `.daemon/daemon.log` (tagged `[warn]`/`[error]`)
  so post-hoc forensics see what the operator saw in the pane. Verdicts and
  audit entries are unchanged — presentation/dedup only.
- Test suite can no longer leak real `cc-daemon-*` tmux daemons (#377): the
  `AI_CONDUCTOR_NO_REAL_EXEC` kill-switch now also refuses `respawn-pane`
  against `cc-daemon-*` sessions (previously only `new-session`), and a new
  suite-level teardown guard (`test/tmux-leak-guard.ts`, wired in
  `test/global-setup.ts`) diffs live sessions against the suite-start
  snapshot, kills every leaked session, and fails the run naming each one
  with its pane cwd — leaks become red builds instead of resident daemons
  idle-polling deleted /tmp fixture repos.
- Build completion gate no longer evaluates an unrelated feature's plan when
  multiple plans exist in the shared `.docs/plans/` (#407). `completionCtx` now
  resolves the plan scoped to the current feature via `resolveFeaturePlanPath`:
  engine-recorded `activePlanPath` first, then the plan named after
  `feature_desc` (the daemon convention), then a single plan file; on true
  ambiguity it passes no plan and the gate fails closed instead of upserting
  someone else's tasks into `task-status.json` and halting on every re-kick.
- Evidence gate id-grammar unification (#417) — guarded `task-N` trailer alias in derive,
  one id grammar + trailer discipline across tdd/pipeline skills, operator-gated recovery
  runbook for parked features (see `docs/runbooks/evidence-backfill-recovery.md`).

### Added

- Opt-in `build_review` judgement gate at the build → manual_test seam
  (`build_review.enabled: true` in `pipeline.yml` / `.ai-conductor/config.yml`): a
  fresh-session, input-starved Opus grader records an objective PASS/FAIL verdict
  (`.pipeline/build-review.json`) on the diff before it reaches manual test. A FAIL kicks
  back to `build` with the reasons as evidence, capped by the shared
  `MAX_KICKBACKS_PER_GATE` constant before HALTing; absent config preserves the legacy
  `build → manual_test` topology. Gating built-in once enabled (`steps.build_review.disable: true` is rejected
  by `validateConfig()`). See `src/conductor/README.md` → "Judgement gate at the build →
  manual_test seam".
- Self-host release gate (TR-10) now accepts a committed waiver as a third way
  to satisfy the migration-block check (`evaluateWaiver` in
  `src/engine/self-host/release-gate.ts`, adr-2026-07-06-migration-gate-waiver,
  fix #354): an internal-only edit to a breaking surface (e.g. `bin/conduct`,
  hook wiring) can commit `.docs/release-waivers/<plan-stem>.md` with a
  `Waives:` list of canonical surface names and a `Rationale:` instead of a
  `## Migration` block. Fail-closed throughout — a stale (not in this diff),
  malformed, or partial-coverage waiver still HALTs, and an undeterminable
  change set stays unwaivable. See CLAUDE.md's "Release & Update Gates" for
  the authoring format.
- `conduct-ts --interactive` RunMode: conversational steps open a live REPL session
  instead of headless print-mode dispatch (`step-runners.ts` respects the RunMode for
  all conversational steps).

- New `conduct-ts brain start|stop|status` verbs (`brain-supervisor-cli.ts`) host the
  GitHub-issues intake poll as a host-wide, tmux-hosted background loop — an alternative to
  cron for keeping idea capture running without a scheduled task or a live terminal. `start`
  is idempotent (no duplicate session), `stop` kills the session, `status` reports
  `running|stopped` plus the queued-issue count from the status surface below.
- `intake-loop --continuous|--once` CLI subcommand (`intake-loop-cli.ts` +
  `engine/engineer/intake/intake-loop.ts`) for background polling: `--continuous` runs the
  poll→enqueue→notify tick forever (the mode `brain start` launches under tmux); `--once`
  runs a single tick for cron/manual use. `--interval-ms <n>` is configurable (default 5
  minutes) and validated against non-finite/non-positive values, with a core-level 60s
  fallback as defense-in-depth against a zero-delay busy-loop. Never spawns `claude` or
  opens a PR — zero-token execution.
- `intake_notifier` config block (mirrors the existing `mermaid_renderer` pattern) — optional,
  best-effort push notification alongside the loop's status-file write; a push failure is
  caught and logged without blocking the tick.
- Desktop push notifications on non-empty intake ticks: when the intake loop discovers new
  issues, it fires a push notification via the existing `sendNotification` transport
  (osascript on macOS, notify-send on Linux, terminal-bell fallback). Transport failures
  are caught and logged without blocking the tick, and the status file is always written
  regardless of push success — both surfaces (durable status file + best-effort notification)
  work together to surface new captured ideas to the operator.
- Status surface durably tracks notified issues: `<engineer-dir>/intake-status.json`
  (`count`, `sourceRefs`, `timestamp`, `message`) is only rewritten when a tick finds new
  issues, and the notifier's de-dup set prevents re-notifying the same `sourceRef` across
  loop restarts.
- Launcher defers to the brain loop when live: `engine/engineer/brain-liveness.ts`'s
  `brainLoopAlive()` (tmux session or pidfile check) causes the interactive
  `conduct-ts engineer` launcher to skip its own `prePoll` step, enforcing a single writer
  on the intake ledger/inbox when the background loop is already running.
- `bin/install --allow-worktree-root` — explicit override for the new worktree-root guard.
  The flag is stripped before mode dispatch, so it combines with any mode (e.g.
  `--update --allow-worktree-root`) and is accepted but inert on a non-worktree checkout.
  Documented in `bin/install --help`, README, and covered by the new real-binary smoke
  `test/test_install_worktree_guard.sh`.
- Owner-gate write-back now also announces on the originating GitHub issue: when a gated
  spec's committed intake marker carries `Source-Ref: owner/repo#N`, `announceGatedIssue`
  (src/conductor/src/engine/gate-writeback.ts) applies the `owner-gated` label and upserts
  the same marker comment on that issue, using the shared `parseSourceRef` parser
  (`engine/engineer/issue-ref.ts`). Independent of the existing PR announcement path — a
  failure on one surface never affects the other, and repo-level warnings never trigger a
  GitHub write for the issue step (Task 20).
- Wired gate write-back into the daemon's discovery tick: `daemon-cli.ts`'s single
  `onGatedDiscovered` call site now announces every owner-gated spec via
  `announceGatedPr`/`announceGatedIssue` (src/conductor/src/engine/gate-writeback.ts),
  right after writing `.daemon/gated.json`. The spec's implementation PR URL (when a prior
  build attempt already opened one) is read from its per-slug `.pipeline/conduct-state.json`
  in `.worktrees/<slug>/`; its `Source-Ref` is threaded through the new optional
  `GatedSpecItem.sourceRef` field (`daemon-backlog.ts`). Both announcements are best-effort —
  a `gh` failure never blocks or aborts the discovery pass (Task 21).
- The `GATED` dashboard group (`daemon-dashboard.ts`) now always renders explicitly —
  including `GATED (0)` — whenever a `gated` list is present (even empty), instead of being
  omitted for a zero count; a `kind: 'repo'` warning row now reads "building NOTHING —
  identity unresolved" / "un-owned specs skipped — no owner_gate_cutover configured" rather
  than the raw `warning` enum value; and a gated spec slug already covered by the PROCESSED
  group (stale-ledger dedup) is excluded from GATED, matching the existing HALTED/PROCESSED
  precedence contract.
- Event-driven re-dispatch on HALT clear (Task 18): when a parked feature's `.pipeline/HALT`
  marker is removed, the daemon detects it via filesystem watch (chokidar) and immediately
  re-dispatches without waiting for the next idle poll. Sub-second response vs. 5-60s polling.
  Fallback: `--no-watch` flag disables filesystem watching and relies on polling only.
- `--no-watch` flag for daemon (conduct-ts daemon): disables filesystem watching, falls back
  to polling-only. Use when chokidar watch fails or for testing. Pairs with `--idle-poll`.
- Transition-only daemon logging (Task 18): daemon logs only slug status transitions (park/unpark,
  dispatch/halt/done), no idle-polling spam. One line per state change, no per-tick chatter.
- Resume marker for re-dispatches (Task 18): when a parked feature is re-dispatched, the daemon
  logs `↻ resume` instead of `▶ start` to distinguish fresh dispatch from re-kick. Feature state
  and logging remain clean and audit-friendly.
- **Halt-PR presentation reliability — verify-after-write + reconciliation sweep (ai-conductor#274).**
  Daemon halt PRs now reliably carry `needs-remediation` label + draft status + durable body
  marker via two mechanisms: (1) **Verify-after-write on escalation:** `ensureHaltPresentation()`
  writes draft, label, and body marker, then re-reads to confirm all three (bounded retry 3×,
  100ms backoff), moving on even if unconfirmed (best-effort); (2) **Reconciliation sweep on
  startup + idle tick:** `reconcileHaltPrs()` enumerates open PRs carrying the body marker and
  heals any missing draft or label (idempotent, no-throw, injected dep hook). Finish cleanup
  removes all three markers via `cleanupHaltPresentation()` verify-after-write so remediated
  PRs exit halt state permanently and cannot be re-halted by the sweep. Together: halt PRs
  cannot present as mergeable; pre-existing broken PRs self-heal; both mechanisms cover each
  other's failure modes. Modules: `pr-labels.ts` (`ensureHaltPresentation`, `cleanupHaltPresentation`),
  `halt-pr-reconciliation.ts` (`reconcileHaltPrs`), `daemon.ts` (sweep wiring). See
  `adr-2026-07-05-halt-pr-presentation-reliability.md` (D1–D5 decisions) and README/`src/conductor/README.md`.
- **RateLimitEpisode coordinator (Tasks 10–16):** in-process episode tracker with shared
  deadline management. When a provider signals rate-limiting (HTTP 429, session-limit messages,
  or usage-limit text), the coordinator captures a timezone-aware deadline and coordinates N
  concurrent workers to wake up together at that deadline (instead of retreating into
  independent, competing waits). New `engine/rate-limit-episode.ts` module + wiring in
  `daemon-cli.ts`, `conductor.ts`, `daemon-backlog.ts`, `daemon-rekick.ts`. Resolves the
  2026-07-03 cascading-HALT + 300s wedge incident.
- **Dispatch gate:** pause NEW feature dispatch while rate-limit episode active (in-flight
  work continues untouched). Entry point: `engine/daemon-backlog.ts` checks
  `episode.isActive()` before discovery and dispatch.
- **Session-limit classification (PRIMARY fix):** detect session/usage-limit messages beyond
  HTTP 429 as rate-limited signals. `isRateLimitError(output)` in `engine/recovery.ts` matches
  `/(rate limit|429|overloaded|usage limit)/i`. Catches subtle API responses that don't set
  HTTP status but clearly signal exhaustion in the message body.
- **Timezone-aware reset parsing:** extract deadline from provider message (e.g.,
  `retry-reset-at: 3:20pm America/New_York`) into absolute wall-clock milliseconds. Parses
  time zone, handles locale-specific formats, computes epoch-relative deadline.
- **Pre-step rate-limit handling (Task 15):** when a rate-limit episode is active and
  unexpired, skip a pending step and escalate as `rateLimited: true` (prevents a redundant
  wait inside the step). Entry point: `Conductor.runBuildStep()` pre-flight check.
- **Episode-caused HALT recovery (Task 22):** automatically re-kick previously-halted
  features when the episode clears (deadline passed), without re-kicking them on every
  base-SHA advance. Entry point: `daemon-rekick.ts` checks episode state and clears sentinel.
- **SIGTERM-responsive wait (abortable rate-limit wait):** `episode.waitUntilReady()` is
  abortable via AbortController. Daemon registers in-flight waits with the coordinator;
  on SIGTERM, all are aborted immediately and conductors escalate to HALT. Preserves graceful
  shutdown under rate-limiting.
- **Jitter and staggered resumption:** `waitUntilReady()` staggers wake-up times so N workers
  don't all resume at the exact deadline instant (prevents thundering herd on retry).
- **Engineer handoff write-back now surfaces failures with a `writebackPending` ledger marker
  and copy/paste-retryable remediation (#290).** `IntakePort.report()` returns a `ReportOutcome`
  (`{ ok: true }` or `{ ok: false, remediation: string[] }`); on a failed `done` write-back,
  `reportDone` (`src/engine/engineer/intake/writeback.ts`) sets `writebackPending: true` on the
  ledger entry (cleared only on a subsequent `ok: true` outcome, per TR-3 — a pre-existing flag is
  never silently dropped by an absent port or missing outcome). `remediation` carries the fully
  substituted `gh` command for the specific step that failed (issue comment or label-add), which
  `dispatchEngineer`'s `handoff`/`land` primitives print to stderr without affecting stdout or the
  exit code — a stalled write-back never turns a successful handoff into a failure.
- **Main-checkout leak triage with byte-identity-gated auto-heal (#380, adr-2026-07-08).** When
  `maybeFastForward` discovers a dirty working tree, before giving up it now runs leak triage:
  classifies every dirty file/untracked stray against candidate branch heads (daemon worktrees
  prioritized, then local `feat/*`), and if a SINGLE candidate explains EVERY dirty entry via
  byte-identity match, auto-heals by restoring tracked files and deleting strays, then proceeds
  with fast-forward. Operator work is protected: heal requires whole-tree explanation by one
  branch, so any ambiguity keeps hands off. Unexplained dirty files escalate from a one-line skip
  to a loud LEAK-SUSPECT WARN with per-file diff-stat so the stall is never silent. Restore/delete
  selection matches a file's full `allExplainedBy` set against the chosen branch, not just its
  first-matched candidate, so a file explained by more than one branch is never dropped from an
  otherwise-valid all-or-nothing heal.
- **Write-fence sandbox for self-host builds (#380, adr-2026-07-08).** A daemon-owned PreToolUse
  hook is provisioned into the self-build sandbox's `settings.json` to block writes targeting the
  harness main checkout outside the build worktree. Edit/Write/MultiEdit/NotebookEdit targeting
  paths under the harness root but outside `.worktrees/` are blocked with guidance to use the
  worktree path; Bash commands referencing main-checkout paths are heuristically screened and
  blocked (the deterministic leak-triage/auto-heal layer is the fallback). The fence never fires
  on worktree-internal paths, temp directories, or unrelated repos (scoped to self-host builds).

### Changed

- **Daemon now owns build-auth token separately from operator OAuth (Tasks 5–17, TR-2, TR-3).**
  The daemon maintains its own build-auth token at a configured path
  (`harness_self_host.build_auth.token_path`), independent of the operator's
  `.credentials.json` OAuth token. Pre-flight validation (`build-auth-preflight.ts`,
  Task 6) fails closed with mint instructions when the token is missing or
  unreadable — operator runs `claude setup-token` to mint and configure the path.
  The `BuildAuthProvider` seam (`daemon-build-token.ts`, Task 5) reads the token at
  runtime, enabling future platform-identity swaps (EKS) without code changes. Token
  state is classified as `ok` / `missing` / `error` with trimmed, fail-closed defaults;
  sandbox builds inject the token via `--build-auth-token` CLI argument, preserving
  the operator's OAuth for non-build steps. See HARNESS.md "Daemon Build Auth" and
  `.docs/specs/2026-07-07-isolate-daemon-build-auth-from-operator-oauth.md`.
- **Post-rebase gate-first mechanical re-verify (Task 14):** file-changing finish-time rebases
  no longer unconditionally dispatch the build agent. Instead, the rebase step pre-verifies the
  build gate's objective completion predicate against the freshly-rebased tree. If the predicate
  (git evidence trailers, `root-commit..HEAD`) remains satisfied post-rebase, dispatch is skipped
  and a `rebase_gate_reverified` event is emitted with the step and optional reason
  (`skippedDispatch: false` for re-dispatch, `true` for mechanical skip). If pre-verify fails or
  throws, build is kicked back and re-dispatched as before (fail-closed). Scope: **`build` only**
  — `build_review` and `manual_test` remain unconditionally invalidated. Consequence: the ~45–60 min
  build-agent lap on every evidence-complete file-changing rebase drops to ~1–2 min mechanical
  derivation; evidence-missing rebases re-dispatch normally. See `.docs/decisions/adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md`.
- `--idle-poll` default raised: 5s → 60s (Task 18). Event-driven wake now handles the hot
  path (HALT clear detection), so the polling fallback can be slower. Override with
  `--idle-poll 5` to restore legacy behavior or when filesystem watch is unavailable.
- Daemon idle timeout behavior improved (Task 11): unref'd timer no longer blocks process
  exit when daemon is idle. Features in-flight still drain before exit, but idle sleeping
  doesn't prevent process termination. Fixes "hanging daemon on SIGTERM when idle" issue.

- **`manual_test` is now a gating step, and its enforcement is locked (#367).** While it was
  advisory, an auto-mode run whose manual test kept failing was silently auto-skipped after
  retries — one of the two false-ship paths behind incident PR #364. It now HALTs
  (auto/daemon) or opens the recovery menu (interactive) instead, matching the enforcement
  the manual-test SKILL.md frontmatter always declared. `manual_test` joined
  `ENFORCEMENT_LOCKED_STEPS` (`engine/skill-resolver.ts`), so a project-local skill override
  cannot downgrade it, and disabling it in project config is now rejected by validation.
  Manual-test results are append-only per attempt: the skill records an
  `## Attempt N — <timestamp>` section per run and the gate evaluates only the latest
  section (sectionless files still scan whole, back-compat).
- **Conductor rate-limit wait now abortable and deadline-first (Tasks 11, 14):**
  `episode.waitUntilReady()` is now abortable via AbortController, computing
  `delayMs = deadline - now()` and respecting SIGTERM signals (wait resolves with
  `{aborted: true}`, conductor escalates to HALT). If the deadline has already passed, the
  wait returns immediately (no spurious delay). Jitter internal to `waitUntilReady()` spreads
  worker wake-up times so they don't collide at the deadline instant.
- **Pre-step rate-limit handling (Task 15):** when a rate-limit episode is active and
  unexpired, `Conductor.runBuildStep()` skips the pending step and escalates it as
  `rateLimited: true` instead of entering the step and waiting there (prevents redundant
  waits and allows earlier dispatch-gate pausing).
- **HALT recovery from rate-limit episodes (Task 22):** when a base-SHA advance triggers a
  re-kick sweep, the conductor checks whether a halted feature was caused by an active
  episode. If the episode has now cleared (`now() >= deadline`), the HALT is automatically
  cleared and the feature is re-kicked, enabling automatic recovery without re-kicking on
  every base-SHA advance.
- **Autonomous restart preserves rate-limit episode (Tasks 19, 20):** when the daemon
  auto-restarts on a stale engine, the `RateLimitEpisode` coordinator is re-created fresh
  but any in-flight `waitUntilReady()` calls in the old workers are already aborted
  (via `onSignal` before restart fires), so waits do not get orphaned.

### Fixed

- #400: Fixed stale-engine respawn stacking multiple daemon generations. Single-generation handoff now enforced: requester exits unconditionally, bounded-wait lock takeover, lock-losers exit cleanly. Restores `auto_restart_on_stale_engine` flag, reverting temporary disable from #402.

- **Daemon restart no longer leaves the daemon stopped when origin is ahead (#353).** Stale-engine
  restarts now respawn in place within the live tmux session: skills relinked via
  `bin/install --update` before the handoff, `remain-on-exit` armed at session creation, and
  the flow is detect drift → relink → write marker → respawn (no exit/pidfile-release/dead
  session). An operator on `conduct-ts daemon connect` stays connected across the respawn.
  Modules: `daemon-tmux.ts`, `daemon-cli.ts`, `daemon.ts`; capstone specs in
  `daemon-stale-respawn-e2e.test.ts` + `daemon-tmux-smoke.test.ts`
  (adr-2026-07-06-stale-engine-respawn-in-place).

- Re-enabled bin/setup worktree smoke by invoking the worktree's own `bin/setup` (#334).

- **Continuous daemon no longer dies silently at its first idle poll (#329 regression).**
  `createDefaultSleep` unref'd its timer, so during an idle poll with no wake-watchers
  registered (a fully drained backlog) the sleep timer was the process's only pending work —
  the node event loop emptied and the daemon exited 0 mid-await with no log, no HALT, and no
  restart marker (observed 2026-07-07: three consecutive silent boot-deaths ~10s after
  startup). The idle-poll timer now holds the event loop; a regression test pins the timer's
  ref via a test-only seam (an await-based test is a false green — the vitest runner itself
  keeps the loop alive).

- **Daemon false-ship guard: daemon no longer records shipped markers for outcomes missing verified PR evidence.** Done-outcomes with null prUrl or non-pr finishChoice now halt with HALT markers, DONE markers deleted, and worktrees kept for operator inspection (#337).
- **Rate-limit cascades now prevented by coordinated episode wait (resolves 2026-07-03
  incident).** Previously, N concurrent workers hitting a rate-limit all waited independently
  (e.g., 300s fixed), then retried at once → thundering herd → cascading HALTs + 300s wedges
  that ignored SIGTERM. With the coordinator active, all workers wake up at a single shared
  deadline (extracted from the provider message, timezone-aware), then resume with jitter so
  they spread out instead of colliding. Episode-caused HALTs are automatically recovered when
  the deadline passes.
- **Session-limit and usage-limit signals now properly classified as rate-limited (PRIMARY
  fix for 2026-07-03 incident).** Subtle API responses that don't set HTTP 429 but clearly
  signal exhaustion in the message body (e.g., "session limit exceeded") are now detected by
  `isRateLimitError(output)` and trigger rate-limit coordination instead of being silently
  treated as a step failure.
- Backfilled the missing intake marker `.docs/intake/2026-06-30-background-intake-conduct-loop.md`
  (`Owner: jstoup111`): the spec landed without an owner stamp, so the post-cutover owner gate
  held it as `unowned-post-cutover` and the daemon never built it. With the marker committed on
  the default branch, `readSpecOwnerStamp` resolves the owner and the spec re-enters the
  dispatchable backlog.
- **Engineer handoff write-back no longer spawns `gh` with `ENOENT` (recurring; ledger advanced
  anyway) (#290).** `report()` in `src/engine/engineer/intake/github-issues.ts` previously fell
  back to `process.cwd()` when the poll-cache had no entry for a repo (e.g. write-back invoked
  without a prior `poll()`), spawning `gh` from whatever directory the daemon happened to be
  running in — which could be missing/deleted and fail with `ENOENT`, or simply target the wrong
  repo. The new `resolveReportCwd()` resolves cwd in order — poll-cache → registry lookup (matched
  by `ghRepo`/`name`) → `os.homedir()` — with each candidate `existsSync`-checked; every `gh` call
  already passes `-R <owner/repo>`, so any existing directory is sufficient.
- **Daemon-lock handoff race can no longer end with zero daemons (ai-conductor#374).**
  `clearStaleLockForRestart` and `ensureRunning`'s acquire-then-unlink step briefly own the
  pidfile with their OWN live pid; a concurrent `ensureRunning` observing that transient
  record (or the phantom `pid: -1` owner left when it vanished mid-read) concluded "live
  daemon, no-op" and returned — while the transient holder unlinked and returned too,
  leaving nothing running (the flaky `daemon-restart-lock` AC3b failure that blocked CI on
  unrelated PRs, and the production shape of `daemon restart` racing an engineer-claim
  nudge). Handoff records are now marked `transient: true` (`PidRecord`, additive) and
  `ensureRunning` treats a live transient or phantom owner as in-transition — it spawns;
  the spawned daemon's boot-time acquire and the idempotent tmux session arbitrate any
  duplicate. Live NON-transient owners still strictly no-op (FR-21/ADR-005 unchanged).
- **manual_test FAILs can no longer be whitewashed or shipped (#367, incident PR #364).**
  The completion gate (`engine/artifacts.ts`) now records the worktree HEAD sha in
  `.pipeline/manual-test-fail-evidence.json` when it observes FAIL rows (via the new
  injectable `CompletionContext.getHeadSha` seam; fail-open without a repo) and refuses a
  later FAIL-free results file unless HEAD has moved — a PASS rewrite with no fix commits
  no longer satisfies the gate. In daemon runs, a manual_test that exhausts its retries
  with FAIL rows recorded is routed deterministically back to `build` with the FAIL rows as
  the retry hint (kickback `manual_test → build`, bounded by `MAX_KICKBACKS_PER_GATE`),
  then HALTs naming the exhausted budget; a non-FAIL gate miss (missing/stale results)
  HALTs directly.

- Worktree-rooted installs can no longer brick the operator environment (ai-conductor#363):
  (1) `bin/install` refuses global-mutating modes (default, `--update`) when its own checkout
  physically resolves under `.worktrees/` — exiting non-zero before any global write, with the
  resolved root and remedy in the message (`--check`/`--help`/`--uninstall` unaffected);
  (2) a new `resolveInstalledHarnessRoot()` ladder (`src/conductor/src/engine/install-freshness.ts`,
  adr-2026-07-06-installed-root-resolution-for-global-writes) derives the installed main checkout
  from the git common dir and hard-rejects worktree roots — the self-build relink preflight now
  throws `InstallStaleError` (→ `.pipeline/HALT`, no dispatch) instead of running
  `bin/install --update` at a worktree, and `runSelfBuildDispatch` passes the installed root to
  `provisionSandbox` so the sandbox `settings.json` retarget (main → worktree) actually fires.
  `resolveHarnessRoot` is untouched (self-host detection unchanged — regression-locked in
  `detector.test.ts`).
- Every conductor step now starts on a fresh LLM session unconditionally (ai-conductor#325):
  the step-boundary `resetSession()` in `engine/conductor.ts` is no longer gated behind the
  daemon-only `freshContextPerStep` flag, which left interactive `/conduct` and the DECIDE
  front half sharing one persistent session across steps (context bloat + cross-step
  leakage). The flag is removed from `ConductorOptions` and from the daemon's conductor
  construction (`daemon-cli.ts`); within-step retries still resume the step's own session.

- Daemon re-kick play-forward rebase now routes a conflict through the same gated `/rebase`
  resolution loop the finish-time step uses (bounded by `rebase_resolution_attempts`) before
  parking for a human, instead of hard-HALTing on the first conflict. Extracted the shared
  `runGatedRebaseResolution` helper so both `conductor.ts:runRebaseStep` and
  `daemon-rekick.ts:resumeRebaseFirst` resolve identically (#300)
- gitignore `.engine-staging-*/` so an orphaned publish-engine scratch dir can no
  longer dirty the working tree. `publish-engine` stages the built engine into a
  `.engine-staging-<rand>/` temp dir and renames it into place; an interrupted or
  crashed publish leaves one behind. Because the pattern was unignored, that orphan
  made `git status` report the tree dirty, and the daemon's fast-forward guard then
  permanently logged `skip fast-forward: working tree not clean` — the checkout fell
  ~20 commits behind `origin/main`, the engine was never rebuilt, and a stale engine
  ran for hours (root cause of #338; downstream halt #336). Ignoring the scratch
  pattern stops a single orphan from wedging the daemon into staleness. Deeper
  cleanup (publish-engine self-sweep on crash + fast-forward guard ignoring
  daemon-owned build scratch) tracked in #338.
- Prevent re-dispatch of delivered and stranded intake entries via claim-time delivery guard (#243)
- CI: skipped the `publish-interrupted` `bin/setup worktree compatibility` smoke
  pending #334. It was authored to self-skip until `bin/setup` existed; `bin/setup`
  landed (#269) and un-skipped it, but the script resolves its target from its own
  location (`$0/..`), so invoking the primary's `bin/setup` from a worktree
  rebuilds the primary and never creates the worktree's `dist` (ENOENT). A
  pre-existing defect the new CI is the first to exercise; tracked in #334 and
  skipped so the suite is honestly green rather than red on unrelated breakage.
- CI: the `engineer-agent-hosted` acceptance suite failed under the new PR
  workflow (#322) because `dispatchEngineer({kind:'land'})` resolves a
  machine-scoped owner-gate identity from `~/.ai-conductor/config.yml` (where
  `spec_owner` wins over the `gh` fallback). With no `spec_owner` and no `gh`
  auth on the CI runner the land path exited *"identity unresolved"* before
  reaching the behavior under test — six tests green locally (dev is gh-authed)
  but red in CI. Fixed by pointing `HOME` at a hermetic fake home carrying
  `spec_owner` in the suite's `beforeEach` (the same pattern the sibling
  `engineer-cli-land-owner` and `conductor-owner-stamp` suites already use),
  so identity resolves deterministically and independently of ambient gh auth.

### Added

- **`verify-claims` skill — correctness & assumption gate (gating, phase: all).** A cross-cutting
  correctness discipline other skills apply at their decision points: it attaches a grounded
  confidence % (with basis — verified / inferred / unverified) to non-trivial claims and theories,
  surfaces every assumption, and HARD-BLOCKS any specced or built work resting on an unconfirmed
  *load-bearing* assumption until the operator approves it (autonomous runs HALT with the assumption
  ledger rather than silently picking the likely value). Armed at load-bearing points by a new
  HARNESS.md **Correctness & Assumption Gate** rule (not an always-on tax) and cited by two roles:
  **authors** that surface assumptions and hard-block before an artifact locks (`explore`, `prd`,
  `architecture-review`, `stories`, `plan`, `writing-system-tests`), and **verifiers/judges** that
  attach a grounded confidence % to every finding/verdict and never assert an unverified one
  (`assess`, `conflict-check`, `code-review`, `prd-audit`, `manual-test`, `remediate`, `debugging`).
  Execution/orchestration/mechanical steps (e.g. `tdd`, `pipeline`, `conduct`, `finish`) rely on the
  rule and surrounding gates rather than self-citing. Each citing skill also declares `verify-claims`
  in its `requires` frontmatter. Added to the generated model-selection table (`inherits caller` —
  runs in the invoking skill's context). The verifier discipline is also propagated into the agent
  personas that actually author findings (so the gate isn't orphaned in the calling skill): a
  **Confidence Calibration** section in `evaluator`, `prd-auditor`, `remediation-planner`,
  `domain-reviewer`, `cto-orchestrator`, and the 9 `cto-*` specialists, plus assumption-surfacing in
  `planner` (the `generator` is deliberately left heads-down).
- `engineer resolve` recovery subcommand to mark stranded entries delivered (recover from write-back failures)
- Local-commit and pr-skipped handoff outcomes now record branch evidence for auditing
- CI: added a PR-triggered GitHub Actions workflow that runs the harness integrity test suite and the conductor build/vitest suite on every pull request.
- writing-system-tests: FR→acceptance-spec coverage gate — product-track runs emit a per-FR coverage table (`.pipeline/fr-coverage.md`) and refuse to complete while any FR is unresolved (spec-covered / unit-covered / already-tested dispositions with citations). (#244)
- **Deep-seam tmux guard prevents real daemon sessions under AI_CONDUCTOR_NO_REAL_EXEC kill-switch (#257).** The default tmux runner in `engine/daemon-tmux.ts` checks the `AI_CONDUCTOR_NO_REAL_EXEC` environment variable before creating a new tmux session. When set to '1' and a daemon session name is targeted, the runner throws an error instead of executing, preventing test suites from leaking real tmux daemon sessions into the system. The kill-switch is set globally by vitest, ensuring all conductor tests run in isolation without spawning long-lived daemon processes.
- **Daemon self-termination on missing repo root with repo_root_missing stop reason (#257).** The daemon now checks at the start of each loop iteration whether its repo root has disappeared (e.g., a worktree deleted out from under it). On definitive absence, it logs the missing path, sets `stoppedReason: 'repo_root_missing'`, and cleanly exits after draining in-flight workers to completion. This enables safe self-termination and cleanup when the underlying repository is removed without leaving the daemon process orphaned.
- **Daemon lifecycle controls: pause/resume/restart with versioned engine store (issue #215).** Operators can now pause individual or all daemons (`conduct pause --all`), preventing new work dispatch while preserving state; resume mirrors pause. Safe in-place restart (`conduct restart --all`) preserves the daemon's tmux session, window layout, and scrollback — an operator watching a daemon stays connected. Restart respects pause state (restarted daemon remains paused). Rebuilding the shared engine no longer crashes running daemons (#215 fix): each daemon pins its engine version at startup and runs that version until restart; restarted daemons adopt the newest build. Versioned engine store (`src/engine/engine-store.ts`) manages versions durably with safe cleanup (four-condition GC: not current, not in-use by a live pidfile, older than min-age, outside keep-last-K). Status surface shows running/paused/stopped/stale state, pause timestamp/operator, and which engine version each daemon is running.
- Added model fallback ladder — reactive downgrade on unavailable models (#186)
- **Daemon auto-restart on stale engine (self-host only).** When enabled in self-host mode, the
  daemon monitors the engine binary (`dist/index.js`) for stale code between idle passes. If stale
  code is detected and no tasks are in-flight, the daemon writes a restart intent marker
  (`.daemon/RESTART_PENDING`) and exits with code 0, allowing the configured respawn transport
  (PR #215) to relaunch with fresh code. Enable with `auto_restart_on_stale_engine: true` in
  project config; the feature is ignored in non-self-host environments and disabled in once-mode.
  Configuration is read once at startup; on non-convergence (fresh identity ≠ target), suppression
  prevents restart loops.
- **Halt-PR rehabilitation at finish (#271).** When `finish` completes a feature whose
  recorded PR was born as a `needs-remediation` halt PR, a new engine step
  (`rehabilitateHaltPr`, run in the daemon's post-run tail) deterministically flips
  draft→ready, clears the `needs-remediation` label (REST), and injects the `Closes`
  ref exactly once — all warn-only. The `/finish`/`/pr` skills now explicitly rewrite
  the reused PR's title/body, and the finish completion gate fails (fail-open on gh
  read errors) while the recorded PR title still starts with `needs-remediation:`
  (adr-2026-07-03-halt-pr-rehabilitation-at-finish).
- **Engine-owned task-status.json with git-evidence auto-heal (#302).** The conductor
  engine is now the single authority for `.pipeline/task-status.json`, which tracks
  per-task completion state across build retries. Completion evidence is derived from
  git log (commits with `Task: <id>` trailers). The auto-heal step (`engine/autoheal.ts`)
  reconciles stale in-flight state before a gate retry by matching commits to tasks via
  trailer match and content-hash, flipping `pending` tasks to `completed` when evidence
  is unambiguous (word-boundary name match + file-path overlap with plan). All
  reconciliations logged to `.pipeline/audit-trail/` for audit. Engine seeds task-status
  on merge/upsert from plan; the trailer contract (`Task: <id>` in commit messages) is
  verified by the rebase completion gate (FR-9, commit preservation).
- **Daemon auto-park on N-attempt trigger (#302).** When the daemon encounters N
  consecutive no-evidence gate misses (a gate showing no new commit evidence since its
  prior attempt) or an empty/missing plan at seed time, it auto-parks the feature instead
  of re-kicking infinitely. Auto-park writes `.daemon/parked/<slug>` with provenance
  `auto` and the reason in the marker body (e.g., `'empty plan'` or `'no evidence after
  2 attempts'`), emits a `ConductorEvent` of type `auto_park`, and halts gracefully.
  Unpark (`conduct daemon unpark <slug>`) removes the park marker and resets the
  evidence counter. The daemon dashboard's PARKED group displays provenance (`— auto-parked`
  for machine-triggered, `— operator` for human-placed), distinguishing the two halt
  styles. Auto-park is deterministic (triggered after N consecutive no-evidence misses);
  operator park is human-triggered via the `conduct daemon park` subcommand.

### Changed

- **manual-test now routes an unexplained failure through `/debugging` before fixing.** The Bug
  Loop added an explicit root-cause-discovery step: a manual FAIL gives the symptom, not the cause,
  so when the cause is not obvious the skill dispatches the `/debugging` protocol (root cause before
  fix, no fixes without evidence) instead of guessing a reproducing test or patch. Previously
  `/debugging` was cited only for the design-conformance gate. (Complements the existing
  `tdd` → `/debugging` escalation when GREEN won't go green.)
- Armed `auto_restart_on_stale_engine: true` in this repo's committed `.ai-conductor/config.yml` — the idle daemon now respawns in place when a local rebuild makes its running engine stale (#256/PR #307 feature, default-inert until armed).

- **Daemon restart now preserves session and respects pause state.** The restart verb (`conduct restart`, formerly kill-session + new-session) is now respawn-in-place: uses tmux respawn-pane -k to remain in the same session with the same window layout. An operator watching a connected daemon stays connected through restart. Restart gating honors pause state — a paused daemon's restart is queued, not immediate. Follows adr-2026-07-04-respawn-in-place-restart.
- **Engine versioning and publish flow.** `npm run build` is now a wrapper (`scripts/publish-engine.mjs`) that stages the build, finalizes it to the versioned store (`dist-versions/<version-id>/`), atomically flips the `dist` symlink, and runs garbage collection. Raw `tsup` invocation against the live `dist/` layout is guarded and refused. First build migrates an existing `dist/` into the store (one-time operation).
- **Declared `harness_self_host.version_freeze: "0.99.19"` in `.ai-conductor/config.yml`.**
  The self-host VERSION approval gate (PR #262) now self-satisfies while VERSION stays at the
  frozen value, ending the per-feature version-gate HALT + manual `.pipeline/version-approval`
  round-trip. Read at daemon startup (restart to apply); update or remove at the 1.0 cut.
- **pipeline: per-task VERIFY now runs the scoped affected-test set with fallback-to-full-suite triggers; batch-boundary full suite unchanged (#245).** Implementation subagents now scope each task's VERIFY step to the test files affected by that task's code changes, reducing feedback latency and test noise. Fallback triggers—shared/core modules (3+ importers), config/migrations/test infrastructure, empty scoped set, or low-confidence mapping—revert to full suite when a task's scope is indeterminate. Batch-boundary verification continues to run the full test suite. Scoped sets are reported per-task and visible in the pipeline dispatch output.

### Removed

- Removed `check_harness_config` (consumer CLAUDE.md → HARNESS.md auto-upgrade) from `bin/conduct`; detection is retained by the session-start context hook. Unblocks the v1.0 bin/conduct removal (#226).

### Migration

**Engine store: one-time dist→store migration on first build.**

The build flow has moved from building directly into `dist/` to a versioned store under `dist-versions/`. This is transparent to most operators: the first `npm run build` post-upgrade automatically migrates your existing `dist/` into the store.

```bash
# After upgrading, run this once:
cd src/conductor
npm run build

# This migrates your current dist/ to dist-versions/<id>/ and creates the dist symlink.
# No action needed; the new build process handles it.
```

If you have daemons running:
- Daemons running on the old `dist/` continue to work as-is (they pin the version at startup)
- After their first `conduct restart` or natural restart, they switch to the new versioned build
- A short transition window exists where you may see one old-style restart (if a daemon restarts before the migration); this is normal and safe

Reverting is not supported: if you revert past this version, the `dist` symlink structure will block the old build flow. Instead, keep forward and use `conduct pause --all` + `npm run build` + `conduct restart --all` for a controlled engine upgrade.

**`manual_test` can no longer be disabled or downgraded (#367).**

`manual_test` is now a gating step with locked enforcement. A project config that disables it
(legal while it was advisory) now fails config validation at startup with
`Cannot disable gating step: "manual_test"`. Remove the disable before updating:

```bash migration
# Only needed if your project config disables manual_test.
# Remove the `manual_test:` disabled block from .ai-conductor/config.yml, e.g.:
if [ -f .ai-conductor/config.yml ] && grep -qE 'manual_test:' .ai-conductor/config.yml; then
  echo "manual_test step config found in .ai-conductor/config.yml —"
  echo "if it sets 'disabled: true', delete that line (gating steps cannot be disabled)."
  grep -n -A2 'manual_test:' .ai-conductor/config.yml
else
  echo "No manual_test step config found — nothing to do."
fi
```

Project-local manual-test skill overrides keep working, but an `enforcement:` value in their
frontmatter is now ignored (locked to `gating`).

**Daemon-owned build-auth token — guarded mint with no clobber (Tasks 5–17, TR-2/TR-3).**

The daemon now owns its build-auth token separately from operator OAuth. Before any dispatch
in daemon-token mode, run `claude setup-token` to mint a token and configure its path in
`harness_self_host.build_auth.token_path`. The pre-flight check fails closed if the token is
missing or unreadable, printing mint instructions.

```bash migration
# Set up daemon build-token if not already present
BUILD_AUTH_TOKEN_PATH="${HOME}/.ai-conductor/build-auth"

# Only mint if the file doesn't exist (no clobber of operator's existing token)
if [ ! -f "$BUILD_AUTH_TOKEN_PATH" ]; then
  echo "Setting up daemon build-auth token…"
  claude setup-token
  chmod 600 "$BUILD_AUTH_TOKEN_PATH"
else
  echo "Build-auth token already present at $BUILD_AUTH_TOKEN_PATH — no action needed."
fi

# Then configure the path in your harness config (.ai-conductor/config.yml):
echo "Configure in your harness config:"
echo "  harness_self_host:"
echo "    build_auth:"
echo "      token_path: $BUILD_AUTH_TOKEN_PATH"
```

If you use daemon-token mode, ensure `harness_self_host.build_auth.token_path` points to
your build token file (default: `~/.ai-conductor/build-auth`). The daemon reads this on
each dispatch; the pre-flight check will guide you if the token is missing. For api-key mode,
no action needed — the token requirement is skipped.

### Fixed

- **Stale-engine checker was silently disabled by a wrong engine path — no daemon ever auto-restarted.** The daemon hashed `<projectRoot>/dist/index.js` for its engine identity, but the harness engine lives at `<projectRoot>/src/conductor/dist/index.js` (`<conductorRoot>/dist`, the symlink `publish`/`flipCurrent` maintain). The wrong path never exists, so `captureEngineIdentity` returned `null`, `createStaleEngineChecker(null)` returned a permanently-disabled checker that always reports `current`, and both the idle-boundary restart (#307) and the dispatch-boundary rebuild-and-restart (#320) were inert — the daemon logged `ARMED` yet also `Engine identity capture failed; stale-engine checker disabled`. Fixed by resolving the entry via a new `engineEntryPathForRepo(projectRoot)`. The identity primitive had unit coverage but its real wiring was never exercised against a self-host layout (orphaned-primitive class); added a regression test that drives the wired path against a real `src/conductor/dist` tree.
- **Daemon now rebuilds its engine and auto-restarts on stale code *before starting each feature*, not only when the backlog fully drains.** The self-host stale-engine auto-restart (#307) detects drift by content-hashing `dist/index.js` — but #309 untracked `dist`/`dist-versions`, so a merge advances `src/` while the local `dist` artifact never moves, and the checker could never observe merge-driven drift on its own. Compounding it, the check ran only in the drained-idle branch, which a merge that lands new specs *skips* (it takes the dispatch branch) — so the daemon built freshly-merged specs on hours-old engine code. The daemon now, on each dispatch boundary (self-host + armed + quiescent), rebuilds the engine from the fast-forwarded source (content-addressed `npm run build` → atomic `dist` flip; the running pinned `dist-versions/<id>` is never disturbed, and an unchanged build is a no-op) and re-checks staleness; on drift it writes the `RESTART_PENDING` marker and restarts so the **next** feature is built by fresh code. It never fires while a build is in flight (guarded on an empty in-flight pool) and reuses the shipped suppression guard against restart loops; a failed rebuild is logged and degrades to the current engine. Adds an `engine_restart` daemon stop reason. Closes the gap left by the #307 × #309 interaction.
- **SDLC steps ladder to an available model when their configured model is out of usage credits, instead of silently halting (#315).** Two compounding bugs: (1) the provider only classified a model as unavailable on a non-zero exit, but the CLI prints `You're out of usage credits` on a **zero** exit — so an out-of-credits step was read as a clean success that merely 'forgot' to write its artifact, producing a misleading 'no verdict file' halt and a re-kick thrash. `claude-provider` now detects the credit notice, marks the step not-successful, and flags `modelUnavailable` so `ModelAvailability` walks the fallback ladder to a model with credits. (2) Every SDLC skill hard-pinned `model:` in its frontmatter, which overrode the conductor's per-step (ladder-aware) `--model` and defeated laddering — e.g. the Sonnet-configured as-built review actually ran on Fable and died when Fable's credits ran out. Removed the frontmatter pins from the top-level Fable-driven conductor skills (architecture-review, explore, prd, remediate, rebase), making `MODEL_BY_STEP` the single source of truth; frontmatter pins are kept on nested skills (code-review, simplify, …) where they are load-bearing. Routed the two ladder-bypassing invoke paths (complexity, rebase) through `invokeWithLadder`. Verified end-to-end: with Fable out of credits, the as-built review now runs on Sonnet and records an APPROVED verdict. Follow-up: `debugging` and `engineer` skills remain Fable-pinned (nested/interactive, outside the automated ship path).
- **Engine build artifacts are no longer committed (#303).** `src/conductor/dist` (symlink) and `dist-versions/` snapshots are untracked and gitignored. They were never meant to be in git — `.gitignore` always ignored `src/conductor/dist/`, but the trailing-slash (directory-only) pattern stopped matching once the lifecycle feature made `dist` a symlink, and builds began committing it plus snapshots. Committed artifacts guaranteed merge conflicts on every engine-touching PR and version drift between committed snapshot and `src/`. Fresh checkouts build locally: `bin/install` runs `npm install + npm run build` in `src/conductor`, and `bin/conduct-ts` fails loudly with a rebuild hint when `dist` is absent. Supersedes the committed-snapshot sync in PR #308.
- Committed engine snapshot synced to post-#307 source: `dist` now points at `dist-versions/20260704T212629Z-36f3f9fa74f5` (contains the stale-engine auto-restart code) and the superseded pre-#307 snapshot is dropped — fresh clones no longer run an engine older than `src/` (#303).
- **Engine publish is now idempotent — unchanged content no longer mints a snapshot or flips `dist` (#303).** Every `conduct-ts` entry that runs `npm run build` (daemon start, `bin/install`, test suites) re-published a byte-identical engine, creating a duplicate `dist-versions/<ts>-<hash>/` snapshot and re-pointing the `dist` symlink each time. On a main checkout that churn showed up as `M src/conductor/dist` + untracked snapshots, which made the daemon **skip origin fast-forward tracking** ("working tree not clean") — silently freezing base-advance re-kicks. `publish()` now compares the freshly-built content hash against the current `dist` target and cleanly no-ops when identical (staging removed, current versionId returned); a dangling or incomplete current target still publishes to heal itself. Also repairs the `resolve(readlink(dist))` sites in `publish-engine`/`publish-interrupted` tests, which resolved the now-relative symlink target against process cwd and were latently red since the relative-symlink fix in PR #296.
- test suite leaked a real `.pipeline/HALT`/`gates/`/`DONE` into the process cwd (poisoning live daemon worktrees); `Conductor.projectRoot` is now required and the suite fails on any cwd `.pipeline` leak (#252).
- **Sandbox auth-expiry park-and-poll — wait for operator credentials refresh instead of failing (#210).** When a daemon headless/sandbox build encounters an expired operator token or an auth-failure step output ("Not logged in" / "Invalid API key"), the conductor now parks the feature and polls for the operator's credentials to refresh (via `claude login` file mtime + freshness check) instead of burning the retry budget. Pre-flight expiry check (before sandbox provision) detects common case; per-step auth-failure detector catches runtime cases. Polling is bounded by `auth_park_timeout_minutes` (default 60 minutes, configurable, opt-out via 0 or negative). Park consumes zero retries — budget is preserved for post-park-resume. Timeout or operator refresh triggers standard HALT remediation (clear marker + re-kick via base-SHA advance or manual dispatch). Modules: `operator-credentials.ts` (reader + wait primitive), `claude-provider.ts` classifier, `conductor.ts` wiring (pre-flight + retry-loop branch + timeout). Configuration: `auth_park_timeout_minutes` in project config.
- engineer land keys the intake marker by the plan stem (was idea slug), so owner-gate and issue auto-close resolve land-authored specs (#207)
- **`engineer migrate-issue-deps` now writes dependency links the live GitHub API accepts.**
  The blocked_by POST sent `-f issue=<owner/repo#N>`, which the live dependencies endpoint
  rejects with a 422 (`issue_id` required) — so `--confirm` could never create a link
  (#260). The writer now resolves each blocking issue's database id
  (`GET repos/<repo>/issues/<n>` → `.id`) and posts `-F issue_id=<id>`, with per-target id
  caching and an additive-only skip (never guess a write payload) when the id can't be
  resolved. The migrate-deps test fakes were remodeled on the live contract — the old fakes
  encoded a third, never-real argv shape (`--method` + `issue_number=`), which is why the
  idempotency test shipped red on main in #246 and failed every feature's full-suite VERIFY
  (#251). Fixes #251, fixes #260.
- Unknown `bin/conduct` subcommands/options now fail loudly (or forward to conduct-ts) instead of silently launching the SDLC pipeline (#178).

### Changed

- **Front-of-funnel DECIDE steps now default to `fable`.** The explore, prd, pre-implementation architecture-review, and engineer skills now run on Fable by default; plan.L and conflict_check.L tier overrides also escalate to Fable. S/M tiers and `--as-built` compliance mode remain unchanged. Graceful degradation when fable is unavailable arrives with #186 fallback ladder; refs #190.

### Added

- **Daemon profile** — enable build-to-PR on self-host repos: `bin/setup` worktree prep, `version_approval_gate` with PATCH auto-pass and MINOR/MAJOR HALT, audit record (`.pipeline/version-signal.json`). See `adr-2026-07-03-harness-daemon-profile` and #174.

- **`harness_self_host.version_freeze` — self-satisfying version gate during a declared
  freeze (#261).** During a version freeze the operator's approval decision is always the
  same ("current version, no bump"), yet every self-host build halted at the VERSION-bump
  approval gate for the operator to write it by hand. A committed
  `version_freeze: "<version>"` in `.ai-conductor/config.yml` now records that standing
  approval: while it matches the repo `VERSION` the gate writes
  `.pipeline/version-approval` itself and proceeds — no HALT. An explicit marker still
  wins, any `VERSION` differing from the freeze halts exactly as before (a freeze never
  approves an actual bump), and the daemon still never merges (ADR-005/ADR-010).

- **Finish-time and as-built remediation (self-healing SHIP gates).** The daemon's
  `/remediate` planner — previously wired only into the `prd_audit` blocking handler — now also
  fires before the generic `failed in auto mode` HALT for a failed `finish` verification and a
  BLOCKED `architecture_review_as_built` (the technical track skips `prd_audit`, so those gates
  had no remediation entry point and dead-ended in a HALT even when the gap was routable). The
  `/finish` skill now flake-checks a failing fresh suite (re-run the failing specs once;
  transient infra ≠ real failure) and records real failures in `.pipeline/test-failures.md` for
  the planner; `/remediate` reads it as a third gap source and directs collateral failures of an
  intentional contract change at updating the tests — never weakening production code. Routing
  stays bounded by the existing remediation-round cap, and `halt` dispositions
  (architectural-clarity / product-scope) still stop for a human. Extracted
  `Conductor.planRemediation` from the prd_audit handler; behavior there is unchanged.

- **Authoring-side owner stamping now fails closed on unresolved identity (multi-operator
  ownership slice B, #184).** Every spec-authoring entry point — the engineer loop
  (`processIdea`), the CLI `engineer land` path, and the `landSpec` primitive — now resolves
  the operator identity up front and refuses to author when it cannot: no `spec_owner` in the
  machine config (`~/.ai-conductor/config.yml`) and no `gh` login → the idea aborts with
  actionable remediation text before any write. Specs are never landed un-owned, so the
  daemon's owner gate can trust every conduct-authored intake marker. Identity is
  machine-scoped with a `gh api user` login fallback; the project config is never consulted
  (anti-leak, D2). Owner stamping preserves `Source-Ref:` on intake markers.

- **Content-aware shipped-work dedup** (#204, #205): committed `.docs/shipped/<stem>.md` records as durable dispatch-dedup authority (stem-primary, content-hash-secondary). Fresh clones and cache resets no longer replay shipped specs. Fixes replay bugs in PR #82, #124, #183.
  - New `conduct shipped-record --slug <stem> --pr <url|local>` subcommand: `/finish` runs it on the implementation branch before the final push, so the record rides the PR and the human merge lands code + shipped-fact atomically (ADR Decision 1). Degrades (warn, exit 0) on any failure; never runs for `discard`/`keep`. The daemon never commits records on its main checkout (which would sit un-pushed on local base and wedge the `--ff-only` fast-forward).
  - `discoverBacklog` skips candidates with base-branch shipped records (stem match + cache repair, wired via `localWorkSource.repairProcessed`).
  - Content-hash matching detects renamed specs.
  - `.daemon/processed/` demoted from authority to cache.
  - `rekickSweep` skips processed slugs via the ledger-or-record `makeIsProcessed` resolver (rebuilt fresh per sweep), with warn-once skip logs — halting spurious re-kicks on dupes (#205).
- **Committed `.ai-conductor/config.yml` for the harness repo itself** — sets
  `owner_gate_cutover: 2026-07-02T11:00:00Z` so this repo's daemon (registered
  2026-07-02, issue #174) grandfather-builds specs already on `main` at
  registration time while gating newly-merged un-owned specs. No `spec_owner`
  is committed: operator identity is machine-scoped and resolved only from
  user config (Slice A, PR #183). Repo-local configuration only — no behavior
  change for consumer projects.
- **Acceptance-specs gate now verifies the specs actually RAN and FAILED, not just that spec files
  exist.** Previously the `acceptance_specs` step's completion check was pure file-existence, so a
  generated spec that never executed — an integration spec `importorskip`-ed away for want of a
  testcontainer, or a suite scoped to a unit-only dir (`pytest tests/` when the specs live under
  `spec/integration/`) — satisfied the gate; the daemon then declared GREEN and opened a PR whose
  own acceptance specs failed in CI (observed on best-stock-picker's SEC-EDGAR adapter #72). The
  `writing-system-tests` skill now (a) forbids scoping the RED run to a unit-only subset and requires
  bringing up the infra the specs need so they actually execute, and (b) records
  `.pipeline/acceptance-specs-red.json` from the real RED run. A new `acceptance_specs`
  completion predicate rejects the step unless that evidence shows `failed >= 1`, `skipped == 0`,
  `errors == 0`, and `executed >= 1` — a skipped/deselected/collection-errored spec no longer
  establishes RED. Evidence is gitignored run evidence, not a committed artifact. Locked with new
  unit tests for the predicate + validator and updated conductor fixtures.

- **Machine-scoped operator identity + anti-leak guard (multi-operator ownership hardening,
  Slice A).** The `conductor` daemon now resolves its `spec_owner` identity **only** from the
  user config (`~/.ai-conductor/config.yml`) via `owner-gate/machine-identity.ts`
  (`makeMachineOwnerResolver`: user-config `spec_owner` → `gh` login → unresolved, resolved
  fresh each poll) — project config is never consulted for identity, so a committed `spec_owner`
  can no longer leak one operator's identity onto everyone who pulls (D1). `validateConfig` gains
  a `{ source: 'project' | 'merged' }` option and **rejects** a `spec_owner` key in a committed
  project config (blank or not) with a config-load error naming the file and the fix
  (`loadConfig` → `source: 'project'`; `loadMergedConfig` → `source: 'merged'`, so a
  user-sourced value in the merged view is still allowed) (D2). An un-owned merged spec is now
  skipped with a **distinct, deduped, actionable** log line telling the operator to add an
  `Owner:` marker on the default branch (or grandfather via `owner_gate_cutover`) instead of a
  bare skip (D5). Documented in `README.md` → "Operator identity & owner gate" and
  `src/conductor/README.md` → "Owner gate: multi-operator identity partition"
  (adr-2026-07-01-machine-scoped-operator-identity). The authoring-side universal stamping /
  fail-closed land (Slice B) is sequenced separately and not included here.
- **Harness self-host guardrails wired into the daemon loop (Phase 6).** The `conductor` daemon now
  activates the self-host guardrail bundle for a harness self-build. `daemon-cli` classifies
  `isSelfHost` **once** at startup against the main repo root (honoring the `activation` override) and
  threads a `selfHost` flag to each `Conductor`. In `conductor.run()`, for a self-build only
  (`daemon && selfHost`): skills are relinked once before the first `build` (a relink `InstallStaleError`
  aborts before any child build); the `build` step runs under a throwaway `CLAUDE_CONFIG_DIR` with
  `process.env.CLAUDE_CONFIG_DIR` set to the sandbox for the duration of that step and **restored in a
  `finally` on both the pass and throw branches** (no bleed into `finish`), with guaranteed sandbox
  teardown on every exit path; and the VERSION-approval + release-artifact gates run **before** the
  `finish` step opens the PR — a failing gate writes `.pipeline/HALT` so the PR never opens and the
  daemon never merges (ADR-005/ADR-010). Every change is additive and gated behind the single
  `selfHost` flag, so any non-harness repo's build path is byte-for-byte unchanged (TR-13); proven by
  the full conductor suite plus a new wired-path integration + structural non-autonomy test
  (`test/engine/self-host/wiring.test.ts`). The harness can now be daemon-registered with self-host
  mode on.
- **Harness self-host guardrail primitives (engine modules).**
  The `conductor` engine gains a `harness_self_host` config block plus six test-covered modules under
  `src/engine/self-host/` implementing the DECIDE spec (adr-2026-06-30-{self-host-detection-seam,
  sandbox-build-isolation, halt-based-release-gates}): `SelfHostDetector` (realpath-based self-build
  detection + `activation: auto|force_on|force_off` override + a swappable interface seam for a future
  platform identity), `SkillRelinkPreflight` (relink harness skills via `bin/install --update` before
  a self-build so a newly added/renamed skill never HALTs on "no parseable result"), `SandboxBuildEnv`
  (a throwaway `CLAUDE_CONFIG_DIR` whose skills/+hooks/ link into the build worktree, with the
  operator's `.credentials.json` + a hook-retargeted `settings.json` COPIED in so the headless build
  can authenticate and fire its OWN edited hooks — the self-build exercises its own edited harness
  without mutating the global `~/.claude` the operator's concurrent sessions read; fails closed on a
  missing worktree link target, guaranteed teardown on pass/fail/crash, no-leak invariant), and
  `VersionApprovalGate`
  + `ReleaseArtifactGate` (HALT-based, fail-closed VERSION-approval / integrity-suite / CHANGELOG
  `[Unreleased]` / migration-block gates). Config is safe-by-default: an absent/partial block
  auto-detects with all gates ON. These modules are the reusable primitives; the daemon-loop
  integration that activates them ships in the same release (see the Phase 6 wiring entry above).
  Includes a real-binary smoke for the relink and adversarial isolation tests for the sandbox.
- **Spec + plan: harness daemon self-host guardrails (DECIDE artifacts only; no code yet).** Design,
  architecture diagrams, 3 APPROVED ADRs, 13 stories (TR-1..TR-13), a clean conflict-check, and a
  Tier-L implementation plan for making the `james-stoup-agents` harness repo safe to
  daemon-register: a unified self-host mode (single swappable `SelfHostDetector` seam) that activates
  a skill-relink preflight, a throwaway-`CLAUDE_CONFIG_DIR` sandbox build (self-verifies edited
  harness without mutating global `~/.claude`), and HALT-based fail-closed VERSION-approval +
  CHANGELOG/migration/integrity release gates. Preserves ADR-005/ADR-010 (daemon never merges).
  Implementation is tracked as a separate build over `.docs/plans/daemon-self-host-guardrails.md`.
- **Daemon owner-gating: the autonomous spec-build daemon now builds only the merged specs it
  owns.** Each discovery pass resolves the daemon's operator identity (configured `spec_owner` wins,
  else the `gh` login, else unresolved → fail-open) and, for every content-eligible spec, reads the
  owner stamp committed in its intake marker (`.docs/intake/<slug>.md`, an `Owner:` line the
  engineer `land` flow writes). A spec owned by another operator is **skipped and logged** with a
  distinct ownership line; a spec matching the daemon owner builds. Un-owned (unstamped) specs are
  gated by a **grandfather cutover** (`owner_gate_cutover`): merged strictly before the cutover →
  grandfather-built, on/after (or an indeterminate merge time) → skipped. When the owner cannot be
  resolved the gate is inactive (builds everything, one warn-once line), so nothing regresses
  for an unconfigured solo setup. New `spec_owner` and `owner_gate_cutover` config fields — a
  malformed cutover is **rejected at config load** (never silently defaulted, so an un-owned spec is
  never misclassified); a missing cutover means no grandfather window. When the gate is active but
  **no `owner_gate_cutover` is set**, discovery emits one warn-once line
  (`owner-gate active but no owner_gate_cutover configured — un-owned specs will be skipped …`) so
  the skip-default for pre-existing un-owned specs is discoverable. The gate runs strictly after
  the existing content filters and after `isProcessed`, so eligibility and idempotency are unchanged.
  Owner is a configured identity (the gh-login fallback is local-dev only); the identity/provenance
  seams keep it forward-compatible with a platform-provided (EKS) identity.
  (`src/engine/owner-gate/`, `.docs/specs/2026-06-30-daemon-owner-gate.md`, 3 ADRs.)
  - **Write side wired end-to-end:** `conduct-ts engineer land` now loads the target repo's
    HarnessConfig and threads `spec_owner` + the `gh` runner into `landSpec`, so a landed spec is
    actually stamped `Owner: <configured spec_owner OR operator gh login>` (unresolved → the
    `Owner:` line is omitted, never blank). Previously the caller passed no owner deps, so no spec
    was ever stamped and every spec reached the daemon un-owned.
  - **Autonomous authoring path now stamps the owner too (closes the ADR-2 "every land path" gap).**
    `runAuthoring` (the engineer loop's autonomous DECIDE→spec seam) previously hard-coded a `null`
    owner when writing the intake marker, so autonomously-authored specs carried no `Owner:` stamp
    and would be skipped post-cutover. It now resolves the owner via the same identity chain as
    `landSpec` (configured `spec_owner` → `gh` login → un-owned/omitted), and `processIdea`
    (`loop.ts`) loads the target repo's HarnessConfig and threads `spec_owner` + the in-scope `gh`
    runner into it. Both land paths now stamp `Owner:` identically.
- **DECIDE pipeline restructure — `explore`/`prd` split, product/technical tracks, architecture
  before stories (the four `adr-2026-06-29-*` DECIDE ADRs: explore-prd-split-track-in-explore,
  architecture-before-stories-convergent-kickback, track-marker-location,
  brainstorm-rename-migration).** `brainstorm` is split into **`explore`** (advisory, always-runs:
  context + approaches + the operator-confirmed product/technical **track**, ephemeral notes →
  `.pipeline/`, decision → `.memory/`) and **`prd`** (gating, product-only PRD with a product-only
  audit gate + external-constraint carve-out — absorbs PR #142). The DECIDE order is now
  **explore → complexity → prd → architecture-diagram → architecture-review → stories →
  conflict-check → plan**: architecture precedes stories, so architecture-induced failure modes
  become negative-path stories, and the PRD stays product-only (the *how* resolves in
  architecture-review as ADRs). The **track** is persisted to `.docs/track/<slug>.md` (`parseTrack`,
  default `product`): on the **technical** track `prd` *and* `prd-audit` are skipped and acceptance
  criteria live in stories (Model X — stories are always present, so the BUILD/daemon path is
  unchanged). `land-spec` requires a PRD only on the product track; the daemon reads the track into
  `BacklogItem.track`. `conflict-check` root-routes a blocking conflict to its cause
  (`prd` | `architecture` | `stories`); `architecture-review` re-opens in a bounded amendment mode.
  Persisted state is migrated (`brainstorm` ⇒ `explore` + `prd`) idempotently. Supersedes PR #142.
- **`conduct render-diagrams --check <file>...` syntax-checks Mermaid blocks at authoring time.**
  It parse-checks every diagram (rendering each with `mmdc` but not opening it) and **exits
  non-zero on a syntax error**, printing the file, block index, and parse-error line. Unlike the
  render path — which never-fails so a missing tool can't block the approval gate — the check
  distinguishes an author error (fail) from a missing `mmdc` (skip, exit 0), so it's a real gate
  that still no-ops on a browser-less CI box. The `architecture-diagram` skill now runs it before
  the approval gate, and documents a **guillemet placeholder convention** (`«slug»`, not `<slug>`
  / `&lt;slug&gt;` / `{slug}`) to avoid the angle-bracket trap that silently broke a sequence
  diagram in a recent spec. New `checkDiagramsForFile` in `mermaid-renderer.ts`.
- **Engineer worktree isolation** (implements the DECIDE spec below). The engineer now authors,
  `land`s, and `handoff`s each idea inside a dedicated per-idea git worktree of the target repo
  (`<target>/.worktrees/engineer-<slug>` on `spec/<slug>`) instead of the shared main checkout —
  so a concurrent daemon build or a second engineer session on the same repo can no longer be
  corrupted by a branch-switch. New `conduct-ts engineer worktree --project <n> --idea "<i>"`
  primitive creates it; `land`/`handoff` gain a **required `--worktree <path>`**. The
  `checkout -b … / checkout back` dance in `landSpec` is deleted (it commits in place), `land`
  stages only `.docs` (idea-scoped, no cross-idea bleed), `handoff` runs `gh` from the worktree
  and **removes it on success** (branch persists) / **keeps it on failure**. Worktree creation
  **strict-aborts** with zero primary-tree mutation when it can't be made (e.g. unborn/detached
  HEAD). The daemon's worktree create/reconcile/teardown logic was extracted into a shared
  `engine/worktree-shared.ts` used by both actors (one worktree story). Real-git smoke +
  primary-tree-untouched / concurrent-actor / sibling-unchanged invariant tests included.
  Assumes the target repo gitignores `.worktrees/` (the same convention the daemon relies on).
- `/bootstrap` now sets up git end-to-end for **new/fresh** projects (new Step 10a, run after
  the smoke test). It forces the default branch to `main`, makes a single seed commit when there
  is no history yet, configures an `origin` remote (`gh repo create --private --source=.` when
  `gh` is authenticated, or a user-provided URL otherwise), and pushes with `-u` to set the
  upstream — so the first feature can open a PR end-to-end. Every action is idempotent and
  non-destructive: an existing repo, existing history, or a pre-configured remote is left
  untouched, and a rejected push (remote already has commits) stops for the user instead of
  forcing. When no remote is available the step is skipped with a note rather than blocking.
- Approved DECIDE spec for **Engineer Worktree Isolation** (`.docs/specs/`, `stories/`, `plans/`,
  `complexity/`, `conflicts/`, `architecture/`, plus `adr-2026-06-30-engineer-worktree-authoring-isolation.md`
  and its architecture-review). Specifies moving the engineer's idea→spec authoring (DECIDE + `land`
  + `handoff`) off the target repo's shared main checkout and into a per-idea git worktree — reusing
  the daemon's worktree mechanism — so a running daemon or a second session on the same target repo
  can't be corrupted by the engineer's branch-switch dance. Spec only; no engine code changed yet.
  Amends ADR-008 (adopts its deferred Option B for same-repo concurrency).

### Changed

- **recovery/failure-response steps (rebase, remediate, debugging) now default to fable** — Fable guards
  root-cause analysis in `debugging` (wrong diagnosis produces band-aid fixes), guards failure disposition
  in `remediate` (false HALT wastes context, wrong routing misroutes rework), and guards semantic merges
  in `rebase` (wrong merge silently reverts merged work). Interim `--model` fallback documented pending
  #186 availability ladder; override per-run with the `--model` CLI flag or a `steps.<step>.model`
  config entry. Refs #189.

### Fixed

- **Finish and pr skills now prove remote staleness before force-with-lease (#213).** After a sanctioned rebase, the branch diverges from `origin/<branch>`, which reports "behind" in `git status`. The old behavior would pull stale commits back in, undoing the rebase and creating GATE 0 halt loops. The new behavior proves `origin/<branch>` is a stale pre-rebase copy via staleness proof (ORIG_HEAD ancestry via `git merge-base` OR reflog "rebase: finish" entry), then safely force-with-lease pushes. Unproven staleness (foreign commits detected) or a failed lease (remote changed concurrently) now halts instead of forcing, preserving the remote work. Documented in the finish skill's §1b "Push Direction" gate and verified in the verification checklist.

- **Intake owner markers renamed to plan stems** — the owner gate reads `.docs/intake/<plan-stem>.md`, but three markers were committed under truncated idea-slug names, so their `Owner:` stamps were invisible and the daemon skipped `generated-model-table`, `harness-daemon-profile`, and `model-availability-fallback-ladder` as un-owned. Data fix only; the writer-side slug bug is tracked separately.

- **Owner-stamped intake markers added under the build slugs for the Fable specs (#189/#190).**
  The engineer `land` flow writes the intake marker as `.docs/intake/<idea-slug>.md`
  (e.g. `adopt-fable-for-front-of-funnel-decide-steps-explo.md`), but the daemon's
  owner-gate provenance read looks up `.docs/intake/<build-slug>.md` derived from the
  spec/stories stem (`fable-front-of-funnel-decide`). The mismatch made both Fable specs
  read as un-owned, and — merged after the `owner_gate_cutover` — they were skipped by the
  daemon ("spec is un-owned and merged on/after the grandfather cutover"). This PR adds
  markers under the build slugs (`fable-front-of-funnel-decide.md`, `fable-recovery-steps.md`)
  carrying the same `Owner:`/`Source-Ref:` stamps so the daemon builds them. Repo-local data
  fix only; the underlying slug-mismatch bug in the engineer land flow is tracked separately.

- **Self-host sandbox builds no longer run untrusted (wedged headless build).** The throwaway
  `CLAUDE_CONFIG_DIR` a harness self-build runs against copied credentials and `settings.json`
  but seeded no `.claude.json`, so the inner headless session saw an untrusted workspace,
  ignored all `permissions.allow` entries in the repo's `.claude/settings.json`
  ("Ignoring 11 permissions.allow entries … this workspace has not been trusted"), and the
  build step wedged on denied tools (observed on the first registered self-build,
  `multi-operator-ownership-hardening`, 2026-07-02). `provisionSandboxBuildEnv` now seeds a
  minimal `.claude.json` that **propagates** the operator's existing workspace trust — written
  IFF the operator's live state file (`~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json`)
  already trusts the harness root, covering the harness root + build worktree (as-passed and
  realpath-canonicalized). A missing state file, malformed JSON, or an untrusted harness root
  seeds nothing — the sandbox never fabricates a trust grant the operator has not made. The
  seeded file is a fresh write (TR-6 no-global-symlink invariant holds) and the operator's
  state file is only ever read. Adversarial specs cover the no-fabrication, explicit-false,
  missing-file, malformed-JSON, and read-only branches.

- **Owner-gate observability notices no longer log on every poll tick.** The gate-inactive
  (fail-open) and no-`owner_gate_cutover` notices were pass-local and re-logged on every daemon
  discovery pass, spamming `.daemon/daemon.log` (and the console) once per idle poll forever. They
  now route through the same `.daemon/warned/` marker dedup as the per-slug merged-spec skips
  (reserved keys `__owner-gate-inactive__` / `__owner-gate-no-cutover__`), so each surfaces once and
  is then suppressed across ticks. The per-pass local guard is retained so the legacy/tests path
  (dedup hooks unset) still logs at most once per pass, never per-spec. No build/skip decision
  changes. Locked with two cross-scan tests in `daemon-backlog.test.ts`.

- **`rebase_resolution_attempts` is now a recognized top-level config key.** It was present in the
  `HarnessConfig` type and resolver but missing from `validateConfig`'s known-keys set, so setting it
  in `config.yml` failed validation with "Unknown top-level key". Surfaced while adding the adjacent
  `harness_self_host` key.
- **Hardcoded per-step tier overrides now affect `model`, not just `effort`/`max_retries`.**
  `DEFAULT_STEP_TIER_OVERRIDES` model bumps were silently ignored — the model resolution chain in
  `resolveStepConfig` omitted `hardcodedStepTier`. As a result HARNESS.md's promised
  `conflict-check: sonnet (S/M), opus (L)` never took effect and Large projects ran conflict-check
  on sonnet regardless. Added `hardcodedStepTier?.model` to the model chain and defined
  `conflict_check.L → opus` and `plan.L → opus` (plan.L also keeps effort xhigh). Locked with
  regression tests in `resolved-config.test.ts`.

- **PR/issue label mutations no longer fail on GitHub's Projects (classic) sunset.**
  `gh pr edit --add-label/--remove-label` and `gh issue edit --add-label/--remove-label`
  resolve label names against repo metadata via a GraphQL query that pulls Projects (classic)
  fields — which GitHub has deprecated, so the whole command now errors out before the label
  is ever applied. This broke the daemon's `mergeable` / `needs-remediation` labeling and the
  mergeable sweep, plus the engineer intake's `engineer:handled` label add/remove. All label
  add/remove operations now go through the REST labels endpoint (`gh api .../issues/<n>/labels`),
  which never touches Projects. New `restAddLabelArgs` / `restRemoveLabelArgs` / `parseIssueRef`
  helpers in `pr-labels.ts` are the single source of the REST contract (used by `addLabel` /
  `removeLabel` and the engineer intake). PR-body/title edits (`gh pr edit --body/--title`) are
  unaffected — they need no name resolution, so they never trigger the Projects query.
- **Repaired 6 silently-broken Mermaid diagrams** across 5 architecture/sequence docs that the
  new `--check` surfaced (they were falling back to raw text in review). Root causes: a `;`
  inside `sequenceDiagram` message/`Note` labels (Mermaid reads it as a statement separator), raw
  `<feature>` / `<slug>` angle-bracket placeholders in sequence labels (the `>` tokenizes as an
  arrow), a dotted link whose `.`-containing label `-.9.3b.->` confused the link lexer (now
  quoted), and a participant literally named `LOOP` that collided with the `loop` keyword (renamed
  `ELoop`). Also fixed `extractMermaidBlocks` to require a fenced ` ```mermaid ` to **start a
  line**, so a mid-sentence prose mention no longer feeds prose to the renderer as a fake diagram.
- Daemon `needs-remediation` escalation now **upserts** its failure comment instead of
  appending a new one on every HALT (#159). The comment carries a hidden marker
  (`<!-- conductor:needs-remediation -->`); on a repeat HALT the existing comment is edited
  in place (the latest reason replaces the prior one) so a repeatedly-failing feature no
  longer accumulates duplicate `## Daemon halt` comments on the same PR. New
  `upsertComment()` seam in `pr-labels.ts`; best-effort/non-throwing (a PATCH failure leaves
  the existing comment as-is, a missing/unparseable/unreachable comment falls back to create).

- **Mermaid diagram rendering now works on WSL, containers, and as root.** The `mmdc-png` /
  `mmdc-svg` presets launched Chromium with its setuid sandbox, which cannot initialize on WSL
  or in most containers (or when running as root), so `conduct render-diagrams` and the
  architecture-diagram approval gate silently fell back to raw Markdown. The renderer now passes a
  Puppeteer config enabling `--no-sandbox` (plus an explicit Chrome `executablePath` when a system
  Chrome is found) in those environments, and honors an operator-managed
  `~/.ai-conductor/puppeteer.json` override when present. Pure helpers `mmdcArgs` / `needsNoSandbox`
  are unit-tested; a real-binary render smoke confirms end-to-end output.

- `/bootstrap` now scaffolds the **full** set of `.docs/` subdirectories the conductor and
  daemon actually read/write — added the three it was missing (`complexity/`, `architecture/`,
  `intake/`) alongside the existing `specs/`, `stories/`, `conflicts/`, `decisions/`, `plans/`,
  and `retros/`. Previously a freshly-bootstrapped project lacked those three until a later step
  happened to create them, leaving bootstrap's directory list out of parity with the engine.

### Changed

- **Unresolved daemon identity now fails CLOSED (multi-operator ownership hardening, Slice A).**
  A `conductor` daemon that can resolve no operator identity — no `spec_owner` in
  `~/.ai-conductor/config.yml` **and** no `gh` login — now builds **nothing** and emits a single
  loud, deduped "identity unresolved" notice, reversing the prior fail-open behavior where an
  unidentified daemon would build *every* operator's specs (the exact multi-operator hazard). A
  daemon with a resolvable identity (the common case: `gh` authenticated) is unaffected, and an
  unwired gate (no `daemonOwner` supplied) still runs legacy discovery unchanged
  (`engine/daemon-backlog.ts`, `daemon-cli.ts`; D3,
  adr-2026-07-01-machine-scoped-operator-identity).
- **Daemon activity log lines are now timestamped.** Every line the daemon tees into the
  durable `.daemon/daemon.log` (read via `conduct-ts daemon logs [--follow]`) is prefixed
  with a leading ISO-8601 UTC timestamp (e.g. `2026-07-01T14:23:05.123Z [daemon] …`) so
  activity can be correlated and grepped by time long after the fact. The stamping is a
  pure, clock-injected `formatDaemonLogLine` helper in `engine/daemon-log.ts`; the live
  tmux console keeps its uncluttered colored line. (`src/engine/daemon-log.ts`,
  `src/daemon-cli.ts`.)
- **`.pipeline/HALT` marker path + best-effort writer consolidated into one module.** The marker
  literal was independently spelled in `conductor.ts`, `rebase.ts`, `daemon-deps.ts`,
  `daemon-dashboard.ts`, `daemon-rekick.ts`, and the new self-host `gate-halt.ts`, and the
  mkdir-then-write plumbing was duplicated between the rebase HALT and the self-host HALT. Both now
  live in `engine/halt-marker.ts` (`HALT_MARKER` + `writeHaltMarker`), so a change to where the
  daemon-stop marker lives or how it is written happens in exactly one place. No behavior change.

- **Model selection right-sized at the front of the funnel.** `explore` now defaults to
  **opus / xhigh** (was sonnet / high), `bootstrap` and `complexity` to **sonnet** (were haiku),
  and `assess` to **sonnet** (was haiku; the `cto-orchestrator` synthesis stays opus). Rationale:
  these steps sit upstream — a cheap model's mistake in divergent discovery (`explore`), tier
  assignment (`complexity`), or the project `CLAUDE.md` (`bootstrap`) cascades into every
  downstream phase. Defaults live in `DEFAULT_STEP_MODELS`/`DEFAULT_STEP_EFFORT`
  (`src/conductor/src/engine/resolved-config.ts`).
- **opus-tier skills now pin `model: opus` in SKILL.md frontmatter** (`explore`, `prd`,
  `debugging`, `code-review`) so interactive/phone invocation on a Sonnet/Haiku session still runs
  them on the right model — previously only the autonomous daemon path enforced the model. `assess`
  frontmatter corrected haiku → sonnet.
- **`tdd` GREEN escalates to `/debugging` on opus instead of thrashing.** When a test won't go
  green after a bounded attempt (or the change breaks other tests with a non-obvious cause), the
  Sonnet generator stops and dispatches the debugging protocol in a fresh opus sub-session with
  the failing test, diff, and failure output.
- HARNESS.md model table reconciled with the engine defaults, with a new note documenting the two
  enforcement paths (autonomous engine defaults vs. interactive frontmatter) to prevent drift.

- `writing-system-tests` skill is now language- and framework-agnostic. Replaced the
  Rails/RSpec-only mechanics (hardcoded `spec/integration`/`spec/system` paths, `config/routes.rb`,
  `bundle exec rspec`, Capybara/`SecureRandom` examples) with framework-neutral guidance that
  defers concrete syntax, paths, runner, and fixtures to the project's detected test framework
  (mirroring how `/tdd` defers to stack test conventions). All correctness principles are
  preserved: §3b replacement-entry-point, §3c path-guard boundary values, §3d adversarial
  derivation coverage, RED discipline, and the acceptance/request/unit layering philosophy.
  README skill table updated to match.

- `bin/install` now builds the `conduct-ts` bundle itself — it runs `npm install
  && npm run build` in `src/conductor/` (in both first-run and `--update` mode)
  before symlinking `conduct-ts`, so updates can never leave a stale bundle for
  the install-freshness guard to reject. The build is non-fatal and idempotent:
  if Node < 20.5 is active or `npm` is missing it's skipped with a warning and
  `conduct` still installs. `bin/install --check` now reports whether the
  `conduct-ts` bundle is built and on PATH.
- **Dependency-ordered intake and dispatch.** Specs whose GitHub issue declares a dependency
  (via GitHub's native issue-dependencies `blocked_by` API, linked through the existing
  `Source-Ref:` marker) are no longer dispatched or built ahead of the work they depend on.
  - **Blocker resolver** (`engine/blocker-resolver.ts`, `createBlockerResolver`) resolves
    `unblocked` / `blocked` / `cycle` / `indeterminate` verdicts, with cycle detection over the
    `blocked_by` chain (every cycle member resolves identically) and fail-closed handling of
    `gh` API errors and unparseable responses/markers (→ `indeterminate`, never `unblocked`).
  - **Daemon dependency gate**: a new **WAITING** group in the startup inherited-state dashboard
    (precedence HALTED > PROCESSED > IN-PROGRESS > WAITING > ELIGIBLE) surfaces build-ready
    specs held back by an open blocker, a cycle, or an indeterminate verdict, with warn-once
    (re-announce-on-change) logging so a slow-moving blocker doesn't spam `daemon.log`.
  - **Engineer intake claim deferral**: the claim walk (`engineer/intake/dependency-claim.ts`)
    skips blocked entries and claims the oldest **unblocked** one, releasing deferred entries
    back to the queue unchanged; a new `all-blocked` outcome — distinct from `empty` — lists
    every deferred entry and its verdict when the whole queue is stuck.
  - **`conduct-ts engineer migrate-issue-deps [--confirm]`** — one-time migration tool that
    converts prose dependency mentions on existing issues into real GitHub issue-dependency
    links so the resolver above can see them (dry-run by default).
- **Daemon issue-priority scheduling.** The daemon now reorders eligible backlog items by
  GitHub issue priority labels, enabling human-driven prioritization without changing the
  eligibility or deduplication logic. Priority bands (`priority: high` / `medium` / `low`)
  are read fresh from the GitHub REST API on each daemon scan (cached within-scan). Items
  are grouped by band and ordered chronologically within each band — post-gate, so priority
  never overrides eligibility, park markers, dedup, owner gating, or dependency resolution.
  On GitHub API failure, the daemon gracefully degrades to chronological ordering and logs
  a single deduped warning per outage (resets on recovery). Dashboard ELIGIBLE items display
  `[band]` suffixes and a `[fallback]` marker when in fallback mode. Non-impact: eligibility
  gate, dedup, owner gate, dependency resolution, and park markers stay unchanged.
  Implementation: `PriorityResolver` in `engine/priority-resolver.ts`, wired into
  `localWorkSource` post-gate ordering and `daemon-dashboard.ts` for visualization.
  See `.docs/specs/2026-07-03-daemon-issue-priority-scheduling.md` and
  `adr-2026-07-03-priority-labels-refresh-and-fallback-semanatics.md`.
- **Operator park/unpark: human-placed halt that survives re-kick.** `conduct daemon park <slug>`
  and `conduct daemon unpark <slug>` let an operator mark a single worktree ineligible for
  dispatch and re-kick without stopping the daemon. The state is a `.daemon/parked/<slug>`
  marker (`engine/park-marker.ts`), validated against `.docs/plans/<slug>.md` or
  `.worktrees/<slug>` before writing. Operator-parked is distinct from HALTed: clearing a
  HALT never unparks a slug, and parking preserves the REKICK sentinel so re-dispatch resumes
  exactly where it left off once unparked. The status dashboard's PARKED group has absolute
  precedence over every other group (operator-park-a-human-placed-halt-must-survive-the).
- **Front-half amendment kickback events.** DECIDE-phase re-opens (e.g. stories/plan sending
  work back to explore/prd) now emit a `↩ KICKBACK` daemon log line, same as tail kickbacks.
- **Operator back-navigation events (`↰ BACK` lines).** Manual operator navigation-back is now
  logged distinctly from automatic kickbacks in the daemon log.
- **Kickback line styling.** `↩ KICKBACK: <from> re-opened <to> (×<count>)` is now bold yellow
  with no leading dim `·` chrome dot, and the `(×<count>)` suffix is never dimmed — matching how
  close a gate is to `MAX_KICKBACKS_PER_GATE`.
- **Front-half re-opens now enforce the same `MAX_KICKBACKS_PER_GATE` cap as tail kickbacks**,
  so a DECIDE-phase kickback loop halts instead of looping indefinitely.
- **Generated model-selection table + integrity checks.** `bin/generate-model-table` now
  generates the HARNESS.md model-selection-table section from `model-table-metadata.ts`
  (Why/complexity/as-built prose) and `resolved-config.ts` (model/effort/tier-override source
  of truth), replacing hand-maintained "keep three things in sync" prose. Validation suite
  checks 5a (table content drift) and 5b (SKILL.md pin agreement) enforce that the generated
  table matches its source and that opus-tier pins in SKILL.md frontmatter agree with the table.
- **HARNESS.md model-selection table is now generated, not hand-edited.** The table gains an
  explicit Effort column and explicit complexity/as-built rows (previously folded into prose or
  omitted); regenerate via `bin/generate-model-table` after editing the source files, do not
  edit the generated block directly.
- Documented the `mergeable_autoresolve` config block and behavior (detection, Tier-1/Tier-2
  resolution, acceptance guards, fail-closed suite gate, lease-protected push, and
  `needs-remediation` escalation) in `README.md` and `src/conductor/README.md`.
- `skills/retro/SKILL.md` Data Collection now names `.pipeline/audit-trail/events.jsonl` as the
  primary source for gate/rework history (replacing `.pipeline/gates/` files), documents that a
  missing/empty audit trail despite executed steps must be reported INCOMPLETE rather than read
  as a clean run, and keeps raw `.pipeline/events.jsonl` as the retry-escalation source for Part
  C (issue #328, Story 7).
- New `conduct-ts finish-record --choice pr|keep [--pr-url <url>] --pipeline-dir
  <abs-path>` subcommand: the only supported way to record a finish outcome
  (`.pipeline/finish-choice` marker, and for `pr`, `pr_url` in
  `conduct-state.json`). Fail-closed — any gate failure (unverifiable PR,
  unpushed `HEAD`, corrupt state, bad/missing flags) exits 1 with **no
  writes**. Fixes the bug where the daemon's auto-mode finish step exited
  without ever writing `.pipeline/finish-choice`, permanently stalling the
  gate on try 1 of every ship. Invoked by `engine/step-runners.ts` in
  daemon auto mode, and also runnable manually. See `src/conductor/README.md`
  for the full flag reference.
- **Daemon routes halt-user-input-required through /remediate before halting (#459).** When the
  build step stalls with `.pipeline/halt-user-input-required` (a question the agent could not
  resolve), the daemon dispatches the `/remediate` planner to determine if the question is
  answerable from committed artifacts. Answerable questions are answered in-loop with no retry
  burned; unanswerable questions halt with the original question preserved verbatim in
  `.pipeline/HALT`, so operators never lose sight of what the agent needed. Stall remediations
  share the existing `MAX_KICKBACKS_PER_GATE` budget (no new counter). See ADR-2026-07-10 and
  the updated `/remediate` and `/pipeline` SKILL.md for full details.
- Rekick pre-loop rebase now records rebase step state (#436): the re-kick
  play-forward path (`resumeRebaseFirst`) now calls `recordRebaseStepCompletion`,
  the same helper the in-loop `runRebaseStep` uses, so a satisfied pre-loop
  rebase stamps `state.rebase` instead of leaving it silently unmarked.
- Judged attribution verdicts now advance the build gate in-cycle, not requiring a second loop iteration (#581).
- Harness install/update was dropping the operator's RTK Claude Code hook: `rtk init
  -g --auto-patch` only ran during first-time dependency bootstrap in `install_dependencies`,
  a step `bin/install --update` skips entirely, so any operator running `--update` would lose
  their RTK hook entry (and never regain it, since the stale `--check` "hook initialized"
  sub-check only inspected a deprecated `~/.claude/hooks/rtk-rewrite.sh` script file rather
  than the actual settings entry, so `--check` reported health even after the entry was
  lost). `rtk init -g --auto-patch` now runs on every install *and* update path (idempotent,
  guarded by `command -v rtk`), and the misleading `--check` sub-check was removed. Existing
  installs self-heal automatically the next time they run `bin/install` or `bin/install
  --update` — see `.docs/release-waivers/2026-07-12-rtk-hook-preservation.md` for why no
  separate migration step is required.
- Auto-park decisions are contradiction-checked against completion evidence; a
  build with completed-task evidence is never parked as `empty/missing plan`
  (#612).
- Engine-owned rebases (`performRebase`, used by both the finish-time
  rebase-on-latest step and the daemon re-kick's play-forward rebase) no
  longer orphan sha-anchored evidence citations. Previously, any rebase that
  rewrote commits left `task-evidence.json` (`sha`, `citedShas[]`,
  `verdictAnchor`), `task-status.json` (`commit`), and the
  `attribution-memo.json` judged-stamp memo pointing at pre-rebase shas that
  no longer existed on the branch, silently dangling verified work.
  `performRebase` now builds a `git patch-id --stable` old-sha→new-sha map on
  any commit-changing rebase, persists it to `.pipeline/rebase-rewrites.json`
  (transitive across repeated rebases), rewrites the three file-backed stores
  in place, and resolves satisfied-by trailer citations through the map at
  read time (`validateCitations`, autoheal's satisfied-by resolver) without
  ever rewriting commit message text. Pre-rebase commits that can't be
  matched by patch-id (dropped, or conflict-modified) are surfaced to
  `.pipeline/rebase-residue.json` with a `rebase_citation_residue` event
  instead of dangling silently. No-laundering is preserved: a citation is
  only ever resolved through a sha that was a genuine key in git's own
  pre-image→post-image map for that rebase; forged or unrelated shas still
  fail the existing ancestry check. No new CLI flag, config, or consumer
  action is required — this activates automatically at both call sites. See
  `.docs/decisions/adr-2026-07-12-rebase-evidence-stamp-translation.md`.
- Finish no longer ships a reused needs-remediation halt PR with the halt boilerplate body: the engine-authored banner is now a stateless halt signal, a deterministic `bodyFloor` (mirroring the retitle floor) replaces it with an implementation-PR body (summary, test-evidence line, halt history preserved in comments), the finish completion gate fails while the banner remains (fail-open on gh errors), and repair outcomes are logged (`[halt-pr-rehab]`) instead of silent (ai-conductor#632; specimen PR #610).
- Closed the daemon pool's selection→dispatch operator-park race (#651): a new `guardedDispatch`/
  `guardedDispatchWith` wrapper in `src/conductor/src/engine/daemon.ts` re-checks the operator-park
  predicate **immediately before every dispatch**, not only at `pickEligible` selection time, so a park
  marker written during the `rebuildAndMaybeRestartForStaleEngine` await between selection and dispatch is
  now honored instead of being dispatched anyway (2026-07-13 20:43Z incident). A grep-enumeration
  regression test (`daemon-park-dispatch-guard.test.ts`) asserts every build-start call site is guarded,
  so a future bypassing entry point fails loudly. No CLI/schema/hook-wiring change, so no Migration block.
- daemon park/unpark now resolve the main repo root from any cwd (repo root, a
  linked worktree, or a nested subdirectory) before scanning plans/worktrees,
  so an emergency-stop `daemon park <slug>` no longer fails with a misleading
  "slug not found" when run from inside the affected worktree; outside any
  repo it now errors with the expected usage instead (ai-conductor#534).
- Daemon setup-failure triage now distinguishes a setup-success-with-dirty-tree
  (accurate "dirty tree could not be cleaned" park that quarantines all
  residual uncommitted paths) from a genuine setup failure, and no longer
  reports "setup failed" when `bin/setup` succeeded (#582).
- `bin/update`, a standalone self-update/channel CLI extracted from `bin/conduct`: `bin/update` (no args) forces an update check now, `bin/update --auto` checks only if `autoCheck` config is not `false`, `bin/update --set-channel <tagged|main>` sets the update channel (exit 2 on invalid), and `bin/update -h|--help` prints usage.
- The auto-update check is now re-homed onto `conduct-ts` startup, which spawns `bin/update --auto` as a one-shot subprocess, instead of running inline as bash functions in `bin/conduct`.
- `conduct-ts halt-issues sweep` subcommand: reconciles GitHub issues auto-filed by the
  out-of-repo halt-monitor daemon (`monitor.sh`, #355) against shipped fixes — stamps
  filed issues with a Halt-Slug marker, detects shipping evidence, and closes resolved
  issues (respecting the `halt-sweep:keep-open` label escape hatch). Additive
  subcommand, not a breaking surface — no migration block needed. See `README.md` and
  `src/conductor/README.md` for flags and the `monitor.sh` hook line
  (`conduct-ts halt-issues sweep || true`).

## Migration

Inline build-work attribution enforcement (commit-msg gate + session mutation gate)
ships as new hook assets written by `prepareWorktree` at worktree provisioning time
(`.pipeline/git-hooks/`, `.pipeline/session-hooks/`). Enforcement itself defaults OFF
(no `attribution_enforcement_cutover` in project config), so no worktree's behavior
changes on update. The new hook assets only land in worktrees **provisioned after**
this update, though — a worktree created by an older daemon build will not have the
new `MUTATION_GATE_HOOK`/updated `COMMIT_MSG_HOOK` scripts until it is re-provisioned.
Restart the daemon so it picks up the updated provisioning code for any worktree it
creates going forward; for a worktree already in flight, remove and let the daemon
recreate it (only necessary once a project actually sets
`attribution_enforcement_cutover` — until then the absent hooks have nothing to
enforce).

```bash migration
# Restart a running daemon so subsequently-created worktrees get the updated
# session-hook / git-hook provisioning code (no-op if no daemon is running).
if [ -f .daemon/daemon.pid ]; then
  pid=$(jq -r '.pid // empty' .daemon/daemon.pid 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "Stopped daemon (pid $pid) so it picks up updated worktree hook provisioning on restart."
    echo "Restart with: conduct-ts daemon start"
  else
    echo "No live daemon detected. Existing worktrees keep their current hooks until re-provisioned."
  fi
else
  echo "No daemon pidfile found. Existing worktrees keep their current hooks until re-provisioned."
fi
echo "Enforcement stays OFF until attribution_enforcement_cutover is set in .ai-conductor/config.yml."
```

The build daemon is now hosted inside a tmux session instead of a detached background process.
Any daemon currently running as a detached process must be stopped once so the first
tmux-hosted `daemon start` isn't blocked by the 1-per-repo pidfile lock. This kills only a live
detached daemon for the current repo; a stale lock self-reclaims and needs nothing.

```bash migration
# Stop a currently-detached daemon for this repo (no-op if none / already stale).
if [ -f .daemon/daemon.pid ]; then
  pid=$(jq -r '.pid // empty' .daemon/daemon.pid 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "Stopped detached daemon (pid $pid). Start the tmux-hosted daemon with: conduct-ts daemon start"
  else
    echo "No live detached daemon (stale lock self-reclaims). Use: conduct-ts daemon start"
  fi
fi
# Requires tmux on the host for the management verbs: e.g. `sudo apt-get install tmux`.
```

The built engine is no longer committed. Updating past this version removes the tracked
`src/conductor/dist` symlink and `dist-versions/` snapshot from your working tree — rebuild locally:

```bash migration
# Rebuild the conductor engine (dist is no longer shipped in git).
cd "$(git rev-parse --show-toplevel)/src/conductor" \
  && npm install --no-audit --no-fund \
  && npm run build
```

`bin/conduct` no longer treats unknown subcommands/options as a feature description: unknown
options and bare single-word tokens are rejected with a hint, and conduct-ts verbs (e.g.
`render-diagrams`) are forwarded to `conduct-ts` — which must be on PATH, else the forward
exits 127 (#178).

```bash migration
# bin/conduct now rejects unknown commands instead of silently launching the
# SDLC pipeline, and forwards conduct-ts verbs to conduct-ts. Verify conduct-ts
# is installed so forwarding works:
if command -v conduct-ts >/dev/null 2>&1; then
  echo "conduct-ts found: bin/conduct verb forwarding will work."
else
  echo "WARNING: conduct-ts not on PATH — forwarded verbs will exit 127."
  echo "Re-run bin/install to build and link conduct-ts."
fi
# Reminder: bare single-word feature descriptions are now rejected — quote
# multi-word descriptions instead, e.g.:  conduct "add user auth"
```

The `post-commit-pipeline-sync.sh` hook has been removed (Task 15). Task-status.json completion is now
owned by the engine; third-party writers are no longer registered. It has been replaced by
`post-commit-derive-feedback.sh` (Task 28), which provides fast-feedback warnings on commits
lacking a `Task: <id>` trailer. If you have the old hook from a prior harness version, it can be
safely deleted — the engine will own task-status updates, and the new hook runs
non-fatally to warn on missing evidence:

```bash migration
rm -f .claude/hooks/claude/post-commit-pipeline-sync.sh
# Install the new fast-feedback derive hook in your project's .git/hooks:
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo '.')"
HARNESS_ROOT="${PROJECT_ROOT}/.claude/harness"  # or wherever the harness is checked out
if [ -d "$PROJECT_ROOT/.git" ] && [ -f "$HARNESS_ROOT/hooks/claude/post-commit-derive-feedback.sh" ]; then
  cp "$HARNESS_ROOT/hooks/claude/post-commit-derive-feedback.sh" "$PROJECT_ROOT/.git/hooks/post-commit"
  chmod +x "$PROJECT_ROOT/.git/hooks/post-commit"
  echo "Installed fast-feedback post-commit hook"
fi
```

### Changed

- **`conduct-ts daemon start` now auto-attaches to the daemon's tmux session (conduct-ts).** After
  starting, `start` hands the terminal to the live session read-only (like `daemon connect`) so the
  operator lands in it instead of having to attach separately. Pass **`-D` / `--detach`** to keep the
  old fire-and-forget behavior. The attach is suppressed automatically when there is no interactive
  terminal (scripts, the engineer auto-launch) so `start` never blocks/fails on `tmux attach` —
  it starts detached and prints how to attach. The engineer auto-launch is unaffected (it calls
  `supervisor.start` directly, not the CLI verb).

- **Rebase discipline moved from the `block-destructive-git` hook into the skill prompts +
  HARNESS.md.** The hook previously *hard-blocked* every ad-hoc `git rebase` (exit 2). That also
  rejected the two legitimate cases — an operator deliberately refreshing a stale PR branch onto
  its base, and the `/rebase` resolver — forcing awkward workarounds. The hook now **allows**
  `git rebase` and emits a single non-blocking reminder instead; `--continue/--abort/--skip/
  --edit-todo` pass silently. The "never rebase mid-build" rule is now stated canonically in a new
  **HARNESS.md → Rebase Policy** section and reinforced in the build-loop skills (`tdd` COMMIT
  phase step 7; `pipeline` already instructs the implementation subagent). Force-push,
  `reset --hard`, unmerged `branch -D`, `clean -f`, and `checkout -- .` remain hard-blocked.
- **`bin/install --check` now exits non-zero on drift.** It previously printed missing/stale-skill
  warnings but always exited 0 (the last statement was an `echo`), so it couldn't be scripted. It now
  `return`s 1 when any skill is missing/stale (and the `--check` dispatcher propagates it via
  `exit $?`), enabling the new install-freshness guard to gate on the exit code.

### Fixed

- **The SHIP `architecture_review_as_built` gate no longer runs when architecture was skipped, and
  is now fail-closed.** On a Small-tier feature the DECIDE-phase `architecture_diagram` +
  `architecture_review` are skipped (no ADRs), but the as-built compliance gate still ran — auditing
  shipped code against APPROVED ADRs that never existed. Its completion predicate was also
  fail-**open**: it passed on any verdict that wasn't the literal word `BLOCKED`, so a confused
  no-ADR review marked the step `done` and the daemon loop ended without a `DONE` or `HALT` marker
  (classified `error`, worktree stranded). Two fixes: (1) `architecture_review_as_built` now skips
  whenever `architecture_review` was skipped — `skippableForTiers: ['S']` plus a new declarative
  `skipWhenSkipped: 'architecture_review'` that also covers config-disable / `when:` skips on
  Medium/Large; (2) the predicate is now **fail-closed** — it passes only on an explicit `APPROVED`
  / `APPROVED WITH DRIFT NOTES` verdict and stays unsatisfied (→ proper HALT) on `BLOCKED`, a
  missing `Verdict:` line, or any unrecognized verdict. Observed on `jstoup111/random-number-api`.
- **Daemon runs always leave a terminal `DONE`/`HALT` marker now (no more stranded `error`
  exits).** The daemon classifies a feature run solely by `.pipeline/DONE` vs `.pipeline/HALT`
  (`daemon-deps.readWorktreeOutcome`), but a few early `return`s in `Conductor.run()` — a blocked
  gate (prerequisites unsatisfied) and a parallel-group gating failure — exited without writing
  either, so the daemon reported a bare `error` and stranded the worktree ("loop ended without DONE
  or HALT marker"). Rather than patch each return site (fragile — a future return reintroduces the
  gap), `run()` now enforces the invariant structurally: the success path writes `DONE` when
  convergence didn't (e.g. a resume that ran no tail step), and a `finally` backstop writes a
  diagnostic `HALT` if a daemon run reaches it with neither marker. Interactive runs (`daemon:false`)
  are untouched. Follow-up to the as-built fix, which closed the specific path that first surfaced
  this on `jstoup111/random-number-api`.
- **`/finish` now refuses a mid-rebase/mid-merge tree (skill GATE 0).** A `/finish` dispatched on a
  worktree with a paused rebase (e.g. `conduct-state` marked `rebase` done but the tree was still
  mid-conflict) would grind for ~15 minutes and then push a PR of a detached, half-rebased branch.
  The skill's generic "check git status" step was too weak for a small model to enforce, so the
  finish skill now has an explicit **GATE 0**: before anything else, refuse to proceed if `git status`
  shows a rebase/merge in progress, a `rebase-merge`/`rebase-apply` dir exists, or
  `git diff --diff-filter=U` is non-empty — STOP without running tests, pushing, opening a PR, or
  writing `.pipeline/finish-choice`, so the conductor HALTs for resolution instead of shipping broken
  work. Enforced in the skill itself rather than via an engine-side workaround.
  The `needs-remediation` escalation is gated on the daemon flag, but as a belt-and-suspenders guard
  the production `makeProductionGh`/`makeProductionGit` runners now throw under
  `AI_CONDUCTOR_NO_REAL_EXEC` (set by the vitest global `test/setup.ts`). This prevents a test that
  reaches a real runner from mutating live GitHub — previously an auto-mode failure test reused a
  live PR and added a `needs-remediation` label + comment. Scoped to this seam only; the real-`git`
  integration tests (rebase / daemon-rekick) use their own execa paths and are unaffected.
- **`conduct-ts daemon --help` launched a daemon instead of printing help (conduct-ts).** The daemon
  sub-verbs are intercepted before commander parses, so `--help`/`-h` after `daemon` fell through to
  `detectDaemonCommand` and **started a real daemon run** (it would scan the backlog and could
  re-kick/dispatch a feature) — a genuine footgun. `daemon --help`/`-h` now prints a daemon-scoped
  help surface (`renderDaemonHelp`) and exits, and a typo'd sub-verb (`daemon strt`) prints that help
  with a clear error + exit 1 instead of launching (`detectUnknownDaemonSubcommand`). The management
  verbs (`start`/`stop`/`restart`/`connect`/`debug`) are now also **documented in `--help`** — they
  were missing because only `status`/`logs` were registered on the commander `daemon` command.

- **Daemon build worktrees now fork from `origin/<default>`, not local `<default>` (conduct-ts).**
  A fresh per-feature worktree was cut from the daemon's LOCAL default branch
  (`git worktree add -b <branch> <path> main`). But `fastForwardRoot` only advances
  local `main` while the root checkout is actually on it — so whenever another
  process leaves the root on a different branch or a detached `HEAD` (e.g. an
  in-progress rebase), local `main` silently goes stale and every new worktree
  built against old code, even though `origin/main` had advanced. `createWorktree`
  now resolves the build base via `resolveWorktreeBase`, preferring the
  remote-tracking `origin/<default>` tip (falling back to local `<default>` only
  when `origin/<default>` is unresolvable — a local-only repo never fetched). The
  fast-forward path and backlog discovery are intentionally unchanged. Covered by
  new `daemon-deps` tests (origin/<base> base + local fallback) and a real-binary
  smoke of `git rev-parse --verify --quiet` + `git worktree add … origin/<default>`.

- **Test suite leaked real build daemons; added an auto-launch kill-switch (conduct-ts).** Several
  engineer tests exercise the real handoff `ensureRunning` without injecting a launch, so under
  ADR-014 each run spawned a real `tmux new-session -d 'conduct-ts daemon --continuous'` daemon that
  outlived the test's tmpdir (pre-ADR-014 it leaked detached node procs; the tmux host just made it
  visible + persistent). Added an operational kill-switch env `AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH=1`
  honored by `launchDaemon` — it suppresses the **default** (non-injected) real launch while leaving
  an explicitly injected supervisor untouched (so the delegation unit tests still assert their
  contract). A global vitest setup (`test/setup.ts`) sets it for the whole suite, so no test spawns a
  real daemon and future tests can't re-introduce the leak. The flag also lets an operator who manages
  daemons by hand disable the engineer's auto-launch.
- **Silent daemon-launch failure on a tmux-less host (engineer).** The engineer's fire-and-forget
  `ensureRunning` nudge is the only production path that starts a daemon, and under the
  daemon-supervisor ADR it now routes through `supervisor.start` (tmux). On a host without tmux that throws
  `TmuxNotInstalledError`, which the handoff caught and **silently swallowed** — authoring the spec
  PR while launching no daemon, so specs would pile up unbuilt with no signal. Both handoff sites
  (`engineer-cli.ts` claim path and `handoff-step.ts`) now keep the failure **non-blocking** (the
  spec branch still lands) but **surface the reason** (`⚠ Spec authored, but the build daemon was not
  started for "<repo>": <reason>`). No change on a tmux-present host.
- **Type error in the github-issues intake adapter (conduct-ts).** `maybeReopen` typed its `repo`
  parameter as `{ name; path }`, omitting the `ghRepo?` field that `RepoLister.list()` actually
  provides and that the function body reads (`repo.ghRepo ?? repo.name`). This produced a
  `tsc --noEmit` error (TS2339). Widened the parameter type to `{ name; path; ghRepo? }` to match
  the data the caller passes; `tsc` is now clean. No behavior change.
- **Daemon finish HALT when cleanup `cd`s into the main repo (conduct-ts).** In auto/daemon
  mode the finish step wrote its completion markers (`.pipeline/finish-choice` and the `pr_url`
  in `.pipeline/conduct-state.json`) via relative paths, but the finish skill's branch/PR/worktree
  cleanup `cd`s into the *main* repo — so the writes landed in the wrong repo while the completion
  gate reads the *worktree's* `.pipeline`. A feature whose PR was genuinely created would HALT with
  "`.pipeline/finish-choice` is missing". The auto-finish system prompt now directs the marker
  writes to the **absolute worktree `.pipeline` paths** (from `pipelineDir`, with a relative
  fallback when unset), instructs the session to write them **before** any merge/cleanup, and to
  reuse an existing PR (`gh pr view`) instead of failing. Skill docs updated to match.

### Added

- **DECIDE spec for Background Auto-Intake on the Conduct Loop (planning artifacts only).** Lands the
  approved PRD, stories (FR-1…FR-12), conflict report, architecture diagram, two APPROVED ADRs
  (`adr-2026-06-30-background-intake-brain-loop`, `adr-2026-06-30-origin-seeded-intake-routing`), and
  the implementation plan under `.docs/`. Designs a mechanical, zero-token brain/supervisor intake
  loop that polls all registered repos, captures (ledger-deduped) + routes by origin + notifies, with
  DECIDE staying human-gated. Implementation is built separately from the merged spec; no behavior
  ships in this PR.
- **Install-freshness guard — the daemon refuses to start on a stale harness install (conduct-ts).**
  A harness update (git pull / merged PR) does NOT relink skills — that only happens when
  `bin/install` runs — so a newly-added skill can exist in `skills/` but be missing from
  `~/.claude/skills/`. A daemon-dispatched `claude -p '/<skill>'` then hits "Unknown command",
  returns empty output, and the conductor HALTs with a cryptic `rebase skill returned no parseable
  result` (this exact gap left the new `/rebase` resolver unrunnable on the daemon — every dispatch
  silently no-op'd). A new guard (`install-freshness.ts`) runs `bin/install --check` at daemon entry:
  on drift, `daemon start` **prompts** to run `bin/install --update` (decline ⇒ it refuses to start);
  the continuous daemon run (and any non-interactive launch, e.g. the engineer handoff auto-launch)
  **fails hard** with an actionable message rather than silently dispatching unregistered skills. If
  the harness root can't be located the check is skipped (never blocks an otherwise-working install).
- **Daemon PR labeling — `needs-remediation` draft PR + `mergeable` label sweep (daemon-only).**
  On **any irrecoverable daemon HALT that strands committed work** — a build/gating-step failure
  (retries exhausted), a prd-audit product/plan gap needing human DECIDE, the kickback-ping-pong or
  stuck-gate caps, or an unexpected conductor error (the rebase-conflict HALT is excluded) — when
  the feature branch has at least one commit, the daemon pushes the branch and opens a **draft PR**
  labeled `needs-remediation` with a comment explaining the HALT reason (which names the failing
  step); when there are zero commits, no GitHub artifacts are produced (FR-6). An existing open PR
  for the branch is reused rather than duplicated (FR-5). PRs
  from features that reach `done` are enrolled in a per-repo watch registry
  (`.daemon/mergeable-watch.jsonl`); a best-effort sweep — on daemon startup, after each feature
  completes, and per idle poll tick — keeps the `mergeable` label in sync: added when the PR is
  open + conflict-free + CI-green, removed when not, pruned when merged/closed (FR-10..FR-14). A
  `needs-remediation` PR is never labeled `mergeable` (FR-12). When a failed feature is re-kicked
  and completes successfully, the daemon clears the stale `needs-remediation` label and un-drafts
  the PR before enrolling it in the sweep (FR-16). All labeling is best-effort and non-blocking —
  a GitHub step failure is logged and never disrupts the daemon's core processing (FR-7, FR-15).
  Daemon-only; interactive runs are unchanged (FR-8, FR-15). PRD:
  `.docs/specs/2026-06-29-daemon-pr-labels.md`.
- **Pluggable memory provider — `local` built-in with canonical shared store.** The harness now
  selects the memory backend via a per-project `memory_provider:` key in `conduct.yml`
  (adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration/adr-2026-06-29-per-project-memory-provider-selection); the only built-in is `local`. The `local` provider stores all `.memory/`
  content in a durable project-keyed canonical directory at
  `~/.ai-conductor/memory/<sha256-of-origin-url>/harness/` and places `.memory/` as a symlink
  to it — making the store branch-/worktree-independent and safe under concurrent builds
  (adr-2026-06-29-shared-memory-store-placement-and-durability). On first `conduct` run `bin/conduct` calls `conduct-ts memory setup <dir>`, which
  creates the canonical store with the four standard categories (`decisions/`, `patterns/`,
  `gotchas/`, `context/`) plus `index.md`, then atomically symlinks `.memory/` to it. If `.memory/`
  already exists as a real directory (legacy project), `migrateMemory` copies its contents to the
  canonical store, verifies, and swaps before creating the symlink (adr-2026-06-29-safe-reversible-memory-migration); the migration is
  idempotent and automatic (see Migration below). **FR-3 invariant:** the harness contains zero
  memory search, ranking, or embedding logic — recall is always the agent reading `.memory/` files
  and judging relevance. New modules: `engine/memory-store.ts`, `engine/memory-migrate.ts`,
  `engine/memory-cli.ts`; new config field `memory_provider` in `engine/config.ts`; `bin/conduct`
  wires `run_memory_store_setup` at bootstrap entry (new `LocalMemoryProvider` in
  `engine/config.ts`).

- **FR-3 invariant check (integrity suite section 8).** `test/test_harness_integrity.sh` gains a
  new section 8 that asserts no harness-side code in `src/conductor/src/`, `bin/`, `hooks/`, or
  `skills/` contains memory-retrieval patterns (`embed(`, `cosineSimilarity`, `vectorSearch`,
  `relevanceScore`, `rankScore`) — so the "recall is always the agent" contract cannot be silently
  broken by a future PR. The engineer flywheel directory is excluded (`--exclude-dir=engineer`).
  The previous version-integrity section is renumbered to 9.
- **tmux-supervised daemons — start / stop / restart / connect / debug (conduct-ts).** The per-repo
  build daemon is now hosted as a **foreground process inside a per-repo tmux session**
  (`cc-daemon-<slug>`) behind a swappable **Supervisor port** (tmux adapter now; a kubectl adapter
  later, no execution-core change). New operator verbs: `conduct-ts daemon start` (idempotent — never
  a duplicate), `stop`, `restart`, `connect` (read-only live colored watch), `debug` (read/write
  attach). `daemon status` now also reports tmux **session up/down** (so a stale pidfile with a live
  orphaned session is distinguishable). The former detached `stdio:'ignore'` spawn (the launch helper,
  renamed `launchDaemonDetached` → `launchDaemon`) now delegates to `supervisor.start`, so an
  engineer-nudged daemon is also attachable — while the engineer stays **launch-only** (ADR-005
  non-management intent preserved; the daemon-supervisor ADR supersedes only the spawn mechanism).
  The daemon runs **serially** (concurrency clamped to 1; `--concurrency > 1`
  is clamped with a logged note). The tmux-hosted daemon is **long-lived by design** — the session
  command is `conduct-ts daemon --continuous` and deliberately drops the former engineer launch's
  `--max-idle-polls` self-limit so an operator can attach to a running daemon at any time; its bound
  is the operator `stop` verb (and reboot), not an idle timeout (daemon-supervisor ADR §7). The
  intake/execute **work-source seam** is formalized (the run loop
  consumes `BacklogItem`s from an injected source; local in-process adapter unchanged). The daemon
  still builds with **no tmux present** (management is purely additive — bare-run invariant).
  `bin/conduct` now forwards `daemon <verb>` to `conduct-ts` (previously `conduct daemon status`
  mis-launched a feature build named "status"). See
  `.docs/decisions/adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting.md` and
  `.docs/plans/2026-06-29-daemon-tmux-supervisor.md`.
- **Gated rebase-conflict resolution + attempt-cap config (conduct-ts).** The daemon's
  finish-time `rebase` step now attempts skill-driven conflict resolution (via the new
  `/rebase` skill) before HALTing on a non-CHANGELOG conflict. The number of attempts is
  configurable via `rebase_resolution_attempts` (config key; default **3**; set to **0** to
  restore the previous immediate-HALT behavior). A resolution is accepted only when the branch
  is genuinely current with the base (FR-8) and no feature commits were dropped (FR-9);
  a code-changing resolution kicks back to `build`/`manual_test` through the existing
  kickback machinery. If all attempts are exhausted the engine falls through to the existing
  HALT path. The gated resolution loop runs only in daemon mode; interactive `/conduct` runs
  and the `/rebase` skill invoked manually by an operator are unchanged.
- **Mermaid diagram renderer — visuals at the architecture approval gates (install + conduct-ts).**
  Generated architecture diagrams and DRAFT ADRs (Mermaid-in-Markdown) can now be reviewed as
  rendered visuals instead of raw Mermaid. `bin/install` offers a renderer choice mirroring the
  markdown-viewer flow — presets `html` (default; self-contained mermaid.js page opened in the
  default browser, no native dependencies, works anywhere), `mmdc-png`/`mmdc-svg` (via
  `@mermaid-js/mermaid-cli`), and `none` — persisting it as
  `mermaid_renderer.{preset,command,args,mode}` in
  `~/.ai-conductor/config.yml`; `install --check` reports its status. At the conduct-ts approval
  gate, `reviewArtifacts` renders a reviewed file's diagrams (after showing the raw Markdown as an
  always-present fallback) via the merged-config preset; a new `conduct render-diagrams <file>...`
  subcommand renders on demand. The renderer is best-effort by contract: it never throws, isolates
  per-diagram failures, HTML-escapes diagram source, and always surfaces a notice on skip/failure
  so the gate is never blocked. `README.md`, `src/conductor/README.md`, and the
  architecture-diagram / architecture-review skill docs updated.

- **Richer daemon startup dashboard — "state of everything" per repo (conduct-ts).** The
  inherited-state dashboard printed before any dispatch now carries the bits an operator
  actually triages on, mined best-effort from each worktree's `conduct-state.json` (and the
  processed ledger): HALTED and IN-PROGRESS rows show the **complexity tier**, the **step** the
  feature reached, and the **open PR link** if one exists; ELIGIBLE rows show the **tier** of
  each queued feature; PROCESSED now **lists each shipped slug with its PR link** (not just a
  count). To support the shipped-PR links, the `.daemon/processed/` ledger is now written as
  JSON (`{ status, prUrl }`) — legacy plain-text `shipped` entries still parse (no PR), so this
  is backward-compatible. All enrichment is best-effort: a malformed `conduct-state` still
  appears (step `unknown`, no tier/PR), and a per-worktree fs error is skipped — the scan never
  aborts startup. `README.md` and `src/conductor/README.md` updated.

- **GitHub issue ↔ PR linkage + auto-close on implementation merge (conduct-ts).**
  github-issues intake previously commented on an issue but never linked or closed it, so an
  issue stayed open even after its spec PR and the daemon's implementation PR both merged. The
  originating issue reference now travels WITH the spec via a committed `.docs/intake/<slug>.md`
  marker (`Source-Ref: owner/repo#N`), written by both authoring paths (`engineer land
  --source-ref` and the autonomous `runAuthoring`). The **spec PR** gets a non-closing
  `Refs owner/repo#N` (links the issue without closing it); the daemon reads the marker from the
  merged base-branch tree (`BacklogItem.sourceRef`) and adds `Closes owner/repo#N` to the
  **implementation PR**, so GitHub auto-closes the issue when the real work merges. All injection
  is gated on a parseable ref (hand-authored specs are unchanged), idempotent, and non-fatal (a
  `gh` failure never affects a delivered PR or build). New shared helper
  `engineer/issue-ref.ts` (`parseSourceRef` / `injectIssueRef` / `closeIssueOnImplementationMerge`)
  is the single source for parsing + linking.

- **OpenTelemetry exporter for conductor runs (Phase 1).** A new opt-in
  `otel:` config block wires the conductor event bus to an OTel tracer/meter
  pipeline (ADR-014). When enabled, each run produces one root trace span
  (`conductor.run`) with a child span per step, plus `conductor.step.duration`
  (histogram), `conductor.step.retries` (counter), and `conductor.step.tokens`
  (counter, only when tokenUsage is present) metrics. Two transports: `exporter:
  otlp` (HTTP/protobuf on port 4318 by default, gRPC/4317 via `protocol: grpc`)
  and `exporter: file` (OTLP-JSON newline-delimited at `.pipeline/otel.jsonl`).
  Feature is default-off (absent `otel:` block → zero overhead). Coexists with
  `events.jsonl` and `--report` — event emission sites are unchanged. Export
  failures emit at most one bounded warning via `onWarning` and never affect the
  run (FR-8). Incomplete spans on abrupt termination are force-closed ERROR with
  `conductor.incomplete=true` (FR-9). SIGINT/SIGTERM handlers trigger a
  best-effort flush within the configured `exportTimeoutMillis` bound.

- **Engineer authors the full DECIDE phase (engineer).** The `/engineer` idea→spec loop now runs
  the complete, build-ready DECIDE set in canonical order —
  brainstorm → **complexity** → stories → **conflict-check** → **architecture-diagram** →
  **architecture-review** → plan — instead of only brainstorm→stories→plan. The operator-assessed
  complexity tier is persisted to `.docs/complexity/<plan-stem>.md`, and conflict-check +
  architecture steps are tier-skipped for Small (mirroring conduct's `skippableForTiers: ['S']`).
  `engineer land` now commits the full `.docs` DECIDE set and **rejects** a DRAFT ADR or a
  tier/artifact mismatch (non-Small with missing architecture artifacts). The daemon reads the tier
  from `.docs/complexity/` (via `discoverBacklog` → `BacklogItem.tier`) and seeds the build's
  `complexity_tier` from it, replacing the previously hardcoded `'M'`; specs with no marker fall
  back to `'M'` (unchanged behavior). Shared `hasDraftAdr` / `parseComplexityTier` predicates added.
- **Implementation subagents must not fetch/rebase/pull (pipeline).** Every per-task dispatch
  prompt now instructs the implementation subagent to NOT run `git fetch`/`pull`/`rebase` or switch
  branches — it commits only to the current feature branch. Prevents the mid-build auto-rebase onto
  a moved `origin/main` that stalled a feature branch in a CHANGELOG conflict. Reaffirms that the
  only sanctioned rebase is the daemon's finish-time, daemon-gated rebase-onto-latest.
- **Type-check gate in the TDD DOMAIN/COMMIT phase.** The post-GREEN DOMAIN phase now runs the
  project's type-checker (e.g. `tsc --noEmit` / `npm run typecheck`) as a mechanical pre-check
  before the domain reviewer is dispatched — a type error returns straight to GREEN rather than
  shipping to batch, PR, or CI. Re-confirmed at the COMMIT hard gate. Conditional on tech-context:
  skipped silently for stacks with no compile step (e.g. Rails). Catches stale imports / renamed
  properties / signature drift introduced by the GREEN agent at the cheapest point — the cycle
  boundary — instead of at PR-creation time (`/pr`) as it does today.
- **Negative-path category: invariant side-effect on alternate branches (stories).**
  Adds a mandatory negative-path category to `/stories`: when a happy path delegates a critical
  side effect (record/ledger write, cleanup, metric, cache invalidation) to a helper, every
  alternate branch that can bypass that helper (error path, no-remote/offline, degraded mode,
  early return) needs its own scenario asserting the side effect still occurs. Closes the gap that
  shipped a no-remote authoring path silently skipping the authored-ledger write.
- **Adversarial-derivation coverage gate (writing-system-tests §3d + domain reviewer).**
  Generalizes the orphaned-primitive (§3b) and path-guard (§3c) rules to *all* security/correctness
  derivations (redaction, auth/permission predicates, path/identity checks, state guards): the spec
  generator must produce a failing test for **every production call site** of the derivation, fed
  the **real adversarial input that site passes** (token-bearing URL, trailing-slash/sibling/
  traversal path, dirty/stale state, empty/boundary), asserting the observable guarantee at that
  site — not the helper's return value in isolation. The TDD domain reviewer gains matching veto
  checks (call-site coverage after RED, derivation-reached-at-every-call-site after GREEN), and the
  dispatcher now feeds the reviewer the derivation's call-site list. Closes the injected-stub blind
  spot that shipped CRITICAL/HIGH bugs caught only by the fresh-context evaluator across three
  consecutive phases.
- **Daemon halt-reconciliation — startup dashboard + main-advance re-kick (ADR-013).**
  On startup, before any dispatch, the daemon now scans `.worktrees/*/` and the
  `.daemon/processed/` ledger and prints a four-group inherited-state dashboard
  (HALTED / IN-PROGRESS / ELIGIBLE / PROCESSED, precedence in that order) to both
  stdout and `daemon.log`. It also tracks the base-branch tip SHA, persisting the
  last-seen value to **`.daemon/last-base-sha`** (corrupt/empty/non-40-hex →
  treated as absent, never a spurious advance). On a genuine base-SHA advance —
  observed live during an idle refresh, or at startup versus the persisted value
  (a base that moved while the daemon was down) — the daemon **re-kicks every
  halted feature**: it aborts any paused 9.0 rebase (a failed abort leaves the
  marker intact), preserves the reason to **`.pipeline/HALT.cleared`**, removes
  `.pipeline/HALT`, and drops a **`.pipeline/REKICK`** sentinel. Re-kick issues no
  direct dispatch — clearing the marker lets PR #109's existing un-park path
  re-dispatch the feature, which then resumes **rebase-first** (9.0's
  rebase-onto-latest runs before the pending gate re-verifies, so an advanced base
  is integrated first). The re-kick is bounded by a per-feature last-rekick SHA
  (a same-SHA re-halt is not re-kicked again), and a plain restart with no advance
  honors all markers exactly as PR #109 does. New modules: `engine/daemon-sha.ts`,
  `engine/daemon-dashboard.ts`, `engine/daemon-rekick.ts`; new optional
  `DaemonDeps` hooks wired in `daemon-cli.ts`.

- **GitHub-issues intake now fires on the live `conduct-ts engineer` launch.**
  Previously poll-on-launch lived only in the test-only `runEngineerMode` harness,
  so bare `conduct-ts engineer` dropped straight into `claude /engineer` and never
  ran intake (only the standalone `conduct-ts engineer poll` did). The launcher now
  **pre-polls** github issues and enqueues new ones before spawning the session
  (`Intake: N issue(s) queued.`), and a new **`conduct-ts engineer claim`**
  subcommand lets the `/engineer` skill atomically dequeue the oldest idea at
  step 1. An idea can now come from three sources — github intake, a CLI arg
  (`conduct-ts engineer "<idea>"` / `--idea "<idea>"`, which skips the poll), or
  direct chat. `land`/`handoff` gain an optional **`--source-ref <owner/repo#N>`**
  that threads write-back (routed comment → done comment + `engineer:handled` label
  + ledger transition) back to the originating issue via the new shared
  `intake/writeback.ts` helper. Write-back stays advisory — a `gh` failure never
  blocks a land or reverts a delivered spec PR. Updates `skills/engineer/SKILL.md`
  (claim-first capture + `--source-ref` threading) and the conductor README.

- **Autonomous gap remediation (`/remediate`) — a blocking `prd_audit` is routed,
  not just halted.** When a daemon `prd_audit` blocks, the conductor now dispatches
  the new `/remediate` SHIP sub-routine, which reasons over the per-FR gaps and
  writes `.pipeline/remediation.json` assigning each a disposition: `build` /
  `acceptance_specs` / `architecture_review` / `plan` (autonomous — routed back to
  that step with the concrete gap + tasks in the kickback hint), or `halt` with a
  category. **HALT is reserved for the two genuinely-human cases — `architectural-
  clarity` and `product-scope`;** everything else is turned into routed work. Mixed
  gaps fix the autonomous ones first (kick to the earliest target step, bounded by a
  remediation cap), and the human gaps re-surface on the next audit and HALT then.
  Routing stays deterministic (the conductor reads the structured plan); the
  *judgment* is the agent's. Falls back to the deterministic `classifyPrdAuditGaps`
  routing when no usable plan is produced or the budget is exhausted. Adds
  `skills/remediate/SKILL.md` + `agents/remediation-planner.md`.

  _Planned follow-up:_ extend the same machinery to **finish-time test/build
  failures** — flake-check first, then route real failures back to `build` with
  cleanup tasks instead of `/finish` parking the branch.

### Changed

- **`.memory/` is now a symlink to the shared canonical store, not a tracked in-project
  directory.** `bin/conduct` sets up the canonical memory store via `conduct-ts memory setup`
  before any bootstrap sub-step runs, so `.memory/` is always a symlink when the bootstrap skill
  executes. The bootstrap skill's Step 5 `.memory/` creation instruction is removed — do not
  `mkdir .memory/` in a project; the directory will already be a symlink. Existing real `.memory/`
  directories in consumer projects are migrated automatically on the next `conduct` run (see
  Migration below).
- **ADRs are no longer sequentially numbered — named `adr-YYYY-MM-DD-<kebab-slug>.md`.**
  Sequential numbering (ADR-001, ADR-007, …) collides when parallel worktrees each grab
  "the next number" for a concurrently-authored decision. ADRs now use a date plus a short
  descriptive slug as both filename and identifier; supersession and verdict references cite
  the filename stem instead of a number. Updated `templates/adr.md.template` (dropped the
  `{{NUMBER}}` header) and the `/architecture-review`, `/conflict-check`, `/conduct`, and
  `/remediate` skill docs. Applies to **newly created ADRs only** — existing numbered ADRs
  keep their names (ADRs remain append-only).

- **`.serena/` is now gitignored in scaffolded and onboarded projects.** Serena's
  MCP server writes a `.serena/` directory (semantic-symbol cache, `project.yml`,
  and machine-written `memories/`) into whatever project it runs against. Since
  the harness registers Serena at user scope, every consumer project picked up
  this directory as untracked state. It's regenerated locally and not source, so
  `conduct create` now seeds `.serena/` into the `.gitignore` skeleton
  (`registry-cli.ts`) and `/bootstrap` adds it when onboarding an existing
  project. The harness repo's own `.gitignore` ignores `.serena/` (and the
  session-local `.handoffs/`) too.

- **Run-specific SHIP artifacts moved from tracked `.docs/` to gitignored
  `.pipeline/` with stable filenames.** `manual_test`, `prd_audit`, and
  `architecture_review_as_built` now write their evidence to
  `.pipeline/manual-test-results.md`, `.pipeline/prd-audit.md`, and
  `.pipeline/architecture-review-as-built.md` (a stable name, overwritten each
  run) instead of date-stamped files under `.docs/`. These are run evidence, not
  durable design records, and tracking them caused three recurring failures:
  (a) the daemon's finish-time rebase precheck HALTed on the dirty/uncommitted
  tree they left behind (`cannot rebase: you have unstaged/uncommitted
  changes`), parking the feature for a human — this halted features twice in
  practice; (b) a new date-stamped file accumulated every run (artifact sprawl)
  and conflicted on rebase/merge; (c) the as-built freshness gate retried every
  run because the prior session's date-stamped file was always stale. Durable
  design docs (PRDs, stories, plans, ADRs, and the design-time architecture
  review) remain tracked in `.docs/`. Gate completion checks now read the new
  `.pipeline/` paths; their on-disk freshness logic is unchanged. Old tracked
  copies left in existing repos (`.docs/audits/*-prd-audit.md`,
  `.docs/decisions/architecture-review-as-built-*.md`,
  `.docs/manual-test-results.md`) are now inert and may be removed with
  `git rm`.

### Fixed

- **Daemon rebase step now uses `git rebase --autostash`, so a dirty worktree no
  longer mis-parks as a "rebase conflict" the operator can't resolve.** A build or
  lint step can leave uncommitted changes in the worktree (e.g. a formatter
  dropping an unused import without committing). Plain `git rebase` refuses with
  *"cannot rebase: You have unstaged changes"*; `performRebase` saw a non-zero exit
  with **zero unmerged files** and HALTed it as a `conflict_halt` whose reason was
  the unstaged-changes error — leaving the feature stuck in a re-kick loop that
  could never succeed (the dirty tree blocked every retry). `--autostash` stashes
  the stray changes, rebases, and reapplies them, so a clean (non-overlapping)
  rebase succeeds with a dirty tree. A genuine overlapping conflict still HALTs
  (covered by a new real-git test alongside the dirty-tree case).

- **Daemon now fast-forwards its root checkout on each idle poll and cuts
  worktrees from fresh `main` — eliminating spurious `ENOENT` HALTs when local
  `main` lagged origin.** The daemon discovered/validated specs against the
  `origin/<default>` remote-tracking tree but *materialized* them by `copyFile`-ing
  from the local working tree, which it only ever `fetch`ed — never advanced. Once
  a spec PR merged on origin while the local checkout sat behind (the steady
  state), discovery found the spec yet the copy failed (`copyfile … .docs/stories/
  <slug>.md`). Root-fixed by replacing the fetch-only discovery ref with
  `fastForwardRoot`: on each idle poll the daemon does a **safe** `git merge
  --ff-only origin/<default>` of its checkout (only when on the default branch with
  a clean tree — otherwise it logs a warning and skips, never clobbering), then
  discovers and cuts each worktree from that now-current branch. Because the
  worktree forks from fresh `main`, the vetted stories+plan already exist in it, so
  the brittle `materializeSpecs` copy step is **removed entirely** (`BacklogItem`
  no longer carries working-tree paths). The fast-forward runs only between work
  (never mid-build) and never touches in-flight worktree checkouts.

- **Conductor now deletes a stale prior-session `.pipeline/` artifact before
  re-running a FAILED or REWORKED gated re-review step — reuse-loop HALTs are
  impossible by construction.** This is the deterministic complement to the
  as-built skill-prose fix: instead of trusting an unattended agent to rewrite, the
  conductor sweeps the stale artifact for `manual_test` / `prd_audit` /
  `architecture_review_as_built` (`sweepStaleReviewArtifacts`), so the agent cannot
  satisfy the freshness gate by reusing a prior-session artifact it declined to
  rewrite — it must regenerate it this session, or the gate fails honestly as
  "missing". The sweep fires **only when re-entering a step whose prior status was
  `failed` or `stale` (kicked back)** — never on a clean first run, which has no
  prior attempt to reuse. Scoped to those three SHIP re-review steps; `build`'s
  cumulative `task-status.json` is never swept; no-op when `session_started_at` is
  unset (legacy → fail open) or the artifact is already fresh this session
  (within-session retries keep their output).

- **As-built architecture review now (over)writes its artifact on every run, so
  a resumed feature stops HALTing on a "stale" gate.** `session_started_at` is
  reset on every conductor (re)start, and the as-built completion gate checks the
  artifact's mtime against it. The `architecture-review --as-built` skill said the
  artifact is "overwritten each run" only descriptively, so in unattended mode the
  agent reused a prior-session artifact it judged "more complete" and never
  rewrote it — the gate then read it as stale, failed, and (after retries) HALTed
  the SHIP tail. Observed live on honeydew after the feature resumed across the
  remediate/prd-audit fixes. The skill now makes the write an unconditional,
  final-action imperative that explicitly preempts the reuse rationalization and
  names the stale-gate consequence. (`skills/architecture-review/SKILL.md` §12.)

- **PRD-audit completion gate no longer false-blocks an ALIGNED FR when its
  Evidence prose contains a verdict word.** The gate's row parser scanned the
  whole table row for `MISSING`/`PARTIAL`/`DIVERGED`, so an ALIGNED row whose
  Evidence cell read e.g. `find_kid_for_parent → 404 foreign/missing` was flagged
  as un-ALIGNED — failing the SHIP gate (`prd-audit found un-ALIGNED FRs: FR-9`)
  on a clean PASS and looping the daemon. The parser now reads the **verdict
  cell** (the first verdict-bearing cell to the right of the `FR-<n>` cell, where
  the Verdict column sits ahead of Evidence) instead of the whole row, shared by
  both the completion check and the daemon's gap classifier. ACCEPTED-override,
  gap-class detection, header/separator skipping, and stale-report handling are
  unchanged. Regression test covers the live FR-9 case.

- **Autonomous `/remediate` no longer crashes the conductor with `Unknown step:
  remediate`.** The `remediate` SHIP sub-routine is dispatched out-of-band (only
  when a `prd_audit` blocks) and is deliberately absent from the linear
  `ALL_STEPS` sequence, but it was never registered anywhere the runner resolves
  a step's phase/index/label. So the moment the conductor tried to dispatch it,
  `phaseForStep` (via `resolveStepConfig`) and `getStepDefinition`/`getStepIndex`
  (in `buildSystemPrompt`) threw `Unknown step: remediate` — which the daemon
  caught and turned into a `.pipeline/HALT`, defeating the whole point of
  autonomous remediation. Added an `OUT_OF_BAND_STEPS` registry that
  `getStepDefinition`/`phaseForStep` fall back to (so out-of-band steps resolve a
  label + `SHIP` phase without occupying a gate-loop slot), a non-throwing
  `tryGetStepIndex`, and a labelled dispatch header for steps with no linear
  position. A genuinely unknown step still throws.

- **Daemon feature errors are now diagnosable (capture + HALT) instead of an
  opaque `error`.** When a feature threw — a crashed step, or worktree-prep /
  `bin/setup` failing — the daemon logged a bare `error`, dropped the captured
  reason, and excluded the slug for the rest of the run with no on-disk trace
  (the cause could only be found by re-running the failing command by hand). Now
  any feature error writes a diagnostic `.pipeline/HALT` into the worktree with
  the captured reason + a resume procedure, the daemon log surfaces the reason
  on the outcome line, and the feature is parked (like a halt) so it re-dispatches
  once the operator fixes the cause and clears the marker — rather than being
  silently excluded.
- **`prd_audit` impl-gap self-heal now actually reaches the BUILD agent (was a
  no-op loop).** When a daemon `prd_audit` blocked on an implementation gap, the
  conductor routed control back to BUILD but dispatched it with no context: the
  failing-FR summary was emitted only as a dashboard event, and the build step
  re-declared `retryHint = undefined` on entry, so `/pipeline` saw a complete
  task list and changed nothing. The re-audit then failed the same FRs until the
  self-heal cap and HALTed — never fixing anything. The kickback now queues a
  `retryReason` for BUILD naming the un-ALIGNED FRs and pointing at
  `.pipeline/prd-audit.md` for per-FR `file:line` evidence, instructing the agent
  to make the code changes even though the task list shows complete. (#115)
- **Daemon no longer re-enters every resumed feature at `acceptance_specs`.** The
  daemon constructed the conductor with a hardcoded `fromStep: 'acceptance_specs'`,
  which both set the loop's start index to the first BUILD step and marked it
  `explicitlyTargeted` — so `acceptance_specs` was re-run on every re-dispatch,
  even when the feature was already at `prd_audit` / `finish`. The daemon now
  passes `resume: true`: with the DECIDE steps pre-seeded done, a fresh feature
  still resumes at `acceptance_specs` (its first pending step), while a
  re-dispatched feature with recorded BUILD/SHIP progress resumes at its real next
  step instead of needlessly re-entering BUILD from the top each cycle.
- **Daemon restart no longer re-dispatches (and clobbers) human-parked halted features.**
  The daemon tracked parked/halted features only in process memory and recorded only `done`
  features in the durable `.daemon/processed/` ledger. After a restart that memory was empty,
  so a feature halted for a human — whose merged spec is still on the base branch — looked
  fresh, got re-dispatched, and re-entered the conductor over its kept worktree, regressing
  `conduct-state.json` (e.g. `last_step` reset to `acceptance_specs` while later steps showed
  `done`). The durable `.pipeline/HALT` marker was consulted only to *un-park* a slug already
  in the in-memory set, never to *park* one at discovery. `pickEligible` now checks the
  on-disk HALT marker for any candidate the current process never dispatched, making worktree
  status — not the base branch plus lost memory — authoritative across restarts. This is the
  root cause behind the recurring "restart wipes halted-project state" symptom that earlier
  fixes addressed only downstream of the re-dispatch.
- **Daemon re-dispatch of halted features no longer wipes BUILD/SHIP progress.** When a
  feature halts mid-BUILD or mid-SHIP and is re-queued (after clearing `.pipeline/HALT`),
  the daemon now preserves prior step statuses in `conduct-state.json` instead of
  unconditionally overwriting it. The run resumes from the first pending step after the
  halt point rather than restarting from `acceptance_specs`.

### Added

- **Daemon worktree preparation: `WORKTREE_NAMESPACE` + `bin/setup`.** Before building a
  feature, the daemon now (1) writes `WORKTREE_NAMESPACE=<worktree>` into the worktree's `.env`
  and (2) runs the project's conventional `bin/setup` non-interactively (`CI=true`, with
  `WORKTREE_NAMESPACE` exported) if it exists — after spec materialization and **before** the
  build. Worktree creation is the daemon's job, so it establishes the per-worktree identity in
  one place; the project's standard config consumes it (e.g. a Rails `database.yml` builds
  `app_<env>_<namespace>` and `bin/setup`'s `db:prepare` creates it), so concurrent worktrees
  build against isolated databases inside one **shared** stack without colliding. Reusing the
  standard `bin/setup` (rather than a bespoke daemon-only script) means the daemon runs exactly
  what a human/CI runs — no second setup path to drift. A non-zero exit (or a
  present-but-non-executable `bin/setup`) throws and the feature is kept/errored rather than
  built against a half-prepared environment — fixing the class of daemon halts caused by
  project infra/setup that was never run in the worktree. New `engine/worktree-prepare.ts`;
  wired via the optional `prepareWorktree` dep on `FeatureRunnerDeps`. Documented in
  `src/conductor/README.md`.

- **Optional Serena semantic-code MCP integration.** `./bin/install` now offers an opt-in
  install of [Serena](https://github.com/oraios/serena) (`oraios/serena`) when `uv` is
  present — prompted, not auto-forced, since it's a heavyweight LSP-backed toolkit. Once
  installed, `/bootstrap` auto-registers it as a **user-scope** MCP server
  (`claude mcp add --scope user serena -- serena start-mcp-server --context claude-code
  --project-from-cwd`) when it's on PATH and not already configured (idempotent via
  `claude mcp get serena`). Graceful no-op when `uv`/Serena are absent; install skipped in
  non-interactive shells. Documented in `README.md` and bootstrap §9a.

- **Daemon surfaces a persistently-unbuildable merged spec once, not forever.** When a
  merged spec can never satisfy the backlog gate (stories not `Status: Accepted`, or no plan
  dependency tree), `discoverBacklog` previously re-logged the identical `skip …` line on
  **every** poll tick. It now emits the skip **once per slug** via `.daemon/warned/<slug>`
  markers (`hasWarned`/`markWarned` in `engine/daemon-deps.ts`, wired through
  `DiscoverBacklogOpts`), then suppresses repeats until the spec is fixed (after which it
  becomes eligible, builds, and is marked processed). The approval-token logic is now a single
  shared `isStoriesApproved` exported from `engine/artifacts.ts` and consumed by both the
  daemon and the engineer land gate, so the chain can never disagree on the marker.
- **GitHub-issues intake + bidirectional write-back for the engineer (Phase 9.3b).**
  The engineer can now take work from GitHub issues, not just chat. A new `github-issues`
  intake adapter (`engine/engineer/intake/github-issues.ts`, an `IntakeSource` + `IntakePort`)
  captures open issues **assigned to you** across registered repos via an injected `gh` runner
  (`conduct-ts engineer poll` — one synchronous sweep, no background timer), enqueuing each into a
  durable file-backed **inbox** (`<engineer-dir>/inbox/`, atomic `O_EXCL`/rename claim, isolated
  from the daemon lock). A durable **intake ledger** (`intake/ledger.ts`) keyed `(source, sourceRef)`
  is the sole dedup authority (the old in-memory guard was removed): polling twice captures nothing
  new, and cross-repo same-number / re-filed-new-number ideas stay distinct. Empty issues are
  skipped and a failing repo is isolated from the rest. `runEngineerMode` gains **poll-on-launch**
  wiring: it polls, enqueues, and processes exactly one (oldest) envelope through the existing gated
  route→author→spec-PR loop, falling back to chat capture on an empty inbox. **Write-back** posts
  `Routed to <repo>` and `Spec PR opened: <url>` comments back to the issue and applies (auto-creating)
  an `engineer:handled` label on done — non-fatal (a `gh` outage never reverts a delivered spec PR)
  and de-duplicated per `(sourceRef, status)`. A `done` issue whose spec PR **closes unmerged** is
  re-emitted on the next poll (label stripped, attempts incremented); a merged PR is never reopened,
  and past the churn cap the issue is parked `needs-manual` until `conduct-ts engineer forget
  <owner/repo#N>` clears its ledger entry and label. Capture never writes to a registered repo's
  working tree (cross-repo isolation verified end-to-end). FR-25→FR-40; ADR-011 (async intake queue +
  github source) + ADR-012 (durable ledger sole dedup authority).
- **Daemon log capture + `conduct-ts daemon status` / `daemon logs` observability.**
  The build daemon is spawned detached (`stdio:'ignore'`), so every log line — including
  the per-feature BUILD progress rendered by `renderDaemonEvent` — was discarded: you
  could see *that* a daemon was alive (via its pidfile) but not *what it was doing*. Now
  `runDaemonMode` tees its log sink into an append-only **`.daemon/daemon.log`**
  (`engine/daemon-log.ts`, opened once the per-repo pidfile lock is held; size-capped
  ~1 MB with one-file rotation to `daemon.log.1`). Because the renderer and every feature
  start/finish line already route through that one sink, the file captures the full build
  narrative — feature start, each gate-loop step result (`step_completed` / unsatisfied
  `gate_verdict` / `kickback` / `loop_halt`), and finish (`shipped`/`failed` + PR url) —
  visible live via `daemon logs --follow`. Two read-only sub-subcommands of `daemon`
  (`engine/daemon-observe-cli.ts`, dispatched before the pipeline boots and before the
  `daemon` run command, so `status`/`logs` are never mistaken for a launch):
  `daemon status` iterates the project registry and reports each repo's pidfile liveness
  (`running` / `stale` / `stopped` / `path missing`) + pid, start time, and last activity,
  reusing the `daemon-lock.ts` `readPidRecord`/`isLive` primitives; `daemon logs
  [--repo <path>] [--follow] [--all]` prints or tails the log for one repo (default cwd)
  or every registered repo. Negative paths covered (missing/corrupt log, dead pid,
  unreadable `.daemon/`, stale registry path). The pidfile path and O_EXCL create flag
  stay confined to `daemon-lock.ts` (boundary test); the log module reuses the newly
  exported `daemonDir()` and never re-encodes the pidfile.
- **`conduct-ts engineer` launches the interactive idea→spec loop.** Running the bare
  `conduct-ts engineer` command now drops the operator into an interactive
  `claude /engineer` session (stdio inherited, human-in-the-loop) instead of
  printing a pointer and exiting. This is the agent-hosted front door (ADR-008):
  the launched session runs the real `/engineer` skill — routing, DECIDE, spec PR —
  in-chat. It is **not** the forbidden headless `claude -p` substrate (that did
  autonomous routing/authoring and was removed); this is an operator-driven
  entrypoint. When already inside a Claude Code session (`CLAUDECODE` set) it prints
  a note to run `/engineer` directly rather than spawning a nested session, and
  falls back to printing usage if the `claude` CLI is not on `PATH`. The
  `projects` / `land` / `handoff` subcommands remain deterministic primitives the
  skill calls (`src/conductor/src/engine/engineer-cli.ts`). The launcher is backed
  by the new `/engineer` skill (`skills/engineer/SKILL.md`), now installed via the
  installer fix below. The launched session is started with `--permission-mode
  default` (never `plan`) so the engineer can author artifacts, branch, and run
  `land`/`handoff` even when the user's global `defaultMode` is `plan`; override the
  mode with `CONDUCT_ENGINEER_PERMISSION_MODE` (e.g. `acceptEdits`) — `plan` is
  rejected.

### Changed

- **Daemon prd-audit halts only on product/plan gaps, self-heals implementation gaps.** A
  blocking `prd_audit` in a daemon run (`mode: 'auto'`, `daemon: true`) is now routed by its
  `Gap-class` column instead of always halting. An **all-`impl-gap`** audit routes back to BUILD
  (`kickback` → `navigateBack('build')`), rebuilds, and re-audits, bounded by
  `MAX_KICKBACKS_PER_GATE` (then HALTs `impl-gap unresolved after N build attempts`). **Any**
  product/plan gap (`intended-drift`, or an unclassifiable blocking row) HALTs immediately
  (`product/plan gap needs human DECIDE`) since the DECIDE amendment can't be made autonomously.
  The daemon also skips the pointless per-step retries on a blocking audit (re-auditing unchanged
  code yields the same verdict). New `classifyPrdAuditGaps` / `findUnalignedFrRowsWithClass` in
  `engine/artifacts.ts`; routing in `Conductor.run`. Interactive `/conduct` is unchanged (human
  recovery menu). Docs: `src/conductor/README.md`, `skills/prd-audit/SKILL.md`,
  `skills/conduct/SKILL.md`.

- **`/stories` stamps the canonical `Status: Accepted` approval marker.** The skill now
  explicitly changes `**Status:** DRAFT` → `**Status:** Accepted` on operator approval (and
  documents that a missing status line counts as **not approved**), reconciling the stories
  chain on one token. The template carries a file-level `**Status:** Accepted` header and the
  verification checklist asserts it. A new `test/test_harness_integrity.sh` check ties this
  skill instruction to the code gate so the two cannot drift.
- **The inline SDLC pipeline is now a subcommand: `conduct-ts inline "<feature>"` (was the
  bare `conduct-ts "<feature>"`).** Completing the verb-first CLI — the foreground pipeline is
  the explicit counterpart to the background `daemon`, so every mode is a named subcommand and
  no invocation relies on a bare positional. All pipeline flags move onto it unchanged
  (`--auto`, `--interactive`, `--resume`, `--status`, `--from`, `--step`, `--report`,
  `--diagnose`, `--cleanup`, `--reset`, `--model`, `--view`, `--tail-lines`, …), e.g.
  `conduct-ts inline --auto "URL shortener"` / `conduct-ts inline --status`. A bare
  feature/flags invocation now errors with guidance instead of silently running. Dispatch
  mirrors the other subcommands: `detectInline` (`src/conductor/src/cli.ts`) strips the token
  before `parseArgs`; `inline` is listed in `--help`. **Breaking CLI change** — see Migration
  below.

- **Harness gates hardened against the orphaned-primitive + path-guard escape classes
  (Phase 9.3 retro H-1 / H-2 / C-2).** Two recurring Phase-9 escape classes — a
  *replacement* whose new code ships orphaned (live path still calls the old symbol) and a
  path/prefix guard with an untested boundary that fails closed/open — now have cheap
  mechanical gates instead of relying solely on the fresh-context final evaluator:
  `skills/writing-system-tests/SKILL.md` gains **§3b** (replacement tasks must include ≥1
  acceptance test that drives the REAL production entry point and asserts the observable
  artifact, not the new unit) and **§3c** (a mandatory boundary-value checklist —
  trailing-slash / root / empty / sibling-prefix — for any path or prefix guard);
  `skills/pipeline/SKILL.md` gains a **"Superseded-symbol check (step 5)"** that greps the
  superseded symbol for zero non-test callers in `src/` before a replacement task is marked
  complete, running *before* the expensive batch-evaluator dispatch so the orphaned-primitive
  class fails fast. (The companion C-4 SHIP-phase "read the governing APPROVED ADR/PRD before
  remediating" triage rule already shipped in `skills/manual-test/SKILL.md` §6.)

- **Engineer post-authoring handoff extracted into a named step (Phase 9.3 cleanup,
  retro A-2/A-3).** The route→gate→author→PR→ensure-running god-chain inside
  `loop.ts` `processIdea` had grown to 473 LOC; the post-authoring tail (PR-open vs
  no-remote local commit, `ensure-running` fire-and-forget, authored-ledger entry) is
  now `runHandoff(target, branch, deps)` in `engine/engineer/handoff-step.ts` with its
  own focused unit test. `processIdea` calls it; `loop.ts` drops to 432 LOC. This keeps
  the loop maintainable before 9.3b adds intake adapters. **No behavior change** — the
  full engineer acceptance suite is unchanged. As part of the extraction the remote
  branch's `deps.gh!` non-null assertion (A-3) is replaced by an explicit gh-present
  guard, so a remote target with no wired `gh` runner throws a clear error instead of
  relying on a type-hole. Engineer routing tests (A-1) now assert the *specific*
  no-side-effect invariant on decline/redirect — the proposed repo's directory listing
  AND registry record count are byte-for-byte unchanged (each shown falsifiable under an
  injected mutation) rather than merely asserting an offer string was printed.

- **Daemon mode is now a subcommand: `conduct-ts daemon …` (was `conduct-ts --daemon`).**
  This makes the CLI verb-first and consistent with `engineer` / `register` / `create`
  — every long-running or non-interactive mode is now a named subcommand rather than a
  bare flag. All daemon options move onto the subcommand unchanged
  (`--concurrency`, `--max-items`, `--continuous`, `--max-cost`, `--max-runtime`,
  `--idle-poll`, `--max-idle-polls`), e.g. `conduct-ts daemon --concurrency 3 --max-items 10`.
  Dispatch mirrors the engineer pattern: a lightweight `detectDaemonCommand`
  (`src/conductor/src/engine/daemon-command.ts`) parses argv before the interactive
  pipeline boots, and `runDaemonMode` is still imported lazily. The engineer's
  `ensure-running` auto-launch (`daemon-launch.ts`) now spawns `conduct-ts daemon …`
  accordingly. **Breaking CLI change** — see Migration below.
- **The build daemon's console output is now colorized.** `[daemon] …` log lines
  (step boundaries, failures/retries, unsatisfied gates, kickbacks, halts/convergence,
  rate limits) and the worker-pool `▶ start` / `■ done` lines now use the same
  color vocabulary as the interactive TTY dashboard (green ✓, cyan ▶, red ✗, yellow
  warnings, dim chrome) so unattended runs are scannable at a glance. Color is
  applied via `chalk`, which auto-disables under `NO_COLOR` or when stdout is not a
  TTY — piped or redirected daemon logs stay byte-identical plain text
  (`src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/daemon.ts`).

### Removed

- **The `--daemon` flag.** Replaced by the `conduct-ts daemon` subcommand (above).
  `conduct-ts --daemon` now errors as an unknown flag.

### Fixed

- **Daemon: a reused worktree no longer inherits a stale Claude session, and a
  mid-pipeline throw no longer loses state.** On a kept worktree (reused on a later daemon
  cycle after a prior halt/error — `createWorktree` is idempotent), the prior run's
  `.pipeline/session-created`/`conduct-session-id` markers survived, so the new runner's
  lazy-init set `sessionStarted=true` and the first step (`acceptance_specs`, which sits
  before the `build` index and so was NOT covered by `freshContextPerStep`) dispatched
  `claude --resume <fresh-uuid>` for a conversation that never existed → "No conversation
  found" → *"session unavailable (expired or in use) — resetting to a fresh session"*,
  errored the feature out, and left `conduct-state.json` inconsistent (build done, SHIP
  entries missing). Reproduced at `--concurrency 1`. Now: `freshContextPerStep` resets the
  session before **every** executed step (no cross-step context retention — sessions are
  fresh per step across the whole build→ship loop; retries within a step still resume), the
  first reset discards the inherited stale session, and `daemon-cli` sweeps the stale
  markers on (re)entry. Separately, any unexpected throw inside the conductor loop now
  flushes state and writes a `.pipeline/HALT` marker (`loop_halt`), so a supervising daemon
  classifies it as `halted` (worktree kept, parked, retryable) instead of `error` with lost
  SHIP state. Tests added: runner stale-marker override, fresh-session-per-step
  interleaving, first-step reset (daemon worktree-reuse), and halt-on-throw.
- **Stories without `Status: Accepted` are now rejected at land instead of silently skipped
  at build.** A stories file with no status line passed the engineer land gate
  (`land-spec.ts` only rejected `Status: DRAFT`/empty/stub) yet was then skipped **forever**
  by the daemon backlog (which requires `Status: Accepted`) — a merged spec that could never
  build, re-logging an identical skip on every scan. `landSpec` and `runAuthoring` now
  **require** the canonical `Status: Accepted` marker on stories (via the shared
  `isStoriesApproved`), failing loudly at land/author time so the mismatch can never reach a
  silently-skipping daemon. Tests added at each seam (land-spec, authoring, daemon-backlog,
  and the `isStoriesApproved` token contract).
- **The `acceptance_specs` completion gate no longer false-halts on monorepo layouts.**
  Its built-in artifact globs (`STEP_ARTIFACT_GLOBS.acceptance_specs`, `engine/artifacts.ts`)
  were all rooted at the repo root, so correctly-written RED specs that land one package deep
  (`api/spec/integration/…`, `frontend/__tests__/screens/Foo.test.tsx`) matched nothing — the
  daemon retried 3×, found "no spec files," and halted even though valid specs were committed
  (observed: honeydew-or-handymando PR #39, 1,018 lines of RED specs). Three additive fixes:
  (1) a new project-level **`acceptance_spec_globs`** config key lets a repo declare where its
  specs live; those globs are *appended* to (never replace) the built-ins, so the gate can
  only loosen and standard Rails/Node-at-root layouts are unaffected. It is threaded to the
  check via `CompletionContext.config` (populated at every `conductor.ts` gate site, including
  the daemon gate-loop's `computeAndWriteVerdict`). (2) The custom glob matcher now expands a
  leading `*/` segment to each immediate subdirectory of the repo root (skipping
  `node_modules`/dot-dirs, preserving the no-`node_modules` property), so a repo can declare
  `*/spec/**` / `*/__tests__/**` without naming each package. (3) The built-in defaults gain
  `.tsx`/`.jsx` test extensions (`*.test.tsx`, `*.spec.tsx`, …) for React/React-Native repos.
  Regression-tested in `test/engine/artifacts.test.ts` (monorepo passes with config; zero
  specs still fails; `*/` won't reach into `node_modules`) and `test/engine/config.test.ts`
  (key validation + merge).
- **Daemon discovers specs merged on origin — but only fetches between work, never
  while a build is running.** The daemon scanned `.docs/plans` only against the
  *local* default branch, so a spec merged on GitHub (origin's main) was invisible
  until an operator manually ran `git pull` — the daemon could lag indefinitely.
  Now the worker pool refreshes from origin **only when it is fully idle with no
  local work left to start** ("drained → find more"): discovery is local-first
  (`refresh:false`, no fetch), and a `git fetch origin <default>` happens *only* when
  that local scan comes up empty and nothing is in flight. While features are
  building (or local queued work remains) there is **no fetch**, so an in-flight
  build is never re-based onto specs that landed on origin mid-run. `resolveDiscoveryRef`
  (`engine/daemon-backlog.ts`) discovers the real default branch via
  `git symbolic-ref refs/remotes/origin/HEAD` (no hardcoded `main`/`master`); on an
  idle refresh it fetches and returns `origin/<default>` (so `gitTreeSource` reads the
  remote-tracking ref the fetch updates), and between fetches it reuses that already-
  fetched ref so the whole batch stays discoverable across concurrent slots without
  new network access. Degrades gracefully: no origin remote, unset origin/HEAD, a
  failed fetch (offline), or an unfetched ref all fall back to the local base and log;
  the poll loop never throws. Fetch + read happen only in the main checkout dir — no
  `git checkout`, no `git reset`, no worktree touches.

- **`conduct-ts --help` is now a complete, recursive command reference.** Top-level `--help`/`-h`
  rendered the *base* program (bare-pipeline flags only), so `register`, `create`, `engineer`, and
  `daemon` were invisible and the run exited non-zero after leaking an `(outputHelp)` line. Root
  help now prints a single document that recurses through **every** command and sub-subcommand —
  the top-level surface plus a titled section per command documenting its options and nested
  commands (`engineer projects`/`land`/`handoff`, `daemon status`/`logs`). `renderFullHelp`
  (`src/conductor/src/cli.ts`) walks the command tree depth-first; `index.ts` routes a top-level
  help request to it (exit 0), after the subcommand dispatchers so `conduct-ts engineer --help`
  (and the other subcommands) keep their own help. `parseArgs` still uses the base program so a
  bare feature description is never mistaken for an unknown command.

- **The continuous daemon now re-attempts a halted feature after its HALT marker is cleared.**
  When a feature halted, `runDaemon` (`engine/daemon.ts`) left its slug in the process-lifetime
  `started` set forever, so the eligibility predicate
  (`!started.has(slug) && !inFlight.has(slug)`) permanently hid a parked-then-unparked feature
  from every later scan — the only recovery was to kill and restart the whole daemon. The
  halted feature was still in `discoverBacklog` (halted ≠ processed) and `createWorktree`
  already resumes a matching existing worktree, so the in-memory exclusion was the sole blocker.
  Halted slugs are now tracked in a separate `parked` set and become re-eligible once their
  `.pipeline/HALT` marker is gone, detected via a new injected `isHalted` dep (production wires
  `isHalted(worktreeBase, slug)` in `engine/daemon-deps.ts` → `daemon-cli.ts`). The next scan
  re-dispatches the feature, reuses the existing worktree, and resumes from the first non-done
  step; while the marker is present the feature stays parked (no busy re-halt loop), and a
  feature that halts again is re-parked until cleared. Double-dispatch protection for in-flight
  and freshly-started features is preserved, and `done`/`error` outcomes are unchanged. Without
  the `isHalted` dep (pure-core default) a parked feature stays parked for the run, exactly as
  before. Three new daemon unit tests cover park-while-present, re-dispatch-after-clear, and
  re-park-on-re-halt.

- **The build daemon now builds a spec only after its PR is merged (FR-24 gate enforced).**
  `discoverBacklog` (`engine/daemon-backlog.ts`) scanned the **working-tree** `.docs/plans`,
  so the instant the engineer authored an Accepted, well-formed spec into the target repo's
  working tree — *before* `land`/`handoff` and well before any merge — a running
  `--continuous` daemon picked it up and built it. The documented "a merged spec PR is the
  only idea→build handoff" contract was unenforced (the FR-24 tests modeled "unmerged" as
  "artifacts absent from the scanned dir", which never holds once the engineer writes them
  in-tree). Discovery now reads artifacts from the **committed default branch** via a
  `BacklogTreeSource` (`git show <baseBranch>:…`), never the working tree and never a
  `.worktrees/` copy, so an unlanded spec or one living only on an unmerged `spec/<slug>`
  branch is invisible until the operator merges it to `<baseBranch>`. New git-backed tests
  reproduce the exact gap (working-tree-present-but-unmerged → not built; merged → built).

- **The build daemon now claims its pidfile on boot — liveness is finally observable
  (ADR-010).** The pidfile-lock primitive (`daemon-lock.ts`) was fully built and tested
  but **never wired into the daemon's boot path**: `runDaemonMode` never wrote
  `.daemon/`'s pidfile, so `process.kill(pid,0)` liveness had no pid to probe and the
  1-per-repo mutex `ensureRunning` relies on never engaged (it would spawn duplicates).
  New `holdLock(repoPath)` claims the pidfile with the daemon's real pid on boot
  (refusing to start if a live daemon already owns it), and releases it on exit; a
  dead-pid pidfile self-heals via reclaim. This is the engine-loop half of the
  observability gap — capturing daemon **logs** to a file (today the detached spawn
  uses `stdio:'ignore'`) plus `conduct daemon status`/`logs` land in a follow-up branch.

- **`bin/install` now auto-discovers every skill instead of a hardcoded list.**
  The `SKILLS` array was maintained by hand and had drifted: skills added under
  `skills/` (e.g. `engineer`, `prd-audit`) were never symlinked into
  `~/.claude/skills/`, so their `/slash-commands` silently failed to resolve. The
  installer now enumerates every `skills/<name>/` directory containing a `SKILL.md`,
  guaranteeing all skills link on install/`--update`.

### Changed

- **Design-conformance-before-effort control** baked into the harness as an
  enforced gate, not just memory. New HARNESS.md Key Convention applies whenever
  code is written, fixed, or hardened, at every phase; a BUILD-phase conformance
  check added to `skills/pipeline/SKILL.md` per-task dispatch; SHIP/fix gates
  added to `skills/debugging/SKILL.md` (Phase 4) and `skills/manual-test/SKILL.md`
  (Bug Loop). A code path that violates or is superseded by an APPROVED ADR/PRD is
  a conformance finding (kickback/BLOCK), not work to do — building or hardening
  code slated for deletion is wasted effort.
- **Harness `.gitignore` now ignores `.daemon/` (and `.worktrees/`).** With the new
  daemon log capture, a daemon run inside `src/conductor/` writes `.daemon/`
  (pidfile + `daemon.log`); the root `.gitignore` previously ignored only
  `.pipeline/`/`.memory/`, so those runtime files showed up as untracked. New
  projects already get all three via the `conduct create` `GITIGNORE_SKELETON`
  (`.pipeline/`, `.daemon/`, `.worktrees/`); the `bootstrap` skill's `.gitignore`
  guidance + checklist now list `.daemon/` too, and existing projects pick it up
  via the migration below.

### Migration

Existing conductor-managed projects should ignore the daemon's `.daemon/` directory
(pidfile + `daemon.log`) now that the daemon writes a persistent log there. New
projects scaffolded by `conduct create` already include it; this back-fills older
ones. Idempotent — safe to re-run.

```bash migration
# Ensure the daemon state dir is gitignored (pidfile + daemon.log live here).
if [ -f .gitignore ]; then
  grep -qxF '.daemon/' .gitignore || printf '.daemon/\n' >> .gitignore
else
  printf '.daemon/\n' > .gitignore
fi
echo "ensured .daemon/ is in .gitignore"
```

## Migration

The daemon flag became a subcommand. Update any scripts, aliases, cron entries, or
shell history that invoke `conduct-ts --daemon`:

```bash
# Rewrite `conduct-ts --daemon` → `conduct-ts daemon` in your own scripts.
# (Adjust the path glob to wherever you keep daemon launch scripts.)
grep -rl --null -- 'conduct-ts --daemon' . 2>/dev/null \
  | xargs -0 -r sed -i 's/conduct-ts --daemon/conduct-ts daemon/g'
```

The daemon's options are unchanged — only the leading `--daemon` flag becomes the
`daemon` subcommand token. The engineer's auto-launch path was updated in-tree, so no
action is needed for `ensure-running`.

The inline pipeline likewise became a subcommand. Update any scripts, aliases, cron
entries, or shell history that invoke the bare pipeline form. Auto-rewriting is unsafe
(`conduct-ts` is also followed by `daemon`/`engineer`/`register`/`create`/`inline`/flags),
so flag candidates for manual review rather than blindly rewriting:

```bash
# The bare inline pipeline now requires the `inline` subcommand:
#   conduct-ts "<feature>"   ->   conduct-ts inline "<feature>"
# Read-only: list conduct-ts invocations that may be bare pipeline runs.
grep -rnE 'conduct-ts +(["'\'']|[A-Za-z])' . 2>/dev/null \
  | grep -vE 'conduct-ts +(inline|daemon|engineer|register|create|help|--)' \
  || echo "No bare conduct-ts pipeline invocations found."
```

Pipeline flags are unchanged — they simply move after the `inline` token
(`conduct-ts inline --auto "<feature>"`, `conduct-ts inline --status`, …).

The `brainstorm` skill was split into `explore` + `prd` (DECIDE restructure). The
`skills/brainstorm/` directory is removed and `skills/explore/` + `skills/prd/` are
added, so installed skill symlinks need refreshing — re-running `./bin/install`
re-links the new skills; the line below also prunes the now-dangling `brainstorm`
symlink in case your installer doesn't:

```bash
# Remove the stale brainstorm skill symlink (if present), then refresh all skills.
rm -f "${HOME}/.claude/skills/brainstorm"
./bin/install
```

No project-level action is needed: persisted `conduct-state.json` is migrated
automatically on read (a recorded `brainstorm` step maps to `explore` + `prd`).

The `.memory/` directory has moved from an in-project directory to a durable shared canonical
store keyed by project. New bootstraps and the next `conduct` run on any existing project apply
the migration automatically via `conduct-ts memory setup`. If you need to migrate manually before
the next `conduct` run (e.g. before pulling the harness update), run the block below from the
project root. Idempotent — no-op if `.memory/` is already a symlink.

```bash migration
# Migrate .memory/ to the canonical shared store under ~/.ai-conductor/memory/.
# No-op if .memory/ is already a symlink. Run from the project root.
_dir="$(pwd)"
_link="${_dir}/.memory"
if [ -L "${_link}" ]; then
  echo ".memory/ is already a symlink — no migration needed."
elif [ -d "${_link}" ]; then
  if command -v conduct-ts >/dev/null 2>&1; then
    conduct-ts memory setup "${_dir}"
  elif [ -x "${HARNESS_DIR:-}/bin/conduct-ts" ]; then
    "${HARNESS_DIR}/bin/conduct-ts" memory setup "${_dir}"
  else
    echo "conduct-ts not found — please run 'conduct-ts memory setup ${_dir}' after updating." >&2
    exit 1
  fi
  echo "Migration complete. .memory/ is now a symlink to the canonical store."
else
  echo ".memory/ does not exist — it will be created automatically on next 'conduct' run."
fi
```

## Migration

The semantic attribution verification lane, its two config keys
(`attribution_judge_cutover`, `attribution_audit_sample_pct`), and the
`conduct-ts evidence judge <slug> [--dry-run]` CLI subcommand are additive and
opt-in. No existing `.ai-conductor/config.yml` needs to change:

- **`attribution_judge_cutover` absent** → the judge lane never dispatches; the
  deterministic evidence gate (trailers, path corroboration) is the sole
  completion authority, exactly as before this change.
- **`attribution_audit_sample_pct` absent** → defaults to `10` but is itself
  inert while `attribution_judge_cutover` is absent (the judgment gate controls
  whether any audit sampling happens at all).
- **`conduct-ts evidence judge`** is a new CLI subcommand; it does not replace or
  alter any existing subcommand's behavior, flags, or output. No script relying
  on the prior CLI surface needs to change.

Only projects that want the semantic judge lane need to act, and the action is
config-only (no schema migration, no hook re-provisioning, no worktree
recreation):

```bash migration
# Opt in to the semantic attribution verification lane by adding the cutover
# key to .ai-conductor/config.yml. No-op / prints guidance if the file is
# missing or the key is already present.
CONFIG_FILE=".ai-conductor/config.yml"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "No $CONFIG_FILE found — nothing to migrate. Create one and add" \
       "attribution_judge_cutover to opt in when ready."
elif grep -q '^attribution_judge_cutover:' "$CONFIG_FILE" 2>/dev/null; then
  echo "$CONFIG_FILE already sets attribution_judge_cutover — no migration needed."
else
  cat <<'EOF' >> "$CONFIG_FILE"

# Semantic attribution judgment gate (opt-in; absent = disabled).
# Uncomment and set a past ISO-8601 instant to activate the judge lane for
# unresolved evidence-gate residue. Restart the daemon/conductor to apply.
# attribution_judge_cutover: "2026-07-11T08:30:00Z"
# attribution_audit_sample_pct: 10
EOF
  echo "Appended commented-out attribution_judge_cutover / attribution_audit_sample_pct" \
       "template to $CONFIG_FILE. Uncomment and set a cutover instant to opt in;" \
       "restart the daemon after editing."
fi
```

## [0.99.17] - 2026-05-02

## [0.99.16] - 2026-05-02

## [0.99.15] - 2026-05-02

## [0.99.14] - 2026-05-01

## [0.99.13] - 2026-05-01

## [0.99.12] - 2026-04-30

## [0.99.11] - 2026-04-29

## [0.99.10] - 2026-04-28

## [0.99.9] - 2026-04-28

## [0.99.8] - 2026-04-28

## [0.99.7] - 2026-04-28

## [0.99.6] - 2026-04-28

## [0.99.5] - 2026-04-28

## [0.99.4] - 2026-04-28

## [Unreleased]

### Fixed
- conduct-ts: the `engineer` routing adapter (Phase 9.3) built its provider call
  as `provider.invoke({ prompt } as any)`, omitting the **required** `sessionId`
  and `resume` fields of `InvokeOptions`. The `as any` cast hid the type error;
  at runtime the real `ClaudeProvider` emitted `claude --session-id undefined`,
  which the CLI rejects with *"Invalid session ID. Must be a valid UUID."* —
  every idea failed to route and silently fell through to "No matching project
  found. Would you like to create one?" even with a seeded registry. Fixed by
  passing a fresh `uuidv4()` session with `resume: false` (routing is a
  single-shot, stateless classification) and removing the `as any` cast so the
  type checker enforces the contract. Regression test
  (`test/acceptance/engineer-routing-session.test.ts`) drives the real
  `runEngineerMode` entry point and asserts the adapter hands the provider a
  valid-UUID `sessionId` — the seam no existing test exercised because every
  routing fake ignored its argument (same class as retro H-1).

- conduct-ts: the engine-native `rebase` loop step (Phase 9.0) could run a
  destructive `git rebase origin/<default>` against the **real** conductor
  worktree whenever a test drove a `Conductor` whose `projectRoot` resolved to
  the conductor's own checkout (the default is `process.cwd()`). It was a silent
  no-op while the dev branch stayed current with `origin/main`, but became a
  branch-corrupting rebase once `origin/main` advanced. Root-fixed by gating the
  step on daemon mode: rebase-on-latest is a **daemon finish-time mechanism**, so
  `runRebaseStep` now performs a clean no-op (gate still satisfied, loop topology
  unchanged) in any non-daemon run — interactive `/conduct` and the entire test
  suite. Only the daemon invokes git; humans rebase manually in interactive mode.
  `rebase-loop` integration specs now construct the `Conductor` with `daemon:true`
  (they exercise the real rebase against an isolated throwaway repo); `full-flow`
  and `plugin-end-to-end` also pass an isolated `projectRoot` as defence-in-depth.

### Changed
- **BREAKING (conduct-ts):** renamed the supervisor from **brain** to **engineer**.
  The CLI subcommand is now `conduct-ts engineer` (was `conduct brain`); the
  cross-project memory store moved from `~/.ai-conductor/brain/` to
  `~/.ai-conductor/engineer/`, and its env override from `$AI_CONDUCTOR_BRAIN_DIR`
  to `$AI_CONDUCTOR_ENGINEER_DIR`. The signal type `BrainSignal` is now
  `EngineerSignal` and `BrainStoreReader` is now `EngineerStoreReader`. No data
  format changed — only names and paths. See Migration below.

### Migration

If a previous `conduct-ts` daemon run created a cross-project store under the old
`brain` name, move it to the new `engineer` location and update any env override
in your shell profile (`AI_CONDUCTOR_BRAIN_DIR` → `AI_CONDUCTOR_ENGINEER_DIR`).

```bash migration
# Move the cross-project store dir to its new name (no-op if absent or already moved)
if [ -d "$HOME/.ai-conductor/brain" ] && [ ! -e "$HOME/.ai-conductor/engineer" ]; then
  mv "$HOME/.ai-conductor/brain" "$HOME/.ai-conductor/engineer"
  echo "moved ~/.ai-conductor/brain -> ~/.ai-conductor/engineer"
fi
# If you set AI_CONDUCTOR_BRAIN_DIR anywhere, rename it to AI_CONDUCTOR_ENGINEER_DIR.
```

### Added
- conduct-ts: **agent-hosted `engineer` redesign** (Phase 9.3). The engineer is
  reworked from a Node TTY REPL that spawned `claude -p` and wrote stub/DRAFT
  stories into an **agent-hosted, in-chat, human-gated DECIDE loop**: the host
  agent drives routing and the real DECIDE skills directly — no spawned `claude`,
  no Node readline REPL, no stub stories. Per idea it routes against the project
  registry, **requires human confirmation** before any write (confirm / decline /
  `redirect <name>` / `create <path>` when nothing fits → scaffolds + registers a
  new repo via the 9.2 `create` path), selects prior lessons from the engineer
  store (FR-5 flywheel), runs the **real DECIDE seam** to author `Status: Accepted`
  stories + a plan dependency tree on a `spec/<slug>` branch (artifacts under
  `.docs/` only — never source), and opens a spec **PR** — it **never** builds
  (`buildsRun` stays 0) and **never** merges (no `gh pr merge`); a merged spec PR
  is the only idea→build handoff. Regression-guarded: authoring never emits the
  old `_Generated by engineer._` stub, never a DRAFT story, and never spawns
  `claude` to author; an unapproved DECIDE step throws and fabricates nothing.
  New seams this phase:
  - **Hexagonal intake port + `Envelope` contract** (`{id, source, sourceRef,
    text, hintRepo?, status, receivedAt}`; parse-don't-validate with field-named
    errors — empty/whitespace text is **rejected, not silently dropped**). The
    `claude-session` adapter ships now; `github-issues`/inbox/write-back are
    additive future adapters behind the same port. Intake **idempotency** keys
    strictly on `(source, sourceRef)`, never on text.
  - **Cross-repo isolation** — authoring writes pass through an `AuthoringGuard`
    (`assertWriteAllowed` rejects `..`, absolute-sibling, and prefix-collision
    paths with `PathEscapeError`); authoring repo A leaves sibling repo B
    byte-for-byte unchanged, and a stale/missing target path fails fast with
    `TargetPathMissingError` (never a cwd fallback). Multi-repo **fan-out** is
    independent — one repo's failure never corrupts another, and a deselected
    repo is left untouched.
  - **pidfile-lock daemon liveness** — `.daemon/daemon.pid` created with `O_EXCL`
    is the **one-per-repo mutex** (exactly one winner under concurrent boots);
    `process.kill(pid, 0)` liveness with stale-pid reclaim that **never
    permanently refuses** (a kill-9 leftover is reclaimed on the next boot).
    `ensureRunning` spawns a detached daemon iff none/stale, no-ops if alive, and
    never manages the lifecycle. The registry `daemonState` mirror is
    non-authoritative — the pidfile wins.
  - **`launchDaemonDetached` fix** — launches with `cwd: repoPath` (was passing
    `--project`), so the pidfile and worktree land under the target repo.
  Read-only `governorReport` (aggregate spend + kickback/halt/retry rates) and
  `computeFlywheelTrend` (improving / insufficient_data over engineer-planned
  features) remain library functions over the engineer store.
- **Two SHIP-phase compliance gates** wired into the conduct-ts gate-driven tail, between
  `manual_test` and `retro`:
  - **`/prd-audit`** (new skill + `prd-auditor` agent) — audits the shipped implementation
    against the approved PRD's functional requirements (`FR-N`). Per-FR verdict
    `ALIGNED | PARTIAL | DIVERGED | MISSING` with `file:line` evidence and a gap-class
    (`impl-gap` → kick back to BUILD; `intended-drift` → kick back to DECIDE to amend the PRD).
    Loops until every FR is ALIGNED or human-ACCEPTED, with a 3-cycle rework budget then operator
    escalation. Objective gate: blocks while any audit-table row is a non-ALIGNED, un-ACCEPTED FR.
    Report at `.docs/audits/YYYY-MM-DD-<feature>-prd-audit.md`. Runs on opus.
  - **`/architecture-review --as-built`** (new mode on the existing `architecture-review` skill) —
    final drift sweep of shipped code vs **APPROVED** ADRs. Verdict
    `APPROVED | APPROVED WITH DRIFT NOTES | BLOCKED`; `BLOCKED` (code violates an APPROVED ADR)
    halts until a human fixes the code or supersedes the ADR. Report at
    `.docs/decisions/architecture-review-as-built-YYYY-MM-DD-<feature>.md`. Runs on sonnet.
  - conduct-ts step registry gains `prd_audit` and `architecture_review_as_built` (both
    `enforcement: gating`, `loopGate: true`); they inherit the verdict/selector/kickback loop.
    HARNESS.md model table, conduct skill flow/assess/gate-enforcement/skip tables, README,
    and `src/conductor/README.md` updated to match.
- conduct-ts daemon: **structured retro signal + engineer memory store** (Phase 9.1).
  On daemon feature completion (`done`/`halted`) the runner emits a structured
  `EngineerSignal` + a narrative to a cross-project store at `~/.ai-conductor/engineer/`
  (override `$AI_CONDUCTOR_ENGINEER_DIR`, dir auto-created). `signals.jsonl` is
  append-only, one atomic (`O_APPEND`, concurrency-safe) JSON line per
  feature-run: `{schemaVersion, ts, project, feature, runId, outcome, kickbacks[],
  halts[], retryHotspots[], tokens{...}, durationByStep{}, narrativeRef?}` —
  assembled from the feature's `events.jsonl` (reusing `report-renderer`
  aggregation) + `FeatureOutcome`, with empty categories as `[]` and an optional
  `narrativeRef`. Narratives live in `narratives/<project>/<feature>-<runId>.md`,
  keyed by `runId` so re-runs never overwrite (`done` → full retro via the LLM
  provider; `halted` → short halt note, no LLM call). Per ADR-002 Option A the
  in-loop `retro` step is **skipped under the daemon** (the emission step owns the
  narrative, keeping repos free of `.docs/retros/` clutter); manual `/conduct`
  runs are unchanged. Emission is **best-effort** — any store error is logged and
  swallowed, so a learning-signal write can never break a ship. A types-only
  `EngineerStoreReader` interface is exported for the future engineer (Phase 9.3).
- conduct-ts: project registry + creation (Phase 9.2). A single-writer registry
  module (`src/conductor/src/engine/registry.ts`) owns
  `~/.ai-conductor/registry.json` (override via `$AI_CONDUCTOR_REGISTRY`): atomic
  temp+rename writes, realpath-canonicalized dedup, credential redaction of remote
  URLs, and status provenance (`created` is never downgraded to `registered`). Two
  non-interactive CLI subcommands consume it: `conduct register [path]` registers an
  existing git repo (name=basename, absolute path, redacted origin remote), and
  `conduct create <name> [--remote <url>]` scaffolds a fresh project (git init +
  skeleton CLAUDE.md referencing HARNESS.md + `.gitignore` with `.pipeline/`,
  `.daemon/`, `.worktrees/`; `--remote` is add-only, no push) with a no-clobber
  guard. `/bootstrap` now auto-registers the project via `conduct register .` after
  onboarding (idempotent).
- conduct-ts: the gate loop's topology is now **derived from the step registry**
  instead of hardcoded, so custom config steps participate (Phase 8). New
  declarative `StepDefinition` flags `loopGate` (in the gate-driven tail) and
  `kickbackTarget` (re-openable upstream gate) replace the hardcoded
  `LOOP_GATE_STEPS`/`KICKBACK_TARGETS`/`regionStart` — built-ins set them
  (build/manual_test/retro/finish = loopGate; stories/plan = kickbackTarget) so
  behavior is unchanged. A custom `.ai-conductor/config.yml` step **inherits its
  `after` target's loop membership** — one inserted among the loop steps
  (build…finish) joins the loop automatically; `gate: true|false` forces/opts out,
  and `kickback_target: true` marks it re-openable. The conductor derives the
  front/loop boundary from the first loop gate, so reordering and custom steps
  both flow through.
- conduct-ts daemon: `--continuous` mode — instead of draining the backlog once
  and exiting, the daemon idle-polls for newly-eligible features (the poll loop
  already existed; this wires it through). Gated by hard ceilings, all new flags:
  `--max-cost <tokens>` (global output-token ceiling), `--max-runtime <seconds>`
  (wall-clock), `--idle-poll <seconds>` (poll interval), `--max-idle-polls <n>`
  (stop after N empty polls). Ceilings stop *starting* new features; in-flight
  work always drains. `--continuous` with no ceiling logs an unbounded-run
  warning. Closes the Phase 7 "then enable continuous" deliverable. The
  wall-clock ceiling (`time_ceiling` stop reason) is new in `runDaemon`;
  `max_items` and `cost_ceiling` already existed.
- conduct-ts daemon: per-step loop progress is now printed to the console. The
  daemon previously wired a **no-op event renderer**, so it went silent between
  `[daemon] ▶ start <slug>` and `✓ shipped` while the whole gate loop ran live in
  the worktree — "started, no meaningful logs." `daemon-cli.ts` now renders
  step boundaries, failures/retries, unsatisfied gate verdicts, kickbacks, halts,
  convergence, and rate limits (prefixed `· `). Events carry no feature slug, so
  with `--concurrency > 1` lines from different workers interleave. Found in
  Phase 7 daemon validation.
- conduct-ts: **rebase-on-latest before finish** (Phase 9.0). A new engine-native
  `rebase` loopGate step (no Claude dispatch, like `complexity`) runs after
  `build`+`manual_test` and before `finish`, rebasing the worktree branch onto the
  **discovered** origin default branch (`git symbolic-ref refs/remotes/origin/HEAD`,
  fetched; falls back to the local base when there's no origin or the fetch fails —
  no hardcoded `main`). Its gate verdict is *satisfied ⇔ the branch is already
  current with the base*, so a no-op rebase goes straight to the PR and re-entry
  after a kickback never re-invalidates. A **clean rebase that changed code/test
  paths** invalidates `build` (+`manual_test` if it ran) via the existing
  kickback machinery (`{from:'rebase', to:'build'}`) so the PR is never built on a
  stale base; a **docs-only / CHANGELOG-only** change does **not** invalidate. A
  rebase conflict confined to `CHANGELOG.md`'s `[Unreleased]` block is
  **auto-resolved** (take the base's merged entries, re-append this feature's lines
  exactly once); any other or mixed conflict writes `.pipeline/HALT` (conflicted
  files + resume steps), leaves the rebase **paused** (no `--abort`), and opens no
  PR. Outcomes emit typed events (`rebase_noop` / `rebase_changed` /
  `rebase_changelog_resolved` / `rebase_conflict_halt`).

### Changed
- conduct-ts daemon: backlog **eligibility is now gated on approval + well-formedness**.
  `discoverBacklog` only picks up a feature when its stories are **approved**
  (`Status: Accepted`, not DRAFT) and its plan declares a **task dependency tree**
  (`## Task Dependency Graph` or per-task `**Dependencies:**` lines). The daemon
  pre-seeds the front half (stories/plan = done) and never re-runs their gates, so
  eligibility is the only place specs are vetted before autonomous build — previously
  any feature with stories+plan *files* present was picked up, DRAFT or not, dependency
  tree or not. Ineligible features are skipped with a logged reason (`[daemon] skip …`).
- harness: new **"Docs track features"** convention (HARNESS.md + this repo's CLAUDE.md):
  every change that adds/alters user-facing behavior must update the `README` and affected
  docs in the same PR; the `finish` step verifies docs reflect what shipped.
- conduct-ts: the `plan` gate now also requires a **task dependency tree** (in addition to
  per-path-type story coverage), so the dependency graph the `build`/pipeline skill
  consumes for topological ordering is actually enforced, not just requested.
- conduct-ts: DECIDE order now runs **architecture before plan** — `stories →
  conflict_check → architecture_diagram → architecture_review → plan →
  acceptance_specs`. Architecture (system-level HOW) grounds the technical plan
  (task-level HOW) instead of being reviewed after it. Prerequisites reordered in
  `engine/steps.ts`; skipped steps still satisfy gates so Small tier is unaffected;
  custom `.ai-conductor/config.yml` steps still resolve (inserted by name). Legacy
  bash `bin/conduct` keeps the prior plan→architecture order (its architecture-review
  gates on the plan); `conduct-ts` is canonical.
- DECIDE phase is now PRD-driven. `templates/design-doc.md.template` is a PRD with
  **enumerated functional requirements (`FR-N`)** plus goals/non-goals, users, NFRs,
  acceptance criteria, and dependencies. `skills/brainstorm` requires those sections;
  `skills/stories` extracts **one or more granular stories per `FR-N`** (behavioral WHAT,
  happy + negative) tagged with their `FR-N` for traceability; `skills/plan` is framed as
  the **technical implementation plan (HOW)** build ships from — it opens with a Technical
  Approach section and keeps the required Design-doc link. Traceability runs PRD `FR-N` →
  story → plan task.

### Fixed
- `block-destructive-git` hook: **ad-hoc `git rebase` onto a base is now blocked**.
  A mid-build rebase onto an advanced `main` rewrites history under active work and
  triggers surprise conflicts (it disrupted two feature branches during Phase 9).
  The only sanctioned rebase is the daemon's finish-time rebase-on-latest (runs via
  execa, not this hook, with conflict→HALT + CHANGELOG auto-resolve); deliberate
  branch updates require asking the user. Resolving an in-progress rebase
  (`--continue`/`--abort`/`--skip`/`--edit-todo`) is still allowed.
- `block-destructive-git` hook: `git branch -D` is no longer hard-blocked for
  **merged** branches. Squash/rebase-merged branches (GitHub's default) aren't
  ancestors of the default branch, so plain `git branch -d` refuses them and the
  operator was forced to use `-D` — which the hook blocked outright, stranding
  routine post-merge cleanup. The hook now allows `-D` only when every named
  branch is provably merged (an ancestor of the default branch, or has a merged
  PR via `gh`); genuinely unmerged force-deletes are still blocked.
- `block-destructive-git` hook: detection now ignores blocked patterns that
  appear **inside quoted arguments** (commit messages, `echo`, comments). The
  hook previously grepped the raw command, so a command that merely *mentioned* a
  pattern (e.g. `git commit -m "...git reset --hard..."`) was wrongly blocked. It
  now matches against the command with quoted spans stripped, so only the real,
  unquoted operation triggers a block. (Trade-off: a destructive command fully
  wrapped in quotes, e.g. `bash -c "git reset --hard"`, is not caught.)
- conduct-ts: test suites no longer fail to load on the dev machine's default
  Node. The conductor needs Node ≥20.5 (execa imports `addAbortListener`), but
  only `src/conductor/.tool-versions` pinned Node 20 — running `npm test` from
  the repo root used the machine default (e.g. 19.6), so 8 suites failed with
  `node:events does not provide an export named 'addAbortListener'`. Added a root
  `.tool-versions` (`nodejs 20.19.2`) so asdf selects Node 20 repo-wide, plus an
  `engines: { node: ">=20.5.0" }` field documenting/enforcing the requirement for
  non-asdf users. All 70 suites / 979 tests now run. `bin/install` also surfaces
  the requirement: when the `conduct-ts` bundle is missing it checks the active
  Node and, if < 20.5, warns with actionable guidance (`asdf install nodejs
  20.19.2`) instead of letting the user hit a cryptic asdf error on `npm run build`.
- conduct-ts: **worktree isolation** — the spawned `claude` subprocess now runs
  in the step runner's `projectDir` (`cwd`), not the parent process's working
  directory. `ClaudeProvider` invoked `execa('claude', …)` with **no `cwd`**, so
  in daemon mode every step ran in the daemon's main checkout instead of the
  feature's worktree: the build agent committed the whole implementation to
  `main` (6 commits) while the `feat/daemon-<slug>` branch stayed empty, and the
  worktree's `.pipeline` desynced (surfacing as a `session-created` ENOENT). The
  `cwd` now threads `InvokeOptions.cwd` → `execa` and `DefaultStepRunner` passes
  `projectDir` on all four provider calls. Found in Phase 7 daemon validation;
  overlaps the intent of PR #72 (per-feature isolation).
- conduct-ts daemon: an auto-mode hard failure now writes a `.pipeline/HALT`
  marker instead of returning silently. Previously a gating/structural step
  failing in `--auto` did `writeState; return` with no marker, so the daemon's
  `readOutcome` saw neither `DONE` nor `HALT` and reported the opaque
  `error — loop ended without DONE or HALT marker`. The conductor now writes
  `HALT` (with the failed step in the reason) and emits `loop_halt`, so the
  daemon classifies it as `halted` — worktree kept, NOT marked processed,
  retryable after a human looks. Found in Phase 7 daemon validation.
- conduct-ts daemon: re-running the daemon after a kept (halted/errored)
  worktree no longer aborts with `fatal: A branch named 'feat/daemon-<slug>'
  already exists`. `createWorktree` now reuses an existing registered worktree
  for the slug (resume-after-human-fix), attaches to an existing branch when the
  worktree was removed but the branch lingered, and only creates a fresh
  branch+worktree when neither exists. Found in Phase 7 daemon validation.
- conduct-ts: the `plan` coverage gate no longer false-fails (and kicks the loop
  back to `plan` forever) on the real generator's output format. Stories use
  `## Story N:` headings (id `N`) and plan tasks reference `**Story:** Story 1
  (FR-1, FR-2)` with the path type on a separate `**Type:** happy-path` line. The
  old matcher captured the literal word "Story" as the id and read happy/negative
  only from the parens (which hold `FR-N` refs), so coverage never matched —
  verdict `plan does not cover: 1 happy, 1 negative, …`. The matcher is now
  task-block-aware: it strips an optional `Story `/`Epic ` prefix word from the
  id and reads the path type from the `**Type:**` line, the Story parens, or a
  path keyword — while still accepting the prior `**Story:** 3.2-1 (happy path)`
  and `## Coverage Check` table formats. Found in Phase 7 validation.
- conduct-ts: the `finish` step no longer stalls the loop in `--auto`. The finish
  skill normally asks the user to pick Merge/PR/Keep/Discard; in unattended mode
  print-mode Claude emitted prose and exited without writing
  `.pipeline/finish-choice`, leaving the gate permanently unsatisfied. In auto
  mode the step now gets an explicit directive to decide deterministically and
  act: open a PR (never merge) and record `pr_url` when a git remote + `gh` are
  available, else `keep` the branch — ending by writing the chosen value to
  `.pipeline/finish-choice`. `skills/finish/SKILL.md` documents the same fallback.
  Found in Phase 7 validation.
- conduct-ts: the `acceptance_specs` completion check no longer false-fails on
  non-Rails projects. Its artifact globs were Rails-only (`spec/acceptance/**/*`,
  `test/acceptance/**/*`), so a Node project — whose `writing-system-tests` skill
  correctly wrote `app.test.js` at the root — failed the gate with "no files
  matching …". Broadened to common conventions (`test/**/*`, `tests/**/*`,
  `__tests__/**/*`, root-level `*.test.{js,ts}` / `*.spec.{js,ts}`, plus Rails
  `spec/requests` and `spec/system`), scoped to avoid recursing `node_modules`.
  Found in Phase 7 validation.
- conduct-ts: `--auto` no longer drops into an interactive session. Two paths
  opened a REPL / recovery menu without checking the mode: the build-stall
  circuit breaker (`runInteractive`) and the post-retry recovery menu
  (`onRecovery`, which the CLI wires even in auto). Auto mode is unattended, so
  on an exhausted-retry failure it now: auto-skips **advisory** steps (so an
  advisory failure can't block the run) and stops on **gating/structural**
  failures (e.g. plan, build) for a human to inspect — never prompting. Found in
  Phase 7 validation.
- conduct-ts: collaborative steps (`brainstorm`, `stories`, `plan`, `manual_test`,
  `finish`) now skip permissions in `--auto` mode. They were dispatched with
  `dangerouslySkipPermissions: false` even when unattended, so the spawned
  `claude` launched in the user's default permission mode — if that's **plan
  mode, every write is blocked**, so brainstorm could never save its
  `.docs/specs/` PRD and the step looped (`no files matching .docs/specs/*.md`)
  with no human and no ExitPlanMode tool to recover. In auto mode there is no one
  to approve permissions, so these steps now skip them like autonomous steps do;
  interactive REPL mode (non-auto) still prompts. Found in Phase 7 validation.
- conduct-ts: the `worktree` step is now engine-managed (deterministic
  `WorktreeManager.create` → `git worktree add -b`) instead of dispatching
  `/conduct worktree` to Claude. The skill path let Claude run a broad
  self-directed orchestration — skipping `brainstorm` ("Feature defined in
  spec"), so **no PRD was persisted**, and botching git so the main repo ended
  up on the feature branch with an empty detached worktree. The engine now
  creates the worktree (main untouched) and drives `brainstorm` etc. normally,
  so the PRD chain holds. Worktree-creation failure degrades gracefully (warn +
  continue in-place) rather than blocking the run. Found in Phase 7 validation.
- conduct-ts: interactive steps (`brainstorm`, `stories`, `plan`, `manual_test`,
  `finish`) no longer hang silently in `--auto`. `invokeInteractive` ran every
  step with `stdio: 'inherit'`, but in print mode (`claude -p`, used for all
  interactive steps under `--auto`) an inherited TTY stdin never reaches EOF, so
  the process blocked forever with no error. Print mode now uses
  `['ignore', 'inherit', 'inherit']` (stdin ignored, output still live), matching
  the autonomous path; REPL mode (`interactive: true`) still inherits all stdio.
- conduct-ts: a "session in use" lock now self-recovers. `ClaudeProvider` detects
  the session-id lock message (`already in use` / `session … in use by another
  process`) and routes it through the existing stale-session path — the conductor
  resets to a fresh session id and retries without burning the retry budget,
  instead of failing the step. The `session_reset` event reason is now generic
  ("session unavailable (expired or in use)").
- conduct-ts: fixed `Fatal: __dirname is not defined` crash on startup. `src/conductor/src/index.ts` referenced the CommonJS-only `__dirname` global inside `readHarnessVersion()`, but the bundle is ESM (`tsup` `format: ['esm']`, `shims: false`), so the binary aborted before the CLI could parse args. Derived `__dirname` from `import.meta.url` using the same pattern already in `src/conductor/src/engine/plugin-manifest.ts`.
- conduct-ts: SHIP-phase steps no longer silently mark a feature complete when pipeline exits mid-implementation. The conductor now stamps each invocation with `state.session_started_at` and the `manual_test`, `retro`, and `finish` completion predicates require fresh, feature-scoped evidence:
  - `manual_test` requires `.docs/manual-test-results.md` with no `| FAIL` rows AND mtime >= `session_started_at` (previously had no completion gate at all — any clean REPL exit marked it `done`)
  - `retro` requires a `.docs/retros/*-<slug>.md` file matching the current `feature_desc` slug AND fresh mtime; falls back to "any retro fresh in this session" when slug is unavailable (previously matched any file under `.docs/retros/`, including stale prior-feature retros)
  - `finish` requires a fresh `.pipeline/finish-choice` marker (mtime >= `session_started_at`); for `choice="pr"`, additionally requires `state.pr_url` to be set; the conductor sweeps stale `.pipeline/finish-choice` from prior sessions on `Conductor.run()` entry (previously the marker could survive across sessions and `state.pr_url` alone could pass the gate)
- conduct-ts: `build` completion predicate now fails when `.pipeline/halt-user-input-required` is present, even with all-complete `task-status.json`. A halt marker that survives to gate-check time means a true halt that bypassed the conductor's stall handler — the predicate now treats it as a build failure so the cascade through SHIP-phase steps doesn't fire.
- conduct-ts: when auto-resume detects an "already complete" feature, the conductor now re-verifies the SHIP-phase predicates and offers a recovery prompt (roll back `feature_status` and resume at the first failing step, or keep state as-is). Self-heals worktrees that hit the prior false-completion bug.
- skills/pipeline/SKILL.md: documents the "User-requested exit during a run" contract — when the user asks to "exit to harness", "stop and continue later", etc., the skill MUST write `.pipeline/halt-user-input-required` before exiting and MUST NOT mark unfinished tasks as `completed`/`skipped`. Without the marker the conductor reads `task-status.json`, sees nothing in flight, and concludes the build step is done — silently cascading through SHIP to mark the feature complete while the user's actual blocker is still open.
- skills/manual-test/SKILL.md: instructs the skill to save results to `.docs/manual-test-results.md` (in addition to displaying in chat) so the conductor's completion gate can verify them. The previous "do NOT write to a file" wording contradicted what the bash conductor was already injecting at dispatch time.
- CHANGELOG.md: fixed unclosed backtick in the preamble that the release workflow had to step around.
- conduct-ts: `src/conductor/src/index.ts` no longer runs the CLI `main()` as an import side-effect. The unguarded top-level `main().catch(... process.exit(1))` fired whenever a test imported the module (e.g. `deriveMode`), so `process.exit(1)` surfaced as an unhandled rejection that flakily failed the parallel `vitest` run and forced a non-zero exit. Guarded with the standard ESM entry-point check (`import.meta.url === pathToFileURL(process.argv[1]).href`). The full suite now exits 0 deterministically.
- conduct-ts test: the `saves state on SIGINT` test in `test/engine/conductor.test.ts` now stubs `process.exit`; it previously invoked the real SIGINT handler's `process.exit(130)`, leaking an unhandled rejection into the run.

### Added
- conduct-ts: gate-loop daemon foundation (Phase 6) — `engine/daemon.ts`
  (`runDaemon`) is the parallel worker-pool orchestration core: pulls features
  from a backlog, runs up to N concurrently (each isolated behind the injected
  `runFeature`), enforces hard ceilings (max items, global token cost), honors
  `once` vs idle-poll, and isolates a thrown feature as an `error` outcome so the
  pool survives. `engine/daemon-backlog.ts` (`discoverBacklog`) finds
  daemon-eligible features — those with both stories AND plan present (the daemon
  consumes specs, never authors them) — skipping already-processed slugs.
  `engine/daemon-runner.ts` (`makeRunFeature`) is the per-feature orchestration
  (done → mark+remove worktree+PR; halted/error → keep worktree for the human; a
  thrown primitive is caught). `engine/daemon-deps.ts` provides the concrete
  git/fs primitives (worktree add/remove, spec materialization with commit,
  `.pipeline/DONE`/`HALT` outcome read, processed markers). New `--daemon`
  (+`--concurrency`, `--max-items`) CLI flag and `daemon-cli.ts` assemble a
  per-worktree Conductor (`verifyArtifacts`+`freshContextPerStep`, `fromStep:
  acceptance_specs`) and run the pool. 22 tests cover the orchestration,
  ceilings, isolation, eligibility, and outcome-reading; the live git/provider/PR
  path is exercised by end-to-end validation (Phase 7).
- conduct-ts: gate-loop observability — new `ConductorEvent` types `gate_verdict`
  (step, satisfied, reason), `kickback` (from, to, evidence, count), `loop_halt`
  (reason), and `loop_converged`, emitted from the conductor's gate-driven tail.
  `TerminalRenderer` surfaces unsatisfied verdicts, kickbacks (with reason + count),
  HALTs, and convergence; the json-stdout subscriber serializes them as-is. (The
  kickback now emits a dedicated `kickback` event instead of reusing
  `navigation_back`, which stays reserved for user-driven back-navigation.)
- conduct-ts: hybrid session model — new `freshContextPerStep` option. When on,
  the conductor resets the LLM session before each new step in the looped region
  (`build`…`finish`), so each runs on fresh context (Ralph-style — context never
  bloats across the SHIP phase) while a step's own retries still resume. The
  front half keeps the persistent session. Default off (persistent everywhere).
- conduct-ts: the conductor now drives the **resolved step registry**
  (`buildStepRegistry(config)`) instead of the static `ALL_STEPS`, so **custom
  steps** defined in `.ai-conductor/config.yml` (via `after:` + `skill:`) are
  dispatched, indexed, and participate in the gate loop. All index math, the
  selector, `navigateBack`/`getNavigableSteps`, and `findResumeIndex` key off the
  resolved list; loop-body checks use the registry def directly (so custom steps,
  absent from the static map, no longer throw `Unknown step`). `checkGate` accepts
  a `StepDefinition`. (Previously `buildStepRegistry` was built and tested but
  never wired into the runtime — custom steps never ran.)
- conduct-ts: gate-driven loop — selector + tail conversion. New
  `src/conductor/src/engine/selector.ts` (`selectNextGate` — earliest unsatisfied
  gate, config-agnostic). `conductor.ts` now drives the back half (`build`→`finish`)
  via the selector instead of a linear `i++`: after `build` engages, the next step
  is the earliest unsatisfied gate; a step that re-opens an upstream gate (kickback
  verdict `{satisfied:false, kickback.from}`) routes the loop back to plan/stories
  via `navigateBack` + downstream-stale cascade. Convergence writes `.pipeline/DONE`;
  an anti-ping-pong cap and a per-gate selection cap write `.pipeline/HALT`. The tail
  engages only with `verifyArtifacts` on — otherwise the conductor stays fully linear
  (unchanged). The front half (`worktree`…`acceptance_specs`) is untouched.
- conduct-ts: gate-driven loop foundation (verdict layer) — new `src/conductor/src/engine/gate-verdicts.ts` with `computeAndWriteVerdict`/`writeVerdict`/`readVerdict`/`readAllVerdicts`/`checkGateCompletion`, persisting per-feature gate verdicts (`{satisfied, reason, checkedAt, kickback?}`) to `.pipeline/gates/<step>.json`. Adds `GATE_ONLY_PREDICATES` in `engine/artifacts.ts` with machine-checkable `stories` (happy + negative path, no DRAFT) and `plan` (per-path-type story coverage) predicates — kept separate from `CUSTOM_COMPLETION_PREDICATES` so the existing linear conductor is unchanged. Blueprint in `.docs/decisions/gate-audit-2026-06-23.md`. (Selector + loop conversion land in a later change.)
- conduct-ts: new `--diagnose` CLI flag — non-mutating diagnostic that loads state for the named (or current) feature, re-verifies the SHIP-phase predicates, and prints any inconsistencies. Exits 0 when state is consistent, 1 when state is marked complete but evidence is missing.
- conduct-ts: new `feature_complete` event payload fields (`featureDesc`, `sessionStartedAt`) and a multi-line bg-green completion banner in `TerminalRenderer` so a finished run is impossible to read as "stopped processing without error" — the previous single-line green render could be missed in a long pipeline run.
- conduct-ts: new `state.session_started_at?: number` (epoch ms) — set on every `Conductor.run()` entry, used by SHIP-phase freshness checks. Purely additive; old state files deserialize fine.
- conduct-ts: new `complete-verifier.ts` module with `verifyCompleteState(worktreePath)` and `formatGapReport(...)` helpers, shared between auto-resume's recovery path and the `--diagnose` flag.
- `UIRenderer` interface (`handle(event): Promise<void>` + `stop()`) in `src/conductor/src/ui/types.ts` — new plugin contract for UI renderers
- `TerminalRenderer` class in `src/conductor/src/ui/terminal-renderer.ts` implementing `UIRenderer` (replaces the `createRenderer` factory function; backward-compat factory retained in `create-renderer.ts`)
- `dispatchRenderers(renderers, event)` in `src/conductor/src/ui/dispatch.ts` — fan-out via `Promise.allSettled`, renderer degradation (one throw doesn't kill others), re-emits `renderer_error` event to survivors
- `renderer_error` event type in `src/conductor/src/types/events.ts` — carries `rendererName` and `error` string
- `RecordingRenderer` test double in `test/ui/recording-renderer.ts` — records events, supports `delayMs` and `throwError` injection
- `registerBuiltins()` now accepts optional `TerminalRendererOptions` and registers `TerminalRenderer` as `ui_renderer:terminal_renderer` alongside the existing `TerminalSubscriber`
- New test files: `test/ui/terminal-renderer.test.ts` (TerminalRenderer class), `test/ui/dispatch.test.ts` (dispatch + degradation + slow-renderer + dup-renderer scenarios)
- `RecorderProvider` reference LLM provider plugin at `plugins/recorder-provider/` — logs every `invoke()` and `invokeInteractive()` call as a JSONL line to a configurable path, returns a canned response, creates parent directories on first write, and throws `RecorderProviderError` on write failure
- Unit tests for RecorderProvider (11 tests) covering JSONL format, canned response, parent-dir creation, error handling, concurrent writes, and invokeInteractive
- Integration tests for RecorderProvider flow (7 tests) covering happy path, misspelled kind rejection, missing plugin dir, version-incompatible manifest, and empty prompt
- RecorderProvider installs through the plugin loader with zero edits to `src/conductor/src/index.ts`
- `when?: string` field on `StepConfig` — conditional step skip evaluated before dispatch
- `parallel?: ParallelBranch[]` field on `StepConfig` — concurrent step groups via `Promise.all`
- `ParallelBranch` type: `{ name, skill?, model?, effort?, advisory? }` — discriminated from skill steps (mutual exclusion)
- `evaluateWhen(expression, state)` in `src/engine/when-expression.ts` — five grammar forms: `tier == L`, `tier in [M, L]`, `phase == BUILD`, `${key} == value`, `A && B`
- `validateWhenSyntax(expression)` — config-load-time syntax check, returns error string or null
- Four new `ConductorEvent` variants: `when_skip`, `parallel_started`, `parallel_completed`, `parallel_failure`
- Conductor evaluates `when:` before dispatching each step; emits `when_skip` when false
- Conductor fans out `parallel:` branches via `Promise.all`; writes synthetic state keys `<group>__<branch>` to `conduct-state.json`
- Gating branch failure (`advisory: false`, the default) → group fails → downstream blocked
- Advisory branch failure (`advisory: true`) → logged via `parallel_failure` event, group continues to success
- `when:` on a parallel group → all synthetic keys set to `"skipped"` when expression is false
- Terminal renderer handles `when_skip`, `parallel_started`, `parallel_completed`, `parallel_failure` events in `create-renderer.ts`
- Config validator (`engine/config.ts`) validates `when:` syntax and `parallel:` structure at config-load time
- 59 new tests across `when-expression.test.ts`, `when-parallel.test.ts`, `when-parallel-renderer.test.ts`
- Feature 3.2: json-stdout-subscriber plugin — emits ConductorEvents as newline-delimited JSON to stdout; selectable via `ui_renderer: json-stdout` in config. Each line includes all original event fields plus a `ts` ISO timestamp. handle() before start() is a no-op (no crash). Plugin discovered automatically by the plugin loader — no changes to `src/conductor/src/index.ts` required.
- Feature 4.1: EventPersister — every ConductorEvent persisted with timestamp to `.pipeline/events.jsonl` (newline-delimited JSON, replayable). Subscribes to event bus as a listener; zero changes to emission sites in `conductor.ts` or `step-runners.ts`.
- Feature 4.1: `conduct --report` subcommand — reads `.pipeline/events.jsonl` and renders step durations (sorted descending), retry hotspots (with failed-step annotation), and token spend tables. Read-only; does not start a Claude session.
- Feature 4.1: Optional `tokenUsage` field on `InvokeResult` — backwards-compatible; `ClaudeProvider` parses from Claude CLI `stream-json` output; `RecorderProvider` synthesizes deterministic counts (`{ input: 10, output: 5 }`) for stable test fixtures. Report gracefully omits token rows when field is absent.
- Plugin manifest schema (`plugin.yml`) with `kind`, `name`, `entrypoint`, `harness_version`, `capabilities?` fields
- `PluginKind` enum: `llm_provider | ui_renderer | step | hook | visualizer`
- Five typed error classes: `PluginManifestError`, `PluginVersionError`, `PluginLoadError`, `PluginNotFoundError`, `PluginRegistryError`
- `validateManifest()` with required-field, kind-enum, name-format (`/^[a-z0-9-]+$/`), and semver compatibility checks
- `loadManifestFromFile()` wrapping YAML parse and I/O errors with file path context
- `PluginRegistry` class: `register<K>()`, `get<T>()`, `list()`, `markInitialized()` with initialization guard
- `discoverPlugins()`: scans global (`~/.ai-conductor/plugins/`) and project-local (`.ai-conductor/plugins/`) directories; project-local shadows global with debug log
- `registerBuiltins()`: `ClaudeProvider` → `llm_provider:claude`, `TerminalSubscriber` → `ui_renderer:terminal`
- `src/index.ts` refactored: no longer hardcodes `new ClaudeProvider()` or `new TerminalSubscriber()` — both retrieved from registry
- Integration tests: default-fallback (blank config → claude provider), EchoProvider E2E (external plugin discovery and invocation), version-mismatch and missing-entrypoint negative paths

### Migration

New optional `when:` and `parallel:` stanzas in `.ai-conductor/config.yml` (Feature 3.1):

```bash
# Conditionally skip a step — skip 'brainstorm' on small features:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  brainstorm:
    when: "tier in [M, L]"
EOF

# Skip a step based on bootstrap mode:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  assess:
    when: "${bootstrap_mode} == fresh"
EOF

# Run two skills concurrently in a parallel group:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  build:
    parallel:
      - name: frontend
        skill: skills/build-frontend/SKILL.md
      - name: backend
        skill: skills/build-backend/SKILL.md
        advisory: false   # failure blocks the group (default)
EOF

# Combine when: with parallel: to skip the entire group on S-tier:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  build:
    when: "tier in [M, L]"
    parallel:
      - name: unit-tests
      - name: integration-tests
        advisory: true    # failure is logged but group succeeds
EOF
```

Existing projects require no changes — both `when:` and `parallel:` are opt-in.

New optional config stanzas in `.ai-conductor/config.yml` to select non-default plugins:

```bash
# Select a custom LLM provider (must be discoverable via plugin.yml in plugin dirs)
# Default is 'claude' (ClaudeProvider built-in); omit to keep using ClaudeProvider
echo "llm_provider: my-custom-provider" >> .ai-conductor/config.yml

# Select a custom UI renderer (default is 'terminal'; omit to keep using TerminalSubscriber)
echo "ui_renderer: my-custom-renderer" >> .ai-conductor/config.yml

# Install a plugin by placing plugin.yml + entrypoint in either:
#   ~/.ai-conductor/plugins/<plugin-name>/   (global — all projects)
#   .ai-conductor/plugins/<plugin-name>/     (project-local — overrides global)
```

Existing projects require no changes — built-in defaults are preserved.

## [0.99.2] - 2026-04-19

## [0.99.1] - 2026-04-19

## [0.99.0] - 2026-04-18

## [0.4.1] - 2026-04-17

## [0.4.0] - 2026-04-12

## [0.3.0] - 2026-04-11` before merge — CI fails the release workflow if the block is
empty.

Categories:

- **Added** — new skills, hooks, gates, or capabilities.
- **Changed** — behavioral changes to existing skills, hooks, or CLI.
- **Fixed** — bug fixes, typo corrections, non-behavioral cleanup.
- **Removed** — skills, hooks, or flags that no longer exist.
- **Migration** — runnable steps needed when upgrading. Use a
  ` ```bash migration ` fenced block for commands `bin/migrate` should execute.

---

## [Unreleased]

### Added

- `finish` step now has a custom completion predicate
  (`src/conductor/src/engine/artifacts.ts`) that requires either
  `state.pr_url` to be set or `.pipeline/finish-choice` to contain one of
  `pr | merge-local | keep | discard`. Without one, the conductor refuses
  to mark the step done — closing the silent-no-PR failure mode where
  print-mode finish exited with prose instead of acting.
- `auto-resume.ts` learns a new `kind: 'orphaned-state'` result, returned
  when project-root state is past the worktree step but no worktree exists
  at any conventional location (`.worktrees/<slug>` or
  `.claude/worktrees/<slug>`). `index.ts` surfaces a clear error with
  recovery instructions instead of silently resuming on main and landing
  artifacts on the wrong branch.
- `auto-resume` and the worktree scan now find worktrees under
  `.claude/worktrees/<slug>` in addition to `.worktrees/<slug>`, matching
  the convention used by Claude Code's IDE Conductor feature.
- TypeScript conductor rewrite (`src/conductor/`) — 3-layer architecture (Engine/Execution/UI) replacing the 3,100-line bash `bin/conduct`.
- `bin/conduct-ts` shell wrapper for the TypeScript conductor.
- 14-step state machine with typed events, gate enforcement, tier-based skipping, checkpoint handling, backward navigation, and recovery flow.
- LLM provider abstraction with Claude CLI adapter, session management, and rate limit handling.
- ink-based terminal UI: dashboard, checkpoint prompts, recovery menus, navigation menus.
- CLI entry point with commander: `--resume`, `--auto`, `--status`, `--from`, `--step`, `--reset`, `--cleanup`, `--output` flags.
- Worktree management: slugify, create, scan, cleanup with collision handling.
- 310 tests across 21 test files + 4 integration tests.
- Architecture diagrams (C4 levels 1-3) and architecture review for conductor rewrite.
- Phase 2 language evaluation choosing TypeScript over Python/Rust/Go.
- User validation checkpoints after build and manual-test steps in conductor.
- Backward navigation (`b = go back`) from checkpoints and recovery menu with numbered step menu.
- `stale` state marking (⚠) for downstream steps when revisiting earlier phases.
- `step_satisfied()` gate function — stale steps pass prerequisite checks but re-run when reached.
- Story catalog: 5 product epics and 36 feature stories specifying all harness behavior as Given/When/Then acceptance criteria.
- Design doc for pluggable harness architecture (phased rewrite: stories -> language eval -> conductor rewrite -> skill overrides -> UI abstraction).
- Implementation plan for Phase 1 (story catalog review and acceptance).
- Semver tagging system with CI-driven releases on merge to `main`.

### Changed

- `finish` step is now dispatched as an interactive Claude REPL in default
  mode (added to `INTERACTIVE_STEPS` in
  `src/conductor/src/engine/step-runners.ts`), not print mode. The skill
  asks the user to choose between Merge/PR/Keep/Discard; print mode
  silently swallowed that prompt and the conductor wrote `done` against
  no actual outcome. Auto mode still uses print mode and now relies on
  the new completion gate to enforce the result.
- `skills/finish/SKILL.md` requires the chosen option to be recorded:
  `.pipeline/finish-choice` for every outcome, plus `pr_url` written to
  `.pipeline/conduct-state.json` when the choice is "Push & PR". In
  unattended (print/auto) mode, the skill defaults to "Push & PR" rather
  than enumerating options to no-one.
- `README.md` reorganized around a "Choosing a Conductor" section: side-by-side
  comparison of `conduct` (stable bash, default) and `conduct-ts` (TypeScript
  rewrite, opt-in) covering install, CLI parity, dashboard, gates, auto-heal,
  and test coverage. Install section no longer implies the TS build is
  required.
- `bin/conduct` prints a one-time "conduct-ts is installed" heads-up the
  first time it runs on a machine where `conduct-ts` is on PATH, with a
  marker at `~/.ai-conductor/conduct-ts-notice-shown` so it never spams.
  `conduct --help` also now mentions `conduct-ts` at the bottom of its
  examples block. Neither changes default behavior — bash conduct stays
  the default.
- `VERSION` pinned to `0.99.0` to signal the harness is pre-1.0 while the
  TypeScript conductor rewrite stabilizes feature parity (notably the
  `--interactive` flag is still bash-only). CI-cut releases will continue
  on the 0.x line until conductor parity is declared complete.
- `run_manual_test()` now runs in print mode (automated) instead of interactive mode; harness checkpoint provides user review.
- `run_acceptance_specs()` now runs in print mode (automated) instead of interactive mode.
- Recovery menu expanded from `r/i/s/q` to `r/i/b/s/q` with backward navigation option.
- CLAUDE.md now requires Claude to present VERSION bump for user approval before creating a PR.
- `VERSION` and `CHANGELOG.md` as the source of truth for release cadence.
- `.github/workflows/release.yml` — auto-tag, rewrite changelog, bump version,
  create GitHub Release on every merge to `main`.
- `.github/pull_request_template.md` — scaffolds the Changelog + Migration
  sections for PRs against this repo. Does not affect consumer projects.
- `templates/claude-settings.json.template` and new `bootstrap` step 3d —
  bootstrap now emits a `.claude/settings.json` scoped to the project root
  (`Read`/`Edit`/`Write` under the bootstrapped directory, including
  dotfiles) so downstream skills don't block on permission prompts when
  they touch harness artifacts.
- `bin/install` now symlinks `conduct-ts` into `~/.local/bin` alongside
  the bash `conduct` when `src/conductor/dist/index.js` is present.
  `bin/conduct-ts` resolves its own path via `readlink -f` so the
  symlink works, and it honors the conductor-pinned Node version via
  `ASDF_NODEJS_VERSION` (reading `src/conductor/.tool-versions`) so
  users with an older default Node don't hit the `addAbortListener`
  import error from execa.
- Build-step stall circuit breaker + auto-interactive handoff. After a
  completion-gate miss, the conductor compares the resolved-task count
  (`completed` + `skipped` in `.pipeline/task-status.json`) before and
  after the attempt. If two consecutive retries produce zero new
  completions, or if the pipeline skill wrote
  `.pipeline/halt-user-input-required`, the conductor stops retrying,
  emits a `build_stall` event, clears the halt marker, and dispatches
  an interactive Claude REPL for the build step so the user can unblock
  whatever autonomous retry couldn't decide. Re-checks the completion
  predicate once the REPL exits — if passing, step succeeds; if still
  failing, falls into the existing recovery menu.
  Closes the failure mode where Claude's build output contains a
  rhetorical "here are three options, what would you prefer?" question
  that no amount of automated retry could resolve. 14 new tests
  (10 unit in task-progress, 4 integration in conductor).
- `skills/pipeline/SKILL.md` — new "Halt-and-Escalate" section
  documenting the `.pipeline/halt-user-input-required` marker contract.
  Pipeline writes it when it knows it needs user judgement (scope
  mismatch, ambiguous requirement, etc.) rather than guessing via a
  rhetorical output question.
- Additive `build_stall` event on `ConductorEvent` (step, reason:
  `no_task_progress | halt_marker`, resolvedBefore, resolvedAfter).
  `TerminalSubscriber` forwards it.
- Conductor skips already-resolved steps on every run. Steps marked
  `done` or `skipped` in `.pipeline/conduct-state.json` are no longer
  re-dispatched when `conduct-ts` is invoked against a project with
  existing progress (e.g. after a terminal close, a crash, or a fresh
  invocation that skipped `--resume`). Previously the main loop
  iterated ALL_STEPS unconditionally, so a re-invocation without
  `--resume` re-ran `worktree`, `memory`, `brainstorm`, etc. from the
  top even though those steps were already `done`. `failed` steps are
  still re-entered so the recovery flow can continue; `--from <step>`
  still forces a re-run of the targeted step regardless of status.
  Observed in the focus-timer-api test: build failed at 7/21 tasks,
  user re-invoked, conductor restarted at `worktree` — now it skips
  everything and lands back on `build`.
- Pre-flight `ensureClaudeSettings(projectRoot)` at conductor startup.
  Before any Claude dispatch, `conduct-ts` checks for
  `$PROJECT_ROOT/.claude/settings.json`; if absent, it writes one with
  project-scoped Read/Edit/Write rules plus a baseline Bash allow-list
  for harness tooling (`git`, `gh`, `rtk`, `npm`, `npx`, `node`, `mkdir`,
  `touch`, `chmod`, `ln`, `glow`). Solves the chicken-and-egg where
  bootstrap is supposed to write its own permission file (step 3d-i)
  but can't do so without permission to write. Stack-specific tooling
  (bundle, rails, pytest, cargo, go…) is intentionally NOT in the
  baseline — bootstrap adds those per detected stack so dead rules
  don't accumulate. Idempotent — existing files are preserved, so user
  customizations and bootstrap's own generation on a later run remain
  authoritative. 10 unit tests cover create-if-missing /
  never-overwrite / scope-correctness / baseline-Bash-allows /
  no-stack-specific-pollution.
- `INTERACTIVE_STEPS` — conversational steps (`brainstorm`, `stories`,
  `plan`, `architecture_review`, `manual_test`) now open a real Claude
  REPL (positional prompt, no `-p`) instead of one-shot print mode,
  unless the conductor was invoked with `--auto`. The design of these
  skills depends on back-and-forth with the user — one-shot print
  closed the session after a single Claude response, so the user
  couldn't refine scope or iterate. One-shot steps (`complexity`,
  `conflict_check`, `architecture_diagram`, `retro`, `finish`) stay
  print-mode — they generate artifacts from existing context without
  user input. `--auto` still forces print mode for everything so
  unattended runs don't block waiting for `/quit`. New `mode: RunMode`
  option on `StepRunnerOptions`; threaded from `src/index.ts` based on
  `--auto` flag. 12 unit tests covering the REPL dispatch matrix.
- `bootstrap_mode` state field + `mode_skip` event. Bootstrap now persists
  the detected mode (`new` / `fresh` / `partial` / `re-bootstrap`) into
  `.pipeline/conduct-state.json`. When mode is `new` the conductor
  skips `assess` with a `mode_skip` event (the 9 CTO specialists have
  no codebase to evaluate on an empty-directory scaffold). Other modes
  run `assess` normally. Closes the "assess silently loops and fails"
  failure mode observed in the focus-timer-api test run.
- `src/conductor/README.md` — new architectural overview for the
  TypeScript conductor (layout, state machine, events,
  bootstrap-mode-skip, auto-heal, pinned Node, testing pattern).
- `README.md` updated: TypeScript Conductor section, project structure
  includes `src/conductor/`, "What Your Project Gets" includes
  `.claude/settings.json`, lint hook explanation, step count corrected
  from 14 to 16.
- `bootstrap` step 3d-ii — pre-PR lint hook. Bootstrap now detects the
  project's lint command (stack-specific table: npm + tsc, rubocop +
  sorbet, ruff + mypy, clippy, go vet) and writes a `PreToolUse` hook in
  `.claude/settings.json` that runs the command before any
  `gh pr create` invocation. Non-zero exit blocks the PR. Linting is
  now deterministic harness machinery — TDD, pipeline, and code-review
  skills no longer invoke the linter themselves. Users can edit the
  hook command in `.claude/settings.json` at any time; re-running
  bootstrap is idempotent.
- `bin/migrate` — self-configuring migration runner that reads the current
  version from `~/.claude/ai-conductor.config.json`, re-runs
  `bin/install --update`, and executes any `## Migration` bash blocks from the
  changelog entries between the old and new version.
- `bin/install --update` — idempotent refresh path that skips the first-run
  dependency bootstrap and the channel-selection prompt.
- `~/.claude/ai-conductor.config.json` — user-facing config for the update
  channel (`tagged` vs `main`), current version, and auto-check preference.
- `conduct --set-channel {tagged|main}` — switch update channels without
  re-running install.
- Conductor-TS UI abstractions: `UISubscriber`, `UIEventHandler`,
  `DashboardSnapshot`, `RenderPayload`, and `UIPromptHost` in
  `src/conductor/src/ui/types.ts`; `TerminalPromptHost` reference
  implementation in `src/ui/terminal/prompt-host.ts`.
- `buildDashboardSnapshot(...)` pure builder split out from
  `renderDashboardLines`, enabling future non-terminal renderers to
  consume structured data instead of parsing strings.
- `chalk` + `ora` dependencies in `src/conductor/package.json`; colored
  dashboard output and an `ora` countdown spinner on `rate_limit` events.
- Current-step banner (step label + HH:MM:SS start time) on the dashboard
  and a post-step `lastStepTail` pane showing the last N lines of the
  previous step's captured stdout.
- `--view full|focus|log` and `--tail-lines <n>` flags on `bin/conduct-ts`.
- Optional `tail?: string[]` field on `step_completed` events (last 200
  lines of captured output; backwards-compatible additive).

### Changed

- `check_harness_update()` in `bin/conduct` is channel-aware: on the `tagged`
  channel it checks for the latest `vX.Y.Z` git tag, renders the changelog
  block via `glow` before prompting, and calls `bin/migrate` on approval.
- `HARNESS.md` now documents the update flow in a new "Harness Updates" section.
- `CLAUDE.md` (harness-repo-level) documents the new release and update gates.
- Conductor-TS readline prompts (checkpoint, recovery, artifact review,
  complexity, navigation) consolidated behind `TerminalPromptHost` instead
  of being scattered top-level functions in `src/conductor/src/index.ts`.
  `ConductorOptions` shape is unchanged — the engine contract is stable.
- `renderDashboardLines` now delegates through the snapshot builder +
  `formatDashboardSnapshot` formatter. Public signature preserved; string
  output is identical apart from additive color on TTY.
- Dashboard step-started transient line shows the step's display label
  (e.g. `Brainstorm`) instead of the raw step name (`brainstorm`).

### Migration

No migration steps required when upgrading from 0.3.0 — the new update flow
takes effect on the next `conduct` run after this release is installed.

### Fixed

- Conductor-spawned Claude sessions no longer inherit the user's global
  `permissions.defaultMode`. `SessionManager.buildClaudeArgs()` in
  `src/conductor/src/execution/session.ts` now explicitly passes
  `--permission-mode default` for interactive step invocations (which
  previously passed nothing and fell through to whatever the user had
  globally). This was silently breaking interactive steps like
  `/brainstorm`, `/stories`, `/plan` for users whose global
  `~/.claude/settings.json` had `"defaultMode": "plan"` — those sessions
  booted into plan mode and the skill could not write its required
  `.docs/specs/`, `.docs/stories/`, or `.docs/plans/` artifacts. Non-
  interactive invocations are unaffected (they already pass
  `--dangerously-skip-permissions`).
- Feature-level state (manual-test, retro, etc.) no longer bleeds across features in root state file; project-level steps (bootstrap, assess) persist correctly.
- Task progress counter shows correct total from the start (0/10, 1/10) instead of growing denominator (1/1, 2/2).
- `bin/conduct-ts` autonomous Claude invocations no longer print
  `Warning: no stdin data received in 3s, proceeding without it.` — the
  provider now passes `stdin: 'ignore'` to execa on the print-mode path.
- Conductor auto-heals `.pipeline/task-status.json` drift before
  re-invoking the build step. When the completion gate fails with
  "tasks not completed", the engine reconciles each pending task against
  the current branch's git log (commit-message + touched-file match); any
  task with unambiguous prior-run evidence is flipped to "completed"
  in-place and the gate re-checks without a Claude retry. Audit trail
  under `.pipeline/audit-trail/autoheal-*.json`. Runs once per session
  per step; scoped to `build`; silently skips when git is absent.
  Additive `auto_heal` event on `ConductorEvent` for UI visibility.
- `skills/pipeline/SKILL.md` — orchestrator-writes-review.json gate tightened:
  after each batch evaluator returns, the orchestrator must atomically
  `mkdir -p`, write `.pipeline/audit-trail/batch-N/review.json`, and
  stat-check the file before advancing. Missing or empty file is a hard
  halt. Closes the "silently bypassed 4 evaluator gates" failure mode.
- `skills/pipeline/SKILL.md` — Pipeline Entry Guard added: if every task
  is already `completed`/`skipped`, the skill early-exits with a one-line
  progress.log note instead of loading the plan and dispatching work.
  Prevents token burn on crashed-then-resumed sessions that already
  finished.
- `skills/pipeline/SKILL.md` — `.pipeline/summary.json` is now required
  at final-task completion (fields: plan_ref, complexity_tier, autonomy,
  task counts, batch counts, rework cycles, interventions, timestamps,
  first/last commit SHAs). Retro consumes this file instead of
  recomputing stats via an Explore agent.
- `skills/pipeline/SKILL.md` — Evaluator model table added: Medium-tier
  intermediate batch evaluators run on Sonnet (not Opus); only the final
  batch evaluator runs on Opus. Small stays Sonnet-only. Large keeps
  Opus throughout.

### Removed

- Dead Ink/React terminal components and their tests
  (`src/conductor/src/ui/terminal/*.tsx`,
  `src/conductor/test/ui/terminal/*.test.tsx`) — superseded by the
  text-based live-region renderer.
- `ink`, `react`, `ink-testing-library` dependencies from
  `src/conductor/package.json` (`react` peerDeps removed too); the
  `"jsx": "react-jsx"` compiler option is dropped from
  `src/conductor/tsconfig.json`.

---

## [0.3.0] - 2026-04-11

Retroactive entry capturing the state of the harness at the point the
versioned release flow was introduced.

### Added

- Full SDLC skill suite: bootstrap, brainstorm, stories, plan,
  architecture-diagram, architecture-review, writing-system-tests, tdd,
  pipeline, code-review, simplify, debugging, manual-test, finish, pr, retro,
  conduct, assess, conflict-check, memory.
- `bin/conduct` orchestrator with phase detection and gate enforcement.
- `bin/install` with symlink-based skill installation, settings.json
  permission/hook wiring, and dependency bootstrap (glow, rtk, puppeteer MCP).
- Hook suite under `hooks/claude/` for destructive-git blocking, TDD commit
  gating, lint-after-edit, spec/diagram coverage, rate-limit handling, session
  start context loading, and stop-memory reminders.
- `test/test_harness_integrity.sh` validation suite covering bash syntax,
  SKILL.md frontmatter, agent references, cross-skill references, HARNESS.md
  model table, template references, and section numbering.
- `HARNESS.md` as the single source of truth for project-facing behavioral
  rules, consumed by every project using the harness.