# Conflict Check: Claude Declares No Resume (#1071)

**Date:** 2026-07-27
**New stories:** `.docs/stories/claude-within-step-retries-resume-the-prior-attemp.md`
(ST-1071-1 … ST-1071-6)
**Scanned against:** open spec PR **#1069** (issue #903) and all six of its artifacts, all
`.docs/stories/`, the session-related ADRs
(`adr-2026-07-24-provider-aware-step-execution`,
`adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`,
`adr-2026-07-27-codex-never-resumes-a-harness-minted-session`,
`adr-2026-07-10-concurrent-group-core`), `HARNESS.md`, the retry-as-escalation and self-host
guardrail specs, and open issues #999 / #1041 / #1042
**Result:** PASSED — 4 conflicts found and resolved, 0 blocking remain

> **Revision note.** The first version of this check concluded that #903 "has landed nothing —
> there is no code to conflict with, only intent." That was wrong: #1069 is an authored,
> APPROVED, mergeable spec PR, opened roughly fifteen minutes before that session began, and its
> head commit records that #1071 depends on it. The miss came from searching `main` and the
> worktree without checking open spec PRs. Conflict 1 replaces that finding.

---

## Conflict 1: Direct dependency on unmerged spec PR #1069

**Artifacts involved:** all stories here vs `.docs/decisions/adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md` and `.docs/plans/codex-fresh-session-per-step-contract.md` on branch `spec/codex-behavior-is-unvalidated-against-fresh-sessio`
**Type:** ordering dependency — this feature consumes a seam that feature builds
**Severity:** blocking if unresolved

**Description:** #1069 introduces `supportsSessionResume` on `LLMProvider`, the capability gate
in `runProviderInvocation`, and the `session_policy` diagnostic. Every story here consumes at
least one of them. Built against a `main` without #1069, this feature would have to invent a
duplicate capability, and the two would conflict irreconcilably at merge — two different
mechanisms for the same decision.

#1069's ADR states the relationship explicitly: *"Making it a declared capability is exactly the
seam that lets Claude flip later as its own change with its own evidence; this feature does not
flip it. Tracked as **#1071**, which depends on this one."*

**Resolution applied:** the dependency is declared in the ADR header, in the plan's
Prerequisites, in the stories' preamble, and — deterministically — as **plan Task 1**, which
asserts the capability seam exists and halts the build if it does not. This converts an ordering
assumption a builder could silently violate into a mechanical precondition, per this repo's
design principle.

**Residual risk:** if the operator merges #1079 before #1069, Task 1 halts rather than producing
a wrong build. That is the intended failure mode.

---

## Conflict 2: #1069 preserves the Claude assertions this feature inverts

**Artifacts involved:** ST-1071-1 vs #1069's plan Task 6
**Type:** contradiction in test expectations, sequenced
**Severity:** degrading (not blocking — the two are ordered)

**Description:** #1069's plan instructs, for
`per-step-provider-routing-927.acceptance.test.ts:922-973`: *"keep `claude.calls[0].resume ===
false` / `calls[1].resume === true`; change the Codex half to assert no attempt ever carries
`resume: true`"*, and generally *"Amend, never delete — each test also carries the Claude
invariant."* The same applies to `conductor.test.ts:9082-9245`. ST-1071-1 inverts exactly those
preserved Claude lines.

**Resolution applied:** recognized as sequential, not contradictory — #1069 deliberately keeps
the Claude half alive so that flipping it is a visible, reviewable change rather than a silent
side effect. Plan Task 15 amends that surviving half and is the last behavior-affecting task, so
it runs against a tree that already contains #1069's edits. The architecture review's F9
enumerates every file both features touch.

**Why not rewrite those assertions in #1069 instead:** that would fold two decisions into one
PR and lose the evidence boundary #1069's ADR is explicit about wanting.

---

## Conflict 3: #1069's "single place resume is decided" does not hold for two paths

**Artifacts involved:** ST-1071-3 vs #1069's ADR Decision 2 and its architecture review
**Type:** factual over-claim in a dependency's design rationale
**Severity:** degrading (does not invalidate #1069; does constrain this feature)

**Description:** #1069's ADR Decision 2 states `runProviderInvocation` *"becomes the single
place resume is decided"*, and its architecture review cites `group-core.ts:438-444` as evidence
that all dispatch paths funnel through the gate. Verified otherwise: `step-runners.ts:613`
enters `runProviderAwareNormal` only when `providerRuntimes` is set and no `branchSessionId` was
supplied; otherwise `:630` dispatches `provider.invokeInteractive` directly with the `resume`
computed at `:529-530`. `group-core.ts:464-469` feeds that same scalar path.

**Resolution applied (story + design level):** ST-1071-3 owns both ungated paths as first-class
work with their own tests (plan Tasks 6-9). Additionally, ADR Decision 1 deletes Claude's
`--resume` argv branch, so the invariant holds structurally even where the gate is not reached —
the same technique #1069 used for Codex, applied for the same reason.

**Effect on #1069:** none blocking. Codex's argv deletion means a Codex resume is unconstructable
regardless of which path requests one, so #1069's guarantee holds by a different mechanism than
its prose describes. The over-claim is recorded in this feature's architecture review (F3) so it
is corrected in the record rather than propagated.

---

## Conflict 4: Two accepted stories and an ADR still assert within-step resume

**Artifacts involved:** ST-1071-1/2/3 vs `.docs/stories/fresh-session-per-step.md:100-126`,
`.docs/stories/per-step-provider-routing-927.md` ST-927-7 (`:309-311`, `:337-341`), and
`adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` §2
**Type:** contradiction — the same observable behavior asserted with opposite verdicts
**Severity:** blocking if unresolved

**Description:** The #325 story states at `:102-107` that a step's internal retries *"must resume
rather than reset"*, and at `:119-120` requires a test that FAILS if a retry started fresh.
ST-927-7 requires resume as a positive criterion. ADR §2 ratified both. #1069 re-qualified §2 as
capability-dependent and *annotated* the two stories without rewriting their criteria (its plan
Task 7: *"Do not rewrite their acceptance criteria"*). After this feature the qualified form is
also wrong — the answer is unconditional.

**Resolution applied:** ST-1071-6 and plan Task 16 make the amendment a required deliverable:
§2 resolves from capability-dependent to unconditional; both stories' criteria are rewritten to
assert cold start while keeping the step-boundary guarantee they also carry (unchanged and still
correct); and `adr-2026-07-27-codex-never-resumes-a-harness-minted-session` gains a forward
pointer recording that the divergence its Consequences names is closed. #1069's annotations are
completed, never reverted.

---

## Verified-clean pairs (reasoned, not assumed)

- **`supportsSessionResume` retention** — ADR Decision 4 keeps the flag with both adapters
  declaring `false`. This does not conflict with #1069: its fail-closed default (an adapter that
  omits the declaration is non-resuming) is preserved exactly, and no `true` case is required for
  that default to be meaningful.
- **`session_policy` diagnostic** — #1069 introduces it as once-per-step. This feature widens
  when it fires (every dispatch, both providers) without changing its scoping. ST-1071-5 asserts
  the once-per-step bound explicitly, since it is now what stands between the diagnostic and log
  spam.
- **Self-host isolation** (`provider-execution.ts:546`, `provider-execution.test.ts:116`) —
  `forceFreshSession` already forces `resume: false` for self-host dispatch. Universal cold start
  is a superset, so the guarantee is preserved by construction; the test must keep passing
  unchanged even if the parameter is later deleted. #1069 deliberately leaves `forceFreshSession`
  in place as a provider-agnostic suppressor; this feature does not remove it before the Task 12
  and 13 guards are green.
- **Concurrent group core** (`adr-2026-07-10-concurrent-group-core.md`) — requires a branch never
  to read or mutate the main conductor session. Per-invocation minting makes branches *more*
  isolated, never less. ST-1071-3 keeps cross-branch isolation as an explicit negative-path
  criterion.
- **Retry-as-escalation (#188)** — escalation passes model and effort explicitly per rung and
  prefixes `RETRY: «reason»` to the full step system prompt (`step-runners.ts:1901-1903`). No
  escalation state lives in the session, so cold start does not disturb the ladder. Only the
  `resume` column of its acceptance test changes.
- **`.pipeline` durability specs** — they assert the `session-created` marker is *persisted*, not
  that it implies resume. ST-1071-3 changes the marker's consequence, not its persistence.
- **OTel run-id contract** — `.pipeline/conduct-session-id` is written only from the step
  runner's `this.sessionId` (`step-runners.ts:659, 926, 1137`), never by `ProviderSessionScope`.
  ST-1071-5 pins this as a testable invariant so per-invocation minting cannot introduce a
  dependency.
- **#1042** (persisting isolated provider homes) — referenced by #1069 as an open question; this
  feature neither depends on nor constrains it, since it removes resume rather than making it
  work.
- **#1041** (the `forceFreshSession` hotfix) — superseded in effect by universal cold start, but
  its test survives as a regression guard. No contention.
- **Release/migration gates** — no `bin/conduct-ts` flag, hook wiring, skill symlink target, or
  `settings.json` schema change, so no migration block is required. ST-1071-6 covers the waiver
  path if the gate's path classifier flags a surface anyway.

## Coverage note

No story here contends with another for the same seam: ST-1071-1 owns the Claude declaration and
its argv; ST-1071-2 owns session identity; ST-1071-3 owns the two ungated dispatch paths;
ST-1071-4 owns interactive recovery; ST-1071-5 owns the invariants the other four must not
break; ST-1071-6 owns documentation. The only ordering constraints are that ST-1071-2 must land
with ST-1071-1 (the id collision), and that ST-1071-5's guards must exist before any cleanup, so
a "dead code" pass cannot remove a live recovery path.
