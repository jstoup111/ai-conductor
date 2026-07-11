# ADR: Attribution verdict interface and evidence-stamp schema evolution

**Date:** 2026-07-11
**Status:** APPROVED (operator, 2026-07-11)
**Deciders:** James Stoup (operator), engineer session for intake #520

## Context

The semantic verification lane (adr-2026-07-11-semantic-attribution-verification-lane)
needs (a) a verdict file contract between the verifier session and the engine, and (b) a
way to record judged provenance in `.pipeline/task-evidence.json` distinctly from
mechanical provenance — issue #520 requires "auditable evidence with distinct provenance
(mechanically attributed vs judged)".

The complexity assessment proposed shaping the verdict as the #469/#500 `BranchOutcome`
discriminated union so the spot-audit can later join the validation group. **Verified:**
PR #500 is unmerged and on operator HOLD; its types exist only on branch
`spec/parallel-validation-phase-fan-out-manual-test-prd-`. Hard-coupling a
priority-critical spec to an unmerged spec's types is a freshness hazard (the types may
change or never merge).

Current sidecar schema (verified, `engine/task-evidence.ts:21`):
`evidenceStamps: Map<string, { sha: string; form: string }>` where `form` is a plain
`string` (`'trailer' | 'evidence:satisfied-by' | 'legacy-heal'` in practice). No reader
switches exhaustively on `form` (verified by grep across `task-evidence.ts`,
`autoheal.ts`, `artifacts.ts`) — a new form value is additive and safe.

## Options Considered

### Option A: Define the verdict union locally; converge structurally with BranchOutcome
- **Pros:** self-contained (no dependency on an unmerged branch); the discriminated-union
  *shape* (`verdict` / `no-verdict` / `skipped`) is preserved so a later #469 adapter is
  mechanical; #500 remains free to change.
- **Cons:** if #500 merges with a different union, a small adapter is needed (accepted).

### Option B: Import #500's `BranchOutcome` types directly
- **Pros:** zero later adaptation.
- **Cons:** impossible on main today; couples a critical fix to a held spec; violates
  fail-closed freshness (building on artifacts not yet merged).

## Decision

**Option A.**

### Verdict file: `.pipeline/attribution-verdict.json`

Written by the verifier session; parsed fail-closed by the engine.

```jsonc
{
  "schema": 1,
  "anchor": { "head": "<sha>", "residue": ["7", "9"] },   // memoization key, engine-provided, echoed back
  "results": [
    {
      "taskId": "7",
      "verdict": "satisfied",                    // "satisfied" | "unsatisfied" | "no-verdict"
      "citations": [ { "sha": "<full-sha>", "rationale": "adds the sweep wiring the task names" } ],
      "testEvidence": { "command": "npx vitest run src/…", "exit": 0, "summary": "12 passed" }
    },
    { "taskId": "9", "verdict": "unsatisfied", "reason": "no candidate diff touches the CLI surface" },
    { "taskId": "12", "verdict": "no-verdict", "reason": "diff ambiguous between tasks 12 and 13" }
  ]
}
```

- `satisfied` REQUIRES non-empty `citations` (full 40-char SHAs) and `testEvidence` with
  `exit: 0`; anything less is coerced to `no-verdict` by the engine parser (whitewash
  guard at the schema layer, before the git-level validation in the lane ADR).
- `unsatisfied` is a positive finding (work absent) and feeds retry hints;
  `no-verdict` is abstention (ambiguity, judge uncertainty) and feeds nothing.
- Tasks missing from `results` are treated as `no-verdict`.
- A stale or mismatched `anchor` (HEAD moved during judging) invalidates the whole file.
- The three-way discriminator deliberately mirrors the #469/#500 `BranchOutcome`
  `verdict`/`no-verdict`/`skipped` style; when #500 merges, the spot-audit's group
  membership needs only a thin adapter, not a reshape.

### Evidence stamp: new form `semantic-verified`, additive audit fields

```
evidenceStamps["7"] = {
  sha: "<primary cited sha>",
  form: "semantic-verified",
  citedShas: ["<sha>", …],          // NEW, optional: full citation set (split attribution)
  verdictAnchor: "<head-sha>",      // NEW, optional: which verdict produced this stamp
  testEvidence: { command, exit }   // NEW, optional: verifier-reported test run
}
```

- Existing stamp fields and forms are never mutated; new fields are optional so every
  existing reader (which reads only `sha`/`form`) is unaffected.
- The manual runbook's `Evidence: satisfied-by` commits remain valid and distinct
  (`form: 'evidence:satisfied-by'`) — operator repairs and judged repairs are separately
  auditable, satisfying #520's distinct-provenance outcome.
- Split attribution: several tasks' stamps may cite the same SHA; `citedShas` records
  the full set per task.

## Consequences

### Positive
- Verdict contract is testable in isolation (schema + coercion rules are pure functions).
- Provenance auditability: `grep semantic-verified .pipeline/task-evidence.json` answers
  "what did the judge decide" without git archaeology.
- No dependency on unmerged work; #469 composition preserved by shape convergence.

### Negative
- A future #500 merge may require a thin verdict→BranchOutcome adapter (accepted cost).
- Schema version field (`schema: 1`) must be bumped and handled on any breaking change.

### Follow-up Actions
- [ ] Implement fail-closed parser + coercion (satisfied-without-citations → no-verdict).
- [ ] Unit-test anchor invalidation (HEAD moves mid-judge).
- [ ] When #500 merges: add the BranchOutcome adapter for validation-group membership.
