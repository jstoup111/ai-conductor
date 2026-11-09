# Conflict Check: Paired fake-and-real contracts for external boundaries (#1990)

**Date:** 2026-11-08
**Stories checked:** `.docs/stories/nothing-proves-a-faithful-fake-still-matches-its-r.md` (Stories 1–5), checked against
all 682 story files in `.docs/stories/`.
**Result:** PASSED. One degrading conflict was found and resolved by rephrasing a story. No blocking conflicts remain.

## Inventory

Story files examined because they share subject matter (smoke capabilities, smoke ledger, boundary registry, faithful fakes, credentialed legs):

- `external-boundaries-have-no-swappable-seams-rerout.md` (#1989 registry and ratchet)
- `codex-fresh-session-per-step-contract.md` (shared faithful Codex fake, S4)
- `no-release-time-smoke-or-eval-gate-releases-cut-wi.md` (smoke discovery, capability declaration, gate mode)
- `30-of-33-bash-tests-never-execute-and-smoke-gating.md` (default-tier capability-declaration guard)
- `daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md` and `ci-needs-a-daemon-end-to-end-smoke-step-drive-a-1-.md` (live provider legs)

The remaining story files only match on incidental terms and have no shared behavior, entity, or gate.

ADRs examined (APPROVED, subject overlaps these stories):

- `adr-2026-11-07-external-boundary-ports-registry-and-ratchet`, including D7 as amended by #1990
- `adr-2026-08-12-per-provider-live-smoke-legs`
- `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`
- `adr-2026-08-04-classify-before-spend-release-smoke-gate`
- `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization`

Narrowed out: every other APPROVED ADR in `.docs/decisions/`. None of them governs smoke execution, the boundary registry, or test fakes.
`adr-2026-09-11-selective-post-rebase-verification` mentions smoke capabilities only for post-rebase test selection, which this
spec does not touch.

## Conflict: Gate-mode outcome for an unmet credentialed contract leg (resolved)

**Stories involved:** Story 5 vs ADR: Per-provider live smoke legs
**Files:** `.docs/stories/nothing-proves-a-faithful-fake-still-matches-its-r.md` vs `.docs/decisions/adr-2026-08-12-per-provider-live-smoke-legs.md`
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-08-12-per-provider-live-smoke-legs
**Story ID:** Story 5
**ADR opposing sentence (verbatim):** "A provider leg is **gate-enforced when its credential is present** in the environment, and recorded as an explicit, named non-gating skip in the ledger and the workflow step summary when it is absent."
**Story opposing sentence (verbatim, before resolution):** "Given the capability for an adapter is unmet in gate mode with that file selected, when `npm run smoke` runs, then the run fails closed naming the unmet capability rather than passing with no assertions."

**Description:** The story treated an absent credential in gate mode as a capability failure. Under D3 it is a named skip, and
the run fails only through `assertGateCredentialedExecution` ("Gate-mode smoke run executed no credentialed test files").
A missing binary while the credential is present is a named failure. This is verified at `src/conductor/src/engine/smoke-capability.ts`
in `resolveGateSmokeCapabilities` and `assertGateCredentialedExecution`.

**Resolution Options:**
1. Rephrase Story 5 to match D3, splitting it into an absent-credential case and an absent-binary case.
2. Supersede D3 so that an absent credential is a hard failure for contract legs.

**Recommendation:** Option 1. The story's intent, no vacuous pass, is still met, and the release-gate semantics stay unchanged.

**Resolution (operator, 2026-11-08):** Option 1. Story 5 was rephrased in place.

## Interactions checked, no conflict

- **Story 2 vs #1989 Story 1 (registry fields).** The new `contract` field is additive. The #1989 entry fields and the
  eight-entry completeness check still hold with it, and Story 2 holds with the #1989 fields unchanged. Both directions hold.
- **Story 3 vs `codex-fresh-session-per-step-contract` S4.** The Codex fake gaining a native-schema terminal result does not
  touch thread-id minting or resume rejection. Both directions hold.
- **Stories 4–5 vs the default-tier smoke-only guard and capability-declaration guard.** The real legs are `*.smoke.test.ts` files
  that declare a closed-set capability, and the fake legs launch no provider. Both directions hold.
- **Story 5 vs `no-release-time-smoke-or-eval-gate-releases-cut-wi` Story 1 (every discovered file is reported once).**
  The new real-leg files are discovered and reported through the same ledger. The structural known-file discovery assertion
  must list them, which is a plan-level obligation and not a story conflict.
- **Story 5 vs `adr-2026-08-12-per-provider-live-smoke-legs` D4 (workflow matrix runs only daemon-e2e legs).** The contract legs
  are outside the matrix, so CI does not run them, which is consistent with #1990's opt-in outcome. Both directions hold.

No oscillating, state, resource, or sequencing conflicts were found.
