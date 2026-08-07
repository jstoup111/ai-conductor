# ADR: One fail-closed DECIDE-entry policy, consulted at every navigation seam

**Status:** APPROVED
**Date:** 2026-08-03
**Issue:** jstoup111/ai-conductor#550
**Track:** technical (no PRD)
**Tier:** L
**Architecture:** `.docs/architecture/daemon-autonomous-runs-must-fail-closed-on-any-amb.md`
**Supersedes in part:** `adr-2026-07-27-daemon-decide-kickback-halt.md` (#551) — that ADR's
predicate is widened and its fail-open default is reversed; its two call sites are preserved.

## Context

The engineer owns DECIDE; the daemon builds merged specs (ADR-008). #551 closed the two
**backward**-navigation seams. Its own *Alternatives considered and rejected* section recorded
the rest as this issue's work: "Couple to #550's forward-walk seam … `PRESEEDED_DONE` is a
*status preseed* in `daemon-cli.ts`, not a dispatch predicate", and its review lists "The
forward-walk dispatch guard is #550" under **Out of scope**.

Five defects remain, and every one of them **fails open**:

0. **The daemon's preseed asserts satisfaction it never checked.** `preseedStepStatuses`
   (`daemon-cli.ts:362-372`) stamps every DECIDE step `done`/`skipped` from the step table alone.
   No artifact is read. Delete `.docs/stories/<slug>.md` and the daemon walks past `stories` into
   BUILD — no dispatch, but no halt and no signal either. The issue's own observable test
   ("delete a spec artifact and watch the daemon halt") fails today.
1. **The forward walk has no phase guard.** `conductor.ts:3081-3088` skips only on persisted
   status (`done`/`skipped`); the sole daemon-conditioned skip in the loop is `retro`. Any
   autonomous run whose state has a DECIDE step `pending`/`failed`/`stale` — precisely the
   reconstructed-state scenario #550 was filed from — dispatches the authoring skill. The
   artifact check runs *after* dispatch (`conductor.ts:4984-4989`).
2. **The resume clamp can land on DECIDE.** `earliestUnsatisfiedGateIndex` clamps backward to
   `topo.regionStart`, which is the first `kickbackTarget` — a DECIDE step.
3. **An unresolvable target routes.** `decideKickbackDisposition` reads
   `steps.find(...)?.phase`; when that is `undefined` it returns `route`. A fail-open default
   sitting on an authorization boundary.
4. **An unknown remediation disposition silently becomes `build`.**
   `earliestRemediationTarget` (`conductor.ts:7995-8009`) skips any gap whose `disposition`
   matches no step (`idx < 0`) and returns its `'build'` initializer — an unresolvable target is
   not merely routed, it is routed *somewhere it was never asked to go*, and dispatches a
   provider. Symmetrically, `scanKickbackVerdicts` iterates only `topo.kickbackTargets`, so a
   verdict naming an unknown or custom target is dropped without a trace.

Coverage today is four of the nine DECIDE steps, on backward paths only. `explore`,
`complexity`, `architecture_diagram`, `conflict_check`, and `coherence_check` are guarded
nowhere.

## Decision

### D1 — One predicate, widened, with the default reversed

Rename `engine/kickback-policy.ts` to `engine/decide-entry-policy.ts` and widen its export:

```ts
export type DecideEntryDisposition =
  | { kind: 'enter'; grantedBy: string }      // operator-directed only
  | { kind: 'fast-forward'; as: 'done' | 'skipped' }
  | { kind: 'halt'; halt: DecideEntryHalt };  // always class 'needs-human'

export function decideEntryDisposition(input: {
  target: StepName;
  steps: StepDefinition[];
  daemon: boolean;
  tier: ComplexityTier | undefined;
  hasContract: boolean;
  satisfied: boolean | 'unknown';
  grant: OperatorGrant | null;
  sourceGate: StepName | 'forward-walk' | 'resume-clamp';
  evidence?: string;
}): DecideEntryDisposition;
```

Rules, in order:

1. `daemon === false` → `enter` (interactive DECIDE authoring is legitimate and unchanged).
2. Target resolves to no step in `steps`, **or** its `phase` is `undefined` → `halt`. This is
   the reversed default and the heart of the change.
3. `phase !== 'DECIDE'` → `enter` (known BUILD targets stay autonomously routable).
4. Step is `skippableForTiers` for the resolved tier → `fast-forward` as `skipped`.
5. Step declares **no completion contract** (`hasContract === false`) → `fast-forward` as
   `skipped`. See "contract-less DECIDE steps" below — this rule prevents over-blocking and is
   still fail-safe, because a fast-forward dispatches nothing.
6. `satisfied === true` → `fast-forward` as `done`.
7. A valid, in-scope operator grant names this step → `enter`, and the grant is consumed.
8. Otherwise (`satisfied === false`, or `'unknown'` from a predicate that threw) → `halt`.

Rule 2 preceding rule 3 is deliberate: an unresolvable target's phase is unknown, so it can
never be proven to be a safe BUILD target.

**Contract-less DECIDE steps (rule 5).** `explore` and `complexity` have empty
`STEP_ARTIFACT_CONTRACTS` entries, so `stepHasCompletionCheck` is false and their satisfaction
is not merely unknown — it is *unknowable*, because no artifact was ever required. Folding them
into rule 8 would halt every daemon build on `explore`. They must be distinguished from a step
that *has* a contract whose check failed or threw, which is a genuine ambiguity and does halt.
The distinction is structural (`hasContract`), computed from the step table, not a name list.
Fast-forwarding them still satisfies the invariant: the danger #550 names is *dispatching an
authoring session*, and a fast-forward dispatches nothing. (`complexity` additionally computes
in-process under `mode: 'auto'`, which is the daemon's mode, so it never reached a provider
anyway.) Giving `explore` a real contract — its `.docs/track/<stem>.md` marker is the obvious
candidate — is a worthwhile follow-up but is deliberately **not** in this scope; it would change
which specs are buildable, which is a discovery-eligibility change, not a guard.

The predicate stays pure and I/O-free. Phase, tier-skippability, `hasContract`, and satisfaction
are all passed in; the predicate never reads disk. Phase is resolved from the passed
`StepDefinition[]`, never a hardcoded name list, so config-added custom DECIDE steps are covered
without an edit.

### D2 — Retire the DECIDE preseed; the engine becomes the single satisfaction authority

`PRESEEDED_DONE` reduces to `['worktree', 'memory']`. DECIDE steps are no longer stamped by the
CLI bootstrap. Their resolution moves wholly into the policy, which decides
`fast-forward(skipped)` / `fast-forward(done)` / `halt` from a real artifact check.

This follows the single-satisfaction-authority principle already established by
`adr-2026-07-11-verdict-aware-resume-entry`. Two authorities is how gap 0 arose: the bootstrap
asserted `done`, and the engine believed it.

Satisfaction is answered by the existing `checkStepCompletion` artifact predicate — the same one
discovery and the post-dispatch check already use. It is file I/O only. **No provider session and
no LLM call is added to the healthy path**, which is the issue's explicit negative-path
requirement.

Moving tier resolution out of the preseed also settles an existing divergence: the preseed
defaults an unresolved tier to `'M'` (`daemon-cli.ts:363`) while the forward loop defaults it to
`'L'` (`conductor.ts:3091`). Today this is inert — every `skippableForTiers` entry in
`steps.ts` is `['S']` or `[]`, so `M` and `L` behave identically — but two defaults for one
question is how the next defect gets in. The engine's `'L'` becomes the single resolution, which
is also the conservative one: `L` skips nothing.

### D3 — Enforce at four seams, not inside `navigateBack`

Consult the predicate at:

- **the forward walk** (`conductor.ts:3081`), before the dispatch decision;
- **the resume clamp** (`conductor.ts:7812` / `selector.ts:130`), on the clamped-to index;
- **`scanKickbackVerdicts`** (`conductor.ts:7055`), preserving #551's ordering exactly — counter
  bump → event emit → cap check → policy → `navigateBack`;
- **`planRemediation`** (`conductor.ts:2011`), via `earliestRemediationTarget`.

Not inside `navigateBack`: it is shared with the rebase-invalidation re-open and the
deterministic BUILD kickbacks, so enforcement there would over-block. #551's F4 reasoning is
unchanged and still binding.

### D4 — Unresolvable targets must be reported, not defaulted

`earliestRemediationTarget` changes signature to surface what it could not resolve:

```ts
export function earliestRemediationTarget(
  fixes: RemediationGap[],
  steps: StepDefinition[],
): { target: StepName; unresolved: string[] };
```

A non-empty `unresolved` makes `planRemediation` halt naming those dispositions; it never
silently falls back to `'build'`. Likewise `scanKickbackVerdicts` scans **all** persisted
verdicts for a `kickback.from === stepName`, not just those keyed to `topo.kickbackTargets`, so a
verdict naming an unknown or custom target is detected and halts instead of vanishing.

### D5 — The HALT payload is a contract, not a string

Every halt from this policy renders the five fields the operator comment requires:

```
DECIDE entry refused — autonomous run may not enter DECIDE without operator direction.

Source gate:       <gate that requested the move, or forward-walk / resume-clamp>
Requested target:  <step name as requested, verbatim, even if unresolvable>
Evidence:          <kickback evidence / remediation gap ledger / missing artifact path>
Why refused:       <phase unresolvable | target unknown | artifact unsatisfied | no grant>
Operator choices:  <direct a return to a named step | correct the routing target |
                    reject the kickback>
```

Written with `writeHaltMarker(projectRoot, body, 'needs-human')`. The class is load-bearing:
`rekickSweep` (`daemon-rekick.ts:173-193`) skips `needs-human` on every sweep. A guard whose
HALT the daemon auto-clears is not a guard.

### D6 — The operator grant is explicit, scoped, single-use, and never inferred

`conduct decide-grant --slug <slug> --step <step> --reason "<why>"` writes
`.pipeline/decide-grant.json`:

```json
{ "version": 1, "step": "plan", "reason": "...", "grantedAt": "...", "grantedBy": "operator" }
```

Four properties, each load-bearing:

- **Explicit.** Only this command writes it. The daemon has no code path that creates a grant,
  so the invariant cannot self-grant.
- **Scoped to one step.** A grant for `plan` does not authorize `stories`.
- **Single-use.** Consumed (deleted) the moment the step is entered, so one grant cannot
  authorize a second autonomous DECIDE entry later in the run.
- **Independent of the HALT marker.** *Clearing the HALT is not a grant.* The standard recovery
  gesture is `rm -f .pipeline/HALT .pipeline/HALT.class`; if that alone re-permitted entry, the
  routine operator action would silently become an authorization. A cleared HALT with no grant
  re-halts immediately and identically.

## Consequences

- The daemon halts on a spec that was merged incomplete or damaged mid-flight, where it
  previously walked past into BUILD. This is the intended behavior change and will surface
  latent bad specs as HALTs on first contact. Discovery's existing warn-skip
  (`daemon-backlog.ts:755-806`) already filters most of these before they enter the backlog.
- Five seams share one predicate, so a future custom DECIDE step or new `kickbackTarget` is
  covered without touching any seam.
- `bin/conduct` gains a subcommand → the implementing PR needs a `## Migration` block per the
  repo's release gate.
- Interactive `/conduct` is provably unchanged: every rule past D1.1 is gated on `daemon === true`.

## Alternatives considered and rejected

**Keep the blind preseed and add only the dispatch guard.** Lower risk, and the guard would
still close the reconstructed-state hole. Rejected because it leaves gap 0 wide open: a missing
artifact is still stamped `done`, so the issue's own observable acceptance test ("delete a spec
artifact, watch the daemon halt") still fails. It would also leave two satisfaction authorities
in place — the exact condition that produced the defect.

**Make the preseed itself verify artifacts, leaving the engine unguarded.** Closes gap 0 with a
much smaller diff. Rejected because the CLI bootstrap runs once, at dispatch; it cannot protect
a run whose state is reconstructed or demoted mid-flight, which is the scenario #550 was filed
from. Enforcement must sit at the seam that acts, not at the seam that initializes.

**Treat a cleared HALT as the operator's direction.** No new CLI surface, no new file. Rejected
as actively dangerous: clearing a HALT is the routine, documented recovery gesture for *every*
halt class, so overloading it would convert an operator's ordinary cleanup into an unrecorded
grant of DECIDE authority — with no record of what was authorized or why.

**A `--allow-decide` daemon flag.** Simple and familiar. Rejected because it is run-scoped, not
step-scoped: it would authorize every DECIDE entry for the whole run, and it lives in the
daemon's own invocation, which makes it self-granting in exactly the way D6 forbids.
