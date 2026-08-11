# Architecture Review: Acceptance-specs RED evidence visibility and completion-wait discrimination (#1246)

**Date:** 2026-08-09
**Mode:** lightweight (Medium tier — Sections 2 and 4 in full; complexity already assessed by
`/conduct`, domain integrity deferred to the TDD domain reviewer)
**Track:** technical (no PRD — `.docs/track/acceptance-specs-hide-missing-red-evidence-and-com.md`)
**Input reviewed:** the intake's technical intent and desired outcomes, plus
`.docs/architecture/acceptance-specs-hide-missing-red-evidence-and-com.md`
**Verdict:** APPROVED WITH CONDITIONS

---

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. No new dependency, service, or runtime. The union, the marker and the dashboard are all existing TypeScript surfaces in `src/conductor/`. |
| **Prerequisites** | None external. The one internal prerequisite — a seam that re-runs the acceptance contract when the marker is invalid — already exists (`conductor.ts:5311-5343` → `acceptance-red-runner.ts:195`) and is governed by an approved ADR. |
| **Integration surface** | Five engine files plus two shipped skill contracts. Crosses the types/engine/skills boundary but introduces no new boundary. |
| **Data implications** | One gitignored run-evidence file gains fields. No schema, no migration, no persisted store. Legacy markers are handled by re-run, not migration (see ADR). |
| **Performance risk** | One additional acceptance-spec execution per in-flight feature, once, at its next `acceptance_specs` attempt. Event emission is append-only on the existing persister. Status rendering reads a ledger the dashboard already reads. |
| **Worktree isolation** | Unaffected. Every artifact touched is per-worktree `.pipeline/` state; no shared port, database, queue or file path is introduced. |

**Feasibility risk that matters:** the back-compat path depends on `selfHealAcceptanceRed` firing on
an *invalid* marker and not only a *missing* one. Verified at `conductor.ts:5311-5343` (guard is
missing-or-invalid with specs committed). If that guard were missing-only, the design would hard-fail
every in-flight feature — the opposite of the approved decision. This is recorded as Condition 1.

---

## Alignment

**Event spine — compliant.** Checked against `.agents/skills/event-spine/SKILL.md` before the design
was written; verdict recorded in the architecture artifact. The lifecycle is an occurrence in time
and rides the existing `ConductorEventEmitter → EventPersister → .pipeline/events.jsonl` path with no
new reader. The marker enrichment is durable gate state read by name (exception C). **No second
channel is introduced, and no timestamp, counter or status is stamped into an artifact to stand in
for an event** — `ranAt` records when the run happened as a property of the run, and the occurrence
is emitted separately.

One trap was explicitly checked and avoided: the §3 corollary ("I'll just add a field to an artifact
we already write"). The marker fields here are not a substitute for telemetry — the telemetry exists
alongside them, on the bus. Had the design carried operator status *only* in the marker, it would be
a violation, and it would be a blocking finding.

**Prior ADRs — no conflict.** `adr-2026-07-21-engine-owned-acceptance-red-execution` is relied upon,
not superseded. Its three load-bearing properties are preserved: the completion predicate stays a
pure read (`artifacts.ts:2041`), execution stays in the step/retry seam, and the marker's
authoritative location stays the worktree root. The gate's pass bar is unchanged.

**Repository design principle — compliant.** "Deterministic where possible; LLM only where
necessary." Every part of this change is mechanical: the validator enforces field presence, the
engine emits lifecycle states, the dashboard renders derived state. The one judgement-bearing input
(`intentRationale`, and the exception's `reason`) is authored by the agent that has the context, and
the engine validates its shape without pretending to validate its sincerity. That limit is stated in
both ADRs rather than papered over.

**Scope — consumer-facing, no new skill, provider-agnostic.** No repo-only signal fires: nothing is
gated behind `isSelfBuild()`, and `acceptance_specs` plus the RED gate run in any repository that
installs the harness. Both skill edits are to already-shipped catalog members.

**State management.** The RED lifecycle is modelled as a four-value `state` enum
(`required | pending | satisfied | rejected`), not a set of independent booleans — invalid
combinations such as "satisfied and rejected" are unrepresentable. `viaException` is a separate
flag rather than a fifth state, deliberately: a waived pass *is* a pass, and collapsing it into the
state enum would let a consumer that only checks `state === 'satisfied'` miss the waiver. This is the
one place where a flag beside an enum is the correct shape, and the reason is recorded here so a
later reviewer does not "simplify" it.

**Security boundaries.** No new endpoint, input, or credential surface. The exception's attribution
field is written by the harness, read by the harness, and never authenticates anything.

**Diagram accuracy.** `.docs/architecture/acceptance-specs-hide-missing-red-evidence-and-com.md`
matches this design; both Mermaid blocks pass `conduct render-diagrams --check`.

---

## Wiring Surface

Design-time commitments. No `file:line` yet — the code does not exist. The as-built sweep at SHIP
verifies shipped callers independently.

| New/changed production surface | Where it is called from in production |
|---|---|
| `acceptance_red` variant on the `ConductorEvent` union (`types/events.ts`) | Emitted by the `acceptance_specs` step path in `conductor.ts` (dispatch boundary and gate verdict) and by `selfHealAcceptanceRed` in `acceptance-red-runner.ts`; consumed by the existing `EventPersister` and every current bus subscriber with no subscriber change |
| Provenance fields on `.pipeline/acceptance-specs-red.json` | Written by `skills/writing-system-tests/SKILL.md` §6 on the happy path and by `selfHealAcceptanceRed` on the self-heal path; read by `validateAcceptanceRedEvidence` (`artifacts.ts:1245`), which is called from the `acceptance_specs` completion predicate (`artifacts.ts:2041`) and from the self-heal's re-validation |
| Exception acceptance in `validateAcceptanceRedEvidence` | Same two call sites as above; produced by `skills/remediate/SKILL.md` on the `acceptance_specs` disposition |
| `working` / `waiting` classification + per-step progress line | Rendered by `daemon-dashboard.ts` in the running-features section (today's line at `:753`), reached from `conduct daemon status`; inputs are the existing `.pipeline/step-heartbeat` reader (`step-heartbeat.ts`) and the existing event ledger |
| Live surfacing of `CompletionResult.reason` | Produced today at `artifacts.ts:752` for every unsatisfied gate; newly carried to the dashboard via the `acceptance_red` event's `reason` field — not by a new computation |

**Early overlap scan (advisory, non-blocking).** `conduct-ts overlap-scan` over the paths above
returns exactly one collision surface: `src/conductor/src/types/events.ts`, touched by essentially
every open spec branch (242 branch-file pairs). `artifacts.ts`, `conductor.ts`,
`daemon-dashboard.ts`, `acceptance-red-runner.ts` and both `SKILL.md` files are clean. Mitigation is
mechanical, not procedural: append the new variant at the end of the union rather than grouping it
near related variants, so the rebase conflict surface is one adjacent line rather than an interior
hunk. Recorded as Condition 3.

---

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Legacy marker with no accompanying run contract cannot be re-run | Data | Low | Medium | Degrades to today's "run contract missing" failure — not a new failure mode. Stated as residual in the ADR rather than engineered around. |
| `events.ts` rebase conflict against 242 open spec branches | Integration | High | Low | Append the variant at the end of the union; conflict surface is one line. |
| `intentRationale` filled in perfunctorily, satisfying shape but not intent | Knowledge | Medium | Medium | Accepted and stated in the ADR. Validator enforces presence and non-emptiness; sincerity is not mechanically checkable and is not claimed to be. |
| Recorded exception becomes a routine bypass | Technical | Low | High | Exception is narrow (kind + non-empty reason + attribution), never waives *execution* (`errors == 0`, `skipped == 0`, `executed >= 1` still apply), and every use is greppable on the ledger. ADR states that frequent use is evidence to revisit the design, not to widen the exception. |
| Status line renders a fabricated child count | Technical | Low | High | Explicitly forbidden: renders `unknown`. Condition 2. |

---

## ADRs Created

- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md` — APPROVED. Union extension,
  marker provenance, live reporting of the unmet condition, and back-compat by re-run. Relates to
  (does not supersede) `adr-2026-07-21-engine-owned-acceptance-red-execution`.
- `adr-2026-08-09-recorded-red-exception-for-remediation.md` — APPROVED. A RED waiver is valid only
  when recorded, is reported as waived rather than proven, and never waives execution.

Both were operator-approved during DECIDE before being written as authoritative.

---

## Conditions

1. **Verify the self-heal guard before relying on it.** The back-compat decision assumes
   `selfHealAcceptanceRed` fires on an invalid marker, not only a missing one
   (`conductor.ts:5311-5343`). Confirm this in code at implementation time. If it turns out to be
   missing-only, the correct fix is to widen that guard — **not** to grandfather the new fields,
   which the ADR rejects with reasons.

2. **Never render a child count.** Subagent observation is out of scope (#1441). The progress line
   reports `unknown` for child count. A rendered `0` would assert something false about a running
   step and is worse than the silence it replaces.

3. **Append the `acceptance_red` variant at the end of the `ConductorEvent` union**, for the rebase
   reason above.

4. **Documentation upkeep travels in the same PR** (repository rule): `docs/explanation/gates.md`
   (the gate's evidence requirements change), `docs/guides/running-the-daemon.md` (status output
   changes), `docs/reference/steps.md` if the `acceptance_specs` contract shifts, and a `HARNESS.md`
   rule for the remediation RED exception — consumer-facing per the scope verdict.

5. **Keep both `SKILL.md` edits provider-neutral.** `test/test_provider_skill_contracts.sh` rejects
   unscoped slash commands and host-specific phrasing in shipped skills.

---

## Out-of-scope boundary — checked for honesty

The intake's desired outcome 4 lists six signals. Four are delivered here (last meaningful action,
heartbeat age, elapsed step time, last test outcome), plus the RED-evidence state from outcome 1 and
the unresolved-condition reporting of outcome 5. Two are deferred: active child count and the
uncached token split.

This is a genuine capability boundary, not a convenient narrowing. Both deferred signals require
observation the engine does not have: the provider layer configures subagents but never observes
them (`claude-provider.ts:749-750`, `llm-provider.ts:226`), and the only token fields on the union
are the end-of-feature `feature_usage_total` aggregate (`events.ts:183-184`). Delivering either
means parsing the provider stream — a different subsystem, and the reason the tier would have moved
to Large. The remainder is filed as `jstoup111/ai-conductor#1441`, linked to this feature, so the
gap is tracked rather than dropped.
