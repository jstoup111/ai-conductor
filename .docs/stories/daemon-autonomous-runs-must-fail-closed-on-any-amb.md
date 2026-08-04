# Autonomous runs fail closed on ambiguous or unresolvable DECIDE entry

Status: Accepted

## Context

The engineer owns DECIDE; the daemon builds merged specs (ADR-008). #644 and #551 closed the two
**backward**-navigation seams, and #551's own review recorded the rest as this issue's work —
"The forward-walk dispatch guard is #550", listed under *Out of scope*.

What remains fails open in five distinct ways: the daemon's preseed stamps DECIDE `done` without
reading any artifact (`daemon-cli.ts:362-372`); the forward walk branches on persisted status
only, with no phase guard (`conductor.ts:3081-3088`); the verdict-aware resume clamp can land on
a DECIDE step; an unresolvable kickback target returns `route` (`kickback-policy.ts:12-20`); and
an unknown remediation disposition silently becomes `'build'` (`conductor.ts:7999-8008`).

The operator's clarification on #550 sets the invariant: *an autonomous run may enter DECIDE only
when the operator has explicitly directed it; any ambiguous or unresolvable phase or target must
fail closed with a `needs-human` HALT and must not route or dispatch.* Known BUILD targets stay
autonomously routable, and healthy already-satisfied DECIDE artifacts still fast-forward without
a provider dispatch.

Design: `.docs/decisions/adr-2026-08-03-fail-closed-decide-entry.md` (APPROVED).

Throughout: "the daemon halts" means `.pipeline/HALT` is written **and** `.pipeline/HALT.class`
contains exactly `needs-human` — the class is what stops `rekickSweep` from auto-clearing the
guard — **and** no provider session is launched.

## Story 1: An unsatisfied DECIDE step halts instead of authoring

As the operator, when an autonomous run reaches a DECIDE-phase step whose required artifact is
missing, I want the run to halt naming that artifact rather than dispatch an authoring session,
so no plan, stories, or ADR is ever written into a build without my approval.

### Happy Path

- **Given** a merged spec whose `.docs/stories/<slug>.md` has been deleted from the feature
  branch, and a conductor constructed with `daemon: true` whose state has `stories` at `pending`,
- **When** the forward walk reaches the `stories` step,
- **Then** the run writes `.pipeline/HALT` with `.pipeline/HALT.class` containing `needs-human`,
  the halt body names the missing artifact path, and **no provider session is launched**,
- **And** `conduct-state.json` still shows `stories` unresolved, so a later granted resume
  re-evaluates it rather than treating it as done.

### Negative Paths

- **Given** the same run, **when** the step's completion predicate **throws** rather than
  returning false (satisfaction is `'unknown'`), **then** the run halts identically — an
  ambiguous answer is treated exactly like an unsatisfied one, never as satisfied.
- **Given** an equivalent run constructed with `daemon: false` (interactive `/conduct`),
  **when** the same `stories` step is reached unsatisfied, **then** the step is dispatched
  normally and no HALT is written — interactive DECIDE authoring is unchanged.

## Story 2: The resume clamp cannot land the run on a DECIDE step

As the operator, when an autonomous run resumes and its verdict-aware backward clamp selects an
earlier index, I want a clamp onto a DECIDE step to halt rather than silently re-open DECIDE, so
a reconstructed or demoted state file cannot restart authoring.

### Happy Path

- **Given** an autonomous resume whose on-disk verdicts make the earliest unsatisfied gate a
  DECIDE step (the clamp target is `topo.regionStart`, itself a DECIDE step),
- **When** `findResumeIndex` applies the backward clamp,
- **Then** the run halts `needs-human` naming `resume-clamp` as the source gate and the clamped
  target as the requested target, and launches no provider.

### Negative Path

- **Given** an autonomous resume whose earliest unsatisfied gate is a **BUILD**-phase step,
  **when** the clamp is applied, **then** the run clamps and proceeds normally with no HALT —
  known BUILD targets remain autonomously routable.

## Story 3: An unknown or unresolvable kickback target halts instead of vanishing

As the operator, when a gate persists a kickback verdict naming a target the engine cannot
resolve, I want the run to halt rather than drop the verdict silently or route it, so an
unresolvable request is never assumed safe.

### Happy Path

- **Given** an autonomous run and a persisted gate verdict of shape
  `{satisfied:false, kickback:{from:'<gate>', evidence:'…'}}` whose target is a step name present
  in **no** step definition (an unknown or custom name),
- **When** `scanKickbackVerdicts` runs for that gate,
- **Then** the run halts `needs-human` — the scan covers all persisted verdicts, not only
  `topo.kickbackTargets`, so the verdict is detected rather than dropped — and the halt body
  carries the requested target verbatim, including the unresolvable name.

### Negative Paths

- **Given** a kickback whose target **is** resolvable and is a BUILD-phase step, **when** the
  scan runs, **then** it routes via `navigateBack` exactly as today with no HALT.
- **Given** a kickback that has already exhausted `MAX_KICKBACKS_PER_GATE`, **when** the scan
  runs, **then** the run halts with the **ping-pong cap reason unchanged** — the ordering
  (counter bump → event emit → cap check → entry policy → `navigateBack`) is preserved, so the
  cap signal is never masked by an entry refusal.

## Story 4: An unresolvable remediation disposition halts instead of defaulting to build

As the operator, when `/remediate` emits a gap whose disposition names no known step, I want the
run to halt naming that disposition rather than fall back to `build`, so an unresolvable target
never dispatches a provider at a step it was never routed to.

### Happy Path

- **Given** an autonomous run and a remediation gap ledger containing a fix whose `disposition`
  matches no step in the registry,
- **When** `planRemediation` resolves the earliest remediation target,
- **Then** the resolver reports the unresolvable disposition rather than returning its `'build'`
  initializer, and the run halts `needs-human` naming every unresolved disposition and launching
  no provider.

### Negative Paths

- **Given** a gap ledger whose dispositions all resolve to known BUILD-phase steps, **when**
  `planRemediation` runs, **then** it routes exactly as today with no HALT.
- **Given** a gap ledger mixing one resolvable BUILD disposition and one unresolvable
  disposition, **when** `planRemediation` runs, **then** the run halts — a partially resolvable
  ledger is still ambiguous and must not route on the resolvable subset.

## Story 5: The HALT payload tells the operator what to do

As the operator reading a refused DECIDE entry, I want the halt body to identify the source gate,
the requested target, the available evidence, why phase or routing could not be established, and
my choices, so I can act without reconstructing the run's state by hand.

### Happy Path

- **Given** any DECIDE-entry refusal from Stories 1–4,
- **When** the halt is written,
- **Then** `.pipeline/HALT` contains all five fields — **source gate** (the gate that requested
  the move, or `forward-walk` / `resume-clamp`), **requested target** (verbatim, even when
  unresolvable), **evidence** (kickback evidence, remediation gap ledger, or the missing artifact
  path), **why refused** (phase unresolvable / target unknown / artifact unsatisfied / no grant),
  and **operator choices** (direct a return to a named step, correct the routing target, or
  reject the kickback),
- **And** `.pipeline/HALT.class` contains exactly `needs-human`.

### Negative Path

- **Given** a refusal whose requested target is an unresolvable name, **when** the body is
  rendered, **then** the **requested target** field still reports that name verbatim and the
  **why refused** field states that the phase could not be established — the payload must never
  omit or normalize away the field that made the entry ambiguous.

## Story 6: Only an explicit operator grant permits autonomous DECIDE entry

As the operator, I want a DECIDE entry to become permissible only through a command I run
deliberately, scoped to one step and usable once, so neither the daemon nor my routine HALT
cleanup can authorize authoring on my behalf.

### Happy Path

- **Given** a run halted by Story 1 on `plan`, and the operator runs
  `conduct decide-grant --slug <slug> --step plan --reason "<why>"`, which writes
  `.pipeline/decide-grant.json`, and then clears the HALT,
- **When** the run resumes and reaches `plan`,
- **Then** the step is dispatched normally, and the grant is consumed (the file is removed) so it
  cannot authorize a second entry.

### Negative Paths

- **Given** a run halted by Story 1, **when** the operator clears `.pipeline/HALT` and
  `.pipeline/HALT.class` **without** writing a grant and resumes, **then** the run re-halts
  identically — clearing a HALT is not an authorization.
- **Given** a grant naming `plan`, **when** the run reaches an unsatisfied `stories` step,
  **then** the run halts — a grant is scoped to the step it names and authorizes no other.
- **Given** a grant that was already consumed at `plan` earlier in the run, **when** a later seam
  would enter `plan` again, **then** the run halts — a grant is single-use.
- **Given** any autonomous run with no operator command executed, **when** any engine code path
  runs, **then** no grant file is created — the daemon has no code path that writes one.

## Story 7: A healthy spec still reaches BUILD with no added cost

As the operator, when a merged spec is complete and well-formed, I want the autonomous run to
fast-forward through DECIDE exactly as it does today, so the guard costs nothing on the healthy
path.

### Happy Path

- **Given** a merged, complete spec (all tier-required `.docs/` artifacts present) dispatched
  autonomously,
- **When** the run walks the step sequence,
- **Then** every DECIDE step resolves without a HALT and **zero provider sessions are launched
  for any DECIDE step**, the run reaches `acceptance_specs`, and satisfaction is answered only by
  the existing file-I/O completion predicate — no LLM call and no extra dispatch is added.

### Negative Paths

- **Given** a Small-tier spec with no `.docs/conflicts/`, `.docs/architecture/`, or
  `.docs/coherence/` artifacts, **when** the run walks those steps, **then** each fast-forwards
  as `skipped` for the tier and none halts — tier skippability is honored before satisfaction is
  consulted.
- **Given** any tier, **when** the run reaches `explore` or `complexity` — DECIDE steps that
  declare **no** completion contract — **then** each fast-forwards as `skipped` without a HALT
  and without a dispatch, because a step with no required artifact has nothing to verify.
- **Given** a spec whose tier cannot be resolved from state, **when** tier skippability is
  evaluated, **then** it resolves to `L`, which skips nothing — the conservative default, and the
  single resolution replacing today's divergent `'M'` (preseed) and `'L'` (loop) defaults.
