# ADR: Wiring reachability becomes a build_review rubric item

**Date:** 2026-08-11
**Status:** APPROVED — PARTIALLY SUPERSEDED by
`adr-2026-08-13-engine-managed-build-review-rubric-branches` for single-dispatch topology and the
no-new-dispatch cost claim; Wiring meaning remains approved
**Deciders:** James Stoup (operator), architecture-review for #1496

## Context

The BUILD `wiring_check` step gates on a `.pipeline/wiring-evidence.json` artifact computed by
`computeWiringEvidence` (`wiring-probe.ts:1312`). It has two layers:

- a **contract layer** — per-task `**Wired-into:**` lines a plan author writes, verified by
  `verifyDeclaredSites`, `checkContractConsistency`, `checkInertContractContradiction`,
  `resolveWaiverRef`, dispositioned by `evaluatePlanWiringDisposition`; gated at DECIDE by
  `landSpec` 4b-ii (`land-spec.ts:254`) and checkable via `conduct-ts validate-wired-into`;
- a **probe layer** — `orphanBackstop` plus Layer 2 `checkExportReachability`, requiring no authoring.

Issue #1496 proposed deleting the contract layer and keeping the probe. Three findings from DECIDE
decided otherwise.

**Finding 1 — `build_review` does not check wiring today.** Its rubric is exactly four items —
tautology, scope, root cause, completeness — and the prompt states outright: *"You are not evaluating
runtime behavior (that is manual_test's mandate)"* (`build-review-prompt.ts:42-44`). Completeness is
judged holistically against the plan; an exported-but-unwired symbol fully delivers its plan task.
The only wiring content `build_review` sees is `BuildReviewGateInstruction` — prior `wiring_check`
kickbacks replayed as *scope* evidence (`build-review-inputs.ts:54-60`), which lets it accept hunks
that repair a wiring gap. It consumes wiring verdicts; it does not produce one.

**Finding 2 — the intake's premise about SHIP is false for S.** #1496 asserts "Production
reachability is independently swept at SHIP." Verified false at S tier:
`architecture_review_as_built` carries `skippableForTiers: ['S']` **and**
`skipWhenSkipped: 'architecture_review'` (`steps.ts:239-250`), and `manual_test` carries
`skippableForTiers: ['S']` (`steps.ts:200`). SHIP is not a universal safety net.

**Finding 3 — the gate measures compliance, not reachability.** `simplify` runs at every batch
boundary *inside* BUILD (`skills/pipeline/SKILL.md:328`), before the `wiring_check` step. The agent
writes code, `simplify` prunes it, and the gate then demands wiring for what remains. The gate is
satisfied by *any* reference to the symbol from outside its defining file — including a call site
added solely to clear it. A mechanical proxy that a compliance-shaped edit passes is not evidence of
production reachability. This applies to the probe layer as much as to the contracts.

Observed cost: 5 wiring kickbacks in the live worktree ledger, 4 of them the same contract-notation
failure on one feature, each costing a full build re-dispatch. Four of the six shipped features that
touched this gate were repairs to the contract layer.

## Options Considered

### Option A: Drop the contract layer, keep the probe (the filer's hypothesis)
- **Pros:** removes the observed notation kickbacks and the DECIDE land gate at low churn.
- **Cons:** Finding 3 applies to the probe too. Forces two non-obvious repairs:
  `evaluatePlanWiringDisposition` (`wiring-probe.ts:628`) demotes **all** gaps to advisory whenever a
  plan carries zero `Wired-into:` lines, so leaving it with contracts gone makes the gate silently
  never block; and `evaluateSameFileComposition` (`wiring-probe.ts:512`) returns
  `missing-same-file-caller-contract` unless a declared site exists, so the same-file composition
  exception — itself a shipped repair — must be rebuilt from the TS checker. Retains ~1,600 lines.

### Option B: Delete the gate; SHIP becomes the sole reachability authority
- **Pros:** largest deletion; leaves one authority instead of two that can disagree.
- **Cons:** by Finding 2, S-tier features get **no** reachability check at any phase. Reachability
  regressions surface only at SHIP, a long route back from BUILD.

### Option C: Move the judgement into `build_review` as a rubric item
- **Pros:** `build_review` is `skippableForTiers: []` (`steps.ts:185`) — it gates at **every** tier,
  S included, so this is the only option that covers S. It already receives the full diff and the
  approved plan, so the judgement costs **no new step and no new dispatch**. It is a judgement rather
  than a mechanical proxy, which is the right instrument for a property Finding 3 shows a proxy
  cannot capture — "is this symbol genuinely reached from production" is exactly the ambiguous call
  an LLM grader is for. Its FAIL already routes back to `build` through an existing kickback path.
- **Cons:** trades a deterministic check for an LLM judgement, which reads against CLAUDE.md's
  deterministic-where-possible principle (addressed below). Adds a fifth rubric item to an
  all-or-FAIL gate, so it can fail builds that pass today. Changes the `.pipeline/build-review.json`
  verdict schema.

### Option D: Demote contracts to advisory
- **Pros:** smallest diff, reversible.
- **Cons:** pays the entire maintenance cost while dropping only the enforcement.

## Decision

**Option C.** Wiring reachability becomes a **fifth `build_review` rubric item**. The probe, the
contract layer, the DECIDE land gate, and the `validate-wired-into` CLI subcommand are all deleted.
The `wiring_check` step itself is retained as a deprecated no-op — see
`adr-2026-08-11-removed-steps-degrade-not-throw` for why the step name survives its machinery.

The new rubric item judges a **static** property of the diff: every new production surface it
introduces is called from a path that reaches a production entry point. It must be worded so it does
not collide with the prompt's existing disclaimer at `build-review-prompt.ts:42-44` — reachability is
a property of the code as written, not of runtime behavior, which remains `manual_test`'s mandate.

The all-or-FAIL rule extends from four items to five, and the `rubric` object in
`.pipeline/build-review.json` gains a `wiring` boolean with a matching `findings.wiring` key. Verdicts
written before this change lack the key and must be read as "not judged", never as a silent pass.

> **Amended 2026-08-13 by #1542:** Wiring now runs in its own default-enabled rubric branch. Missing
> or empty `config.wiring.entry_points` is represented as `skipped: missing-entry-points`, preserving
> this ADR's not-judged behavior without calling it a pass. The extra branch is a new dispatch; the
> static reachability definition and legacy aggregate compatibility remain authoritative.

**On the deterministic-where-possible principle.** This removes deterministic machinery in favour of
LLM judgement, which reads as a violation. It is not, for the reason in Finding 3: the deterministic
gate was not deterministically measuring the property it claimed. The principle prefers machinery
when the mechanical proxy is *faithful*; here the proxy was satisfiable by an edit that creates no
real wiring, and 4-in-5 of its failures were notation rather than dead code. Replacing an unfaithful
cheap check with a faithful judgement that costs no extra dispatch is the correct trade, and the
principle's own justification — "fails at the point of violation, token-free" — never held for a gate
whose dominant failure mode was authoring notation.

## Consequences

### Positive
- **S-tier features gain reachability coverage they have never had.** `build_review` gates at every
  tier; the deleted gate's replacement is strictly broader than both the gate and SHIP.
- Eliminates the dominant BUILD kickback class and a full re-dispatch per occurrence.
- Removes per-task authoring ceremony from every plan and one rejection mode from every land.
- Deletes ~2,200 lines and a documented ESM circular-import hazard between `wired-into.ts` and
  `plan-task-parse.ts` (`wired-into.ts:1-12`).
- The judgement reads real code in context instead of a diff-derived symbol list, so the same-file
  composition case that needed a bespoke exception is handled by ordinary reading.

### Negative
- A wiring FAIL is now non-deterministic: the same diff can be judged differently across runs, and
  the grader can produce both false positives and false negatives where the probe was at least
  consistent.
- `build_review` becomes a heavier gate carrying five all-or-FAIL items; one flaky wiring judgement
  now fails the whole review, including work that passed the other four.
- `.pipeline/build-review.json` schema change; older verdicts are not comparable.
- The `BuildReviewGateInstruction` feed becomes vestigial — no `wiring_check → build` kickbacks will
  be emitted for it to replay.

### Follow-up Actions
- [ ] Word the rubric item to avoid contradicting the runtime-behavior disclaimer at
      `build-review-prompt.ts:42-44`.
- [ ] Cite this ADR in `skills/architecture-review/SKILL.md` §12 so the as-built sweep's relationship
      to the new BUILD-time judgement is explicit — the sweep is unchanged and remains authoritative
      at SHIP.
- [ ] Watch the first builds after landing for wiring-item false positives; if the grader proves
      unreliable, the fallback is demoting the item to advisory, not restoring the probe.
