---
title: Gates
parent: Explanation
nav_order: 3
---

# Gates

What a gate is in this harness, the four enforcement levels, the gates that can block a feature, and the
waiver mechanism. Per-step enforcement values are listed in [steps](../reference/steps.md); the integrity
check suite is a different thing and lives in [validation](../contributing/validation.md).

## What a gate is

A gate is a check that can block progression. Every step passes through two of them before the flow moves on:

1. **The prerequisite gate.** Every step names the steps it depends on. The gate passes when all of them are
   satisfied — where satisfied means `done`, `skipped`, or `stale`. A skipped step therefore never wedges
   its dependents.
2. **The completion gate.** After a step runs, the engine recomputes whether it is actually done by reading
   evidence off disk, and writes the verdict to `.pipeline/gates/<step>.json`. The loop owns that verdict.
   An agent cannot declare its own step complete; see [evidence model](evidence-model.md).

A step that never ran still leaves a verdict. When the engine resolves a verdict-bearing step by *skipping*
it — complexity tier, work track, bootstrap mode, an upstream skip, `disable: true`, a false `when:`, the
daemon's in-loop `retro` skip, or an advisory step that failed and was auto-skipped in auto mode — it writes
`{"satisfied": true, "reason": "skipped: <cause>"}` to `.pipeline/gates/<step>.json`. Satisfaction is
unchanged (the selector has always treated a skipped gate as satisfied); what changes is that the skip is
*recorded*. Before this, a skipped gate left no verdict file at all and the selector fell back to the step's
own status flag, so `retro` — advisory, tier-S-skippable, and skipped on every daemon run — could reach a
resolved state with no verdict anywhere in the audit record. Read the `skipped: ` prefix as "this gate was
deliberately not run", never as "this gate's evidence passed".

Those two are orthogonal. Prerequisites answer *may this run yet*; completion answers *did it actually
happen*. A step can pass the first and fail the second forever, which is exactly what a halt looks like.

## The four enforcement levels

Enforcement is a property of the step, not of the gate. It decides what happens when the step fails.

| Level | On failure in auto mode | In interactive mode | Can config disable it? |
| --- | --- | --- | --- |
| `advisory` | marked `skipped`, run continues | recovery menu, `skip` offered | yes |
| `gating` | run halts | recovery menu, tagged `[gating]`, `skip` withheld | no, unless the step definition opts in |
| `structural` | run halts | recovery menu, `skip` offered | never — the opt-in flag is ignored |
| `mechanical` | — | — | not accepted by the config validator |

Read the levels as a statement about *who can decline the step*:

- **Advisory** steps are useful, not load-bearing. Memory recall, exploration, architecture diagrams, retro.
  If one fails unattended the run keeps going, because a missing retro should not strand a finished feature.
- **Gating** steps are the correctness contract. A failure means the thing being gated is not true yet, so
  the run stops rather than proceeding on a false premise. The interactive recovery menu drops the `skip`
  option for these — you can retry, fix interactively, go back, or quit, but you cannot wave one through.
- **Structural** steps are mechanics the flow cannot proceed without: the worktree, the build itself, the
  rebase. They fail the run in auto mode like a gating step, and no project config can turn one off.
- **Mechanical** is declared in the type union and documented as the hook-based enforcement tier, but no
  step definition uses it and the config validator rejects it. It is currently a reserved word.

Exactly one built-in gating step opts into being disabled by project config, and that opt-in is per step and
must be committed in `.ai-conductor/config.yml`. The point of the restriction is that a partial or
copy-pasted config can never silently drop a guardrail.

## The gate catalog

Gates come in five families. The families exist in different places in the codebase because they run at
different times against different evidence.

| Family | Runs | Blocks | Count |
| --- | --- | --- | --- |
| prerequisite | before every step | that step | 1 (universal) |
| per-step completion | after a step runs, and whenever the loop re-scores it | that step, and the loop | 12 |
| land-time | when a spec PR is landed | the spec, before anything is built | 8 |
| self-host | before the finish step, only when the harness is building itself | the PR | 6 |
| hook | at the moment of a tool call | the individual edit, command, or dispatch | see [settings and hooks](../reference/settings-and-hooks.md) |

### Commit scope-containment boundary

The generated `commit-msg` hook checks staged paths on a task-attributed commit against the active task's
declared files. A path outside that declaration is diagnosed with one copy-pasteable
`Scope: <path> — <rationale>` trailer per path. Those trailers make an intentional widening visible to the
engine-side containment floor and to `build_review`; they do not declare a task complete or waive semantic
scope review.

Containment ships report-only by default because false-positive refusals can stall a live build. The checker
prints every verified violation but returns `0`, so the commit proceeds and the containment floor retains the
evidence for later review. Set `build_review.scopeContainmentEnforced: true` to enable refusal. Its
three-valued contract keeps the hook safe if state is unavailable: `0` allows (including a reported default
violation), `2` is a positive refusal when enforcement is enabled, and every other result is an abstention
that the hook logs and allows. The hook converts only `2` to Git's blocking exit `1`; malformed or missing
task state never blocks a build.

At `build_review`, the containment floor writes `.pipeline/containment-floor.json`. Every violation is also
printed in the step output and warning log with its task id, commit SHA, and offending paths. Every accepted
widening is supplied directly to the isolated grader with its path, rationale, task id, and commit SHA, because
the grader judges the branch diff rather than commit messages. The rubric projection carries that diff by
reference — per-file paths, change kinds, and hunk line ranges anchored to the merge base — and the grader
session, running inside the feature worktree, reads the referenced file contents and per-path diffs itself
instead of receiving the raw diff text inline.

### Declared pattern replication check

A plan may declare, in its header, that it replicates an existing source file under a rename map
(`**Pattern-source:**` / `**Rename-map:**`, parsed by `plan-pattern-source.ts`). When the declaration
resolves, `build_review` runs a deterministic content-comparison check — the engine's first — before the
grader runs: it reads the declared copy target, applies the rename map to the source, and requires an
exact match. Unlike the per-task floors above, which are fail-soft and never change `success`, a copy
mismatch **fails the step** outright, and its diagnostic (missing target, unexpected target, a rename-map
collision, or a content mismatch naming the first differing line and column) is returned in place of a
grader verdict — no RED evidence is derived from it, and it never runs at `acceptance_specs`. A
`malformed` declaration (one header line without the other, an unresolvable source path, or an invalid
rename-map pair) fails `build_review` before either the equivalence check or the grader runs, so a
half-declaration can never be read as no declaration at all.

### Per-step completion gates

These are the twelve gates that decide whether a step's work is real. Ten replace the default
"did the step's artifact glob match anything" check with a custom predicate; two more run only in the
verdict layer, so they can be strict without disturbing the linear walk.

| Step | What it protects against |
| --- | --- |
| `stories` | stories that exist but do not specify behavior — every story needs a happy path and a negative path, each with scenarios, and none may be draft |
| `plan` | a plan that does not cover the feature's stories, scoped to this feature's plan and stories |
| `build` | tasks reported complete without work — task rows are re-seeded and re-derived from the plan each evaluation, so a forged row fails |
| `acceptance_specs` | acceptance specs that never ran — proof is required that this feature's specs executed *and failed*, so a collection error or a skipped spec cannot pass for RED |
| `build_review` | an incomplete build — four independently judged Tautology, Scope, Root Cause, and Completeness raw verdicts joined into a fresh effective PASS, judged from the diff rather than self-reports |
| `wiring_check` | no active check — a deprecated compatibility step retained so existing state, config, and prerequisites continue to resolve |
| `test_suite` | a stale green — the fingerprint is re-inspected every time, so the evidence file's existence can never satisfy it |
| `manual_test` | a whitewashed retest — after a recorded FAIL, HEAD must have moved before an all-PASS attempt is accepted |
| `prd_audit` | a partial audit report passing as complete — exactly one verdict row is required for every FR enumerated by the feature's approved PRD; a missing row blocks identically to an unaccepted missing, partial, or diverged row. When the report carries a `## Verdict Table` heading, only that section's rows count as verdicts, so a prior-cycle history table cannot block an all-`ALIGNED` audit. An unresolvable or unreadable feature PRD also blocks fail-closed |
| `architecture_review_as_built` | an unrecognized verdict passing by default — only an explicit approval verdict satisfies it |
| `retro` | a retro from a different feature or a prior session counting for this one |
| `finish` | a publication outcome that was never coherently recorded — `.pipeline/finish-choice` is the final record, not the source of interactive intent; a `pr` outcome additionally requires the recorded PR identity and verified publication evidence |
| `finish` (release readiness) | a configured release-disposition result that is missing, stale, malformed, or unreadable — FINISH reports the exact typed condition before dispatching prose authoring or judgment, or making a publication mutation |
| `finish` (prose authorship) | a retained PR whose body is still the engine-seeded placeholder — the coordinator dispatches its `author_pr_prose` pass (with the branch diff and the feature's spec artifacts) and accepts it only when re-observation shows the placeholder classification gone. The judgment pass is therefore never handed an unauthored body, and no prose defect commits the shipped record, so a prose halt stays re-dispatchable |
| `finish` (presentation) | a PR shipping with halt boilerplate or an engine-generated floor body (the body-floor marker plus floor content — a marker an authoring pass left behind on real prose does not count) — either classification keeps a bounded prose pass required and prevents the final outcome record. Every completion-gate refusal in this class is classified `missing: 'presentation'`, which routes the loop back into `finish` for a body rewrite rather than into `/remediate` or `build`; that re-dispatch is bounded to one attempt per `pr_url` (recorded in `.pipeline/pr-body-regen-attempt.json`), after which the engine's deterministic body floor runs as a last resort so the feature still converges. A reused halt PR's *presentation* is repaired earlier still — whenever the retained SHIP PR identity is resolved (SHIP-phase adoption, the pre-finish snapshot, or the finish-time restore), so SHIP steps that run before `finish` do not read a `needs-remediation` placeholder; a lighter clear additionally runs once at the start of every dispatch regardless of phase, so a resumed `BUILD` step is not left holding the placeholder either; the draft→ready flip stays finish-only |

Within `build_review`, the Tautology counterfactual is classified solely by the scoped command's exit
code; the engine does not parse runner-specific output. Exit code zero stays green and every nonzero
exit is counterfactual RED. Only launch, timeout, and signal are scoped-run infrastructure outcomes.
When a counterfactual excerpt establishes that no test executed, Tautology judges that as a finding rather
than an infrastructure result. A scoped-run infrastructure failure carries a bounded output excerpt on the
existing `.pipeline/events.jsonl` event spine.

Each predicate's exact file, format, and failure text is in [artifacts](../reference/artifacts.md).

### Tree-attesting admission

A step may declare itself tree-attesting only when its completion predicate re-verifies the current
tree rather than trusting persisted step state. At the dispatch boundary, a persisted `done` status for
such a step is fast-forwarded only when that predicate still passes; a stale or indeterminate result
falls through to normal dispatch. The check reads evidence and does not reconcile or rewrite state.
`skipped` remains a scheduling decision and is never re-evaluated by this rule.

The same rule applies at resume entry (`--resume`, including a daemon restart): a `done` step with a
satisfied on-disk gate verdict is re-checked against its tree-attesting predicate before resume clamps
its starting index to a later step. A predicate that no longer passes, or that throws, pulls the resume
entry back to that step instead of trusting the stale verdict — this is what lets a daemon restart
after a rebase land on `test_suite` rather than resuming past it into `build_review`.

The current tree-attesting set is `{build, test_suite}`. `build` re-derives task completion from the
current history, and `test_suite` re-inspects its content fingerprint. This admission rule prevents a
rebase-invalidated suite proof from allowing `build_review` to run ahead of `test_suite` while preserving
the ordinary fast path for a current proof.

### BUILD-verification round authority

`wiring_check` and `test_suite` remain the BUILD-verification group for topology compatibility.
`wiring_check` is a deprecated no-op; only `test_suite` performs an active verification. After BUILD
is repaired, the next round re-dispatches every non-skipped member; a satisfied gate verdict on disk
never skips a member by itself. The group's current join is the sole authority that marks a member
satisfied for that round.

### Land-time gates

These run when the engineer loop lands a spec branch, outside the step loop. They protect the base branch
from specs that would waste a build.

| Gate | Refuses |
| --- | --- |
| required artifacts | a spec missing its PRD, stories, or plan, or with an empty one |
| draft/stub reject | any artifact still marked draft, or a known stub string |
| stories approval | stories without the explicit acceptance marker — not being draft is not enough |
| ADR status | any ADR under `.docs/decisions/` whose first line-anchored `Status:` declaration is not `APPROVED` or `SUPERSEDED`, or that declares no status at all — fenced code-block examples of rejected statuses are excluded from matching |
| tier agreement | a declared complexity tier that disagrees with the artifacts present |
| coherence | a traceability record that does not connect outcomes, requirements, accepted ADRs, stories, and tasks, or stories that do not tie out to the PRD |
| mermaid render | a diagram that does not render — previously prose guidance, now enforced |
| protected-target plan | a task that directs BUILD to amend another feature's sealed DECIDE artifact |

Before land, plan authoring runs `conduct-ts plan-protected-targets <plan-path>`. It is a blocking,
read-only check that reports every offending task/path pair. Land repeats the same judgment against
the plan being landed, so a plan cannot bypass the rule by skipping the authoring command. Both gates
apply at every tier and judge only the current plan, not historical plans already merged.

The coherence gate is itself layered. It disengages entirely at tier S, and it does not apply retroactively:
a change set with no coherence artifact path in it is treated as a legacy change, not a violation. Once
engaged, the story, orphan-task, and coverage-table layers are always required; the functional-requirement
layer only on the product track; the outcome layer only when outcomes exist; and the ADR layer whenever
the current spec change set contains a `.docs/decisions/adr-*` path, including a deletion. The ADR row
pool itself contains only non-deleted ADRs, so a deletion-only change engages the layer but passes with
no ADR row. It aggregates every gap rather than stopping at the first, and reports them as one error.
See [engineer loop](../guides/engineer-loop.md).

The functional-requirement layer checks both directions, because coverage alone is only half of a tie-out.
Forward, a PRD requirement no story cites — or whose only citing stories no task covers — is a gap.
Reverse, a story that cites an `FR-N` the PRD never declares, or that cites no requirement at all, is a gap
against that story's id. The reverse direction runs on the product track only: a technical-track spec has no
PRD, so it has no requirement layer to tie out against. What the gate does not judge is whether a story
*semantically* delivers the requirement it cites — a story whose scenarios contradict its own FR is a
`fail` verdict the `/coherence-check` skill records, not a set comparison. Story-versus-story contradictions
belong to `conflict-check` earlier in DECIDE; this gate compares each story against the PRD only.

Earlier in DECIDE, `conflict_check` also compares each relevant story with the selected approved ADR
corpus. The default `change_set` corpus is bounded to the current spec's ADRs; `repo_wide` narrows all
approved ADRs to overlapping subjects and records the ADRs it examined and excluded. That judgment resolves
ADR-versus-story conflicts before planning. This is separate from the coherence gate: any current-change-set
ADR path engages its ADR layer, while only non-deleted ADR files enter the traceability-row pool; no
conceptual applicability judgment expands that row set.

### Self-host gates

When the harness builds itself, an extra bundle activates as one unit behind a single decision. It covers
version approval, the release artifact gate, a live-boundary fingerprint, a build-auth preflight, a sandbox
build environment, and a skill relink preflight. These protect the running checkout from the build that is
modifying it. Details and the release-gate specifics are in [releases](../contributing/releases.md) and
[self-hosting](../guides/self-hosting.md).

## Fail-closed semantics

Every completion gate fails closed. Missing evidence, stale evidence, malformed evidence, and a non-passing
verdict all leave the gate unsatisfied — none of them is treated as "probably fine".

Three specific forms this takes:

- **Presence is never proof.** Several gates re-derive their answer even when a passing artifact is sitting
  right there, because the artifact could describe a previous state of the code.
- **Freshness is part of the check.** A verdict must be newer than a floor — the current judging attempt
  when there is one, otherwise the run's session start. Without the per-attempt floor, a review session that
  failed to rewrite its verdict would silently re-score the previous session's answer forever. A small
  filesystem-clock tolerance applies to the attempt floor only.
- **Undeterminable is a failure, not a pass.** When a gate cannot compute its input at all — an unresolvable
  plan among several, a change set git cannot produce, a scope it cannot bound — it blocks. It does not
  guess.

The one deliberate fail-open: when a run carries no session-start timestamp at all, freshness checks pass on
file presence, so upgrading the harness mid-feature does not strand an in-flight build.

## Kickback and remediation routing

A blocking gate in the tail loop does not simply stop. It routes.

**Kickback** re-opens an upstream gate by writing an unsatisfied verdict that carries provenance: which step
re-opened it, and the evidence. Four steps opt in as kickback targets — `prd`, `architecture_review`,
`stories`, `plan` — so the furthest back the loop can throw work is the spec. Kickbacks per gate are capped;
past the cap the run halts instead of cycling.

An autonomous run may enter a DECIDE step only with explicit operator direction. The same fail-closed
policy is consulted at all four navigation seams: the forward walk, the verdict-aware resume clamp,
the verdict-driven `scanKickbackVerdicts` rewind, and the planner-driven `planRemediation` rewind. An
unknown target or phase, or an unsatisfied or unverified DECIDE completion contract, writes a
`needs-human` HALT and launches no provider. This supersedes the two-seam DECIDE-kickback policy from
#551.

The policy fast-forwards without dispatch only when the DECIDE step is tier-skipped, has no completion
contract, or has a verified satisfied contract. Otherwise an operator must create a matching
[`decide-grant`](../reference/cli.md#conduct-ts-decide-grant); the grant authorizes one named step and
is consumed immediately before that step dispatches. The grant is stored in the daemon-owned
`.daemon/grants/<slug>.json`, outside every feature worktree, so a build agent cannot author its own
authorization; a `decide-grant.json` inside `.pipeline/` authorizes nothing. `plan` is excluded
entirely — it is refused before any grant is consulted, and the CLI rejects `--step plan`, because a
daemon that re-plans rewrites an approved DECIDE artifact with no human at the gate. A `planRemediation` rewind that names a DECIDE
step is the one exception: remediation explicitly asking to revise that step is evidence the accepted
artifact needs another look, so a satisfied contract does not fast-forward it either — the same grant
is still required. Interactive runs retain their existing DECIDE authoring path.

**Remediation** is what a blocking SHIP audit — or a `build_review` completeness or scope failure — does when the
fix is not obvious. It classifies each gap and routes it to the earliest step that can close it — build,
acceptance specs, architecture review, or plan — all of which sit before the gate that found it. A fifth
disposition, `publication`, covers a gap whose only defect is the published PR prose (a placeholder or
wrong-template body, a stale title, a missing `Closes` reference): it routes to `finish`, the step that owns
PR prose, and — unlike the four step-valued targets — appends nothing to `.docs/plans/<slug>.md`, because a
PR body fix is not plan work and amending the plan from here trips the protected-artifact self-amendment
guard. Two gap categories cannot be routed and halt for a human instead: architectural clarity and product
scope. Neither is something an unattended run should decide.

A finish-gate refusal that is *itself* a publication defect never reaches the planner at all. The gate
already names exactly what is wrong with the PR, so the loop re-dispatches `finish` directly for a body
rewrite — bounded to one re-dispatch, after which the gate's own last-resort body floor converges the
feature. Routing that through the planner is what once turned a 30-second `gh pr edit` into an 18-task
rebuild.

A verified FINISH publication transition is progress, not a failed attempt: it immediately re-enters
FINISH without spending the step retry budget or advancing its model-escalation rung. This separate
allowance is bounded to 14 verified transitions per FINISH step entry. If publication still has not
converged when the allowance is exhausted, the conductor writes a `needs-human` HALT naming the last
transition rather than looping indefinitely. The [stalled-feature runbook](../runbooks/stalled-or-stuck-feature.md#finish-publication-halts)
defines diagnosis and recovery for that halt.

If the remediation plan is missing, stale, malformed, or has gaps it does not cover, the engine falls back
to deterministic routing rather than trusting a partial plan. Unknown dispositions are dropped, not
honored.

An ordinary `build` disposition must carry concrete tasks — a taskless `build` gap is dropped and the run
halts instead of dispatching an empty route to the builder. The one exception is a build-stall question:
there the answer legitimately lives in the gap's `rationale` with `tasks: []`, so a taskless `build` is
accepted only when the gap's source is a build-stall.

Remediation tasks must not order a regression. A task that removes, replaces, rewrites, or relaxes
existing code, tests, or assertions has to name the completed plan task or story criterion whose
delivered behavior and coverage survive the change, and — unless the evidence shows that coverage is
redundant — carry the replacement in the same task as the removal. Removing a workaround does not
license dropping the assertion beside it: the next audit re-raises the lost coverage and the lap is
spent restoring it. This applies to every remediation trigger, not only the `finish` verification's
test failures.

A remediation gap that requires amending another feature's sealed DECIDE artifact is not eligible for
`build` or `acceptance_specs`. It returns to the owning DECIDE step; in daemon mode the existing
DECIDE kickback policy reaches the operator gate rather than attempting a BUILD-side bypass.

### A prior lap's FAIL is not a fresh verdict

`build_review` completion reads `.pipeline/build-review.json` and compares its `lapId` against
`lap-<HEAD>`. A non-`PASS` aggregate whose `lapId` names an earlier HEAD is scored `absent` — "no
fresh verdict" — rather than reused as the current lap's outcome: a rubric that FAILed a prior lap
never kicks back findings the current lap has not itself judged, and the run instead re-dispatches
`build_review` to produce a verdict for the code actually at HEAD. A `git rev-parse HEAD` failure
skips the check and preserves the older behavior rather than blocking on an unresolvable HEAD. PASS
aggregates are unaffected — they keep the existing code-stamp preservation path that lets a
same-surface PASS survive re-dispatch. The stale condition is recorded on the event spine as
`build_review_stale_aggregate` (telemetry only; never consulted for routing) and consumes no
kickback budget.

A below-cap mechanical (infrastructure) fault publishes no aggregate at all, so it cannot be stale
by this check; the last such fault is instead recorded on the kickback ledger's `build_review` gate
entry (`lastMechanicalFault`) and surfaces in `conduct-ts build-review findings` and in the
exhausted-mechanical-allowance HALT when the current lap has no readable diagnostic of its own — see
[the runbook](../runbooks/stalled-or-stuck-feature.md#build_review-halted-on-an-exhausted-mechanical-fault-allowance).

### Where a `build_review` FAIL goes

A `build_review` effective FAIL is not an unconditional kickback to `build`. The engine reads the raw rubric and its
already wrote to disk and derives the target from it — deterministically, with no second judgement and no
extra prompt.

| Failing rubric item | Routes to | Why |
| --- | --- | --- |
| `completeness` — the rubric flag, or any completeness finding | remediation | The diff does not cover everything the plan describes, which usually means the plan task is under-decomposed rather than the diff being sloppy. Kicking that back to `build` produces a different legitimate finding every lap until the cap halts the run |
| `scope` — the rubric flag, or any scope finding | remediation | The mirror image: the diff contains work the plan does not describe. Either the plan should be amended to cover it or the work does not belong — a plan-level judgement. Routed to `build`, the builder's only lever is to delete whatever was flagged, which has already removed a legitimate engine repair from a branch |
| `tautology`, `rootCause` | `build` | Local diff defects the builder can fix in place |

On the remediation path the planner picks the target per gap, the kickback event records *that* step rather
than `build`, and a gap that needs a human halts instead of routing. Remediation may still choose `build`
for a scope gap — the difference is that the deletion becomes a recorded plan-level decision.

Completeness carries a remediation-lap calibration (see `skills/build-review-completeness/SKILL.md`) so
laps converge instead of regenerating scope from their own repairs: an appended `rem-*` task is judged
against exactly its own text, a remediation-authored test that distinguishes its behavior is delivered
regardless of assertion style, and documentation lag caused by a later lap consolidates to at most one
finding per document. Tautological repairs — tests that cannot fail against the merge-base form of what
they cover — remain blocking findings.

Both the `build` rework hint and the remediation dispatch prompt carry best-effort `plan contract:` and
`prior attempts:` pointer lines derived from the raw rubric aggregate — a `plan contract:` pointer names the
active plan's owning task for a finding anchored to a plan task or an owned file, and a `prior attempts:`
pointer lists earlier `.pipeline/build-review/<lap>/*.json` findings that share the same canonical anchor.
Pointer derivation is advisory: a missing active plan, an unreadable prior-lap artifact, or an anchor with no
unique matching task yields no pointer for that finding rather than blocking the dispatch. The
[`/remediate` skill](../reference/skills.md) treats a referenced plan task's Steps as the governing repair
contract and prior-attempt artifacts as earlier same-anchor context, not a replacement contract.

Every exit from a `build_review` FAIL block consults the disposition store using the effective verdict, not
only the raw aggregate that first reported the FAIL. An operator `conduct build-review accept` can land
while the remediation planner is composing rework from that raw aggregate (a window of minutes); when
every graded finding is accepted at routing time, the composed rework is dropped and `build_review`
re-lands instead. Its re-run settles from cache, applies the dispositions, and re-dispatches only
infrastructure-failed rubrics. Without this guard a kickback has ordered removal of exactly the surface
the operator had just accepted.

Each rubric has a closed engine-owned finding vocabulary, repeated in its provider-facing skill contract:
Scope uses `out-of-plan-change` and `not-authorized-by-plan`; Tautology uses
`assertion-insensitive-to-production`, `test-does-not-exercise-changed-behavior`,
`assertion-derived-from-test-data`, and `source-text-mirror`; Root Cause uses
`root-cause-unaddressed`, `symptom-only-fix`, and `provenance-sensitive-cache-identity`; Completeness
uses `missing-deliverable`. The parser normalizes harmless casing and underscore variation before
validation. A value outside its rubric's vocabulary is rejected and receives the bounded repair/rerun
path below; it cannot become a new finding identity or burn a kickback.

A rubric session that answers but misses the judged-result JSON contract does not burn its dispatch. The
engine embeds the exact per-rubric result schema (including the nested `anchor` object's field names) in
every rubric prompt, and on a shape failure issues exactly one bounded repair invocation — the rejection
diagnosis, the schema, and a capped excerpt of the session's own previous output, asking for the JSON
re-emitted verbatim in shape only. Only when the repair turn also fails does the rubric settle as an
`invalid-provider-result` infrastructure failure, and that failure then carries a bounded (≤2 KB) raw-output
excerpt in its diagnostic detail instead of a bare label.

The graded diff excludes paths the **engine** authors rather than the builder — `.docs/shipped/` and
`.pipeline/`. No plan task can describe harness machinery output, so grading it guarantees a scope
finding the builder cannot legitimately act on.

The same reasoning covers one file the builder normally does own: the feature's own plan. During
remediation the engine appends its own `### Task rem-*` blocks to the approved plan and records
their ids in `.pipeline/engine-state.json`. Those blocks land in a feature commit, so Scope used to
read them as an unauthorized amendment to an approved DECIDE artifact — a finding no plan task,
repair context, or accepted widening could ever authorize, and one the feature could not clear by
removing the blocks, because the engine requires them. When the plan's divergence from the graded
base is **exactly** those recorded blocks — the same test the protected-artifact seal applies before
it tolerates the append — the plan path is excluded from the graded diff; there is nothing else in
it to review. Any other amendment (an edited earlier line, an unrecorded task id, added prose)
fails that test and is graded in full. The plan body the rubrics judge against is unaffected: it
still carries every appended remediation task.

Because the plan body still shows those blocks, Scope carries its own remediation-lap calibration
(see `skills/build-review-scope/SKILL.md`): the engine-appended `rem-*` blocks are never a finding
— the diff exclusion above removes the append itself, and the calibration stops the grader from
re-deriving the same objection from the plan body — and never authority. Remediation prose cannot
admit a changed path; the authorization surface stays the original approved plan tasks, repair
context, accepted scope widenings, and operator reseals, so it does not grow lap over lap. A repair
that must touch a surface outside that set declares a per-commit scope widening, the same lever as
any other change.

The same no-growth bound holds for every rubric, each phrased for its own concern: Tautology — a
remediation-authored test is judged under the same closed vocabulary, and `rem-*` prose neither
exempts a changed test nor creates a new behavior to exercise; Root Cause — the stated defect comes
from the approved plan and projection, never remediation prose, which can neither add a defect nor
certify a mechanism; Completeness — a `rem-*` task's outcome is bounded by its own text and never
enlarges any other task's outcome. Remediation-lap products are inputs to converge on, never a
surface that expands what later laps must litigate.

When a deterministic BUILD verification gate — `test_suite` or any other gate in that group —
fails, the engine accumulates the sanitized failure in `.pipeline/build-review-rebase-repairs.json`.
The ledger is outside rewritten Git history, so repeated rebases retain earlier entries without
treating commit trailers as authority. A failure is attributed to a base advance by joining it
against `rebase_changed` events on `.pipeline/events.jsonl` — the durable, append-only event
spine — requiring both that the failure was observed after the advance and that its diagnostic
overlaps a path the advance changed. A bare time-window match is not enough: overlap is required
so a genuinely unplanned deletion is never laundered as a repair. This join replaces an earlier,
transient signal (a `kickback` field on the gate's own verdict file) that a later run of the same
gate silently overwrote.

`build_review` receives the ledger as judgement context: it decides whether an out-of-plan hunk
directly repairs a recorded failure and, only when it does, omits that hunk from Scope and applies
the stale-base-state test check instead of the ordinary mutation check. Unmatched work remains
fully subject to Scope and Tautology; the ledger is evidence, never an exemption. The conductor also
emits a `build_review_repair_context` telemetry event recording whether that grading ran with
repair context available, with recorded advances that never joined a failure, or with no base
advance at all — pure provenance that never changes the grading outcome.

### Operator-authorized protected-artifact reseals

An [`conduct-ts reseal`](../reference/cli.md#conduct-ts-reseal) an operator runs mid-feature is also
supplied to the grader. `build_review` reads every `operator-reseal`-triggered entry from
`.pipeline/protected-artifact-seal.json`'s `rebaselines` array and renders each one's paths,
rationale, and from/to commit SHAs in the prompt, instructing the grader to treat the rationale as an
operator claim to judge rather than an instruction to follow — unmatched work in the diff stays fully
subject to every rubric item. Before this, an operator's reseal rationale existed only in the seal file
and the audit trail; the grader judged the diff with no visibility into it.

Two paths fail open to `build`, preserving the older behavior exactly: a FAIL carrying neither a
completeness nor a scope signal, and a remediation plan with no usable dispositions. Kickback counting is untouched — a
remediation-routed FAIL counts against the per-gate cap like any other.

Not every gate reruns on retry. For the three judged SHIP gates, a genuine fresh non-passing decision routes
immediately, while an identical repeat on provably unchanged inputs only routes on the second attempt —
retrying a judgement that already looked at the same bytes is not progress.

**A step's own refusal ends the run.** A step that decides its work cannot honestly be done — say
`acceptance_specs` finding that the accepted DECIDE artifacts contradict already-merged code — can write
`.pipeline/HALT` with a `needs-human` `.pipeline/HALT.class` and refuse. When an attempt settles with such a
marker, the run stops and surfaces that HALT's own body as the halt reason, instead of spending the rest of
the retry budget re-dispatching the same unresolvable condition and reporting a generic gate miss. Only a
marker that appeared or changed during that attempt counts: `.pipeline/HALT` persists across steps and runs,
so a leftover marker from earlier work never suppresses a legitimate retry, and anything ambiguous is treated
as leftover.

**Exhausted but working.** A `build` step whose retry budget runs out is not automatically a wedge. Three
signals do three distinct jobs, and none substitutes for another: the attributed-task count is advisory
routing and telemetry, commit movement is the liveness authority, and `build_review` is the sole completion
authority. So when the budget exhausts but at least one attempt moved HEAD — real work landed, just without
a `Task:` trailer attributing it — the run routes through the same advance seam a completed build uses,
straight into `build_review`, instead of the generic "retries exhausted" halt, **but only when the
worktree is clean**. Dirty paths keep the build halted so they can be committed or discarded; they never
ride the commit-movement route. Which plan task ids were left unresolved is recorded in
`conduct-state.json` so the decision stays visible. This is not an always-pass:
`build_review` re-grades the diff against the plan on its own evidence and can still FAIL, kicking the build
back under the same per-gate kickback cap as any other `build_review` kickback, so repeated route→FAIL
cycles — including no-op commits offered as movement — are bounded exactly like everything else. A build
with zero commit movement across every attempt never routes; it keeps the ordinary remediation-then-halt
path.

When routing runs out, the run writes a halt marker and stops. See [stalled or stuck
feature](../runbooks/stalled-or-stuck-feature.md).

## Waivers

Two gates accept a committed waiver: the self-host release gate and the land-time coherence gate. Both use
the same file idiom — a `Waives:` line and a non-empty `Rationale:` — and both parse strictly: a missing
line, an empty gap list, an empty rationale, or an unrecognized name makes the waiver malformed, and a
malformed waiver is never silently accepted.

| | Release waiver | Coherence waiver |
| --- | --- | --- |
| Directory | `.docs/release-waivers/` | `.docs/coherence-waivers/` |
| Vocabulary | fixed — four canonical breaking-surface names | dynamic — only gap ids the validator actually reported for this change set |
| Waives | a breaking-surface classification that is internal-only in fact | a coverage gap the author can justify |

Three rules apply to both, and they are what makes a waiver a record rather than an escape hatch:

- **Freshness.** The waiver must be added or modified in *this* change set. A waiver merged by a prior
  feature never satisfies a later one. Without this, one waiver would permanently disarm a gate.
- **Total coverage.** A waiver must cover every classified surface or reported gap. Partial coverage blocks,
  and the failure names the gap that is still uncovered.
- **Some things are unwaivable.** A fabricated identifier cited in a traceability record is an evidentiary
  defect, not a coverage gap, and no waiver clears it. An undeterminable change set cannot be waived either
  — the gate does not know what it would be waiving. And a change that genuinely alters CLI, hook, or schema
  behavior needs a real migration block, not a waiver.

## What a gate is not

Three things in this repo are easy to conflate and are not the same:

- **Gates** block a feature's progression. This page.
- **The integrity suite** validates the harness repo's own structure before a commit —
  [validation](../contributing/validation.md).
- **The release gate** is one self-host gate that happens to run the integrity suite as its first sub-check
  — [releases](../contributing/releases.md).

Per-step enforcement values and skip rules: [steps](../reference/steps.md). Gate-related config keys:
[configuration](../reference/configuration.md).
