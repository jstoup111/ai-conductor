# Architecture Review: ADRs carry a machine-checked assumption ledger
**Date:** 2026-10-10
**Mode:** Lightweight (Tier M): Technical Feasibility and Architectural Alignment only
**Inputs reviewed:** `.docs/track/adrs-lock-without-a-machine-checkable-assumption-l.md`,
`.docs/complexity/adrs-lock-without-a-machine-checkable-assumption-l.md`,
`.docs/architecture/adrs-lock-without-a-machine-checkable-assumption-l.md` (technical track; no PRD;
stories not yet written)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | Pure TypeScript inside the existing engine. No new packages, services, or infrastructure. |
| Prerequisites | None. `adrApprovalStatus` and `parseAdrDecisions` (`artifacts.ts`) are the template for a third pure ADR parser. |
| Integration surface | Four modules: `artifacts.ts` (parser + `GATE_ONLY_PREDICATES` entry), `engineer/land-spec.ts` (4e rung + new `LandGateReason`), `steps.ts` (`architecture_review` enforcement), and the `architecture-review` / `verify-claims` skill files plus `adr.md.template`. |
| Data implications | No schema or persisted-state change. The only new artifact content is a markdown section in newly authored ADRs. The existing 341 ADRs are untouched (decision 3 scoping). |
| Performance risk | Negligible. One regex and line pass per in-scope ADR at land and at architecture-review completion. |
| Worktree isolation | No ports, databases, or shared state. Both gates read only the worktree being judged and its merge-base tree. |

**Verified facts behind the design:**
- **Verified (99%).** `landSpec`'s 4e rung already computes `changedAdrPaths` from the spec diff and
  `baseAdrPaths` via `git ls-tree` at the merge base (`land-spec.ts` lines ~592-640). The
  added-versus-changed split in ADR decision 3 is derivable with no new plumbing.
- **Verified (95%).** `architecture_review` is `enforcement: 'advisory'` (`steps.ts`), and the
  auto-mode failure branch records advisory failures as skips and continues (`conductor.ts`, the
  `step.enforcement === 'advisory'` branch). This is why ADR decision 6 flips it to `gating`.
- **Verified (95%).** Neither `CUSTOM_COMPLETION_PREDICATES` nor `GATE_ONLY_PREDICATES` has an
  `architecture_review` entry today; the gate-only map holds `stories` and `plan` only.
- **Inferred (80%).** The gate-verdict path (`gate-verdicts.ts` `checkGateCompletion`, called from
  `computeAndWriteVerdict`) is step-generic and will evaluate a new `architecture_review` entry once
  the step is gating. This is ADR assumption A3, and a condition below covers it.

## Alignment

- **Single-parser pattern.** Follows adr-2026-08-08-single-adr-approval-parser-three-rungs and
  adr-2026-09-02-adr-decision-citability-contract D1: one pure function in `artifacts.ts` owns
  interpretation; gates consume it. It inherits their parser hygiene (fences excluded,
  line-anchored, fail closed).
- **Rung placement.** The land rung extends the existing 4e ADR rung exactly as adr-2026-09-02 D4 did
  for citability: diff-scoped, refuses only, non-waivable as an evidentiary defect
  (adr-2026-08-24-evidentiary-defects-are-not-waivable), and appends no tasks
  (adr-2026-08-22-one-owner-per-review-question). The operator decided to leave daemon discovery
  out (ADR decision 7), in line with adr-2026-09-02 D4's reason for keeping content-shape gates out
  of discovery. Approval-status checking at discovery (adr-2026-08-08 rung 2) is unchanged.
- **Gate-only predicate.** The conduct rung joins `GATE_ONLY_PREDICATES` next to `stories` and `plan`,
  which that map's own comment reserves for kickback-target DECIDE steps. `architecture_review` is a
  kickback target (`steps.ts`, `kickbackTarget: true`;
  adr-2026-06-29-architecture-before-stories-convergent-kickback). It is kept out of
  `CUSTOM_COMPLETION_PREDICATES`, so the linear conductor's completion semantics for other steps are
  unchanged.
- **Enforcement change.** Flipping `architecture_review` to `gating` deliberately widens what halts an
  auto run. The operator chose this during review (ADR A4) over moving the check to the `stories`
  gate, which would misroute kickbacks, or dropping the conduct rung.
- **Template as runtime source.** The template edit falls under
  adr-2026-08-13-markdown-default-inversion. It adds a section and leaves the status vocabulary
  owned by adr-2026-08-08 untouched.
- **Scope check (repo-only vs consumer-facing).** The mechanism exists outside this repository.
  Consumer projects run `ai-conductor compose land` and `/conduct` against their own ADRs, and use the
  shipped `skills/architecture-review` and `skills/verify-claims`. The change is consumer-facing and
  belongs in the shipped `skills/` catalog. It is provider-agnostic: engine code plus markdown skills.
- **Diagram accuracy.** `.docs/architecture/adrs-lock-without-a-machine-checkable-assumption-l.md`
  reflects the operator-narrowed design (two rungs, no daemon rung) and passes the render check.
- **Security / DI defaults.** No endpoints, inputs from untrusted parties, or DI registrations.

**Focused local pattern basis.**
- **Role:** the parser, and the land-rung shape for decisions 4-5.
- **Precedent:** the citability work (`parseAdrDecisions` plus its 4e land rung, delivered under
  adr-2026-09-02).
- **Traits to preserve:** a pure function returning a discriminated `ok | diagnostic` result;
  fenced code blocks stripped before matching; a land refusal that names every offending file with
  a specific remedy sentence; a diff-scoped candidate set computed once in the rung.
- **Allowed variation:** the ledger parser returns *all* diagnostics per ADR, not the first, so one
  land attempt surfaces every bad row. That follows the exhaustive-reporting lesson recorded in the
  as-built skill.
- **Rediscovery hints:** `artifacts.ts` → `parseAdrDecisions`, `AdrDecisionParseResult`;
  `engineer/land-spec.ts` → `landGateError('adr-uncitable-decision'`, `uncitableAdrs`.

## Wiring Surface

| New production surface | Production caller (design-time commitment) |
|---|---|
| `parseAdrAssumptionLedger(content)` in `artifacts.ts` | Called from `landSpec`'s existing 4e ADR loop for each in-scope ADR, and from the new `GATE_ONLY_PREDICATES.architecture_review` entry |
| `LandGateReason` member `'adr-assumption-ledger'` | Thrown by `landSpec` via `landGateError`; surfaced by the existing `ai-conductor compose land` CLI error path |
| `GATE_ONLY_PREDICATES.architecture_review` | Evaluated by the existing step-generic `checkGateCompletion` in `gate-verdicts.ts`, reached from `conductor.ts`'s `computeAndWriteVerdict` calls once the step is gating (assumption A3, condition C1) |
| `architecture_review` `enforcement: 'gating'` | Read by the existing step-failure handling in `conductor.ts` |
| `## Assumptions` section in `adr.md.template` | Read by the `architecture-review` skill when authoring ADRs |

**Early overlap scan (advisory, 2026-10-10):** `ai-conductor overlap-scan` over the six wiring-surface paths reported "No overlap detected; no open blockers."

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Gate-only predicate is not evaluated for `architecture_review`, so the conduct rung is inert (A3) | Technical | Low | High | C1: a plan task proves enforcement with a failing-ledger integration test and wires the call if absent |
| Gating `architecture_review` halts auto runs on unrelated architecture-review failures that used to skip | Technical | Medium | Medium | Operator-accepted (A4). The halt names the failing reason; no silent pass |
| Daemon-built merged specs trip the new conduct predicate (A5) | Integration | Low | High | C2: a test pins that a worktree whose ADRs all exist at the merge base passes the predicate |
| Specs mid-DECIDE at ship time fail land until a ledger is added | Knowledge | Medium | Low | The land refusal names the ADR, the rule, and the template section to copy |
| Authors classify a real assumption as `no` to avoid approval | Knowledge | Medium | Medium | Out of scope by design (track exclusion); the ledger makes the classification visible to reviewers |

## ADRs Created

- `adr-2026-10-10-adr-assumption-ledger-contract`: the ledger grammar, approval rule, scope, single
  parser, land and conduct rungs, and the `architecture_review` enforcement change. Warranted under
  §7: it establishes a durable artifact-format contract consumed by two gates and changes a DECIDE
  step's enforcement. No existing APPROVED ADR governs ADR assumption content. adr-2026-08-08 and
  adr-2026-09-02 are cited and reused, not superseded.

## Conditions

- **C1 (A3).** The plan MUST include a task that proves, with a failing-ledger test driven through the
  conductor's gate-verdict path, that `architecture_review` blocks in auto mode; and wires
  `checkGateCompletion` for the step if that path does not already evaluate it.
- **C2 (A5).** The plan MUST include a test proving that a worktree whose ADRs all exist in the
  merge-base tree passes the `architecture_review` predicate, which is the daemon-build shape.
- **C3.** The land rung's refusal message names each offending ADR, entry id, and rule in one
  refusal, not one per attempt.
