# ADR: DECIDE mutates accepted `.docs/` artifacts directly, and never emits a task that mutates one

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
- BUILD executed Task 14 exactly as written.
- The seal refused, correctly: `namesOwnFeature` (`protected-artifact-seal.ts:508-511`) is false for
  both stems, so `inspectSeal` fell through to the halt at `:630`.

The defect is in the hand-off. DECIDE detected the amendment correctly and then, having no sanctioned
way to *perform* it, emitted it as a task — handing the work to the one phase structurally forbidden
to do it.

## Decision

**DECIDE mutates the artifact itself. DECIDE never emits a task that mutates a DECIDE artifact.**

Those two sentences are the whole decision. Everything below is how each is made real.

### 1. The mutation happens at DECIDE, in place

An amendment to an accepted `.docs/` artifact is written into that artifact during the DECIDE pass
that necessitates it, and committed on the spec branch.

The mechanism this relies on is already in the engine: **the seal baseline is created at first BUILD
entry** (`conductor.ts:4677`). A mutation performed during DECIDE is therefore *part of* that
baseline, not a deviation from it. Nothing for the seal to detect, nothing to rotate, no reseal
command needed — which is why this does not depend on #1281.

The note form is the convention already used throughout this repository's corpus and named
"established" inside three separate artifacts, but codified in no skill. It is now codified:

```
> **Amended YYYY-MM-DD by #NNN:** <what the assertion now says, and why>
```

Amendments are additive. The original assertion is never rewritten or deleted; the note sits with it,
so a reader of the old text sees the correction beside it rather than a silent replacement.

### 2. The ban on tasking a mutation binds every skill, not just `plan`

The amendment intent originates in three different DECIDE skills, so a single-skill fix would leave
two paths that still produce a task pointing at a sealed artifact. The contract is stated once in
`HARNESS.md`; each affected skill carries its half:

| Skill | Obligation |
|---|---|
| `conflict-check` | Already detects falsified assertions. Now **performs** the mutation instead of deferring it. |
| `architecture-review` | A review that finds an accepted assertion falsified performs the mutation; it never instructs a later phase to "amend in the same change set". |
| `stories` | Its one vague sentence about superseding stories gains the codified note form and performs the mutation. |
| `plan` | MUST NOT emit a task whose `**Files:**` names a sealed artifact. By the time `plan` runs the mutation is already done; there is nothing left to task. |
| `remediate` | MUST NOT assign a disposition routing a sealed-artifact change to `build` or `acceptance_specs`. |

### 3. Scope of the ban: sealed directories, other features' artifacts

Answered from the code rather than by preference:

- **Which paths.** The four sealed directories only — `.docs/architecture`, `.docs/plans`,
  `.docs/specs`, `.docs/stories` (`protected-artifact-seal.ts:17-22`). Not all of `.docs/`. The wider
  `classifyMutationTarget` write-guard policy is unchanged; this ban governs what a plan may *direct*.

  > **Amended 2026-08-19 by #1736:** the sealed set is **five** directories, not four —
  > `.docs/decisions` belongs with the other four and always has
  > (`protected-artifact-seal.ts:17-22` has enumerated five throughout; the omission above was in
  > this ADR's prose only, never in the code). The artifact at the centre of #1736 was an ADR under
  > `.docs/decisions/`, so every normative restatement of this ban — `HARNESS.md`, `skills/plan`,
  > `skills/remediate` — inherited the same gap and told plan authors an ADR-checkbox task was
  > permitted. The ban's scope is, and was always intended to be, `isProtectedArtifactPath`.
- **Whose artifacts.** Another feature's. A path whose stem names the current feature is already
  tolerated by the seal as a reported self-amendment (#1047), and `remediation-append` depends on that
  tolerance to write remediation tasks into the feature's own plan. Banning own-feature paths would
  break shipped machinery to solve a problem it does not have.

### 4. Enforcement is deterministic and engine-side, at two checkpoints

Per this repository's Design Principle, the fix for a repeatedly-violated rule is machinery that
rejects at the moment of the mistake, not stronger prompt text.

- **Authoring-time**, a blocking `conduct-ts` check over the plan, invoked by `/plan` — the same shape
  as the existing advisory `overlap-scan`, but blocking. It reuses `parsePlanTaskPaths` for the
  task→paths map and the seal module's own directory set and own-feature predicate for the policy, so
  a future change to what "sealed" means propagates for free.
- **Land-time**, in `land-spec.ts` alongside the existing gates. This is the backstop that does not
  depend on an agent having run the authoring check. A merged spec whose plan violates the rule is
  refused before any daemon can build it.

Enforcement is **mechanical, not LLM-judged**. "Does this path lie under a sealed directory and not
name this feature" is set membership with an authoritative answer already in the engine.

### 5. A mid-BUILD discovery returns to DECIDE. There is no BUILD-side route.

When BUILD learns that an accepted assertion is falsified, that finding belongs to DECIDE and goes to
DECIDE. Concretely: `remediate` may never dispose such a gap to `build` or `acceptance_specs`; it
routes to the owning DECIDE step, which in daemon mode reaches the existing operator gate
(`kickback-policy.ts:7-23`).

**No new artifact, no deferred-request file, no parallel ledger, no new write-allowlist entry.**

This reverses an earlier draft of this ADR, and the reasoning is the crux of the whole issue. That
draft gave BUILD an unsealed directory to record an amendment request in, so the build could continue
and SHIP could surface the request later. It was justified by the intake's own line that "a rule that
converts a self-healing build into an operator interrupt is not an improvement."

That justification is wrong. A mechanism whose purpose is to let BUILD record a DECIDE-owned decision
*without going to DECIDE* is a bypass of DECIDE wearing the costume of a ledger. It re-creates the
exact failure this issue exists to end — a DECIDE-scope mutation handled outside DECIDE — while adding
an artifact directory, a write-guard exception, a parser, and a SHIP gate to maintain. The correct
response to "BUILD found something DECIDE missed" is to send it to DECIDE, not to invent somewhere
else to put it.

Liveness is protected by making the path rare rather than by routing around it: `conflict-check`
already detects falsified assertions before `plan` runs, and §1 makes it act on that detection. The
mid-BUILD case is the residue after that detector has run, and a residue that needs a human is
acceptable where a bypass is not.

### 6. The fail-closed guarantee needs no new machinery

The intake asks that the corpus never *silently* contradict shipped behavior. It already cannot. If
DECIDE fails to amend a falsified assertion and BUILD then edits it, the seal halts loudly and names
the path — that halt is the fail-closed backstop, and this ADR leaves it unchanged. If BUILD does not
edit it, `build_review`'s existing Scope rubric judges DECIDE-artifact modifications against the
approved plan (per `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`).

No new SHIP gate, no new `finish` predicate. The guarantee the intake wants is the one the seal
already provides; what was missing was a sanctioned way to satisfy it, which is §1.

## Alternatives considered and rejected

**Enforcement alone (the filer's hypothesis).** Cross-check `**Files:**` against the sealed set and
reject. Rejected as incomplete on the filer's own reasoning: applied to the observed incident it would
have blocked the plan with no sanctioned way to produce an amendment the change genuinely needed. It
is half of this decision, not a decision.

**A BUILD-writable amendment ledger / deferred request.** Rejected — see §5. This is the bypass the
issue is about.

**Loosen the seal — tolerate any amendment the plan explicitly declares.** Rejected: it converts the
seal from tamper detection into a declaration checkbox, and any BUILD session that can write a plan
can write itself the permission. #1254's stated desired outcome is the exact opposite.

**Amend via an operator-approved reseal.** Rejected: it depends on #1281 shipping a command that does
not exist, the rotation predicate refuses feature-authored changes by construction
(`protected-artifact-seal.ts:704-707`), and it puts a human in the loop for *every* amendment — the
checkpoint `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` already removed once.

**A superseding-artifact convention instead of in-place notes.** Mirrors the ADR supersession rule in
`conflict-check`. Rejected for stories: a superseding story file fragments one assertion across two
documents, and the corpus already uses in-place dated notes in over a dozen places.

## Consequences

- The observed incident becomes impossible in two independent ways: the mutation happens before BUILD
  exists, and a plan that tries to task it is rejected at authoring and again at land.
- A mid-BUILD discovery in daemon mode reaches the operator gate. This is accepted, not worked around.
  Its frequency is bounded by `conflict-check` acting at DECIDE time.
- No new artifact directory, no new write-guard exception, no new SHIP gate. The net machinery added
  is one scan, one land-gate call, and skill text.
- The rule narrows what a plan may contain. Enforcement is at authoring and land, not retroactive over
  merged plans.
- #1281 remains worth shipping as an operator escape hatch, but no longer blocks amendment work.

## Verify-Claims Verdict

Load-bearing claims and their basis:

- Sealed directory set is a hardcoded four-entry list, not config — **verified**,
  `protected-artifact-seal.ts:17-22`.
- Own-feature amendments are tolerated and reported rather than halting — **verified**, `:624-626`
  and `:508-511`.
- The seal baseline is written at first BUILD entry — **verified**, `createProtectedArtifactSeal`
  called from `conductor.ts:4677`.
- Daemon-mode DECIDE kickbacks reach an operator gate — **verified**, `kickback-policy.ts:7-23`.
- No reseal command is reachable from the CLI — **verified**, no match for reseal/rotate across
  `bin/`, `cli.ts`, `cli-builtins.ts`; `index.ts` re-exports nothing from the seal module.
- `conflict-check` already emits `Required Amendments` before `plan` runs — **verified**, read at
  `.docs/conflicts/build-repair-preserves-stale-wiring-pass-and-halts.md:60-64`, with step ordering
  confirmed in `steps.ts` (`conflict_check` at 99, `plan` at 109).
- The dated-note convention is in use but codified nowhere — **verified**, present in a dozen
  `.docs/stories/` files and named "established" in three artifacts; absent from all of `skills/`
  and `docs/`.
- Codex bypasses the Claude-only docs write-guard — **inferred, 95%**, from #1254's recorded
  observation rather than a reproduction here. Impact if wrong: none to this design, which places
  every check engine-side regardless.

No unconfirmed load-bearing assumption remains.
