# Architecture Review: Provenance-based protected-artifact seal rotation (#1229)

**Date:** 2026-08-09
**Tier:** M — lightweight pass (Sections 2 and 4 only)
**Design reviewed:** `.docs/architecture/manual-rebase-strands-protected-artifact-seal.md` (operator-approved 2026-08-09)
**Runs before:** `/stories` — no stories or plan exist yet
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependency. The design reuses `execa` + git invocations already present in the module. |
| Prerequisites | None. No migration, no config, no external setup. The seal file format is unchanged — no new field, no version bump. |
| Integration surface | One module (`protected-artifact-seal.ts`) plus additive payload fields on two existing `ConductorEvent` variants and their daemon renderer. Does not cross a domain boundary. |
| Data implications | None. `.pipeline/protected-artifact-seal.json` keeps `version: 2` and its existing shape. |
| Performance risk | Bounded. The provenance probe is one `git diff --name-only` per *diverging* path, and diverging paths only exist on the non-ancestor (history-rewritten) path. The common case — baseline is an ancestor of HEAD — short-circuits at `same-history-ancestor` before any probe runs. Verified by reading `evaluateProtectedArtifactSealRotation`'s early returns. |
| Worktree isolation | Unaffected. The seal is already per-worktree and gitignored; no shared state, port, or service is introduced. |

**Verified claims (95%, read directly from source at this HEAD):**

- `evaluateProtectedArtifactSealRotation` (`protected-artifact-seal.ts:283`) is a pure function over
  preloaded blob maps and is unit-tested directly — 11 references in
  `src/conductor/test/engine/protected-artifact-seal.test.ts`. This is a real testability seam and
  the design must not dissolve it (see Condition 1).
- `branchUntouchedInheritance` (`:586`) already implements the merge-base authorship probe
  (`git diff --name-only <baseRef>...HEAD -- <path>`) and already distinguishes `no-merge-base` and
  `diff-probe-failed` from a real answer. The probe being lifted is proven, not new.
- `rotationRefusalPreservesInspection` (`:797`) already implements non-escalation for
  `same-history-ancestor` and `base-tip-unresolved`. The design extends an existing mechanism rather
  than inventing one — the non-escalation concept is not novel here, only its coverage.

## Alignment

**Against `adr-2026-07-26-protected-artifact-seal-rebaseline` (APPROVED).** That ADR's Decision item
2 states rotation is permitted only when the HEAD blob "is byte-identical to the same path's blob at
the base-branch tip — i.e. the new content was **inherited from the base**, not authored by this
feature." The clause after the dash is the intent; the clause before it is the implementation. #1229
demonstrates they are not equivalent: a feature that is merely behind base fails byte-identity while
having authored nothing. **This design does not overturn that ADR's intent — it corrects the
implementation to match it.** Items 1, 3, and 4 of that ADR are untouched.

Handled per the accepted-artifact amendment protocol: an additive amendment note beside the
falsified assertion, plus a new ADR carrying the corrected predicate. The original ADR is neither
rewritten nor superseded wholesale, because three of its four decisions remain correct.

**Against `CLAUDE.md` Design Principles.**

- *Deterministic where possible.* Satisfied — the fix is a git-derived predicate evaluated by the
  engine at the moment of the decision. No prompt, no agent, no operator discipline. This is
  precisely the "machinery, not prose" direction the principle demands, and it retires an operator
  runbook step.
- *Extend the existing event spine; never add a parallel channel.* Satisfied — the concern (why a
  rotation was refused, on what evidence) is already carried by
  `protected_artifact_rebaseline_refused`. Only its payload is too thin for triage to classify.
  Additive fields on an existing variant is the schema-not-file answer; no new variant, no sibling
  ledger, no sidecar, no timestamp-in-an-artifact.

**Pattern consistency.** The design introduces no new pattern. It moves one existing predicate to a
second call site and widens one existing refusal-classification table.

**State management.** The refusal condition set is a discriminated union
(`ProtectedArtifactSealRotationVerdict`). Adding a `base-ahead` classification as a *union member*
rather than a boolean flag keeps invalid states unrepresentable and forces exhaustive handling at
every consumer. The design's choice to instead *exclude* base-ahead paths from the blocking set is
stronger still: the state cannot be constructed at all, so no consumer can mishandle it.

**Security boundaries.** The seal is a tamper-detection surface, so the loosening was checked
adversarially:

- Agent commits an edit to a protected artifact → HEAD touched the path since merge-base →
  classified feature-authored → refuses and halts. Unchanged.
- Agent commits a deletion → HEAD touched the path → feature-authored → halts. Unchanged.
- Agent edits without committing → `workspace-differs-from-head` fires first, and keeps escalating
  under the narrowed non-escalation rule. Unchanged.
- Agent rewrites history to drop its own edit → the path genuinely reverts to base content; nothing
  is being concealed.
- Agent rebases onto a newer base to shift the merge-base forward → an edit present in HEAD and
  absent from base still appears in `<base>...HEAD`. No laundering path found.

Independently, `inspectSeal` catches a committed feature-authored edit on fingerprint mismatch
before rotation is ever consulted. The two checks are redundant for that case, which is why
narrowing rotation's escalation does not open a hole.

**Production DI defaults.** Not applicable — no DI, no store selection.

## Wiring Surface

This feature introduces **no new production surface**. It changes behavior inside surfaces that are
already wired:

| Surface | Change | Production caller (existing) |
|---|---|---|
| `evaluateProtectedArtifactSealRotation` | New input field carrying precomputed per-path authorship; new `base-ahead` exclusion | `evaluateProtectedArtifactSealRotationInRepository`, same module |
| `evaluateProtectedArtifactSealRotationInRepository` | Resolves the authorship probe and populates the new input | `verifyExistingProtectedArtifactSeal`, same module |
| `rotationRefusalVerdict` | Narrowed escalation via `rotationRefusalPreservesInspection` | `verifyExistingProtectedArtifactSeal`, same module |
| `verifyProtectedArtifactSeal` | Unchanged signature | `conductor.ts` BUILD/SHIP step guard |
| `protected_artifact_rebaseline_refused` / `protected_artifact_rebaseline` | Additive payload fields | `ConductorEventEmitter` → `EventPersister`; rendered in `daemon-cli.ts#renderDaemonEventUnsafe` |

Because every changed export already has a production caller inside its own module chain rooted at
`conductor.ts`, the plan's `Wired-into:` lines will point at existing call sites rather than new
wiring. `/plan` must still declare them explicitly.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Provenance probe cannot answer (no merge-base, git failure) and is treated as "not authored", admitting a real violation | Security | Low | High | Fail closed: any non-definitive probe result classifies the path as feature-authored and refuses. Condition 2. |
| Lifting the git probe into the pure evaluator destroys its unit-test seam | Technical | Medium | Medium | Resolve provenance in the repository wrapper; pass a precomputed set into the pure function. Condition 1. |
| Narrowed non-escalation is implemented as blanket non-escalation, silently dropping the uncommitted-edit signal | Security | Medium | High | Explicit negative-path stories asserting `workspace-differs-from-head` still halts. Condition 3. |
| Merge conflict with in-flight #1281 in the same file | Integration | High | Low | No function-level overlap. Sequence after #1281 or rebase onto it. Condition 5. |
| Rotation audit trail under-reports which artifacts moved | Data | High | Low | Pre-existing defect found during review; fix in scope. Condition 4. |

## Findings

**F1 — `translateAfterRebase` omits `.docs/decisions` from its rotation audit paths (pre-existing).**
`rebase-translate.ts:453-463` diffs only `.docs/architecture`, `.docs/plans`, `.docs/specs`,
`.docs/stories`, but `PROTECTED_ARTIFACT_DIRECTORIES` (`protected-artifact-seal.ts:17-23`) includes
`.docs/decisions`. Fingerprint *correctness* is unaffected — `createSeal` re-fingerprints every
protected directory — but the `rebaselines[]` audit entry silently under-reports ADR movement. Since
outcome (4) makes this audit trail load-bearing for triage, fix it here.

**F2 — the engine-managed `translateAfterRebase` path needs no behavioral change.** It calls
`rotateProtectedArtifactSeal` directly with `trigger: 'proactive-rebase'`, bypassing the rotation
evaluator entirely, so the defective predicate never runs on it. Confirmed by reading
`rebase-translate.ts:448-478`. Only F1's path list changes there. The filer's first hypothesis is
therefore accurate as a description (manual rebase bypasses this lifecycle) but is not where the fix
belongs — the defensive rotation exists to cover exactly that bypass, and it is the broken part.

**F3 — `overlap-scan` output is not decision-relevant here.** It reported ~29 overlapping spec
branches on `protected-artifact-seal.ts`. Spec branches carry only `.docs/` commits, so these are
merge-base artifacts of stale branches, not genuine concurrent edits. The one real overlap is #1281,
identified independently. Recorded so a later reader does not mistake the scan's volume for risk.

## ADRs Created

Both are authored at APPROVED status only after explicit operator approval in this session; neither
is cited by downstream work before then.

1. `adr-2026-08-09-seal-rotation-authorship-predicate.md` — rotation permission is *authorship*, not
   base-identity; and a rotation refusal does not escalate a passing inspection except for
   tamper-evidencing refusal classes. Amends (does not supersede)
   `adr-2026-07-26-protected-artifact-seal-rebaseline` Decision item 2.
2. `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator.md` — git-dependent provenance is
   resolved by the repository wrapper and handed to the pure evaluator as data, preserving the
   evaluator's unit-test seam.

## Conditions

1. **Preserve the pure-evaluator seam.** `evaluateProtectedArtifactSealRotation` must remain a pure
   function over supplied data. Authorship is resolved in
   `evaluateProtectedArtifactSealRotationInRepository` and passed in as a precomputed per-path
   input. No `execa` call may be added to the pure function. Enforced by
   `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator`.

2. **Fail closed on an indeterminate provenance probe.** `no-merge-base`, a failed `git diff`, and an
   unresolvable base ref must each classify the path as feature-authored (refuse and escalate) — never
   as `base-ahead`. A negative-path story must assert each branch.

3. **Prove the escalation boundary is unweakened.** Stories must assert, as explicit negative paths,
   that a committed feature-authored protected-artifact edit still halts, and that
   `workspace-differs-from-head` still halts, under the new non-escalation rule.

4. **Fix F1 in this change.** Add `.docs/decisions` to `translateAfterRebase`'s rotation path diff so
   the `rebaselines[]` audit entry covers every protected directory.

5. **Declare the #1281 sequencing in conflict-check.** `/conflict-check` must record the file-level
   overlap with `.docs/plans/no-operator-command-to-reseal-a-protected-decide-a.md` and state the
   ordering decision. The two are complementary — `conduct reseal` is an interactive operator-only
   recovery command and cannot satisfy this issue's no-intervention outcomes.

6. **Reproduce the reported sequence as an acceptance-level story.** Outcome (5) names a specific
   sequence — rebase completion, base-only protected-artifact advance, daemon resume. A story must
   cover it end-to-end against real git fixtures, not only the unit-level predicate.
