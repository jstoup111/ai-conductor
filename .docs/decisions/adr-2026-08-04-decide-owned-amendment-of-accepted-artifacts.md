# ADR: Amending an accepted `.docs/` artifact is a DECIDE-time act, enforced deterministically at every skill that can direct one

Status: APPROVED
Date: 2026-08-04
Refs: jstoup111/ai-conductor#1293
Related: #1254 (protected DECIDE artifact traps a feature in a BUILD cycle), #1281 (no operator
reseal command), adr-2026-07-27-protected-artifact-seal-self-amendment-visibility

## Context

On 2026-08-04 at 05:17:10, `build-repair-preserves-stale-wiring-pass-and-halts` halted with
`Protected artifact changed: .docs/stories/2026-07-12-wiring-reachability-gate.md`. Recovery required
hand-editing fingerprints in `.pipeline/protected-artifact-seal.json` — the third such manual reseal
in one night.

Nothing misbehaved. Every component did exactly what it was specified to do:

- `conflict-check` correctly detected that the feature falsifies two accepted assertions, and wrote a
  `## Required Amendments (same change set)` section naming both story paths
  (`.docs/conflicts/build-repair-preserves-stale-wiring-pass-and-halts.md:60-64`).
- `architecture-review` agreed: "Amend both in the same change set with a dated note, following the
  established precedent for refining a pinned assertion"
  (`.docs/decisions/architecture-review-2026-08-03-build-repair-member-reuse-validity.md:91`).
- `plan` faithfully turned that into Task 14, "Amend the two accepted assertions whose wording this
  changes", with both sealed paths on its `**Files:**` line.
- BUILD executed Task 14 exactly as written, adding one dated additive note to each file.
- The seal refused, correctly: `namesOwnFeature` (`protected-artifact-seal.ts:508-511`) is false for
  both stems, so `inspectSeal` fell through to the halt at `:630`.

The defect is not in any component. It is in the **hand-off**: DECIDE produced a correct amendment
*intent* and had no sanctioned way to *perform* it, so it expressed the intent as work for the one
phase structurally forbidden to do it.

Two further facts bound the solution space, and both were verified by reading the code:

1. **Autonomous remediation cannot rewind to DECIDE.** `decideKickbackDisposition`
   (`kickback-policy.ts:7-23`) halts any daemon-mode kickback whose target step has
   `phase === 'DECIDE'`. Observed live on `changelog-unreleased-is-a-shared-write-target-conf` at
   2026-08-03T11:48:15. Any design whose mid-BUILD answer is "rewind to DECIDE" converts a
   self-healing build into an operator interrupt — which the intake explicitly rules out as
   not an improvement.
2. **The prescribed recovery does not exist.** The halt text
   (`rebase.ts:453-463`) instructs the operator to "perform an audited reseal with the engine rotation
   function". `rotateProtectedArtifactSeal` is exported from its module but is not re-exported from
   `src/index.ts` and has no command in `cli.ts`. Its permission predicate
   (`evaluateProtectedArtifactSealRotation:269-318`) additionally *refuses* feature-authored changes by
   construction — `Feature-authored protected artifact change cannot rotate seal` at `:704-707`. A
   design that routes amendments through a reseal is therefore blocked on #1281 and, even after it,
   asks an operator to approve every amendment by hand.

## Decision

### 1. The amendment is performed at DECIDE, in place, before BUILD exists

An amendment to an accepted `.docs/` artifact is authored during the same DECIDE pass that produces
the plan, committed on the spec branch, in the artifact itself.

The mechanism this exploits is already in the engine and needs no new tolerance: **the seal baseline is
taken at first BUILD entry**. An amendment that landed at DECIDE is part of that baseline. There is
nothing for the seal to detect, nothing to rotate, and no reseal command required. This design does not
depend on #1281.

The note form is the convention already used throughout this repository's corpus and named
"established" inside three separate artifacts, but codified in no skill. It is now codified:

```
> **Amended YYYY-MM-DD by #NNN:** <what the assertion now says, and why>
```

Amendments are **additive**. An accepted assertion's original text is never rewritten or deleted; the
note sits with it. Git holds the history, and a reader of the old assertion sees the correction next
to it rather than a silent replacement.

### 2. The rule binds every skill that can direct a mutation, not just `plan`

This is not a `/plan` bug fix. The intent originates in three different DECIDE skills and is consumed
by two more, so the contract is stated once in `HARNESS.md` and each affected skill carries its half:

| Skill | Obligation |
|---|---|
| `conflict-check` | Already detects falsified assertions. Now **performs** the amendment and records it in the ledger, instead of deferring it to a later phase. |
| `architecture-review` | A review conclusion that an accepted assertion is falsified records a ledger row; it never instructs a later phase to "amend in the same change set". |
| `stories` | Its one vague sentence about superseding stories gains the codified note form and the ledger row. |
| `plan` | MUST NOT emit a task whose `**Files:**` names a sealed artifact. Amendments are already performed by the time `plan` runs; there is nothing left to task. |
| `remediate` | MUST NOT assign a disposition that routes a protected-artifact amendment to `build` or `acceptance_specs`. |
| `tdd` / `pipeline` | BUILD-side: an accepted assertion discovered falsified mid-build takes the deferred-request route below. |

### 3. Scope of the ban: sealed directories, other features' artifacts

Answering the intake's open decision #3 from the code rather than by preference:

- **Which paths.** The four sealed directories only — `.docs/architecture`, `.docs/plans`,
  `.docs/specs`, `.docs/stories` (`protected-artifact-seal.ts:17-22`). Not all of `.docs/`. The wider
  `classifyMutationTarget` policy (all of `.docs/`, minus a per-step allowlist) remains as the
  runtime write-guard and is unchanged; this ban is about what a *plan may direct*, and directing an
  edit to `.docs/coherence/` or `.docs/decisions/` is not the failure this ADR addresses.
- **Whose artifacts.** Another feature's. A path whose stem names the current feature is already
  tolerated by the seal as a reported self-amendment (#1047), and `remediation-append` depends on
  exactly that tolerance to write remediation tasks into the feature's own plan. Banning own-feature
  paths would break shipped machinery to solve a problem it does not have.

### 4. Enforcement is deterministic and engine-side, at two checkpoints

Per this repository's Design Principle, the fix for a repeatedly-violated rule is machinery that
rejects at the moment of the mistake, not stronger prompt text.

- **Authoring-time**, a blocking `conduct-ts` check over the plan, invoked by `/plan` — the same shape
  as the existing advisory `overlap-scan` and as PR #1190's `validate-wired-into`, but blocking. It
  reuses `parsePlanTaskPaths` for the task→paths map and the seal module's own directory set and
  own-feature predicate for the policy, so a future change to what "sealed" means propagates for free.
- **Land-time**, in `land-spec.ts` alongside the existing coherence, DRAFT-ADR, and tier gates. This is
  the backstop that does not depend on an agent having run the authoring check. A merged spec whose
  plan violates the rule is refused before any daemon can build it.

Enforcement is **mechanical, not LLM-judged**. The question "does this path lie under a sealed
directory and not name this feature" is a set-membership test with an authoritative answer already in
the engine. An LLM judge would be slower, non-deterministic, and strictly worse at the one thing this
check does.

### 5. Mid-BUILD discovery routes to a deferred amendment request, and never blocks

BUILD legitimately learns things DECIDE could not predict. When a BUILD session concludes that an
accepted assertion is now false, it writes a row to `.docs/amendments/<plan-stem>.md` — a path
**outside** the sealed set and on the `.docs/` write allowlist — and **the build continues**. Nothing
halts, no rewind is attempted, no operator is interrupted.

The fail-closed half is at SHIP, and it fails closed on *silence*, not on the build: `finish` refuses
to complete while an unresolved request row exists without being carried into the PR body and filed as
a follow-up issue. The accepted corpus can therefore be temporarily out of date, but it can never be
*silently* out of date — which is precisely the guarantee the intake asks for.

## Alternatives considered and rejected

**Enforcement alone (the filer's hypothesis).** Cross-check `**Files:**` against the sealed set and
reject. Rejected as incomplete on the filer's own reasoning: applied to the observed incident it would
have blocked the plan at authoring time with no sanctioned way to produce an amendment the change
genuinely needed. It is half of this decision, not a decision.

**Loosen the seal — tolerate any amendment the plan explicitly declares.** Cheap, keeps builds
self-healing, and requires no skill changes. Rejected: it converts the seal from tamper detection into
a declaration checkbox, and any BUILD session that can write a plan can write itself the permission.
#1254's stated desired outcome is the exact opposite. It also fails the provider-neutrality test in
the worst way — the declaration would be trusted from a session the write-guard already cannot police.

**Route mid-BUILD discovery through remediation to a DECIDE step.** Rejected on measured behavior:
`decideKickbackDisposition` halts every daemon-mode DECIDE kickback. This is the operator-interrupt
outcome the intake names as not an improvement.

**Amend via an operator-approved reseal.** Rejected: it depends on #1281 shipping a command that does
not exist, the rotation predicate refuses feature-authored changes by construction, and it puts a human
in the loop for every amendment — the halt/rekick checkpoint that
`adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` already removed once.

**A superseding-artifact convention instead of in-place notes.** Mirrors the ADR supersession rule in
`conflict-check`. Rejected for stories: a superseding story file fragments one assertion across two
documents, and the corpus already uses in-place dated notes in over a dozen places. Codifying the
convention in use beats importing a different one.

## Consequences

- The observed incident becomes impossible in two independent ways: the amendment is performed before
  BUILD exists, and a plan that tries to task it is rejected at authoring and again at land.
- `.docs/amendments/` is a new artifact directory. It is deliberately unsealed; a future change that
  seals it would re-create this bug for the mid-BUILD route.
- The rule narrows what a plan may contain. Existing merged plans are unaffected — enforcement is at
  authoring and land, not retroactive over the corpus.
- #1281 remains worth shipping as an operator escape hatch for the case where the rule is right and
  reality disagrees, but no longer blocks amendment work.

## Verify-Claims Verdict

Load-bearing claims and their basis:

- Sealed directory set is a hardcoded four-entry list, not config — **verified**, read at
  `protected-artifact-seal.ts:17-22`.
- Own-feature amendments are tolerated and reported rather than halting — **verified**, read at
  `:624-626` and `:508-511`.
- The seal baseline is written at first BUILD entry — **verified**, `createProtectedArtifactSeal`
  called from `conductor.ts:4677`.
- Daemon-mode DECIDE kickbacks always halt — **verified**, `kickback-policy.ts:7-23`.
- No reseal command is reachable from the CLI — **verified**, no match for reseal/rotate across
  `bin/`, `cli.ts`, `cli-builtins.ts`; `index.ts` re-exports nothing from the seal module.
- `conflict-check` already emits `Required Amendments` — **verified**, read at
  `.docs/conflicts/build-repair-preserves-stale-wiring-pass-and-halts.md:60-64`.
- The dated-note convention is in use but codified nowhere — **verified**, present in a dozen
  `.docs/stories/` files and named "established" in three artifacts; absent from all of `skills/`
  and `docs/`.
- Codex bypasses the Claude-only docs write-guard — **inferred, 95%**, from #1254's recorded
  observation rather than a reproduction run here. Impact if wrong: none to this design, which
  places every check engine-side regardless.

No unconfirmed load-bearing assumption remains.
