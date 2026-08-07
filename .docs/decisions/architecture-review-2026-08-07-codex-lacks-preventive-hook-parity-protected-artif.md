# Architecture Review: provider-neutral preventive controls for protected DECIDE artifacts (#1254)

**Date:** 2026-08-07
**Tier:** M (retiered from L during this review)
**Track:** technical
**Input reviewed:** `.docs/track/`, `.docs/complexity/`, `.docs/architecture/` for this stem; issue #1254
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Yes. One new bash asset in `git-hook-assets.ts`, alongside two existing ones. No new dependency. |
| Prerequisites | None. `core.hooksPath` is already wired worktree-scoped (`worktree-prepare.ts:453-457`). |
| Integration surface | Three modules: `git-hook-assets.ts` (new asset), `worktree-prepare.ts` (install + fail-closed), `plan-task-parse.ts` (parser widening, 3 consumers). Plus `conductor.ts:9098-9102` for the remediation redirect. |
| Data implications | None — no schema, no migration, no persisted state beyond the existing hook files. |
| Performance risk | One `git diff --cached --name-only` per commit against a fixed prefix list. Negligible. |
| Worktree isolation | Improved. The hook is worktree-scoped by construction; no shared state introduced. |

## Complexity

Medium. Retiered from Large during this review after three workstreams left scope (see Conditions).
No single seam dominates; the mechanics are well understood and the largest risk is parser
false-positives rather than novel design.

## Alignment

**Honors `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation:87`** (APPROVED,
*"Provider-local hooks remain early feedback only"*). This was the crux question and it was judged
explicitly rather than assumed.

The design does **not** make a second provider-local hook load-bearing. It relocates correctness to a
channel that is not provider-local at all, leaving both providers' `PreToolUse` hooks as feedback and
the terminal seal as acceptance authority. That is Option B of `adr-2026-07-25` applied faithfully
rather than circumvented. **No superseding ADR is required.**

Consistent with the repository's own Design Principle (`CLAUDE.md`): the fix is machinery that
rejects at the moment of the mistake, not a stronger prompt.

## Domain Integrity

No domain types introduced. The one policy concern is a genuine divergence to reconcile:
`PROTECTED_ARTIFACT_DIRECTORIES` (`protected-artifact-seal.ts:17-22`) omits `.docs/decisions`, while
the runtime classifier `classifyMutationTarget` (`:205-207`) protects all of `.docs/`. Two
definitions of "protected" is exactly the condition that let an ADR-targeting task pass the plan
scanner. A single shared definition must feed the hook, the scanner, and the seal.

## Wiring Surface

| New production surface | Called from, in production |
|---|---|
| `PRE_COMMIT_HOOK` asset (new export, `git-hook-assets.ts`) | `writeGitHooks` in `worktree-prepare.ts:399-416`, the same function that writes the two existing hook assets |
| The written `.pipeline/git-hooks/pre-commit` script | git itself, on every `git commit` in the worktree, via `core.hooksPath` set at `worktree-prepare.ts:453-457` |
| Fail-closed wiring behavior | `writeGitHooksAndWire` (`worktree-prepare.ts:385-396`), reached from `prepareWorktree` (`:93-105`), reached from `daemon-deps.ts:118-119`, `daemon-runner.ts:330-332`, `autoresolve.ts:324-325`, `daemon-cli.ts:1164-1166` |
| Widened path harvesting in `plan-task-parse.ts` | existing three consumers: `land-spec.ts:242`, `cli.ts:137`, `conductor.ts:9094-9104` |
| Remediation redirect over `gap.rationale` | `planRemediation`, `conductor.ts:2365-2378` |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Parser widening false-positives block legitimate spec landings | Technical | Medium | High | Negative-path acceptance tests: a plan that merely *cites* a protected artifact as context must still land. Three consumers, one of which blocks landing. |
| Blocked commit becomes a retry loop, re-consuming the cycles the gate exists to save | Technical | Medium | High | Diagnostic must name the artifact and owning DECIDE phase and state the amendment route. Acceptance test asserts the message, not just the exit code. |
| Fail-closed wiring turns a previously tolerated environment fault into a hard stop | Integration | Medium | Medium | Distinguish "cannot write hooks" (fail) from pre-existing tolerated conditions; cover the read-only-`.git` path explicitly. |
| Hook wiring is a canonical breaking surface | Integration | High | Medium | Real `## Migration` block in the implementation PR; a waiver is not appropriate here. |
| Two definitions of "protected" drift again | Technical | Medium | Medium | Single shared predicate feeding hook, scanner, and seal. |
| `--no-verify` / out-of-worktree commits bypass the gate | Technical | Low | Low | Accepted and documented; terminal seal owns these paths. |

## ADRs Created

- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` — **APPROVED**.

None superseded.

## Conditions

1. **Wiring must fail closed.** `writeGitHooksAndWire` (`worktree-prepare.ts:389-396`) currently
   swallows every error and logs `git hooks: skipped`. A missing or unwritable preventive control
   must fail the step, per #1254's own requirement.
2. **A single shared protected-path predicate** must feed the pre-commit hook, the plan scanner, and
   the seal. `.docs/decisions` must be covered by whatever the scanner consults.
3. **Negative-path coverage for the parser widening** is mandatory before land: a plan citing a
   protected artifact as context must still land clean.
4. **The block diagnostic is part of the contract**, not a nicety — it must name the offending
   artifact and its owning DECIDE phase, and be asserted by an acceptance test.
5. **`CONDUCT_ENGINE_COMMIT=1` must be honored** by the new hook, matching the existing `commit-msg`
   convention (`git-hook-assets.ts:140`), or engine bookkeeping commits will break.
6. **The implementation PR carries a real `## Migration` block** for the hook-wiring surface.
7. **Deferred scope stays deferred and filed:** Codex `PreToolUse` (#1353), destructive-git
   relocation (#1354), TDD-phase enforcement (#1009). The control inventory must record all three,
   plus `rate-limit-wait.sh` (#1019), as known-inactive rather than silently omitting them.

## Corrections Made During This Review

Recorded because the first draft of the architecture document asserted each of these wrongly;
full ledger in `.pipeline/verify-claims-architecture_review.md`.

- **`reset --hard` was wrongly listed as having no neutral veto point.** It moves HEAD, so
  `reference-transaction` fires and can abort it — verified on git 2.53.0. `clean -f` and
  `checkout -- .` fire no ref transaction and are genuinely unguardable.
- **"pre-commit fully covers the protected-artifact threat" was an overclaim.** Uncommitted mutation
  is a distinct tracked verdict (`protected-artifact-seal.ts:771-776`) the gate never sees.
- **Both TDD gates are dormant** (#1009) — relocating that control would have moved machinery that
  does not function.
- **`hooks/pre-commit-tdd-gate.sh` already exists** but nothing installs it
  (`settings-and-hooks.md:222-224`).

## Verdict

**APPROVED WITH CONDITIONS.** The design is sound, honors the governing ADR without amendment, and
targets the verified root cause. Conditions 1–7 are tracked into the plan and checked at code review;
unmet conditions at `/finish` are blocking.
