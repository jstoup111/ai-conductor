# Architecture Review: Scoped invocation cannot expand to the aggregate suite

**Date:** 2026-08-01
**Tier:** Medium (lightweight mode — Feasibility + Alignment; complexity and domain pre-check skipped per skill)
**Track:** technical
**Input reviewed:** intake jstoup111/ai-conductor#1173, `.docs/track/build-review-repeats-aggregate-verification-despit.md`, `.docs/architecture/2026-08-01-scoped-invocation-cannot-expand-to-aggregate.md`, `.pipeline/explore-notes.md`
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clear. TypeScript engine, vitest, `execa` already in use by `full-suite-executor.ts:307`. No new dependency. |
| **Prerequisites** | None external. The scoped-run config key is additive and optional, so no consumer action is required before the change lands. |
| **Integration surface** | Three engine touchpoints: CLI dispatch (`src/index.ts`, sibling of the `test-suite` verb at `:404-406`), the `test_suite` config validator (`config.ts:1152-1225`), and a new scoped-run module. Plus prompt/doc call sites. Under the 3-boundary flag threshold for engine code. |
| **Data implications** | None. No schema, no migration, no persisted state. Notably the feature does **not** write evidence — it deliberately stays out of the content-addressed proof path owned by `FullSuiteVerifier`. |
| **Performance risk** | Net negative cost, which is the point: an accidental aggregate run costs roughly one native-suite duration (median 2.01 min in the intake's local sample). Risk of a scoped run being *too* narrow is bounded by the existing four fallback triggers in `HARNESS.md:333-339`. |
| **Worktree isolation** | Clean. The interface is stateless, takes file paths, shells out in the project root. No new port, service, database, queue, or shared file. Two worktrees can run it concurrently — unlike the aggregate verifier, it needs no lock because it writes nothing. |

**Feasibility verdict: FEASIBLE.**

One feasibility finding materially changed the design and is recorded in
`adr-2026-08-01-engine-owned-scoped-test-invocation`: the review question as posed
("validate `test_suite.command` does not discard forwarded arguments") targets the wrong command.
`FullSuiteVerifier` never forwards arguments to the aggregate command, so the constraint would be
inert where applied and absent where needed, while invalidating correct existing consumer configs.
The rule was moved onto the new scoped-run key, where it is both meaningful and non-breaking.

A second finding eliminated the intake's hook-interception hypothesis on feasibility rather than
principle: `build_review` is dispatched with `dangerouslySkipPermissions: true`
(`step-runners.ts:1727`), so a permission-decision hook may never fire for the very session that
produced the observed incident, and `hooks/codex/` is empty so provider parity would be net-new.

A third finding came from operator challenge during review and changed the contract. The scoped
template's placeholder was originally specified as `{files}`, on an unverified assumption that a
file-path list expresses scoped selection generally. It does not: `go test` selects packages,
`cargo test` selects by test-name substring with no file selection at all, and `dotnet test`, Gradle,
and Maven select by filter expression or class name. The placeholder became an opaque `{selectors}`
list the engine substitutes but never interprets, which is runner-agnostic by construction. The
correction and its evidence table are recorded in the ADR's Verify-Claims ledger rather than
silently patched.

## Alignment

**Domain boundaries.** The feature respects the boundary the deterministic-verification work
established: `FullSuiteVerifier` remains the sole authority for aggregate runs and the sole writer of
`.pipeline/test-suite-evidence.json`. The scoped path is a genuinely separate concern that has never
had an owner, and this gives it one. No aggregate machinery is modified.

**Pattern consistency.** The new verb follows the registration pattern of the existing `test-suite`
verb (`src/index.ts:404-406` → `engine/test-suite-cli.ts`). Fail-closed validation on a malformed
config value follows `config.ts:1152-1225`. Neither is a new pattern, so no ADR is owed on that
basis.

**Alignment with the repository Design Principle.** This is the strongest alignment signal.
`CLAUDE.md` states that when an agent repeatedly violates a rule, the fix is machinery that
rejects at the moment of the mistake, not a stronger prompt. #245 and #588 both addressed this
leak with prompt/documentation-only changes, and #245's engine-side scoped re-execution was
explicitly deferred and never landed. This is the third occurrence, and the first proposal to move
the mechanism into the engine.

**State management.** No new state, no new gate, no new lifecycle status, no boolean flags. The
scoped-run interface is a pure function of (config, file set) → process exit status.

**Diagram accuracy.** `.docs/architecture/2026-08-01-scoped-invocation-cannot-expand-to-aggregate.md`
matches this design; both Mermaid blocks pass `conduct-ts render-diagrams --check`.

**Security boundaries.** One item worth naming: the scoped-run template is operator-authored config
interpolated with file paths and executed in a shell. That is the same trust model as
`test_suite.command`, which is likewise operator-authored and run via `execa(command, {shell:true})`.
No privilege escalation relative to today, but see Risk R3 for the path-interpolation caveat.

**Alignment verdict: ALIGNED.**

## Scope discipline (out-of-scope drift check)

The operator narrowed this feature to command-expansion prevention. `/stories` and `/plan` MUST NOT
introduce work in these areas, all of which belong to other tickets:

| Excluded | Owner |
|---|---|
| Evidence reuse across gates for an unchanged tree | **#1176** (critical, L, v1.0, assigned) — and largely already built in `FullSuiteVerifier`'s `REUSED` path |
| BUILD post-task tail latency, fixed cooldowns | **#1176** |
| Review output size/duration reduction targets | **#1176** |
| Model-tier or reasoning-effort reduction, shadow calibration | **#1176** |
| Partial sibling BUILD-verification capability after rebase | **#1205** |

Two intake outcomes are therefore **deliberately not delivered by this feature** and must not appear
as acceptance criteria: "review output size and duration fall materially from the measured baseline"
and "any model-tier reduction is evaluated in shadow". Building the reuse path here would recreate
the partial-sibling failure already tracked as #1205.

## Wiring Surface

Design-time commitment for each new production surface:

| New surface | Where it is called from in production |
|---|---|
| Scoped-run CLI verb | Registered in the `conduct-ts` dispatch in `src/conductor/src/index.ts`, following the `test-suite` verb's detect/dispatch shape at `src/index.ts:404-406`. Invoked by BUILD and `build_review` provider sessions as a shell command. |
| Scoped-run engine module | Called by the CLI verb's dispatch entry point; not exported for direct step-runner use in this feature. |
| Scoped-run config key + its validator rule | Read by the scoped-run module at invocation; validated inside the existing `test_suite` validation path in `src/conductor/src/engine/config.ts`, which is already called on every `loadConfig`. |
| Repaired `package.json` scripts | Consumed by `.ai-conductor/config.yml`'s `test_suite.command` (`npm test`) via `full-suite-executor.ts:307`, and by developers directly. |
| Prompt/skill references to the verb | `build-review-prompt.ts` (grader prompt, currently `:58-60`), `skills/pipeline/SKILL.md`, `skills/tdd/SKILL.md`, `HARNESS.md` intermediate test execution policy. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 — Implementation edits `bin/conduct`, tripping the `bin/conduct CLI` breaking surface and HALTing the self-host release gate with no migration block | Integration | Low | High | `adr-2026-08-01-scoped-run-verb-release-surface` makes "do not edit `bin/conduct`" a binding, plan-carried constraint. Condition C1 below. |
| R2 — Agents keep hand-assembling `npm test -- <files>` because the prompts still describe that form | Knowledge | Medium | Medium | Updating the call sites is in scope (ADR Decision 8), not a follow-up. Condition C2. |
| R3 — A selector containing shell metacharacters or a space is spliced into the scoped template and misparsed or injected | Security | Low | Medium | ADR Decision 5: substitution must quote each selector or pass them as argv, never string-splice. Condition C3. |
| R4 — Scoped runs silently fall back to aggregate when the key is unconfigured, recreating the defect | Technical | Low | High | ADR Decision 6 forbids silent fallback; unavailability must be explicit. Must have a negative-path story. Condition C4. |
| R6 — An empty selector list is substituted into the template, producing the bare command and running everything | Technical | Medium | High | ADR Decision 4 refuses an empty selection outright. This is the highest-likelihood recurrence of the original defect, since an empty affected-set arises naturally (it is fallback trigger 3, `HARNESS.md:336`). Condition C8. |
| R7 — A consumer's runner cannot express its selection as one templated invocation (`go test` packages, `cargo test` name filters, `dotnet`/JVM filter expressions) | Technical | Low | Low | ADR A3: the `{selectors}` placeholder is opaque, covering package and filter-expression runners; genuinely inexpressible cases leave the key unconfigured and route through the aggregate verifier. Documented, not blocking. |
| R5 — Stories drift into #1176's reuse/latency/calibration territory | Knowledge | Medium | Medium | Scope discipline table above; `/conflict-check` must verify. Condition C5. |

No High-impact risk is unmitigated; R1 and R4 are High-impact but each is fully addressed by a
condition below.

## ADRs Created

- `adr-2026-08-01-engine-owned-scoped-test-invocation.md` — the engine owns scoped argv assembly; a
  new additive config key carrying an opaque `{selectors}` template, with fail-closed validation on
  that key only; an empty selector list is refused rather than executed; no constraint added to
  `test_suite.command`; no silent fallback.
- `adr-2026-08-01-scoped-run-verb-release-surface.md` — no migration block and no waiver, given the
  classifier's exact-path rules, subject to the `bin/conduct` constraint. The implementation writes
  neither `CHANGELOG.md` nor `VERSION`; the bot-owned release PR owns both.

## Conditions

- **C1** — `/plan` must carry "MUST NOT edit `bin/conduct`" as an explicit task condition. If
  implementation finds a real need to edit it, the PR requires a migration block and
  `adr-2026-08-01-scoped-run-verb-release-surface` must be superseded.
- **C2** — Updating the call sites (`build-review-prompt.ts`, `skills/pipeline/SKILL.md`,
  `skills/tdd/SKILL.md`, `HARNESS.md`) is in scope for this feature, not deferred. A change that
  ships the interface while the prompts still describe hand-assembly does not satisfy the intake.
- **C3** — File paths must be passed to the runner without shell-splicing ambiguity (argv or
  explicit quoting). Needs a test with a path containing a space.
- **C4** — An unconfigured scoped-run key must produce an explicit "scoped running unavailable"
  result naming the key, never an aggregate run. Needs a negative-path story and test.
- **C8** — An empty selector list must be refused, not executed. This needs its own negative-path
  story and test; it is the likeliest way the original defect returns, because an empty affected-set
  occurs naturally and is already an enumerated broad-fallback trigger (`HARNESS.md:336`).
- **C5** — `/conflict-check` must confirm no story overlaps #1176 or #1205 per the scope discipline
  table.
- **C6** — The implementation writes neither `CHANGELOG.md` nor `VERSION` (amended 2026-08-07). The
  change is notable and reader-visible — new CLI verb + new config key — but the bot-owned
  `automation/release-pr` owns both files, and the pipeline's `release-disposition` step derives the
  PR's release declaration. No task records the note.
- **C7** — Documentation upkeep is mandatory in the same PR: the new verb → `docs/reference/cli.md`;
  the new config key → `docs/reference/configuration.md`; the changed test-execution policy →
  `HARNESS.md`.

## Verdict

**APPROVED WITH CONDITIONS.** The design is feasible and aligned, and it moves a thrice-violated
prose rule into machinery, which is what this repository's Design Principle requires. Conditions
C1–C7 are tracked into `/plan`.
