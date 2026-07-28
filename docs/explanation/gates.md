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
| land-time | when a spec PR is landed | the spec, before anything is built | 7 |
| self-host | before the finish step, only when the harness is building itself | the PR | 6 |
| hook | at the moment of a tool call | the individual edit, command, or dispatch | see [settings and hooks](../reference/settings-and-hooks.md) |

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
| `build_review` | an incomplete build — a fresh PASS verdict against a completeness rubric, judged from the diff rather than from self-reports |
| `wiring_check` | code that exists but nothing calls — unreachable new exports and unsatisfied wiring contracts become gaps |
| `test_suite` | a stale green — the fingerprint is re-inspected every time, so the evidence file's existence can never satisfy it |
| `manual_test` | a whitewashed retest — after a recorded FAIL, HEAD must have moved before an all-PASS attempt is accepted |
| `prd_audit` | shipped code drifting from the requirements — any missing, partial, or diverged requirement blocks unless explicitly accepted |
| `architecture_review_as_built` | an unrecognized verdict passing by default — only an explicit approval verdict satisfies it |
| `retro` | a retro from a different feature or a prior session counting for this one |
| `finish` | a finish that never happened — a fresh finish choice is required, and the `pr` choice additionally requires a recorded PR URL |
| `finish` (presentation) | a PR shipping with halt boilerplate or an engine-generated placeholder body — the PR's presentation is read *before* any deterministic repair, and a reused halt PR is kicked back once so `/pr` authors a real templated body. The kickback is bounded to one attempt per `pr_url` (recorded in `.pipeline/pr-body-regen-attempt.json`); on the next pass the engine's floor runs as a last resort so the feature still converges |

Each predicate's exact file, format, and failure text is in [artifacts](../reference/artifacts.md).

### Land-time gates

These run when the engineer loop lands a spec branch, outside the step loop. They protect the base branch
from specs that would waste a build.

| Gate | Refuses |
| --- | --- |
| required artifacts | a spec missing its PRD, stories, or plan, or with an empty one |
| draft/stub reject | any artifact still marked draft, or a known stub string |
| stories approval | stories without the explicit acceptance marker — not being draft is not enough |
| ADR status | any architecture decision record still in draft |
| tier agreement | a declared complexity tier that disagrees with the artifacts present |
| coherence | a traceability record that does not connect outcomes, requirements, stories, and tasks |
| mermaid render | a diagram that does not render — previously prose guidance, now enforced |

The coherence gate is itself layered. It disengages entirely at tier S, and it does not apply retroactively:
a change set with no coherence artifact path in it is treated as a legacy change, not a violation. Once
engaged, the story, orphan-task, and coverage-table layers are always required; the functional-requirement
layer only on the product track; the outcome layer only when outcomes exist. It aggregates every gap rather
than stopping at the first, and reports them as one error. See [engineer loop](../guides/engineer-loop.md).

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

**Remediation** is what a blocking SHIP audit — or a `build_review` completeness failure — does when the
fix is not obvious. It classifies each gap and routes it to the earliest step that can close it — build,
acceptance specs, architecture review, or plan — all of which sit before the gate that found it. Two gap
categories cannot be routed and halt for a human instead: architectural clarity and product scope. Neither
is something an unattended run should decide.

If the remediation plan is missing, stale, malformed, or has gaps it does not cover, the engine falls back
to deterministic routing rather than trusting a partial plan. Unknown dispositions are dropped, not
honored.

### Where a `build_review` FAIL goes

A `build_review` FAIL is not an unconditional kickback to `build`. The engine reads the rubric the grader
already wrote to disk and derives the target from it — deterministically, with no second judgement and no
extra prompt.

| Failing rubric item | Routes to | Why |
| --- | --- | --- |
| `completeness` — the rubric flag, or any completeness finding | remediation | The diff does not cover everything the plan describes, which usually means the plan task is under-decomposed rather than the diff being sloppy. Kicking that back to `build` produces a different legitimate finding every lap until the cap halts the run |
| `tautology`, `scope`, `rootCause` | `build` | Local diff defects the builder can fix in place |

On the remediation path the planner picks the target per gap, the kickback event records *that* step rather
than `build`, and a gap that needs a human halts instead of routing.

Two paths fail open to `build`, preserving the older behavior exactly: a FAIL carrying no completeness
signal at all, and a remediation plan with no usable dispositions. Kickback counting is untouched — a
remediation-routed FAIL counts against the per-gate cap like any other.

Not every gate reruns on retry. For the three judged SHIP gates, a genuine fresh non-passing decision routes
immediately, while an identical repeat on provably unchanged inputs only routes on the second attempt —
retrying a judgement that already looked at the same bytes is not progress.

**Exhausted but working.** A `build` step whose retry budget runs out is not automatically a wedge. Three
signals do three distinct jobs, and none substitutes for another: the attributed-task count is advisory
routing and telemetry, commit movement is the liveness authority, and `build_review` is the sole completion
authority. So when the budget exhausts but at least one attempt moved HEAD — real work landed, just without
a `Task:` trailer attributing it — the run routes through the same advance seam a completed build uses,
straight into `build_review`, instead of the generic "retries exhausted" halt. Which plan task ids were left
unresolved is recorded in `conduct-state.json` so the decision stays visible. This is not an always-pass:
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
