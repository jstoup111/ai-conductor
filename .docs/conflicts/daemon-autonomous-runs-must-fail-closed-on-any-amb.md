# Conflict Check: fail-closed DECIDE entry for autonomous runs (#550)

**Date:** 2026-08-03
**Stories:** `.docs/stories/daemon-autonomous-runs-must-fail-closed-on-any-amb.md` (S1–S7)
**Verdict:** **CLEAN** — 6 conflicts found, all resolved in the stories/ADR before this report closed.

## Method

Each story pair checked for contradiction, overlap, state conflict, and resource contention; then
each story checked against already-shipped behavior in the same code regions (the forward step
loop, the resume clamp, `scanKickbackVerdicts`, `planRemediation`, the daemon preseed, the rekick
sweep) and against every open PR whose diff or plan touches those files.

## Resolved conflicts

### C1 — S1 (unsatisfied DECIDE halts) vs S7 (healthy spec fast-forwards) — **contradiction**

S1 says an unsatisfied DECIDE step halts; S7's negative paths say `explore`, `complexity`, and
tier-skipped steps must **not** halt even though none of them is satisfied in any artifact sense.
Read literally the two stories contradict for every Small-tier run and for `explore` on every run
— the guard would halt 100% of daemon builds.

**Resolved:** satisfaction is not a single boolean. The ADR's rule order separates three distinct
states before ever reaching "unsatisfied": tier-skippable (rule 4), **no completion contract
declared** (rule 5), and satisfied (rule 6). Only a step that declares a contract and fails or
throws on it reaches the halt (rule 8). `explore` and `complexity` have empty
`STEP_ARTIFACT_CONTRACTS` entries, so they are structurally rule-5 cases, not rule-8 cases. S7's
negative paths pin each branch; S1 is scoped to a contracted step. Architecture review F1 records
the reasoning.

### C2 — S1/S2 (halt on DECIDE) vs S6 (grant permits entry) — **state conflict**

Both stories describe the run's behavior at the same moment — an autonomous run arriving at an
unsatisfied DECIDE step — and reach opposite outcomes. Without an ordering rule, whether the run
halts or dispatches is undefined.

**Resolved:** the grant check (rule 7) sits strictly between satisfaction (rule 6) and the halt
(rule 8), so a grant is consulted only after the step is known to be unsatisfied, and the halt
fires only when no grant applies. S1's criteria are scoped to the no-grant case; S6's happy path
is the grant case. The two are disjoint by construction.

### C3 — S6 (grant) vs the documented HALT-clearing recovery — **contradiction with shipped behavior**

The runbook tells operators to recover from any HALT with
`rm -f .worktrees/<slug>/.pipeline/HALT .worktrees/<slug>/.pipeline/HALT.class`
(`docs/runbooks/stalled-or-stuck-feature.md:426,447`). If clearing the HALT were sufficient to
resume past a DECIDE refusal, the guard would be defeated by its own documented recovery — and,
worse, the operator's routine cleanup would become an unrecorded grant of authoring authority.

**Resolved:** ADR D6 makes the grant a separate artifact with no coupling to the HALT marker, and
S6's first negative path asserts the exact scenario — clear the HALT, write no grant, resume, and
the run re-halts identically. Architecture review F4 records it. The plan carries a runbook update
so the documented procedure states both steps.

### C4 — S3 (unknown kickback target halts) vs the shipped ping-pong cap — **state conflict**

A kickback can simultaneously exceed `MAX_KICKBACKS_PER_GATE` and name an unresolvable target.
Two halts compete, with different reason strings, and the ordering decides which signal the
operator sees. Reporting the entry refusal would mask a genuine ping-pong loop.

**Resolved:** #551's F3 already fixed this order — counter bump → `kickback` event emit → cap
check → entry policy → `navigateBack` — and ADR D3 restates it as binding rather than
re-deriving it. The cap wins when both apply. S3's third criterion asserts the cap reason is
unchanged; S3's happy path is scoped to the below-cap case. Architecture review F8.

### C5 — S4 (unresolvable disposition halts) vs shipped #647 D1 and the halt-wins ordering — **overlap**

`planRemediation` already contains three ordered decisions within a few lines: halt-gaps win over
routable fixes (`conductor.ts:1997-2002`), the #644/#551 phase check (`:2004-2024`), and the #647
D1 route-into-no-op guard (`:2030-2059`). S4 inserts a fourth. A careless change to
`earliestRemediationTarget`'s return shape could reorder them and silently change which halt a
run reports.

**Resolved:** S4 adds its check at the resolution step only — the resolver reports what it could
not resolve, and `planRemediation` halts on a non-empty `unresolved` **before** consulting the
phase policy, leaving all three existing decisions in their current relative order. S4's two
negative paths pin the unchanged routing cases, and the plan requires the existing
`conductor-remediation-noop-guard.test.ts` and
`kickback-build-noop-escalation.acceptance.test.ts` suites to pass unmodified.

### C6 — S7 (retire the preseed) vs two shipped test suites — **resource contention**

ADR D2 reduces `PRESEEDED_DONE` to `['worktree','memory']`, but two committed suites import the
constant and iterate it to build daemon state:
`test/integration/audit-trail-daemon-wiring.integration.test.ts:41,81,129,157` and
`test/acceptance/daemon-decide-preseed-ownership.acceptance.test.ts:61,268-269`. The latter
asserts the constant's *derivation* from DECIDE phase membership — it is a spec that D2
deliberately invalidates. Landing D2 without updating both breaks the suite; updating the
acceptance spec without stating why would look like a test weakened to pass.

**Resolved:** the plan's Task 4 rewrites `daemon-decide-preseed-ownership.acceptance.test.ts` to
assert the *replacement* invariant — that DECIDE resolution is owned by the engine policy and
that `PRESEEDED_DONE` no longer contains DECIDE steps — in the same commit as the change, with
the ADR referenced in the spec header. The integration suite's iteration is behavior-neutral and
needs only the narrower constant.

## Checked and clear

- **S2 (resume clamp) vs `adr-2026-07-11-verdict-aware-resume-entry`.** That ADR's rule is that
  resume must never mutate `conduct-state.json` and that the local `startIndex` clamp is the only
  resume-entry mechanism. S2 adds a refusal at the clamp, not a state write, and S1's happy path
  explicitly asserts the DECIDE step is left unresolved. No conflict.
- **S3 vs `navigateBack`'s other callers.** `navigateBack` (`conductor.ts:377`) is shared with the
  rebase-invalidation re-open and the deterministic BUILD kickbacks. No story places enforcement
  inside it; #551's F4 reasoning is carried forward as architecture review F7. No conflict.
- **S1 vs discovery's eligibility warn-skip** (`daemon-backlog.ts:755-806`). Discovery filters
  which specs enter the backlog and `continue`s past a malformed one; this guard protects a run
  already in flight. Complementary layers, different moments, no overlapping decision.

## Cross-feature contention (open PRs)

Checked every open PR whose diff or plan names `conductor.ts`, `daemon-cli.ts`, `selector.ts`,
`steps.ts`, `artifacts.ts`, `kickback-policy.ts`, or `cli.ts`.

| Branch / PR | Contention | Assessment |
|---|---|---|
| `spec/build-reports-step-completed-status-done-while-lea` (#1277) | Extends `CompletionContext` in `artifacts.ts` and injects a probe in `completionCtx` (`conductor.ts:1191-1364`); also edits `:5640-5680`, `:6480-6497`, `:8038-8102` | **Soft.** This spec *consumes* `completionCtx` to answer satisfaction; it does not change its shape. Its `:8038` edit to `buildRetryHint` is textually adjacent to `earliestRemediationTarget` (`:7995-8009`) but is a different function. Same-file merge friction only — no semantic conflict. Whichever lands second rebases. |
| `fix/wired-into-anchor-validator` (#1190), `spec/pipeline-commits-files-outside-the-active-plan-bef` (#1262), `spec/build-review-repeats-aggregate-verification-despit` (#1239) | Each registers or edits commands in `src/conductor/src/cli.ts`; ADR D6 adds `decide-grant` there | **Soft.** Additive command registration in a shared file. Textual merge friction only. |
| `feat/cursor-provider` (#1168) | Provider/hook surface | **None.** Disjoint files. |

No hard conflict found. The only real cost is rebase friction in `conductor.ts` and `cli.ts`,
which is expected in this repo and is not a specification-level conflict.
