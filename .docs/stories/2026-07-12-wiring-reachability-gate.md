**Status:** Accepted

# Stories: Wiring reachability gate (green-but-unwired guard)

Track: technical (no PRD). Source: intake jstoup111/ai-conductor#462 +
adr-2026-07-12-wired-into-contract + adr-2026-07-12-wiring-check-gate (both APPROVED) +
architecture-review-2026-07-12-wiring-reachability-gate (APPROVED WITH CONDITIONS).

---

## Story: Wired-into plan-line parser with round-trip guarantee

**Requirement:** ADR wired-into-contract (grammar); review condition 2

As the conductor engine, I want a deterministic parser for per-task `Wired-into:` lines so that
the wiring contract is machine-readable with the same reliability class as `Files:` lines.

### Acceptance Criteria

#### Happy Path
- Given a plan task carrying `**Wired-into:** src/engine/conductor.ts#advanceTail`, when the plan
  is parsed, then the task's contract is one declared site `{path: 'src/engine/conductor.ts',
  symbol: 'advanceTail'}`.
- Given `**Wired-into:** src/a.ts#foo, src/b.ts#bar`, when parsed, then both sites are returned
  in order.
- Given `**Wired-into:** same as Task 3` on Task 5, when parsed, then Task 5's contract resolves
  to Task 3's contract (matching `Files:` inheritance semantics).
- Given `**Wired-into:** none (no new production surface)`, when parsed, then the task's contract
  is the closed variant `no_new_surface`.
- Given `**Wired-into:** none (inert until jstoup111/ai-conductor#999)`, when parsed, then the
  contract is `inert` with ref `jstoup111/ai-conductor#999`.
- Given `**Wired-into:** none (inert until .docs/plans/2026-08-01-wiring-follow-up.md)`, when
  parsed, then the contract is `inert` with a repo-local path ref.
- Given any parsed contract, when re-serialized to its line form and re-parsed, then the result
  is identical (round-trip property, tested in the same tasks that introduce the parser).

#### Negative Paths
- Given a line `**Wired-into:** fix it later`, when parsed, then the parser returns a
  `malformed` result naming the offending text and the four accepted forms — it does NOT
  silently drop the line or treat it as `no_new_surface`.
- Given `**Wired-into:** same as Task 99` where Task 99 does not exist, when parsed, then the
  result is a named error `inheritance target Task 99 not found` (not an empty contract).
- Given `**Wired-into:** none (inert until )` (empty ref), when parsed, then the result is
  `malformed` (an inert waiver without a ref never parses as a valid waiver).
- Given a task with two `Wired-into:` lines, when parsed, then sites accumulate (bullet
  continuation, matching `Files:` behavior) — verified so grammar drift (#417 class) is pinned
  by test, not convention.
- Given a `Wired-into:` value written with backticks (e.g. `` `src/b.ts#foo` ``), when
  `parsePlanTaskPaths` processes the section, then the line is consumed by the Wired-into match
  (as `FILES_LINE` consumes its line) and `src/b.ts#foo` does NOT leak into the task's `Files:`
  corroboration paths via the `BACKTICK_TOKEN` prose fallback (conflict-check finding vs
  autoheal.ts:1159-1166).

### Done When
- [ ] `WIRED_INTO_LINE` parser exists beside `FILES_LINE` in `src/engine/autoheal.ts` (or an
      extracted module autoheal imports) and is exported for the gate predicate.
- [ ] Round-trip tests (author → parse → serialize → parse) pass for all four closed forms.
- [ ] Malformed inputs produce named parse errors carrying the offending text; zero silent drops.

---

## Story: Architecture-review output must enumerate the wiring surface (M/L)

**Requirement:** ADR wired-into-contract (decision origin)

As an operator, I want the design-time architecture review to name every production entry
point/consumer the feature hooks into, so that consumer-scoping errors (#460's "1 of 3
schedulers") are caught at design time.

### Acceptance Criteria

#### Happy Path
- Given a Medium or Large feature in design-time architecture-review, when the review reaches
  its APPROVED verdict, then the review report contains a `## Wiring Surface` section
  enumerating the production entry points/consumers (each as `path#symbol` or a named consumer
  list), and `/plan` can derive `Wired-into:` lines from it.

#### Negative Paths
- Given a review of a feature that adds new production behavior, when the reviewer produces a
  report with no `## Wiring Surface` section, then the review's own verification checklist marks
  the review incomplete — the SKILL.md checklist gains a blocking item, so an APPROVED verdict
  without a wiring surface is a checklist violation visible at review time.
- Given a capability with multiple consumers named in the approved architecture, when the later
  plan declares `Wired-into:` sites covering only a subset, then plan review flags the
  under-declaration against the `## Wiring Surface` section (drift is checkable because both
  artifacts name the same surface).

### Done When
- [ ] `skills/architecture-review/SKILL.md` design-time sections require the `## Wiring Surface`
      enumeration for M/L features and carry a blocking verification-checklist item.
- [ ] The requirement is scoped to design-time mode only (as-built §12 unchanged).

---

## Story: Plan derives Wired-into lines; Small tier authors them directly

**Requirement:** ADR wired-into-contract (contract carrier + fallback)

As the plan author, I want the plan skill to require a `Wired-into:` line on every task so the
contract always exists for the gate, whatever the tier.

### Acceptance Criteria

#### Happy Path
- Given an M/L feature with an approved `## Wiring Surface`, when `/plan` writes tasks, then
  every task carries a `**Wired-into:**` line derived from that surface (or a `none` form), in
  one of the four closed forms.
- Given a Small feature (no architecture-review ran), when `/plan` writes tasks, then the plan
  authors the `Wired-into:` lines directly (fallback origin) with the same grammar.

#### Negative Paths
- Given a plan task that adds exported primitives, when its `Wired-into:` line is omitted, then
  the plan skill's verification checklist blocks (missing line = incomplete plan), and — if it
  still ships — the wiring_check gate independently reports `undeclared new-export surface`
  (defense in depth; neither layer trusts the other).
- Given a plan whose `Wired-into:` line names a path outside the repo (e.g. `../other/x.ts#f`),
  when the plan is validated, then the line is rejected as malformed (path must be repo-relative).

### Done When
- [ ] `skills/plan/SKILL.md` documents the grammar (all four forms + inheritance), the M/L
      derivation rule from `## Wiring Surface`, the Small-tier self-authoring fallback, and a
      blocking checklist item.
- [ ] The plan template/examples show a `Wired-into:` line beside `Files:`/`Dependencies:`.

---

## Story: wiring_check step joins the gate loop between build_review and manual_test

**Requirement:** ADR wiring-check-gate (step placement)

As the conductor, I want `wiring_check` as a gating loop member after `build_review` so an
unwired feature can never advance to manual_test.

### Acceptance Criteria

#### Happy Path
- Given a build whose `build_review` gate is satisfied, when the selector picks the next
  unsatisfied gate, then `wiring_check` is evaluated before `manual_test` (its `prerequisites`
  are `['build_review']` and `manual_test.prerequisites` now reads `['wiring_check']`).
- Given a fully wired feature, when `wiring_check` evaluates, then the verdict is
  `satisfied:true` and the tail proceeds to `manual_test` with no operator interaction.
- Given ANY complexity tier including Small, when the step topology is derived, then
  `wiring_check` is present (`skippableForTiers: []`).

#### Negative Paths
- Given a wiring gap, when the predicate fails, then the verdict is `satisfied:false` with
  `kickback:{from:'wiring_check', evidence:<named gaps>}` re-opening `build` — no HALT marker is
  written on this path.
- Given repeated wiring failures on the same gate, when the kickback count exceeds
  `MAX_KICKBACKS_PER_GATE`, then the EXISTING stall-escalation path engages (unchanged
  behavior) — verified so the new gate cannot ping-pong forever.
- Given a consumer project mid-build when the engine updates (stale topology), when gates are
  recomputed for an in-flight feature whose `manual_test` verdict predates `wiring_check`, then
  the selector re-derives from `ALL_STEPS` without crashing (topology migration is exercised in
  a test seeded with pre-existing gate verdicts).
- Given a file-changing rebase at finish time, when `applyRebaseVerdicts` invalidates the
  re-verify set, then `wiring_check` is IN that set (`{build, build_review, wiring_check,
  manual_test}`) so a stale `satisfied` wiring verdict cannot survive a rebase that moved or
  deleted the verified references (conflict-check finding vs conductor.ts:3454-3463 and the
  #420 pinned enumeration — the #420 and build-review registry tests are amended in the same
  change).
  **Refined by `adr-2026-07-20-post-rebase-delta-aware-invalidation.md` (#655):** this
  unconditional membership is narrowed to a delta-aware trigger condition rather than
  contradicted — `wiring_check` verifies production reachability (runtime paths), so a
  test-only or docs-only rebase delta cannot move or delete a production reachability
  target, and preserving `wiring_check` on such a delta does not violate this story's
  rationale (the references it verified are provably intact). `wiring_check` is invalidated
  iff the rebase delta contains runtime source (`D_featureSrc ∪ D_foreignSrc ≠ ∅`) and
  preserved on a test/docs-only delta — a strict narrowing of the trigger condition that
  keeps the gate's protective intent unchanged (established precedent: this story's own
  amendment of the #420 pinned enumeration).
- Given the shipped build-review story's registry test asserting
  `manual_test.prerequisites === ['build_review']`, when this feature repoints the field, then
  that registry test is updated in the same commit to assert `['wiring_check']` AND that
  `wiring_check.prerequisites === ['build_review']` (build_review remains strictly upstream —
  original intent preserved, adjacency assertion amended).

### Done When
- [ ] `steps.ts` contains the new StepDefinition; `manual_test.prerequisites` repointed.
- [ ] Selector/advanceTail integration test: unsatisfied wiring_check blocks manual_test;
      satisfied wiring_check unblocks it.
- [ ] Kickback path test proves no `.pipeline/HALT` on a plain wiring gap.

---

## Story: Layer 1 universal probe — declared sites verified, orphan exports named

**Requirement:** ADR wiring-check-gate (Layer 1); review conditions 1, 3

As the wiring gate, I want a language-agnostic verification that declared call sites really
reference the new symbols and that no new export ships referenced by nothing, so every consumer
project gets deterministic protection.

### Acceptance Criteria

#### Happy Path
- Given a task with declared site `src/engine/conductor.ts#advanceTail` and a feature diff whose
  new symbol `probeWiring` is referenced at that site in non-test code, when Layer 1 runs, then
  the site passes with evidence `{site, symbol, matchedLine}`.
- Given new exported symbols each referenced by ≥1 non-test file other than their defining file,
  when the backstop runs, then it passes listing each symbol with its referencing file.
- Given a task whose contract is `none (no new production surface)` and a diff adding no new
  exports for that task's files, when Layer 1 runs, then the task passes.

#### Negative Paths
- Given a declared site whose file exists but contains no reference to any of the task's new
  symbols, when Layer 1 runs, then the gap reads
  `declared call site src/x.ts#foo has no non-test reference to «symbol» (searched: src/x.ts)` —
  symbol AND search scope named (condition 3).
- Given a new exported symbol referenced ONLY from `*.test.ts` / `test/` / `__tests__/` paths,
  when the backstop runs, then the gap reads `«symbol» exported but referenced by no production
  code (N test-only references excluded)` — test-only callers never satisfy the gate.
- Given a new exported symbol referenced only from its own defining file, when the backstop
  runs, then it is a named gap (self-reference is not wiring).
- Given a task adding new exports whose contract is `none (no new production surface)`, when
  Layer 1 runs, then the gap names the contradiction: the symbols added vs the declared-none
  contract (undeclared surface).
- Given a diff whose base cannot be derived (no anchor, no origin default, no merge-base), when
  the probe runs, then the verdict is `satisfied:false` with reason `wiring scope
  undeterminable` (fail-closed, abstain-or-loud) — never a silent pass.
- Given a plan containing ZERO `Wired-into:` lines on any task (legacy plan authored before this
  contract existed), when the gate evaluates, then it passes `satisfied:true` with a loud
  advisory in the verdict reason (`legacy plan (pre-Wired-into contract): wiring gate
  advisory-only for this feature`) and the Layer 1 backstop findings are reported as advisory
  text, not gaps — operator-selected disposition (conflict-check 2026-07-12); a fully-undeclared
  NEW plan is prevented upstream by the plan skill's blocking checklist and the engineer land
  gate, not by this predicate.
- Given a plan with ≥1 `Wired-into:` line on any task, when the gate evaluates, then full
  gating applies to every task (partial declaration does not soften the gate).

### Done When
- [ ] `src/engine/wiring-probe.ts` exports Layer 1 as a pure function over injected inputs
      (diff symbols, file reader, grep runner) — injectable via `CompletionContext`.
- [ ] New-symbol extraction reuses the evidence-range base ladder (no new base derivation).
- [ ] Every gap message asserts symbol + searched-scope in tests (adversarial fixtures per
      review condition 5).
- [ ] Layer 1 lands and gates independently of Layer 2 (condition 1 sequencing).

---

## Story: Layer 2 TS reachability — entry-point import graph with loud degradation

**Requirement:** ADR wiring-check-gate (Layer 2)

As the wiring gate on a TS/JS project, I want new exports proven transitively imported from the
project's configured production entry points, so orphan islands that pass Layer 1 are caught.

### Acceptance Criteria

#### Happy Path
- Given `wiring.entry_points: [src/index.ts, src/daemon-cli.ts, src/intake-loop-cli.ts,
  src/engine/engineer-cli.ts]` in `.ai-conductor/config.yml` and a new export whose module is
  imported (transitively, via non-test edges) from `src/daemon-cli.ts`, when Layer 2 runs, then
  the symbol passes with the import chain recorded as evidence.
- Given the self-host repo, when config is read, then the four entry points above are present in
  the committed config (self-host default lives in config, not engine constants).

#### Negative Paths
- Given a new export in a module imported only by another new module that nothing imports
  (orphan island — passes Layer 1 by mutual reference), when Layer 2 runs, then the gap reads
  `«symbol» exported but unreachable from any entry point (roots: <configured list>)`.
- Given a module reachable only through imports inside test files, when the graph is built, then
  those edges are excluded and the symbol is unreachable (named gap).
- Given a TS project with NO `wiring.entry_points` config, when Layer 2 would run, then it skips
  with an explicit advisory line in the verdict reason (`Layer 2 skipped: wiring.entry_points
  not configured`) and Layer 1's result still gates — loud degradation, never silent.
- Given a non-TS project (no tsconfig/package.json), when the probe runs, then Layer 2 does not
  run and the verdict reason records `Layer 2 not applicable (no TS project detected)`.
- Given a configured entry point path that does not exist on disk, when Layer 2 runs, then the
  verdict is `satisfied:false` naming the bad root (config error is a gap, not a skip — a typo
  must not silently disable reachability).

### Done When
- [ ] Import graph built with the already-present `typescript` compiler API (no new dependency).
- [ ] `wiring.entry_points` parsed from config with schema validation; self-host default
      committed to this repo's `.ai-conductor/config.yml`.
- [ ] Reachability evidence records the chain (root → … → defining module) for at least one
      passing case in tests; unreachable gaps name roots searched.

---

## Story: Inert waiver resolves or blocks — fail-closed

**Requirement:** ADR wired-into-contract (waiver); ADR wiring-check-gate (resolution)

As an operator shipping a deliberately-INERT staged rollout, I want the waiver honored only when
its follow-up ref is real and open, so the wiring PR can never be silently orphaned (#179/#180).

### Acceptance Criteria

#### Happy Path
- Given `none (inert until .docs/plans/2026-08-01-follow-up.md)` and that file exists in the
  repo, when the gate evaluates, then the task is waived and the verdict evidence records
  `waived: inert until .docs/plans/2026-08-01-follow-up.md (path exists)`.
- Given `none (inert until jstoup111/ai-conductor#640)` and issue #640 is open, when the gate
  evaluates with `gh` available, then the task is waived with the resolved state recorded.

#### Negative Paths
- Given an inert ref to a repo-local path that does not exist, when the gate evaluates, then the
  gap reads `inert waiver ref .docs/plans/… not found` and the verdict kicks back to build.
- Given an inert ref to a CLOSED issue, when the gate evaluates, then the gap names the closed
  state (`inert waiver ref #640 is closed — wiring follow-up already resolved or abandoned`) —
  a closed ref never waives.
- Given an issue ref while `gh` fails (network/auth/quota), when the gate evaluates, then the
  gap reads `inert waiver ref #640 unverifiable (gh error: <stderr line>)` — fail-closed; the
  waiver is a bypass, outages must not widen it. A later retry with `gh` restored clears it.
- Given an inert waiver on a task whose diff ALSO adds a production reference to the new symbol
  (contract says inert, code says wired), when the gate evaluates, then the contradiction is a
  named gap (stale contract), not a pass — the plan must be corrected to declared sites.

### Done When
- [ ] Waiver resolution implemented with injectable path/`gh` runners; all four negative paths
      covered by tests with adversarial fixtures.
- [ ] `gh` is never invoked for path-form refs (no network on the local form).

---

## Story: WiringEvidence artifact — validated, named, kickback-consumable

**Requirement:** ADR wiring-check-gate (evidence file); review condition 3

As the completion predicate, I want a validated `.pipeline/wiring-evidence.json` recording per-gap
named evidence so verdicts are auditable and the build agent receives actionable kickback text.

### Acceptance Criteria

#### Happy Path
- Given a probe run, when it completes, then `.pipeline/wiring-evidence.json` records: probed
  base + HEAD shas, per-task contract form, per-site/per-symbol results (pass with evidence,
  or gap with kind ∈ closed enum), Layer 2 applicability, and waiver resolutions.
- Given a valid evidence file with zero gaps, when `STEP_COMPLETION_CHECKS.wiring_check` runs,
  then the gate is satisfied.

#### Negative Paths
- Given an evidence file that is not a JSON object / missing required numeric+enum fields /
  recording a HEAD sha different from the current HEAD, when the validator runs, then the gate
  is unsatisfied with a reason naming the exact defect (`validateAcceptanceRedEvidence`
  precedent — stale or forged evidence never satisfies).
- Given gaps present, when the predicate composes the kickback, then `kickback.evidence`
  contains every gap's full named message (symbol + searched scope) — the build agent sees the
  same text the operator would.
- Given a gap kind outside the closed enum, when the validator runs, then validation fails
  (exhaustive matching, no catch-all pass — domain-integrity requirement).

### Done When
- [ ] `WiringEvidence` interface + `validateWiringEvidence` in `src/engine/artifacts.ts`
      (template: AcceptanceRedEvidence) with predicate wired into `STEP_COMPLETION_CHECKS`.
- [ ] Freshness check (HEAD sha match) proven by a test that moves HEAD after writing evidence.

---

## Story: Docs, config schema, and changelog land in the same PR

**Requirement:** review condition 4; repo release gates

As a harness consumer, I want the new gate and config key documented when the feature merges, so
the behavior change is discoverable and the release gates pass.

### Acceptance Criteria

#### Happy Path
- Given the feature PR, when it is reviewed, then `README.md` and `src/conductor/README.md`
  document the `wiring_check` step, the `Wired-into:` grammar (four forms), and
  `wiring.entry_points`; `CHANGELOG.md` `[Unreleased]` carries an Added entry.

#### Negative Paths
- Given the config schema change, when release classification runs, then the PR carries either a
  real migration note or (if internal-only per the waiver rules) a compliant
  `.docs/release-waivers/` file — an empty/missing classification response fails the release
  gate rather than shipping undocumented.

### Done When
- [ ] Both READMEs updated; CHANGELOG `[Unreleased]` entry present.
- [ ] `test/test_harness_integrity.sh` passes (SKILL.md edits keep frontmatter/model-table
      agreement).
