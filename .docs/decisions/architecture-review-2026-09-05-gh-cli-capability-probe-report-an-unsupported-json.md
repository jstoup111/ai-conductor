# Architecture Review: `gh` version floor and machine-level environment gate

**Date:** 2026-09-05
**Source:** jstoup111/ai-conductor#2139
**Tier:** Medium — lightweight mode (§2 Feasibility + §4 Alignment; §3, §5, and mandatory-ADR
skipped per the skill's Medium-tier rule)
**Stories reviewed:** none yet — this review runs pre-stories per
adr-2026-06-29-architecture-before-stories-convergent-kickback
**Verdict:** APPROVED WITH CONDITIONS

## Scope boundary (binding, from `.docs/track/`)

Declare a minimum `gh` version and gate on it at the machine level; translate the unsupported-field
error into a typed capability error at the canonical seam; state the floor in `README.md` and the
five `docs/` prerequisite tables. Excluded: a per-field capability registry, a `conduct doctor`
command, and closing the `worktree.ts:186` seam bypass. No expansion beyond this was taken.

## Feasibility

| Check | Assessment |
|---|---|
| **Stack compatibility** | No new dependency. `gh` is already a declared prerequisite; this declares a version of it. Version comparison is a small pure function. |
| **Prerequisites** | None external. Operators below v2.73.0 must upgrade — that is the feature. |
| **Integration surface** | Three surfaces: the canonical `gh` seam (`tracker-client.ts`), the daemon dispatch cycle, and the DECIDE/engineer entry. All three are existing seams with governing ADRs; none is created here. |
| **Data implications** | None. No schema, no migration, no persisted state beyond an in-memory gate condition. |
| **Performance risk** | One `gh --version` subprocess per dispatch cycle check. Negligible against a cycle that dispatches an LLM build. |
| **Worktree isolation** | Unaffected. The gate is a machine-level property read identically from any worktree; it introduces no port, database, file path, or queue. |

**Feasible.** The one genuinely uncertain element is `gh --version` output parsing, which
Decision 8 gates with a real-binary smoke rather than assuming.

## Alignment

**Domain boundaries.** The change respects them. Version knowledge lives in one constant; the
probe is its own unit; the gate consumes a pure verdict. No caller learns about versions.

**Pattern consistency.** Three existing patterns are reused rather than re-invented: the
dispatch-preventing waiting condition (`adr-2026-07-22-daemon-level-missing-credential-gate`), the
guarded injectable runner (`adr-2026-07-22-canonical-tracker-client-seam`), and routing on typed
result kind rather than reason text (`adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`
D1).

**Convention over precedent.** Three preflights in the corpus degrade rather than block
(`adr-2026-07-20-ci-fix-startup-preflight`, `adr-2026-07-29-codex-readiness-probe-failure-disposition`,
`adr-2026-07-04-auth-failure-park-and-poll` D4). This design does not follow them, deliberately:
each governs a capability whose absence degrades one feature of the run, whereas `gh` below the
floor makes every ship path unable to complete. The governing precedent for a *global* missing
precondition is the credential gate, and that is the one followed.

**State management.** The gate verdict is a closed discriminated set
(`ok | below-floor | unparseable | absent`), not a boolean pair — invalid combinations such as
"present but also absent" are unrepresentable. `unparseable` is deliberately distinct from
`below-floor` so an unrecognized `gh --version` shape cannot silently read as compliant.

**Diagram accuracy.** `.docs/architecture/gh-cli-capability-probe-report-an-unsupported-json.md`
and its sequence file were regenerated for this design after the ADR sweep; both render clean under
`ai-conductor render-diagrams --check`.

**Security boundaries.** No new endpoint, input, or credential. The probe reads a version string
from a binary the harness already executes.

**Production DI defaults.** The probe's production default is the real guarded `gh` runner; the
injected variant exists for tests only. No `InMemory*`/`Fake*`/`Stub*` is a production default.

## Wiring Surface

| New production surface | Where it is called from in production |
|---|---|
| `GH_VERSION_FLOOR` constant | Read by the floor check; rendered into the waiting-condition text. |
| `parseGhVersion` (pure) | Called by the floor check only. |
| `checkGhVersionFloor` (pure) | Called from the daemon dispatch-cycle gate and from the DECIDE/engineer entry check. |
| Injectable version probe | Constructed by `runDaemonMode` in `daemon-cli.ts` and by `dispatchEngineer` in `engineer-cli.ts`; production default is the guarded `gh` runner. |
| Daemon environment waiting condition | Consumed by the existing daemon dispatch cycle that already renders waiting conditions for `adr-2026-07-22-daemon-level-missing-credential-gate`; surfaced through the existing daemon status/log path. |
| Typed `GhCapabilityError` | Produced inside the wrapper returned by `makeProductionGh()` in `tracker-client.ts`; observed by existing `gh` callers, which keep their current dispositions. |

Design-time commitments only; §12's as-built sweep verifies real `file:line` callers at SHIP.

## Early overlap scan (advisory)

`ai-conductor overlap-scan`, run per-path over the Wiring Surface paths, against a baseline of
**312 unmerged spec branches** (295 local, 17 remote):

| Path | Overlapping branches | Share of baseline |
|---|---|---|
| `README.md` | 285 | 91% |
| `src/conductor/src/daemon-cli.ts` | 284 | 91% |
| `src/conductor/src/engine/shipment-evidence.ts` | 279 | 89% |
| `src/conductor/src/engine/engineer-cli.ts` | 272 | 87% |
| `src/conductor/src/engine/finish-record-cli.ts` | 184 | 59% |
| `src/conductor/src/engine/tracker-client.ts` | 144 | 46% |

Advisory only; it does not affect the verdict. Read honestly, the scan has almost no discriminating
power here: nearly every unmerged branch touches nearly every core engine file, so no path in this
feature's surface is unusually contended relative to the others — the two files this feature edits
most invasively are in fact the *least* contended of the six. The actionable reading is about the
backlog, not this feature: with 312 unmerged spec branches, any engine change carries substantial
rebase cost, which is an argument for keeping every edit here minimal — a thin wrapper around the
existing `gh` factory rather than any restructuring of the seam — and for landing promptly.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `gh --version` output shape differs from the assumed `gh version X.Y.Z (…)` across the supported range, so the parser misreads or throws | Integration | Medium | High | Condition 1: real-binary smoke before landing. `unparseable` is a distinct verdict that refuses rather than passing. |
| A blanket disposition in the seam wrapper silently flips a caller from fail-open to fail-closed or the reverse, contradicting an APPROVED ADR | Technical | Medium | High | Decision 6: the wrapper changes error type and text only. Condition 2 makes this a named story with a negative-path criterion on both dispositions. |
| The probe shells out under `AI_CONDUCTOR_NO_REAL_EXEC`, so daemon-boot and engineer-dispatch tests attempt real execution | Technical | High if unaddressed | Medium | Decision 4: injectable probe calling `assertRealExecAllowed`. |
| A consumer later matches `Unknown JSON field` text rather than the error class, re-creating the brittleness this replaces | Knowledge | Low | Medium | Decision 5 states the rule; the typed class makes the class check the easier path. |
| The floor goes stale when the harness adopts a field or command newer than v2.73.0 | Knowledge | Medium | Medium | Accepted and recorded as a Negative consequence; derivation machinery noted as a follow-up, out of scope here. |
| Rebase cost on `tracker-client.ts` given 144 overlapping branches | Integration | High | Low | Thin wrapper, minimal diff surface in that file. |

No unmitigated High-impact risk remains.

## ADRs Created

`adr-2026-09-05-gh-cli-version-floor-and-environment-gate.md` — **APPROVED** by the operator on
2026-09-05.

**Structural prerequisite applied.** This establishes an integration pattern: the external `gh`
CLI seam gains a declared version contract and a typed capability error at its boundary. That is
an uncovered structural decision — an exhaustive sweep of all 551 files in `.docs/decisions/`
confirmed no ADR declares any `gh` version floor.

**Governing-ADR reuse check applied.** Ten APPROVED ADRs govern parts of this design and are cited
and reused rather than duplicated: `adr-2026-07-22-canonical-tracker-client-seam`,
`adr-2026-07-22-daemon-level-missing-credential-gate`, `adr-2026-07-07-finish-record-primitive`,
`adr-2026-07-03-halt-pr-rehabilitation-at-finish`, `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`,
`adr-2026-08-06-bounded-progress-allowance-for-finish-publication`,
`adr-2026-07-28-total-halt-classification-legacy-boundary`, `adr-2026-08-03-fail-closed-decide-entry`,
`adr-2026-08-01-multi-proof-park-deletion-authority`, and
`adr-2026-07-07-daemon-owned-build-credential`. No existing ADR is superseded or amended.

## Conditions

1. **Real-binary smoke on `gh --version` parsing before this lands.** Required by
   `adr-2026-07-07-daemon-owned-build-credential` decision 5 for any claim about installed-CLI
   behavior. It is the one unverified row in the ADR's evidence table.
2. **Per-call-site disposition is a named story with negative-path criteria.** Stories must assert
   that `finish-record-cli.ts` still fails closed and the finish completion gate still fails open
   after the wrapper is introduced. Decisions 6 and `adr-2026-07-03-halt-pr-rehabilitation-at-finish`
   D3 are contradicted by any blanket policy.
3. **No downstream consumer matches gh's error text.** Class checks only, per Decision 5.
4. **No `mechanical` halt class on this path.** `needs-human` only, per Decision 7.
5. **`HARNESS.md` is not edited.** `adr-2026-07-03-version-gate-semver-escalation` rule 3
   escalates any `HARNESS.md` change to a MINOR HALT in the self-build. The documented floor
   belongs in `README.md` and `docs/`, which rule 4 admits as PATCH.
6. ~~**The ADR reaches `Status: APPROVED` before `/stories`.**~~ Satisfied 2026-09-05: the
   operator approved it during this review.

## Sequencing note

`adr-2026-08-08-finish-human-required-halt-rendering` records `finish-publication.ts` as declared by
~29 unmerged spec branches, and the live 2026-09-05 review for #2190 touches the same halt/retry
seams. This feature does not modify `finish-publication.ts` or the retry router, so the collision
surface is limited to `tracker-client.ts`; sequence behind #2190 if both are in flight.
