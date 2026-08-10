---
Status: APPROVED
Date: 2026-08-09
Deciders: operator (James Stoup)
Feature: acceptance_specs RED evidence visibility and provenance (#1246)
---

# ADR: A remediation waiver of the RED requirement must be recorded, attributable and observable

## Status
APPROVED

## Relates to
`adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` (the lifecycle variant and marker
provenance this decision writes into) and `adr-2026-07-21-engine-owned-acceptance-red-execution`
(the execution seam, unchanged).

## Context

`skills/remediate/SKILL.md` routes a gap whose cause is missing or too-weak acceptance coverage to
the `acceptance_specs` disposition — "regenerate failing specs, then build" (`SKILL.md:83`,
`:159`). The intended shape is unambiguous: the regenerated specs must fail before implementation.

The run that produced #1246 did something else. Observed directly and quoted in the intake: the
same acceptance-spec session changed both acceptance tests and production files before reporting
GREEN. Under today's gate that combination is refused — `failed == 0` fails
`validateAcceptanceRedEvidence` (`artifacts.ts:1294-1299`) — but it is refused *anonymously*. The
engine cannot distinguish two situations that deserve opposite treatment:

- a session that quietly implemented the behavior alongside the spec, destroying the RED signal it
  was dispatched to produce; and
- a remediation that legitimately had to touch both, for a reason a human would accept.

Both surface as "0 failed — RED not established". The first is a defect that should stay refused.
The second has no way to state its case, so in practice it is worked around rather than recorded,
and the workaround leaves no trace an operator or a later reviewer can audit.

The gap is therefore not permissiveness. It is that a legitimate exception has no vocabulary, so
every exception is indistinguishable from a violation and none of them are observable.

### Assumptions surfaced

| Assumption | Confidence | Basis | Impact if wrong |
|---|---|---|---|
| `remediate` can route to `acceptance_specs` and does so for coverage gaps | 95% | verified — `skills/remediate/SKILL.md:83`, `:159` | If no such route existed, the exception would have no producer |
| A green acceptance run cannot pass the gate today under any path | 95% | verified — `artifacts.ts:1294-1299`, and the self-heal re-validates with the same function | If some path passed green, this ADR would be closing a hole rather than naming an exception |
| Legitimate combined test-and-production remediation genuinely occurs | 70% | inferred — from the single observed run in #1246; the intake reports it happened, not how often | If it never legitimately occurs, the exception is dead weight and the correct fix is to refuse harder |

The third assumption is the one worth watching. It is why the exception is designed to be *rare and
loud* rather than convenient: if it is never used, it costs nothing; if it is used often, its
records are exactly the evidence needed to revisit this decision.

## Decision

**A waiver of the RED requirement is valid only when it is recorded in the marker.** The exception
is a structured field carrying, at minimum: its kind (`remediation`), a non-empty reason stating
why RED could not be established separately, and the attribution identifying what authorized it.
`validateAcceptanceRedEvidence` accepts `failed == 0` **only** in the presence of a well-formed
exception; every other requirement (`errors == 0`, `skipped == 0`, `executed >= 1`) still applies,
because a waived RED requirement is not a waived *execution* requirement — the specs must still
have run.

**A waived pass is reported as waived, never as proven.** The `acceptance_red` event is emitted
with `state: satisfied` and `viaException: true`, and the live status line and the ledger both
carry that distinction. A waived step must never present the acceptance-spec lifecycle as
successfully proven — that is desired outcome 3 of the intake, and it is the reason the flag rides
the event rather than being folded into a boolean pass.

**An unrecorded green run stays rejected, with its reason unchanged.** The exception adds a way to
*declare*, not a way to *pass quietly*. The failure text for an unrecorded green run
(`0 failed — RED not established`) is deliberately untouched.

> **Amended 2026-08-09 by #1246:** a recorded exception must survive re-execution, which this ADR
> originally left unstated. Conflict-check found that `selfHealAcceptanceRed`
> (`acceptance-red-runner.ts:249-258`) composes the marker from the exec result plus the run
> contract and writes it **wholesale**, dropping every field it did not produce. The exception is
> the first *declaration* ever stored in what was until now a purely result-shaped artifact, so a
> self-heal firing after a remediation recorded one would silently erase it — and the step would
> then refuse a legitimately waived run with a reason describing a missing RED signal rather than a
> destroyed waiver.
>
> The decision is therefore extended with an explicit ownership rule: **the exec result owns
> observed counters; a recorded declaration survives re-execution.** Before writing, the self-heal
> reads any existing root marker and carries its `exception` forward. It never invents an exception
> where none was recorded, and it never repairs a malformed one into a well-formed one — a malformed
> exception must still be refused by the validator after a re-run. One artifact, one authoritative
> path, and the root-path rule of `adr-2026-07-21-engine-owned-acceptance-red-execution` is
> untouched. Carried by Story 8.
>
> Rejected here for the same reasons recorded in the conflict report: moving the exception to its own
> file (a second read for one verdict, and the parallel-channel trap), and forbidding self-heal
> whenever an exception is present (which would make a waived step unrecoverable from a missing
> marker).

**`skills/remediate/SKILL.md` states the obligation.** A remediation that will combine acceptance
and production changes declares the exception rather than performing the combination silently. The
prose must stay provider-neutral — `test/test_provider_skill_contracts.sh` rejects unscoped slash
commands and host-specific phrasing in shipped skills — and the corresponding consumer-facing rule
belongs in `HARNESS.md`, since `acceptance_specs`, the RED gate and `remediate` all ship to every
repository that installs the harness.

### Rejected alternatives

- **Let remediation runs skip the RED gate entirely.** Rejected: it converts a narrow, attributable
  waiver into a blanket bypass keyed on which step dispatched the work, which is exactly the
  property an auditor cannot verify after the fact.
- **Detect the combination heuristically** (e.g. refuse when a session's diff touches both spec and
  production paths). Rejected: it punishes legitimate cases without giving them a remedy, and it
  guesses at intent from file paths — the intent is precisely what a recorded exception states
  directly.

## Consequences

**Positive.** A legitimate exception becomes expressible, attributable, and visible on the same
spine as every other lifecycle occurrence. A reviewer can find every waived acceptance step by
reading the ledger. The gate's strength is unchanged for every unrecorded case.

**Negative.** A recorded exception is only as honest as its author; the engine validates shape, not
sincerity. This is the same accepted limit as `intentRationale` in the companion ADR — an
attributable, greppable claim is materially stronger than the silent workaround it replaces, and
weaker than a mechanical proof nobody has proposed.

**Operational.** Waived passes are worth watching. If they become common, that is evidence the
`acceptance_specs` remediation route itself needs redesign, and this ADR should be revisited rather
than the exception widened.
