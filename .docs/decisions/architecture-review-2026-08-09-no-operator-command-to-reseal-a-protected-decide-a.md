# Architecture Review: Operator-audited reseal of a protected DECIDE artifact (#1281)

**Date:** 2026-08-09
**Mode:** full pass (pre-stories), lightweight per Medium tier — §2 Feasibility + §4 Alignment
**Stem:** `no-operator-command-to-reseal-a-protected-decide-a`
**Track:** technical (no PRD; acceptance criteria live in stories)
**Tier:** M
**Stories reviewed:** none yet — this review runs before `/stories`, against the technical intent
in `.docs/track/` and the approach in `.docs/architecture/`
**Verdict:** APPROVED WITH CONDITIONS

Sections 3 (Complexity), 5 (Domain Integrity Pre-Check) skipped per Lightweight Mode; complexity
was already assessed at `.docs/complexity/no-operator-command-to-reseal-a-protected-decide-a.md`.

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | Clean. No new dependency, service, or infrastructure. Every primitive needed — content fingerprinting, atomic tmp+rename write, audit-trail append, HALT marker preservation, TTY detection — already exists in-repo. |
| **Prerequisites** | None external. The refactor of `rotateProtectedArtifactSeal`'s writer tail must land before or with the scoped head. |
| **Integration surface** | Four modules: `protected-artifact-seal.ts` (refactor + new head + guard), `cli.ts`/`index.ts` (verb declaration + pre-boot dispatch), `types/events.ts` + `event-sinks.ts` + `daemon-cli.ts` (audit variant), `halt-marker.ts`/`daemon-rekick.ts` (marker retirement, reuse only). Below the 3-boundary flag only because the event trio is one concern. |
| **Data implications** | No schema migration. Additive only: two `ConductorEvent` variants, an additive `rebaselines[]` entry, and a widening of the audit record's origin field. The seal file's `version: 2` shape is unchanged — a scoped reseal produces a structurally identical seal. |
| **Performance risk** | None. A single non-interactive command over a bounded set of `.docs/` files. |
| **Worktree isolation** | Clean, and central to the design: the command is scoped to one resolved worktree's `.pipeline/`. No shared state, no ports, no databases. Two worktrees resealing concurrently touch disjoint paths, and the audit trail's `appendFileSync`/O_APPEND tolerates concurrent appenders by construction (`audit-trail.ts:44-46`). |

### Verified claims (verify-claims protocol)

| Claim | Basis | Confidence |
|---|---|---|
| `rotateProtectedArtifactSeal` re-fingerprints **all** protected artifacts; its `paths` argument constrains nothing | verified — `:911` calls `createSeal()` at `:486`; `paths` appears only in the `rebaselines` entry | 97% |
| `inspectSeal` (verification) never reads `seal.baselineCommit` | verified — read of `:615-720`; it compares against `seal.protectedArtifacts` only | 95% |
| Automatic rotation is refused when the baseline is an ancestor of HEAD, so it fires only on history rewrite | verified — `evaluateProtectedArtifactSealRotation` `:292` returns `same-history-ancestor` | 95% |
| Heads read content **at a commit**, never from the workspace | verified — `createSeal` uses `contentAtCommit` `:491` | 97% |
| `PROTECTED_ARTIFACT_HALT_CLASS = 'protected-artifact'` already exists as the halt classifier | verified — `halt-marker.ts:20` | 97% |
| The worktree audit trail exists and tolerates concurrent appenders | verified — `audit-trail.ts:43-46`, `appendFileSync` with `flag: 'a'` | 95% |
| TTY-based operator detection is an established in-repo pattern with an injectable seam | verified — `intake-file-cli.ts:63`, `daemon-supervisor-cli.ts:217`, `install-freshness.ts:216` | 95% |
| A step's provider subprocess runs with piped (non-TTY) stdio, so the TTY gate discriminates it from an operator | **inferred** — consistent with the daemon's non-interactive execution model, but not directly observed | 75% |

The one inferred claim is load-bearing for the third operator-only layer and is carried as
**Condition 1** rather than assumed.

## Alignment

**Domain boundaries.** Respected. The seal module keeps ownership of all fingerprint and seal-file
semantics; the CLI layer owns only argument parsing, the TTY gate, and marker retirement. No new
coupling: the CLI depends on the engine, never the reverse.

**Pattern consistency.** Follows the `decide-grant` precedent exactly (detect/dispatch pair,
pre-boot dispatch, operator-only) — the closest existing analogue, and itself an operator escape
hatch. HALT retirement reuses `daemon-rekick.ts`'s preserve-then-remove sequence rather than
introducing a second way to retire a marker.

**State management.** The seal's state model is unchanged; no new state machine, no boolean flags
standing in for an enum. The `baselineCommit` question — the sharpest correctness risk flagged for
this review — is settled explicitly in
`adr-2026-08-09-operator-only-scoped-artifact-reseal` §3 rather than left implicit: it advances,
and the unlisted-drift guard is the invariant that makes the advanced baseline truthful for the
entries the reseal did not touch.

**Diagram accuracy.** `.docs/architecture/no-operator-command-to-reseal-a-protected-decide-a.md`
matches this review; all 3 Mermaid blocks parse-check clean. Its one deliberately-open question
(audit write location) is now closed by
`adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`.

**Security boundaries — the material finding of this review.** #1281 requires reseal be "never
something a daemon step can invoke". The design as proposed to this review relied on *not
registering a step* plus pre-boot dispatch. **That is necessary but not sufficient:** a build agent
holds a Bash tool and can shell out to `conduct reseal` directly, which no amount of step-registry
absence prevents. Per this repository's Design Principle, "agents shouldn't run this" is prompt
discipline; a mechanism that refuses is machinery. The ADR therefore adds a third, deterministic
layer — an interactive-terminal gate behind an injectable seam. Also enforced: a mandatory
non-empty `--reason`, and refusal on a dirty protected-artifact workspace.

**Event-spine compliance.** Checked before the design was written down, per `CLAUDE.md`. Verdict:
extend the union, route via the existing `EVENT_SINKS` table to the existing worktree audit trail.
No parallel channel, no bespoke sidecar. Exceptions A and B were tested against the code and found
not to apply.

**Production DI defaults.** Not applicable — no DI registrations, no in-memory stores.

## Wiring Surface

| New production surface | Wired into |
|---|---|
| Shared seal writer (extracted, internal) | Called by both heads inside `protected-artifact-seal.ts`; `rotateProtectedArtifactSeal` becomes a thin caller, preserving its existing engine call sites in `rebase.ts` and `conductor.ts`. |
| Scoped reseal head + unlisted-drift guard (exported) | Called by the reseal dispatcher below. Not reachable from any step runner — deliberately. |
| `detectResealCommand` (exported) | Declared in `cli.ts`'s command table beside `decide-grant`/`plan-protected-targets` so `--help` lists it; parse-only, no I/O. |
| `dispatchResealCommand` (exported) | Invoked from `index.ts`'s pre-boot dispatch chain, in the same position as `dispatchDecideGrantCommand` (`index.ts:526`) — before the pipeline boots. |
| Reseal + reseal-refused `ConductorEvent` variants | Declared in `EVENT_SINKS` (`event-sinks.ts`); routed to the persister and, for the performed variant, to `AuditTrailWriter`; rendered in `daemon-cli.ts` beside the existing `protected_artifact_rebaseline` cases. |
| Audit-record operator origin (widened field) | Consumed by `AuditTrailWriter.record` and every existing audit-record reader; the sweep is a follow-up action on the audit ADR. |
| `--clear-halt` marker retirement | Reuses `halt-marker.ts`'s `PROTECTED_ARTIFACT_HALT_CLASS` predicate and `daemon-rekick.ts`'s preserve-then-remove sequence; gated, not unconditional. |

Design-time commitments only — no `file:line` citations are claimed, since the code does not exist
yet. This section does not substitute for the §12 as-built reachability sweep at SHIP.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A build agent shells out to `conduct reseal` via Bash, defeating operator-only | Security | Medium | **High** | TTY gate behind an injectable seam (ADR §4, layer 3); mandatory `--reason`; no step registration; pre-boot dispatch. Validation of the non-TTY assumption is Condition 1. |
| The refactor silently changes `rotate`'s behavior on the automatic rebase path | Technical | Low | **High** | Pin `rotate`'s current behavior with tests written before the extraction; `rotate` must keep supplying the unchanged `createSeal()` head. |
| The unlisted-drift guard defines "drift" differently from `inspectSeal`, so reseal passes while verification still halts | Technical | Medium | High | ADR §2 requires the guard be expressed in `inspectSeal`'s classification, reusing its base-inheritance tolerance — one definition, one code path. |
| Advancing `baselineCommit` interacts badly with a later rebase rotation | Data | Low | Medium | Verified: rotation refuses on `ancestor`, fires only on history rewrite, and then recomputes everything from the new commit — the scoped state is correctly superseded. |
| The audit-record origin widening breaks a consumer that assumes `step` is a real step | Technical | Medium | Medium | Sweep all `AuditRecord` consumers as an explicit follow-up; sentinel step names are rejected by the audit ADR precisely to force the sweep rather than hide the problem. |
| Operator resealing a dirty workspace expects the workspace content to be sealed | Knowledge | Medium | Medium | Heads read at a commit; reseal refuses on dirty protected-artifact state and says so. Runbook must state commit-first. |

## ADRs Created

- `adr-2026-08-09-operator-only-scoped-artifact-reseal` — shared writer + two heads; the
  unlisted-drift guard expressed in `inspectSeal`'s terms; `baselineCommit` advances; operator-only
  enforced by three independent mechanisms. Categories: Cross-Cutting Concerns (authorization),
  Domain Architecture (module seam).
- `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` — the audit entry is a
  `ConductorEvent` variant routed by the existing `EVENT_SINKS` table into the existing worktree
  audit trail; no sidecar, no new ledger. Category: Cross-Cutting Concerns (observability).

Both are `Status: APPROVED` following operator review.

## Conditions

Verdict is **APPROVED WITH CONDITIONS**. Proceed to `/stories`; these are tracked into the plan and
checked at code review and `/finish`.

1. **Validate the non-TTY assumption before relying on it.** The claim that a step's provider
   subprocess presents non-TTY stdio is *inferred* (75%), not observed. BUILD must confirm it
   against the real execution path and cite the evidence. If it proves false, the third
   operator-only layer must be replaced (an explicit in-band marker the engine sets for step
   subprocesses is the fallback) — the layer may not simply be dropped, since layers 1 and 2 do not
   stop a Bash shell-out.
2. **Pin `rotate`'s behavior before extracting the writer.** A test asserting the current
   recompute-everything behavior must exist and pass before the refactor, and still pass after.
3. **The unlisted-drift guard must reuse `inspectSeal`'s classification**, not a fresh fingerprint
   comparison. A divergent second definition of drift is a blocking code-review finding.
4. **Sweep every `AuditRecord` consumer** when the origin field widens. No sentinel `StepName`.
5. **Documentation lands in the same PR** — `docs/runbooks/stalled-or-stuck-feature.md:694-733`
   replaced with the command (including commit-first), and `docs/reference/cli.md` documenting the
   flags. Per `CLAUDE.md`, the PR is not complete while either is stale.

## Overlap Scan

Advisory only; does not affect the verdict.

`conduct-ts overlap-scan` was run over this review's Wiring Surface paths with
`--source-ref jstoup111/ai-conductor#1281`. **No open blockers** were reported on the source ref.

The sibling-branch overlap output is **not usable as a signal here**: a single-file scan of
`src/conductor/src/engine/protected-artifact-seal.ts` reported 242 overlapping `spec/*` branches,
and every path in the Wiring Surface matched nearly every open branch. That is the expected result
when many unmerged spec branches diff against a base that predates shared core files — it reports
co-presence in a diff, not genuine contention. Recorded as observed rather than interpreted; the
real collision risk for this feature is judged instead from the two named related issues
(#1229 sharing the reseal primitive, #1254 removing the common trigger), both of which are
additive rather than conflicting.

There is one genuinely adjacent branch worth naming for `/conflict-check` to weigh:
`spec/protected-artifact-seal-cannot-distinguish-legitim`, which by title addresses the same
classification surface (`inspectSeal`) that Condition 3 requires this feature to reuse.
