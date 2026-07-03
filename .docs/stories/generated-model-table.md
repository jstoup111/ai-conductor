**Status:** Accepted

# Stories: Generated HARNESS.md Model-Selection Table

**Track:** technical (no PRD — derived from intake jstoup111/ai-conductor#187 + APPROVED ADR
`adr-2026-07-03-generated-model-table-single-source`)
**Tier:** M

---

## Story: Typed model-table metadata is the single source of truth

**Requirement:** TS-1 (ADR §1)

As a harness maintainer, I want model/effort policy and its rationale expressed as typed engine
exports so that adding or changing a step's policy is a single-file edit that cannot silently
omit table data.

### Acceptance Criteria

#### Happy Path
- Given the engine metadata module, when it exports `STEP_RATIONALE`, then it is typed
  `Record<StepName, string>` and has a non-empty rationale for every step in
  `DEFAULT_STEP_MODELS` (including `complexity` and `architecture_review_as_built`).
- Given the metadata module, when it exports `EXTRA_MODEL_TABLE_ROWS`, then every non-engine row
  of today's HARNESS.md table (domain-reviewer, evaluator, code-review, debugging, simplify,
  pipeline→(kept as engine `build` row), tdd RED/GREEN, engineer, conduct, pr, worktree-manager→(engine `worktree` row), cto-security, cto-data-integrity, cto-dependencies, cto-architecture, cto-duplication, cto-testing, cto-infrastructure, cto-observability, cto-devex, cto-orchestrator, manual-test→(engine row), …) is represented exactly once with a name, model text, and rationale.
- Given the metadata module, when it exports `SKILL_STEP_MAP` and `PIN_EXEMPT_SKILLS`, then every
  `skills/*/SKILL.md` carrying a `model:` pin is either mapped to a `StepName` or listed as
  exempt with an inline rationale comment.

#### Negative Paths
- Given a new `StepName` is added to the union in `src/conductor/src/types/steps.ts` without a
  matching `STEP_RATIONALE` entry, when `npm run typecheck` runs in `src/conductor`, then it
  fails with a missing-property error on `STEP_RATIONALE` (compile-time enforcement — verified
  by a type-level test, e.g. `tsc` on a fixture or an `expect-type` assertion).
- Given a skill directory with a `model:` pin that is neither in `SKILL_STEP_MAP` nor in
  `PIN_EXEMPT_SKILLS`, when the pin check (TS-4) runs, then it fails naming that skill —
  an unmapped pinned skill is never silently passed.
- Given `EXTRA_MODEL_TABLE_ROWS` contains a name that collides with an engine step's table name
  (e.g. an extra row named `plan`), when the generator runs in any mode, then it exits non-zero
  reporting the duplicate row name (no duplicate rows can be emitted).

### Done When
- [ ] `src/conductor/src/engine/model-table-metadata.ts` exists, exports the four constants, and `npm run typecheck` passes
- [ ] A unit test asserts every `DEFAULT_STEP_MODELS` key has a non-empty `STEP_RATIONALE` entry
- [ ] A unit test asserts every `skills/*/SKILL.md` `model:` pin is mapped or exempt (fixture-driven with the real skills/ dir)
- [ ] A unit test asserts duplicate row names (engine vs extra) are rejected

---

## Story: Generator write mode rewrites only the marked region

**Requirement:** TS-2 (ADR §2, §3, §5; conditions C1, C2)

As a harness maintainer, I want `bin/generate-model-table` to regenerate the HARNESS.md table
in place so that the committed table always equals the engine metadata.

### Acceptance Criteria

#### Happy Path
- Given HARNESS.md contains `<!-- BEGIN GENERATED: model-selection-table -->` and
  `<!-- END GENERATED: model-selection-table -->` markers, when `bin/generate-model-table` runs,
  then the region between markers is replaced with the generated table and every byte outside
  the region (including the markers themselves and the hand-authored prose/interim-fallback
  note) is unchanged.
- Given the generated table, when rendered, then it has one row per engine step with Model,
  Effort, and Why columns; tier-varying steps render suffixed values from
  `DEFAULT_STEP_TIER_OVERRIDES` (e.g. plan → `sonnet (S/M), fable (L)` and effort
  `medium (S), high (M), xhigh (L)`); `complexity` and `architecture_review_as_built` appear as
  explicit rows; `EXTRA_MODEL_TABLE_ROWS` render after the engine rows.
- Given a freshly written table, when `bin/generate-model-table --check` runs immediately after,
  then it exits 0 (write is idempotent and self-consistent).
- Given the wrapper script, when it resolves its runner, then it executes
  `src/conductor/node_modules/.bin/tsx` on the TypeScript source directly.

#### Negative Paths
- Given HARNESS.md is missing the BEGIN marker, the END marker, or has END before BEGIN, when
  the generator runs in write or check mode, then it exits non-zero with a message naming the
  missing/malformed marker and HARNESS.md is not modified at all (C2 — never append, never
  whole-file regenerate).
- Given HARNESS.md contains two BEGIN markers, when the generator runs, then it exits non-zero
  reporting the duplicate marker (ambiguous region is a hard error, not a first-match guess).
- Given `src/conductor/node_modules/.bin/tsx` does not exist, when `bin/generate-model-table`
  is invoked directly, then it exits with a distinct environment-error code (not the drift code)
  and a message telling the user to run `npm install` in `src/conductor` — and it never falls
  back to `npx -y` (no network fetch; verified by asserting the wrapper contains no `npx` and
  the process makes no package download).
- Given the generator runs in any mode, when it completes, then `src/conductor/dist/` mtimes are
  unchanged and no `tsup`/`npm run build` process was spawned (shared-dist rebuild hazard guard;
  asserted by a test that stats dist before/after — invariant must hold on the error branches
  above too, not just the happy path).

### Done When
- [ ] `bin/generate-model-table` (bash) + `src/conductor/src/tools/generate-model-table.ts` exist; `bash -n` passes (integrity check 1 covers bin/)
- [ ] `tsx` is in `src/conductor` devDependencies (C1) and the wrapper contains no `npx`/build invocation
- [ ] Unit tests cover: region-only rewrite (byte-identical outside), marker missing/malformed/duplicate hard errors with unmodified file, idempotent write→check, tier-suffix rendering, explicit `complexity` + `architecture_review_as_built` rows
- [ ] Distinct exit codes documented in the wrapper: 0 ok, 1 drift (check mode), 2 environment/marker error

---

## Story: Check mode detects table drift

**Requirement:** TS-3 (ADR §3, §4)

As a harness maintainer, I want `--check` to fail loudly when the committed table disagrees with
the engine so that forgotten regeneration cannot merge.

### Acceptance Criteria

#### Happy Path
- Given the committed region equals the generated output, when `bin/generate-model-table --check`
  runs, then it exits 0 and prints nothing but a pass line.
- Given `--check` runs, when it completes (pass or fail), then HARNESS.md is byte-identical to
  before the run (check mode never writes — invariant holds on the failure branch too).

#### Negative Paths
- Given a hand-edit inside the generated region (e.g. a model changed from `sonnet` to `opus` in
  one row), when `--check` runs, then it exits 1 and prints a unified diff plus the exact
  remediation command (`bin/generate-model-table`).
- Given an engine default changes (e.g. `DEFAULT_STEP_MODELS.stories` flipped to `fable` in a
  test fixture) without regeneration, when `--check` runs, then it exits 1 with the diff showing
  the stale row.
- Given whitespace-only corruption of the region (trailing spaces, CRLF), when `--check` runs,
  then it still exits 1 — comparison is exact, not normalized (silent normalization would let
  real drift hide behind "cosmetic" churn).

### Done When
- [ ] Unit tests cover: clean pass, in-region hand-edit, changed-default drift, whitespace drift, and no-write-on-check (before/after byte compare)
- [ ] Exit code 1 is used only for drift; environment/marker errors use a different code (so the suite can distinguish)

---

## Story: Pin check keeps SKILL.md frontmatter honest

**Requirement:** TS-4 (ADR §1, §4)

As a harness maintainer, I want every hand-authored SKILL.md `model:` pin verified against the
engine default for its step so that the interactive and autonomous paths cannot silently diverge.

### Acceptance Criteria

#### Happy Path
- Given `--pins` mode, when it runs, then it emits JSON mapping each mapped skill to its
  engine-default model (tier-override base value, i.e. the untiered default) and each exempt
  skill with an `"exempt": true` flag.
- Given all pins agree with engine defaults (e.g. `skills/rebase/SKILL.md` pins `fable` and
  `DEFAULT_STEP_MODELS.rebase` is `fable`), when integrity check 5b runs, then it passes each
  skill by name.

#### Negative Paths
- Given `skills/explore/SKILL.md` pin is edited to `sonnet` while `DEFAULT_STEP_MODELS.explore`
  is `fable`, when check 5b runs, then it FAILS naming the skill, the pinned value, and the
  expected engine value.
- Given a skill in `PIN_EXEMPT_SKILLS` (e.g. `code-review`, which has no engine step), when
  check 5b runs, then it passes that skill as exempt — and the exemption does NOT suppress the
  duplicate/unmapped failure from TS-1 for other skills.
- Given a SKILL.md whose frontmatter has no `model:` line, when check 5b runs, then that skill
  is skipped (inheriting from session/engine is legal) — absence of a pin is never an error.
- Given malformed JSON from `--pins` (simulated by a corrupted fixture), when check 5b consumes
  it, then the check FAILS with a parse error rather than passing vacuously on empty data.

### Done When
- [ ] `--pins` JSON schema covered by a unit test (mapped, exempt, and unmapped-fail cases)
- [ ] Suite-level test (bash) demonstrates: agreeing pin passes, disagreeing pin fails with names, pin-less skill skipped, malformed JSON fails closed

---

## Story: Integrity suite integrates drift + pin checks with warn-and-skip degradation

**Requirement:** TS-5 (ADR §4)

As a harness consumer running `test/test_harness_integrity.sh` in a checkout without
`npm install`, I want the new checks to degrade to a warning so that I never see a false
integrity failure — while CI (with node_modules) enforces them hard.

### Acceptance Criteria

#### Happy Path
- Given `src/conductor/node_modules` exists, when the suite runs, then section 5a invokes
  `bin/generate-model-table --check` and section 5b runs the pin comparison, and both report
  pass/fail into the suite's PASS/FAIL counters.
- Given `src/conductor/node_modules` is absent, when the suite runs, then sections 5a/5b emit a
  WARN line ("model-table checks skipped — run npm install in src/conductor") via the suite's
  existing `warn_check` mechanism, the suite's exit code is unaffected by the skip, and the
  presence-only check 5 still runs.

#### Negative Paths
- Given node_modules exists and the table has drift, when the suite runs, then the suite FAILS
  (non-zero exit) — degradation must not trigger when the environment is healthy.
- Given node_modules exists but the generator exits with the environment-error code (e.g. tsx
  binary missing due to a partial install), when the suite runs, then the suite FAILS with the
  environment message — a broken toolchain in a supposedly-installed checkout is a real failure,
  not a skip (only the *absence of node_modules* degrades).
- Given the drift check fails, when the suite completes, then the remaining checks (6, 7, …)
  still ran — one section's failure doesn't abort the suite (matches existing suite behavior).

### Done When
- [ ] `test/test_harness_integrity.sh` gains sections 5a/5b; `bash -n` passes
- [ ] A suite self-test (or documented manual verification in the PR) demonstrates all four paths: healthy-pass, drift-fail, env-error-fail, no-node_modules-warn-skip
- [ ] Existing checks 1–7 unchanged and still green

---

## Story: Repo lands regenerated and drift-free with docs updated

**Requirement:** TS-6 (condition C3; CLAUDE.md docs-track-features + changelog gates)

As a harness maintainer, I want the feature PR to ship the regenerated table and updated docs so
that the repo is self-consistent the moment it merges.

### Acceptance Criteria

#### Happy Path
- Given the feature branch, when `bin/generate-model-table` has been run, then HARNESS.md
  contains the markers and the regenerated table (with the new Effort column, `complexity` and
  `architecture_review_as_built` rows), and `bin/generate-model-table --check` exits 0.
- Given the docs, when reviewed, then HARNESS.md's surrounding prose instructs "edit
  `model-table-metadata.ts` / `resolved-config.ts` and run `bin/generate-model-table`" (the
  "change all three by hand" instruction is gone), CLAUDE.md's validation-suite list includes
  the two new checks, and `CHANGELOG.md` `[Unreleased]` has an Added entry.
- Given the full validation suite, when `test/test_harness_integrity.sh` runs on the branch with
  node_modules installed, then it exits 0.

#### Negative Paths
- Given the regenerated table, when its content is compared to the pre-change table, then no
  step lost its rationale ("Why" text) and no existing row silently disappeared — every row of
  the old table is either present (possibly renamed per the documented step-name mapping) or its
  removal is called out in the PR body.
- Given the interim-fallback blockquote (#186) and the "Two enforcement paths" prose, when the
  regeneration runs, then both survive byte-identical outside the markers.

### Done When
- [ ] `bin/generate-model-table --check` exits 0 on the branch; full integrity suite green
- [ ] HARNESS.md prose, CLAUDE.md suite list, and CHANGELOG `[Unreleased]` updated in the same PR
- [ ] PR body includes the old-vs-new table row accounting
